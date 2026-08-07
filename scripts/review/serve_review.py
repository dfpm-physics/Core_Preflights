#!/usr/bin/env python3
"""serve_review.py — local review page for the PHYS 310 Murray grounding corpus.

    python scripts/review/serve_review.py
    python scripts/review/serve_review.py --source <path> --port 8765 --no-open

`courses/phys-310/texts/MURRAY-GROUNDING.md` is reconstructed from model knowledge, not
extracted from a book, and it gates every build: a lesson cannot be built while any of its
sections is `STATUS: PENDING`. recker clears that gate by reading each section against a
physical copy of Murray. This serves those sections one screen at a time and writes the
decision back.

**Approving writes to the corpus.** It rewrites that section's `STATUS: PENDING` line to
`STATUS: REVIEWED <date>` — the exact string the gate greps for. That is deliberate: a
sidecar file recording approvals would be a second source of truth, and the build would keep
reading the first one. Rejections stay out of the corpus and go to a sidecar, because the
corpus has no slot for them and inventing one would change a format other tooling reads.

Four rules the writeback obeys, each of which is a way this could go wrong:

1. **Only the STATUS line is ever rewritten.** The physics, flags, and cross-check text is
   passed through byte-for-byte. This tool has no business editing prose recker is reviewing.
2. **The file is re-read immediately before every write** and the write is refused if it
   changed since the page was rendered. Another session edits this corpus; a blind write
   would silently revert its work.
3. **Writes are atomic** — temp file, then replace. A half-written corpus blocks every build.
4. **Rejections never touch the corpus.** A rejected section stays `PENDING`, which is
   already the correct state for "not approved".

Standard library only (`CORE.md` §2). Binds to loopback.
"""

import argparse
import datetime
import hashlib
import html
import json
import pathlib
import re
import sys
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

REPO = pathlib.Path(__file__).resolve().parent.parent.parent
DEFAULT_SOURCE = REPO / "_builder" / "courses" / "phys-310" / "texts" / "MURRAY-GROUNDING.md"

SECTION_RE = re.compile(r"^## (§.+?)\s*$", re.M)
STATUS_RE = re.compile(r"^\*\*STATUS:\s*(PENDING|REVIEWED[^*]*?)\s*\*\*(.*)$", re.M)


def say(msg: str = "") -> None:
    """print() that cannot raise on a Windows console.

    `PROJECT.md` §9's pipe-encoding edge in its other form: a bare print of a non-ASCII
    character — the section titles here are full of `§` and em-dashes — raises
    UnicodeEncodeError under cp1252. Inside a request handler that kills the connection
    mid-save, and the browser reports a network failure for a write that already landed.
    """
    enc = getattr(sys.stdout, "encoding", None) or "utf-8"
    sys.stdout.write(msg.encode(enc, "replace").decode(enc, "replace") + "\n")
    sys.stdout.flush()


# ── parsing ──────────────────────────────────────────────────────────────────

def parse_corpus(path: pathlib.Path):
    """Return (raw_text, [section, ...]). Sections are `## §…` blocks."""
    raw = path.read_text(encoding="utf-8")
    marks = list(SECTION_RE.finditer(raw))
    if not marks:
        sys.exit(f"error: no '## §…' sections in {path.name} — has the corpus format changed?")

    sections = []
    for n, m in enumerate(marks):
        start = m.start()
        stop = marks[n + 1].start() if n + 1 < len(marks) else len(raw)
        block = raw[start:stop]

        smatch = STATUS_RE.search(block)
        status_raw = smatch.group(1).strip() if smatch else ""
        lesson = smatch.group(2).strip().lstrip("·").strip() if smatch else ""
        reviewed = status_raw.upper().startswith("REVIEWED")

        # body = everything after the status line (or after the heading if there is none)
        cut = smatch.end() if smatch else m.end()
        body = block[cut - start:].strip("\n")

        sections.append({
            "id": "s%02d" % n,
            "title": m.group(1).strip(),
            "lesson": lesson,
            "status": status_raw,
            "reviewed": reviewed,
            "text": body,
            "sha": hashlib.sha256(body.encode("utf-8")).hexdigest()[:16],
            "words": len(body.split()),
        })
    return raw, sections


