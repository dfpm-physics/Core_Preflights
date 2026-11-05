#!/usr/bin/env python3
"""Check (and write) the Content-Security-Policy and script pinning of every shipped page. Standard library only.

WHY A META TAG
  GitHub Pages cannot send response headers, so a policy can only ride in each page as
  <meta http-equiv="Content-Security-Policy">. A meta policy cannot carry `frame-ancestors`, `report-uri` or `sandbox`;
  those stay unavailable until the site is served from somewhere that can set headers.

WHAT THE POLICY SAYS
  * script-src: this origin, the exact URL of each pinned library the page loads, and the SHA-256 hash of each inline
    script the page carries. No `unsafe-inline` and no `unsafe-eval` for scripts, so an injected script tag or an
    inline event handler does not run. A page's hashes are computed from the page itself.
  * connect-src: this origin and the database project's host, so a script that did run cannot send data elsewhere.
  * object-src none, base-uri and form-action this origin.
  * style-src keeps `unsafe-inline`: the pages use style attributes throughout, and styles carry far less risk.

WHAT IT CHECKS (exit 1 on any miss)
  1. Every external <script src> is a pinned URL listed in PINNED below (exact version, not a floating one such as
     `@2` or `latest`), with the integrity value recorded for it and crossorigin="anonymous".
  2. Every shipped page carries one CSP meta tag equal to the policy built from that page. An inline script edited
     without rebuilding the policy therefore fails here, not in a cadet's browser.
  3. No inline event handler attribute (onclick=, onerror=, ...) and no javascript: link in a page, and none in a
     string template under site/js, because the policy would block them.

NOT COVERED: site/gemini/ and site/genai/ (generated backup builds with their own loaders and their own tooling).
They are left as they are, and say so here so the gap is a decision and not an oversight.

Usage:
  python scripts/checks/csp_pages.py            check; exit 1 on any miss
  python scripts/checks/csp_pages.py --write    rebuild each page's CSP meta tag, then check
Changing a library: add its exact URL and integrity to PINNED, point the page at it, run with --write.
Computing an integrity value is a one-time act on the bytes the CDN serves for that exact version:
  curl -s <url> | openssl dgst -sha384 -binary | openssl base64 -A    (prefix the result with "sha384-")
"""
import base64
import hashlib
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SITE = ROOT / "site"
SKIP_DIRS = {"gemini", "genai"}

# exact URL -> integrity. The only external scripts a shipped page may load.
PINNED = {
    "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0/dist/umd/supabase.js":
        "sha384-uteMfOloLDGt042uDz+xHGF3ym63/WQ6rFq7murQRG8Ih7QrXGEGNtWd8688sb4O",
    "https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.0/marked.min.js":
        "sha384-NNQgBjjuhtXzPmmy4gurS5X7P4uTt1DThyevz4Ua0IVK5+kazYQI1W27JHjbbxQz",
    "https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.0.9/purify.min.js":
        "sha384-3HPB1XT51W3gGRxAmZ+qbZwRpRlFQL632y8x+adAqCr4Wp3TaWwCLSTAJJKbyWEK",
    "https://cdnjs.cloudflare.com/ajax/libs/lz-string/1.5.0/lz-string.min.js":
        "sha384-0d+Gr7vM4Drod8E3hXKgciWJSWbjD/opKLLygI9ktiWbuvlDwQLzU46wJ9s5gsp7",
}

# data blocks are not executed and are not governed by script-src
EXECUTABLE_TYPES = {"", "module", "text/javascript", "application/javascript", "importmap", "speculationrules"}

SCRIPT_RE = re.compile(r"<script\b([^>]*)>(.*?)</script\s*>", re.I | re.S)
ATTR_RE = re.compile(r"([A-Za-z_:][\w:.-]*)(?:\s*=\s*(?:\"([^\"]*)\"|'([^']*)'|([^\s\"'>]+)))?")
HANDLER_RE = re.compile(r"""\s(on[a-z]+)\s*=\s*["']""", re.I)
META_RE = re.compile(r"""[ \t]*<meta\s+http-equiv=["']Content-Security-Policy["'][^>]*>[ \t]*(?:\r?\n)?""", re.I)
CHARSET_RE = re.compile(r"""<meta\s+charset=[^>]*>""", re.I)
FLOATING_RE = re.compile(r"""(@latest\b|/latest/|@\d+(?=[/"'?]|$)|@\d+\.\d+(?=[/"'?]|$)|@\^|@~)""")

BASE_POLICY = [
    ("default-src", ["'self'"]),
    ("style-src", ["'self'", "'unsafe-inline'"]),
    ("img-src", ["'self'", "data:", "blob:", "https://*.supabase.co", "https://dfpm-physics.github.io"]),
    ("connect-src", ["'self'", "https://*.supabase.co", "wss://*.supabase.co"]),
    ("font-src", ["'self'", "data:"]),
    ("object-src", ["'none'"]),
    ("base-uri", ["'self'"]),
    ("form-action", ["'self'"]),
]


