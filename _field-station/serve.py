#!/usr/bin/env python3
"""Serve the site with the Field Station overlay on top, against STAGING only.

This is `scripts/staging/serve_local.py` plus a layer. It imports that file and reuses its
database targets, its rewrite (production URL and key swapped for staging's, published address
swapped for this local one), its list of served roots and its refusals. Nothing in `site/` changes.

WHAT THE OVERLAY ADDS
  1. A request under /site/ is answered from `_field-station/site/` when that file exists there,
     otherwise from `site/`. Delete the folder and the plain site comes back.
  2. Every portal HTML page gets one stylesheet link and one module script link, added in memory
     as it is served, before </head>. Tutor lesson pages (site/gemini, site/genai) are left alone.
  3. One alias: /site/js/nav-base.js is the real site/js/nav.js, so the overlay nav.js can reuse
     it whole instead of copying it.

WHAT IT KEEPS
  The browser still refuses any connection to production (the same connect-src policy header), it
  binds to 127.0.0.1 only, and it serves nothing outside the two site trees. It refuses to start
  if config.js has no staging key, or if its staging entry names production.

USAGE (from the repo root, Windows PowerShell)
  python _field-station/serve.py --port 8045
  python _field-station/serve.py --check       # prove the rewrite leaves no production value
"""

import argparse
import http.server
import importlib.util
import mimetypes
import re
import sys
from pathlib import Path
from urllib.parse import unquote, urlsplit

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
BASE_SCRIPT = REPO / "scripts" / "staging" / "serve_local.py"
OVERLAY_SITE = HERE / "site"
REAL_SITE = REPO / "site"

spec = importlib.util.spec_from_file_location("serve_local", BASE_SCRIPT)
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)  # defines functions only; its main() is not called

ALIASES = {"js/nav-base.js": "js/nav.js"}
# Tutor lesson pages are generated artifacts with their own look. They are not portal pages.
NO_INJECT = ("gemini/", "genai/", "vendor/", "help/")
CSS_LINK = "fs/field-station.css"
JS_LINK = "fs/field-station.js"


def resolve(rel: str):
    """Return the file that answers /site/<rel>, or None."""
    rel = rel.lstrip("/")
    if rel == "" or rel.endswith("/"):
        rel += "index.html"
    for root, name in ((OVERLAY_SITE, rel), (REAL_SITE, ALIASES.get(rel, rel))):
        try:
            path = (root / name).resolve()
            if (path == root or root.resolve() in path.parents) and path.is_file():
                return path
        except (ValueError, OSError):      # a NUL byte or a name Windows will not take: not a file here
            return None
    return None


def inject(html: bytes, rel: str) -> bytes:
    if any(rel.lower().startswith(p) for p in NO_INJECT) or b"data-fs-injected" in html:
        return html
    depth = rel.count("/")
    prefix = "../" * depth
    tags = (
        f'<link rel="stylesheet" href="{prefix}{CSS_LINK}" data-fs-injected>\n'
        f'<script type="module" src="{prefix}{JS_LINK}"></script>\n'
    ).encode()
    low = html.lower()
    i = low.find(b"</head>")
    return html if i < 0 else html[:i] + tags + html[i:]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8045)
    ap.add_argument("--check", action="store_true", help="prove the rewrite, then exit")
    args = ap.parse_args()

    prod, staging = base.read_targets()
    if staging["url"] == prod["url"] or base.urlsplit(prod["url"]).hostname in staging["url"]:
        sys.exit("REFUSED  the staging entry in config.js names the production project.")
    if args.check:
        rc = base.check(prod, staging, args.port)
        rewrites = base.make_rewrites(prod, {"url": staging["url"], "anon": "sb_publishable_CHECK"}, args.port)
        ref = base.urlsplit(prod["url"]).hostname.split(".")[0].encode()
        bad = []
        for p in OVERLAY_SITE.rglob("*"):
            if p.is_file() and p.suffix.lower() in base.TEXT_SUFFIXES:
                out = base.rewrite(p.read_bytes(), rewrites)
                if ref in out or prod["anon"].encode() in out:
                    bad.append(p.relative_to(REPO).as_posix())
        print(f"overlay: {len(bad)} file(s) name production")
        return 1 if (rc or bad) else 0
    if not staging["anon"].startswith("sb_publishable_") or staging["anon"] == prod["anon"]:
        sys.exit("REFUSED  config.js has no staging publishable key yet (PREP_STAGING.anon).")

    rewrites = base.make_rewrites(prod, staging, args.port)
    staging_host = base.urlsplit(staging["url"]).hostname
    origin = f"http://localhost:{args.port} http://127.0.0.1:{args.port}"
    connect = " ".join(["'self'", origin, f"https://{staging_host}", f"wss://{staging_host}",
                        *base.OTHER_CONNECT, "blob:", "data:"])
    csp = f"connect-src {connect}"

    class Handler(http.server.BaseHTTPRequestHandler):
        server_version = "FieldStation/1"

        def log_message(self, fmt, *a):  # quiet; the console stays readable
            pass

        def _send(self, status, body=b"", ctype="text/plain; charset=utf-8", extra=None):
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Content-Security-Policy", csp)
            self.send_header("Cache-Control", "no-store")
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)

        def _serve(self):
            path = unquote(urlsplit(self.path).path)
            if chr(0) in path or "\\" in path:
                return self._send(400, b"bad request")
            path = re.sub(r"/{2,}", "/", path)     # /site//student/x.html is /site/student/x.html, and is styled the same
            if path == "/":
                return self._send(302, extra={"Location": "/site/"})
            if not path.startswith("/site/"):
                return self._send(404, b"not found")
            rel = path[len("/site/"):]
            f = resolve(rel)
            if f is None:
                return self._send(404, b"not found")
            ctype = {".js": "text/javascript", ".mjs": "text/javascript"}.get(f.suffix.lower()) \
                or mimetypes.guess_type(str(f))[0] or "application/octet-stream"
            data = f.read_bytes()
            if f.suffix.lower() in base.TEXT_SUFFIXES:
                data = base.rewrite(data, rewrites)
                if f.suffix.lower() == ".html":
                    data = inject(data, rel if not rel.endswith("/") and rel else "index.html")
                if ctype.startswith("text/") or ctype.endswith("json") or ctype.endswith("svg+xml"):
                    ctype += "; charset=utf-8"
            return self._send(200, data, ctype)

        do_GET = do_HEAD = _serve

    server = http.server.ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"Field Station overlay on http://localhost:{args.port}/site/  ->  database {staging_host}", flush=True)
    print("Production is rewritten away and blocked by the browser. Ctrl+C to stop.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