def set_reviewed(raw: str, title: str, when: str):
    """Rewrite one section's STATUS line to REVIEWED. Returns (new_raw, changed)."""
    marks = list(SECTION_RE.finditer(raw))
    for n, m in enumerate(marks):
        if m.group(1).strip() != title:
            continue
        start, stop = m.start(), (marks[n + 1].start() if n + 1 < len(marks) else len(raw))
        block = raw[start:stop]
        smatch = STATUS_RE.search(block)
        if not smatch:
            return raw, False
        if smatch.group(1).strip().upper().startswith("REVIEWED"):
            return raw, False                      # already reviewed; leave it alone
        tail = smatch.group(2)                     # " · Lesson 3 — Binding Energy…"
        new_line = f"**STATUS: REVIEWED {when}**{tail}"
        new_block = block[:smatch.start()] + new_line + block[smatch.end():]
        return raw[:start] + new_block + raw[stop:], True
    return raw, False


# ── sidecar (rejections + notes only) ────────────────────────────────────────

def notes_path(source: pathlib.Path) -> pathlib.Path:
    return source.parent / (source.stem.lower() + "-review-notes.json")


def load_notes(path: pathlib.Path) -> dict:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8")).get("sections", {})
    except (json.JSONDecodeError, OSError) as exc:
        sys.exit(f"error: {path.name} unreadable ({exc}). Move it aside rather than "
                 f"letting this overwrite it.")


def save_notes(path: pathlib.Path, source: pathlib.Path, existing: dict, incoming: dict) -> dict:
    merged = dict(existing)
    for sid, rec in incoming.items():
        prev = merged.get(sid, {})
        note = rec.get("note", "").strip() or prev.get("note", "")
        decision = rec.get("decision", "") or prev.get("decision", "")
        if not note and decision != "rejected":
            merged.pop(sid, None)                  # nothing worth recording
            continue
        merged[sid] = {"decision": decision, "note": note,
                       "sha": rec.get("sha", prev.get("sha", "")),
                       "title": rec.get("title", prev.get("title", ""))}
    payload = {
        "source": str(source.relative_to(REPO)).replace("\\", "/"),
        "note": "Rejections and reviewer notes from scripts/review/serve_review.py. "
                "APPROVALS ARE NOT HERE - they are written into the corpus as "
                "'STATUS: REVIEWED <date>', which is what gates a build. `sha` is the "
                "section text as reviewed; if it no longer matches, the section was "
                "rewritten after the note was taken.",
        "sections": merged,
    }
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(path)
    return merged


# ── page ─────────────────────────────────────────────────────────────────────