def attrs(raw):
    out = {}
    for m in ATTR_RE.finditer(raw):
        out[m.group(1).lower()] = m.group(2) if m.group(2) is not None else (m.group(3) if m.group(3) is not None else (m.group(4) or ""))
    return out


def lf(text):
    """The HTML parser turns CR LF into LF before a script's text is hashed, so the hash is taken over the LF form."""
    return text.replace("\r\n", "\n").replace("\r", "\n")


def sha256_source(text):
    return "'sha256-" + base64.b64encode(hashlib.sha256(lf(text).encode("utf-8")).digest()).decode() + "'"


def scripts_of(html):
    """[(attrs, inline_text_or_None)] for every executable <script> in the page."""
    out = []
    for m in SCRIPT_RE.finditer(html):
        a = attrs(m.group(1))
        if a.get("type", "").lower() not in EXECUTABLE_TYPES:
            continue
        out.append((a, None if "src" in a else m.group(2)))
    return out


def build_policy(html):
    ext = sorted({a["src"] for a, inline in scripts_of(html) if inline is None and re.match(r"https?://", a["src"])})
    hashes = sorted({sha256_source(t) for _, t in scripts_of(html) if t is not None and t.strip()})
    script_src = ["'self'", *ext, *hashes]
    parts = [("default-src", BASE_POLICY[0][1]), ("script-src", script_src), *BASE_POLICY[1:]]
    return "; ".join(f"{k} {' '.join(v)}" for k, v in parts)


def meta_tag(policy):
    return f'<meta http-equiv="Content-Security-Policy" content="{policy}">'


def page_problems(html, name="page"):
    """Every reason a page fails. [] when it is fine."""
    problems = []
    text = lf(html)
    for a, inline in scripts_of(text):
        if inline is None:
            src = a["src"]
            if re.match(r"(https?:)?//", src):
                if src not in PINNED:
                    why = "a floating version" if FLOATING_RE.search(src) else "not in the pinned list"
                    problems.append(f"{name}: external script {src} is {why}")
                else:
                    if a.get("integrity") != PINNED[src]:
                        problems.append(f"{name}: {src} lacks the recorded integrity value")
                    if a.get("crossorigin", None) != "anonymous":
                        problems.append(f'{name}: {src} lacks crossorigin="anonymous"')
    body = SCRIPT_RE.sub("", text)
    for m in HANDLER_RE.finditer(body):
        problems.append(f"{name}: inline event handler attribute {m.group(1)}= (the policy blocks it)")
    if re.search(r"""(?:href|src|action)\s*=\s*["']\s*javascript:""", body, re.I):
        problems.append(f"{name}: a javascript: URL (the policy blocks it)")
    metas = META_RE.findall(text)
    if len(metas) != 1:
        problems.append(f"{name}: expected one Content-Security-Policy meta tag, found {len(metas)}")
    else:
        found = re.search(r'content="([^"]*)"', metas[0])
        want = build_policy(text)
        if not found or found.group(1) != want:
            problems.append(f"{name}: the policy does not match the page (an inline script or a library changed; run --write)")
    return problems


def with_policy(html):
    """The page with its CSP meta rebuilt (inserted straight after the charset tag if absent)."""
    nl = "\r\n" if "\r\n" in html else "\n"
    text = lf(html)
    text = META_RE.sub("", text)
    tag = meta_tag(build_policy(text))
    m = CHARSET_RE.search(text)
    if not m:
        raise ValueError("no <meta charset> to place the policy after")
    text = text[:m.end()] + "\n  " + tag + text[m.end():]
    return text.replace("\n", nl) if nl == "\r\n" else text


def pages():
    return sorted(p for p in SITE.rglob("*.html") if not (set(p.relative_to(SITE).parts) & SKIP_DIRS))


def js_template_problems():
    out = []
    for p in sorted((SITE / "js").glob("*.js")):
        for i, line in enumerate(lf(p.read_text(encoding="utf-8", errors="replace")).split("\n"), 1):
            if re.search(r"""<[a-z][^>]*\son(?:error|click|load|change|input|submit|focus|blur)\s*=\s*["\\$]""", line, re.I):
                out.append(f"{p.relative_to(ROOT).as_posix()}:{i}: an inline event handler inside an HTML string (the policy blocks it)")
    return out


def main(argv):
    write = "--write" in argv
    problems = []
    for p in pages():
        raw = p.read_bytes().decode("utf-8")
        if write:
            new = with_policy(raw)
            if new != raw:
                p.write_bytes(new.encode("utf-8"))
                raw = new
        problems += page_problems(raw, p.relative_to(ROOT).as_posix())
    problems += js_template_problems()
    for line in problems:
        print("FAIL " + line)
    print(f"{len(pages())} pages checked, {len(problems)} problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
