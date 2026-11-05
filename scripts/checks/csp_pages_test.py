#!/usr/bin/env python3
"""Offline tests for scripts/checks/csp_pages.py. No network, no database, no credential.

Part 1 runs the checker over the real pages. Part 2 runs it over small invented pages that each break one rule, and
each must be reported, so a checker that quietly passed everything would fail here.

Prints [pass] / [FAIL] lines; exit 1 on any failure.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import csp_pages as C  # noqa: E402

passed = failed = 0


def check(desc, ok, detail=""):
    global passed, failed
    if ok:
        passed += 1
        print(f"  [pass] {desc}")
    else:
        failed += 1
        print(f"  [FAIL] {desc}{(' - ' + str(detail)) if detail else ''}")


SB = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0/dist/umd/supabase.js"
PIN = f'<script src="{SB}" integrity="{C.PINNED[SB]}" crossorigin="anonymous"></script>'


def page(body="", head_extra="", with_meta=True):
    """An invented page; the policy is built from it unless with_meta is false."""
    html = f'<!DOCTYPE html>\n<html><head>\n<meta charset="UTF-8">\n{head_extra}</head><body>{body}</body></html>\n'
    return C.with_policy(html) if with_meta else html


print("\n=== the real pages ===")
real = C.pages()
check("there are shipped pages to check", len(real) >= 30, len(real))
check("the generated backup builds are not part of the check", not any("gemini" in p.parts or "genai" in p.parts for p in real))
bad = []
for p in real:
    bad += C.page_problems(p.read_bytes().decode("utf-8"), p.relative_to(C.ROOT).as_posix())
check("every shipped page is pinned, has the policy it should and carries no inline handler", not bad, bad[:3])
check("no site/js string template carries an inline handler", not C.js_template_problems(), C.js_template_problems()[:3])
frozen = (C.SITE / "student" / "interaction-submit.html").read_bytes().decode("utf-8")
check("the frozen submit page keeps its pending-report hash script", "cp.pendingReport" in frozen and "location.hash" in frozen)
import re  # noqa: E402
check("every pinned library URL names an exact x.y.z version", all(re.search(r"[@/]\d+\.\d+\.\d+[/]", u) for u in C.PINNED), list(C.PINNED))

print("\n=== the policy text ===")
pol = C.build_policy(page(PIN + "<script>var a = 1;</script>", with_meta=False))
check("scripts: this origin, the exact URL, and the hash of the inline script",
      "script-src 'self' " + SB in pol and "'sha256-" in pol)
check("scripts: no unsafe-inline and no unsafe-eval", "script-src" in pol and "'unsafe-eval'" not in pol and
      "'unsafe-inline'" not in pol.split("style-src")[0])
check("connections go to this origin and the database host only", "connect-src 'self' https://*.supabase.co wss://*.supabase.co" in pol)
check("plugins, base and forms are closed", all(x in pol for x in ("object-src 'none'", "base-uri 'self'", "form-action 'self'")))
check("the hash is taken over the LF form, so a CRLF working tree and an LF repository agree",
      C.build_policy("<script>a\r\nb</script>") == C.build_policy("<script>a\nb</script>"))

print("\n=== a page that breaks one rule is reported ===")
check("a clean invented page passes", C.page_problems(page(PIN + "<script>1</script>")) == [])
unpinned = page('<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>')
p = C.page_problems(unpinned)
check("an unpinned (floating-version) script tag fails", any("floating version" in x for x in p), p)
p = C.page_problems(page('<script src="https://cdn.jsdelivr.net/npm/some-other-package@1.0.0/x.js"></script>'))
check("an exact version that is not in the pinned list fails", any("not in the pinned list" in x for x in p), p)
p = C.page_problems(page(f'<script src="{SB}" crossorigin="anonymous"></script>'))
check("a pinned URL with no integrity fails", any("integrity" in x for x in p), p)
p = C.page_problems(page(f'<script src="{SB}" integrity="sha384-AAAA" crossorigin="anonymous"></script>'))
check("a pinned URL with the wrong integrity fails", any("integrity" in x for x in p), p)
p = C.page_problems(page(f'<script src="{SB}" integrity="{C.PINNED[SB]}"></script>'))
check("a pinned URL with no crossorigin fails", any("crossorigin" in x for x in p), p)
p = C.page_problems(page('<script src="//cdn.example/x.js"></script>'))
check("a protocol-relative external script fails", any("not in the pinned list" in x or "floating" in x for x in p), p)
p = C.page_problems(page(PIN, with_meta=False))
check("a page with no policy fails", any("expected one Content-Security-Policy" in x for x in p), p)
good = page("<script>var a = 1;</script>")
p = C.page_problems(good.replace("var a = 1;", "var a = 2;"))
check("an inline script edited after the policy was built fails", any("does not match" in x for x in p), p)
p = C.page_problems(page('<button onclick="go()">x</button>'))
check("an inline event handler attribute fails", any("onclick" in x for x in p), p)
p = C.page_problems(page('<a href="javascript:alert(1)">x</a>'))
check("a javascript: link fails", any("javascript:" in x for x in p), p)
p = C.page_problems(page('<script type="application/json">{"a":1}</script>'))
check("a JSON data block is not treated as a script", p == [], p)
p = C.page_problems(page("<script>var a = 1;</script>").replace("</head>", PIN + "</head>"))
check("adding a library after the policy was built fails", any("does not match" in x for x in p), p)
check("rewriting is stable: a second write changes nothing", C.with_policy(good) == good)

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
