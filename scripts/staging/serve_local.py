#!/usr/bin/env python3
"""Serve the site on this computer, in a way that can only reach the STAGING database.

USE THIS INSTEAD OF `python -m http.server` ON THE v2 BRANCH.

WHY http.server IS NOT ENOUGH
  site/js/config.js picks staging for any address but the published one, which covers every page
  that loads it. But 92 generated lesson pages under site/gemini/ and site/genai/ do not load it.
  They carry the production URL and key directly, for the tutor error log and the GenAI proxy, and
  link to the published submit page. Under http.server they would reach production.

WHAT THIS SERVER DOES (standard library only, changes no file on disk)
  1. REWRITE. Every text file it serves has the production URL and key swapped for staging's, and
     the published site address swapped for this local one.
  2. BLOCK. Every response carries a Content-Security-Policy whose connect-src lists staging and
     does not list production. So if a page ever builds the production address some way that
     step 1 misses, the browser itself refuses the connection.
  3. LIMIT. It binds to 127.0.0.1 and serves only /site/ and /tests/browser/. The repo root holds
     supabase/admin/.env and config.json, which a plain http.server hands to any page that asks.

WHAT IT CANNOT COVER
  A real lesson on claude.ai is not served from here. It still submits to the published site, which
  is production. To test a submission locally, use the local Gemini copy of that lesson.

Refuses to start if config.js has no staging key, or if its staging entry names production.

USAGE
  python scripts/staging/serve_local.py              # then open http://localhost:8000/site/
  python scripts/staging/serve_local.py --port 8080
  python scripts/staging/serve_local.py --check      # prove the rewrite leaves no production value
"""

import argparse
import http.server
import re
import sys
from pathlib import Path
from urllib.parse import unquote, urlsplit

REPO = Path(__file__).resolve().parents[2]
CONFIG = REPO / "site" / "js" / "config.js"
PUBLISHED = "https://dfpm-physics.github.io/Core_Preflights/"
SERVED_ROOTS = ("/site/", "/tests/browser/")
TEXT_SUFFIXES = {".html", ".js", ".mjs", ".css", ".json", ".md", ".txt", ".svg"}
# Hosts a page may call besides this server and staging. Production is not one of them.
OTHER_CONNECT = (
    "https://generativelanguage.googleapis.com",
    "https://cdn.jsdelivr.net",
    "https://cdnjs.cloudflare.com",
)


def read_targets():
    """Read both database entries out of config.js, so they are written down in one place."""
    src = CONFIG.read_text(encoding="utf-8")
    found = {}
    for name in ("PREP_PROD", "PREP_STAGING"):
        m = re.search(
            rf"^const {name} = \{{\s*url:\s*'([^']*)',\s*anon:\s*'([^']*)',?\s*\}};", src, re.M
        )
        if not m:
            sys.exit(f"REFUSED  cannot find {name} in {CONFIG.relative_to(REPO).as_posix()}.")
        found[name] = {"url": m.group(1), "anon": m.group(2)}
    return found["PREP_PROD"], found["PREP_STAGING"]


def make_rewrites(prod, staging, port):
    return [
        (prod["url"].encode(), staging["url"].encode()),
        (prod["anon"].encode(), staging["anon"].encode()),
        (PUBLISHED.encode(), f"http://localhost:{port}/".encode()),
    ]


def rewrite(data, rewrites):
    for old, new in rewrites:
        data = data.replace(old, new)
    return data


def served_files():
    for root in SERVED_ROOTS:
        for path in (REPO / root.strip("/")).rglob("*"):
            if path.is_file() and path.suffix.lower() in TEXT_SUFFIXES:
                yield path


def check(prod, staging, port):
    """Rewrite every servable text file in memory and look for anything left of production."""
    ref = urlsplit(prod["url"]).hostname.split(".")[0].encode()
    rewrites = make_rewrites(prod, {"url": staging["url"], "anon": "sb_publishable_CHECK"}, port)
    total = changed = 0
    left = []
    for path in served_files():
        before = path.read_bytes()
        after = rewrite(before, rewrites)
        total += 1
        changed += after != before
        if ref in after or prod["anon"].encode() in after:
            left.append(path.relative_to(REPO).as_posix())
    print(f"{total} text files checked; {changed} would be rewritten; {len(left)} still name production")
    for name in left[:20]:
        print(f"  {name}")
    return 1 if left else 0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--check", action="store_true", help="prove the rewrite, then exit")
    args = ap.parse_args()

    prod, staging = read_targets()
    if staging["url"] == prod["url"] or urlsplit(prod["url"]).hostname in staging["url"]:
        sys.exit("REFUSED  the staging entry in config.js names the production project.")
    if args.check:
        return check(prod, staging, args.port)
    if not staging["anon"].startswith("sb_publishable_") or staging["anon"] == prod["anon"]:
        sys.exit("REFUSED  config.js has no staging publishable key yet (PREP_STAGING.anon).")

    rewrites = make_rewrites(prod, staging, args.port)
    staging_host = urlsplit(staging["url"]).hostname
    origin = f"http://localhost:{args.port} http://127.0.0.1:{args.port}"
    connect = " ".join(
        ["'self'", origin, f"https://{staging_host}", f"wss://{staging_host}", *OTHER_CONNECT, "blob:", "data:"]
    )
    csp = f"connect-src {connect}"
    served_dirs = [(REPO / root.strip("/")).resolve() for root in SERVED_ROOTS]

    class Handler(http.server.SimpleHTTPRequestHandler):
        # The Windows registry can map .js to text/plain, which makes a browser refuse a module.
        extensions_map = {
            **http.server.SimpleHTTPRequestHandler.extensions_map,
            ".js": "text/javascript",
            ".mjs": "text/javascript",
        }

        def __init__(self, *a, **k):
            super().__init__(*a, directory=str(REPO), **k)

        def end_headers(self):
            self.send_header("Content-Security-Policy", csp)
            self.send_header("Cache-Control", "no-store")
            super().end_headers()

        def _url_path(self):
            return unquote(urlsplit(self.path).path)

        def _is_served(self):
            # Judge the real file, never the URL text: "/site/../supabase/admin/.env" starts with
            # "/site/" and still resolves to the credentials file.
            local = Path(self.translate_path(self.path)).resolve()
            return any(local == root or root in local.parents for root in served_dirs)

        def do_HEAD(self):
            if not self._is_served():
                return self.send_error(404)
            return super().do_HEAD()

        def do_GET(self):
            if self._url_path() == "/":
                self.send_response(302)
                self.send_header("Location", "/site/")
                self.end_headers()
                return None
            if not self._is_served():
                return self.send_error(404)
            local = Path(self.translate_path(self.path))
            if local.is_dir() and self._url_path().endswith("/"):
                local = local / "index.html"
            if not (local.is_file() and local.suffix.lower() in TEXT_SUFFIXES):
                return super().do_GET()
            body = rewrite(local.read_bytes(), rewrites)
            self.send_response(200)
            self.send_header("Content-Type", self.guess_type(str(local)))
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return None

    server = http.server.ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"Serving http://localhost:{args.port}/site/  ->  database {staging_host}", flush=True)
    print("Production is rewritten away and blocked by the browser. Ctrl+C to stop.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