PAGE = r"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Murray grounding review — PHYS 310</title>
<style>
  :root{--navy:#1b2a4a;--navy-light:#243560;--blue:#3b82f6;--line:#e2e8f0;--text:#0f172a;
        --soft:#64748b;--muted:#94a3b8;--bg:#f8fafc;--ok:#16a34a;--ok-bg:#f0fdf4;--ok-line:#86efac;
        --no:#dc2626;--no-bg:#fef2f2;--no-line:#fecaca;--warn:#b45309;--warn-bg:#fffbeb;
        --warn-line:#fde047;--mono:"SF Mono","Cascadia Code","Fira Mono",Consolas,monospace}
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--text);
       line-height:1.6;padding-bottom:76px}
  header{background:var(--navy);color:#fff;padding:16px 28px;position:sticky;top:0;z-index:10}
  .eyebrow{font-family:var(--mono);font-size:10px;letter-spacing:.12em;text-transform:uppercase;
           color:#bfdbfe;margin-bottom:3px}
  h1{font-size:17px;font-weight:700}
  .sub{font-size:12px;color:#94a3b8;margin-top:3px}
  .bar{display:flex;gap:8px;align-items:center;margin-top:11px;flex-wrap:wrap}
  .pill{font-family:var(--mono);font-size:11px;padding:3px 10px;border-radius:99px;
        background:rgba(255,255,255,.12);color:#e2e8f0}
  .pill.ok{background:rgba(22,163,74,.3);color:#bbf7d0}
  .pill.no{background:rgba(220,38,38,.3);color:#fecaca}
  .filter{margin-left:auto;display:flex;gap:6px}
  .filter button{font-size:11px;padding:4px 11px;border-radius:99px;border:1px solid rgba(255,255,255,.25);
                 background:transparent;color:#cbd5e1;cursor:pointer;font-family:var(--mono)}
  .filter button.on{background:#fff;color:var(--navy);border-color:#fff;font-weight:700}
  main{max-width:1000px;margin:0 auto;padding:22px 20px}
  .intro{background:#fff;border:1px solid var(--line);border-radius:12px;padding:15px 18px;
         margin-bottom:18px;font-size:13.5px;color:#334155}
  .intro b{color:var(--text)}
  .intro code{font-family:var(--mono);font-size:.88em;background:rgba(15,23,42,.06);padding:1px 5px;
              border-radius:4px}
  section{background:#fff;border:1px solid var(--line);border-radius:12px;margin-bottom:14px;overflow:hidden}
  section.approved{border-color:var(--ok-line)}
  section.rejected{border-color:var(--no-line)}
  section.locked{opacity:.62}
  .head{padding:12px 18px;border-bottom:1px solid var(--line);display:flex;gap:11px;
        align-items:baseline;flex-wrap:wrap;background:#fcfdfe;cursor:pointer}
  section.approved .head{background:var(--ok-bg)}
  section.rejected .head{background:var(--no-bg)}
  section.locked .head{background:var(--ok-bg)}
  .num{font-family:var(--mono);font-size:11px;color:var(--muted)}
  .title{font-size:14px;font-weight:700;flex:1;min-width:220px}
  .lesson{font-size:11.5px;color:var(--soft)}
  .state{font-family:var(--mono);font-size:10px;text-transform:uppercase;letter-spacing:.07em;
         padding:2px 8px;border-radius:4px;white-space:nowrap}
  .state.approved,.state.locked{background:var(--ok);color:#fff}
  .state.rejected{background:var(--no);color:#fff}
  .state.pending{background:#e2e8f0;color:var(--soft)}
  .bodywrap{display:none}
  section.open .bodywrap{display:block}
  pre{font-family:var(--mono);font-size:12.5px;line-height:1.6;padding:15px 18px;white-space:pre-wrap;
      overflow-wrap:break-word;color:#1e293b;max-height:520px;overflow-y:auto}
  .foot{padding:11px 18px;border-top:1px solid var(--line);display:flex;gap:8px;align-items:center;
        flex-wrap:wrap;background:#fcfdfe}
  button.act{font-family:inherit;font-size:13px;font-weight:600;padding:6px 15px;border-radius:6px;
             cursor:pointer;border:1.5px solid var(--line);background:#fff;color:var(--soft)}
  button.act.yes.on{background:var(--ok);border-color:var(--ok);color:#fff}
  button.act.no.on{background:var(--no);border-color:var(--no);color:#fff}
  .words{font-family:var(--mono);font-size:11px;color:var(--muted);margin-left:auto}
  textarea{width:100%;margin-top:9px;padding:9px 11px;border:1.5px solid #cbd5e1;border-radius:6px;
           font-family:inherit;font-size:13px;resize:vertical;min-height:34px;outline:none}
  textarea:focus{border-color:var(--blue)}
  .notewrap{padding:0 18px 13px;display:none}
  .notewrap.show{display:block}
  .notewrap label{font-size:11px;color:var(--soft);font-weight:600}
  footer{position:fixed;bottom:0;left:0;right:0;background:#fff;border-top:1px solid var(--line);
         padding:11px 28px;display:flex;gap:14px;align-items:center;box-shadow:0 -1px 8px rgba(15,23,42,.06)}
  .save{background:var(--navy);color:#fff;border:1.5px solid var(--navy);padding:9px 22px;
        border-radius:6px;font-weight:600;font-size:13px;cursor:pointer;font-family:inherit}
  .status{font-size:12.5px;color:var(--soft)}
  .status.good{color:var(--ok);font-weight:600}
  .status.bad{color:var(--no);font-weight:600}
</style></head><body>
<header>
  <div class="eyebrow">PHYS 310 · Murray grounding corpus · local review</div>
  <h1>Section review — approving writes STATUS: REVIEWED into the corpus</h1>
  <div class="sub">__SOURCE__</div>
  <div class="bar">
    <span class="pill" id="p-tot"></span>
    <span class="pill ok" id="p-ok"></span>
    <span class="pill no" id="p-no"></span>
    <span class="pill" id="p-left"></span>
    <span class="filter">
      <button id="f-all" class="on" onclick="setFilter('all')">all</button>
      <button id="f-pending" onclick="setFilter('pending')">pending only</button>
    </span>
  </div>
</header>
<main>
  <div class="intro">
    <p><b>This corpus is reconstructed from model knowledge, not extracted from the book.</b> It is
    the tutor's only source of physics at runtime, and a lesson cannot be built while any of its
    sections is <code>PENDING</code>. Read each against your copy of Murray.</p>
    <p style="margin-top:7px">Each section ends with a <b>Flags</b> paragraph — that is the agent
    naming what it is unsure of (whether an example is Murray's, which value a text quotes). Those
    are the fastest things to confirm or kill.</p>
    <p style="margin-top:7px"><b>Approve</b> rewrites that section's status line to
    <code>STATUS: REVIEWED</code> in the corpus itself — nothing else in the section is touched.
    <b>Reject</b> leaves it <code>PENDING</code> and saves your note to
    <code>__NOTES__</code> for me to rewrite from. Already-reviewed sections are shown locked;
    click a header to expand any section.</p>
  </div>
  <div id="sections"></div>
</main>
<footer>
  <button class="save" onclick="save()">Save decisions</button>
  <span class="status" id="status">Nothing saved yet.</span>
</footer>
<script>
const SECTIONS = __SECTIONS__;
const NOTES = __NOTES_JSON__;
const state = {};
let filter = "all";

SECTIONS.forEach(s => {
  const prev = NOTES[s.id];
  state[s.id] = {
    decision: s.reviewed ? "locked" : (prev && prev.decision === "rejected" ? "rejected" : ""),
    note: prev ? (prev.note || "") : "",
    open: false,
  };
});

function setFilter(f){ filter=f;
  document.getElementById("f-all").className = f==="all"?"on":"";
  document.getElementById("f-pending").className = f==="pending"?"on":"";
  render(); }

function render() {
  const host = document.getElementById("sections");
  host.innerHTML = "";
  SECTIONS.forEach((s, i) => {
    const st = state[s.id];
    if (filter === "pending" && (st.decision === "locked" || st.decision === "approved")) return;
    const cls = st.decision === "locked" ? "locked"
              : st.decision === "approved" ? "approved"
              : st.decision === "rejected" ? "rejected" : "";
    const el = document.createElement("section");
    el.className = cls + (st.open ? " open" : "");
    const label = st.decision === "locked" ? "reviewed " + s.status.replace(/^REVIEWED\s*/i,"")
                : st.decision || "pending";
    el.innerHTML = `
      <div class="head" onclick="toggle('${s.id}')">
        <span class="num">${String(i+1).padStart(2,"0")}</span>
        <span class="title"></span>
        <span class="lesson"></span>
        <span class="state ${cls || "pending"}"></span>
      </div>
      <div class="bodywrap">
        <pre></pre>
        <div class="foot">
          <button class="act yes ${st.decision==="approved"?"on":""}"
                  onclick="mark('${s.id}','approved')" ${st.decision==="locked"?"disabled":""}>Approve</button>
          <button class="act no ${st.decision==="rejected"?"on":""}"
                  onclick="mark('${s.id}','rejected')" ${st.decision==="locked"?"disabled":""}>Reject</button>
          <span class="words">${s.words} words · ${s.sha}</span>
        </div>
        <div class="notewrap ${st.decision==="rejected"||st.note?"show":""}">
          <label>What is wrong, or what does Murray actually say?</label>
          <textarea oninput="note('${s.id}',this.value)"
            placeholder="e.g. Murray peaks B/A at Ni-62, not Fe-56 - and the deuteron example is not in this section"></textarea>
        </div>
      </div>`;
    el.querySelector(".title").textContent = s.title;
    el.querySelector(".lesson").textContent = s.lesson;
    el.querySelector(".state").textContent = label;
    el.querySelector("pre").textContent = s.text;
    el.querySelector("textarea").value = st.note;
    host.appendChild(el);
  });
  counts();
}
function counts(){
  const v = SECTIONS.map(s=>state[s.id]);
  const lock=v.filter(x=>x.decision==="locked").length;
  const ok=v.filter(x=>x.decision==="approved").length;
  const no=v.filter(x=>x.decision==="rejected").length;
  document.getElementById("p-tot").textContent = SECTIONS.length+" sections";
  document.getElementById("p-ok").textContent = (ok+lock)+" reviewed";
  document.getElementById("p-no").textContent = no+" rejected";
  document.getElementById("p-left").textContent = (SECTIONS.length-ok-lock-no)+" pending";
}
function toggle(id){ state[id].open=!state[id].open; render(); }
function mark(id,d){ if(state[id].decision==="locked")return;
  state[id].decision = state[id].decision===d?"":d; state[id].open=true; render(); }
function note(id,v){ state[id].note=v; }

async function save(){
  const el=document.getElementById("status");
  const payload={};
  SECTIONS.forEach(s=>{ if(state[s.id].decision==="locked")return;
    payload[s.id]={decision:state[s.id].decision,note:state[s.id].note,
                   sha:s.sha,title:s.title}; });
  el.className="status"; el.textContent="Saving…";
  try{
    const r=await fetch("/save",{method:"POST",headers:{"Content-Type":"application/json"},
                                body:JSON.stringify(payload)});
    const j=await r.json();
    if(!r.ok) throw new Error(j.error||("HTTP "+r.status));
    el.className="status good";
    el.textContent=`Wrote ${j.approved} STATUS: REVIEWED into the corpus · ${j.rejected} rejected → ${j.notes}`;
    setTimeout(()=>location.reload(),900);
  }catch(e){ el.className="status bad"; el.textContent="Save failed: "+e.message; }
}
render();
</script></body></html>
"""


def build_page(source, sections, notes, npath):
    def js(o):
        return json.dumps(o, ensure_ascii=False).replace("<", "\\u003c")
    return (PAGE
            .replace("__SECTIONS__", js(sections))
            .replace("__NOTES_JSON__", js(notes))
            .replace("__SOURCE__", html.escape(
                str(source.relative_to(REPO)).replace("\\", "/")))
            .replace("__NOTES__", html.escape(
                str(npath.relative_to(REPO)).replace("\\", "/"))))


# ── server ───────────────────────────────────────────────────────────────────

def make_handler(source, npath, lock):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def _send(self, code, body: bytes, ctype):
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path.split("?")[0] not in ("/", "/index.html"):
                self._send(404, b"not found", "text/plain; charset=utf-8")
                return
            with lock:
                _, sections = parse_corpus(source)   # re-read: never a cached copy
                notes = load_notes(npath)
            page = build_page(source, sections, notes, npath)
            self._send(200, page.encode("utf-8"), "text/html; charset=utf-8")

        def do_POST(self):
            if self.path != "/save":
                self._send(404, b"not found", "text/plain; charset=utf-8")
                return
            try:
                n = int(self.headers.get("Content-Length", 0))
                incoming = json.loads(self.rfile.read(n).decode("utf-8"))
            except (ValueError, json.JSONDecodeError) as exc:
                self._send(400, json.dumps({"error": str(exc)}).encode(),
                           "application/json; charset=utf-8")
                return

            today = datetime.date.today().isoformat()
            with lock:
                raw, sections = parse_corpus(source)
                by_id = {s["id"]: s for s in sections}
                approved, stale = [], []

                for sid, rec in incoming.items():
                    if rec.get("decision") != "approved":
                        continue
                    sec = by_id.get(sid)
                    if not sec:
                        continue
                    # Refuse to approve text that changed since the page rendered it.
                    if rec.get("sha") and rec["sha"] != sec["sha"]:
                        stale.append(sec["title"])
                        continue
                    raw, changed = set_reviewed(raw, sec["title"], today)
                    if changed:
                        approved.append(sec["title"])

                if approved:
                    tmp = source.with_suffix(".md.tmp")
                    tmp.write_text(raw, encoding="utf-8", newline="")
                    tmp.replace(source)

                merged = save_notes(npath, source, load_notes(npath), incoming)

            rejected = [v for v in merged.values() if v.get("decision") == "rejected"]
            say(f"\n  corpus  {len(approved)} section(s) marked REVIEWED {today}")
            for t in approved:
                say(f"    APPROVED  {t}")
            for sid, rec in sorted(merged.items()):
                if rec.get("decision") == "rejected":
                    say(f"    REJECTED  {rec.get('title', sid)[:44]:<44} "
                        f"{(rec.get('note') or '(no note)')[:58]}")
            for t in stale:
                say(f"    SKIPPED   {t} - text changed since you read it; re-review")

            self._send(200, json.dumps({
                "approved": len(approved), "rejected": len(rejected),
                "stale": stale,
                "notes": str(npath.relative_to(REPO)).replace("\\", "/"),
            }).encode(), "application/json; charset=utf-8")

        def log_message(self, *a):
            pass

    return Handler


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--source", type=pathlib.Path, default=DEFAULT_SOURCE)
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--no-open", action="store_true")
    args = ap.parse_args()

    source = args.source.resolve()
    if not source.exists():
        sys.exit(f"error: no corpus at {source}")

    npath = notes_path(source)
    _, sections = parse_corpus(source)
    done = sum(1 for s in sections if s["reviewed"])
    url = f"http://127.0.0.1:{args.port}/"

    say(f"\n  corpus    {source.relative_to(REPO)}")
    say(f"  sections  {len(sections)}  -  {done} reviewed, {len(sections)-done} pending")
    say(f"  notes     {npath.relative_to(REPO)}")
    say(f"\n  APPROVING WRITES TO THE CORPUS (STATUS: REVIEWED <date>). Rejections do not.")
    say(f"\n  -> {url}\n\n  Ctrl+C to stop. Decisions print here as you save.\n")

    server = ThreadingHTTPServer(("127.0.0.1", args.port),
                                 make_handler(source, npath, threading.Lock()))
    if not args.no_open:
        threading.Timer(0.4, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        say("\n  stopped.\n")
        server.shutdown()


if __name__ == "__main__":
    main()
