#!/usr/bin/env python3
"""Add the backup-version button to a Claude preflight artifact's source.

WHAT THIS DOES
    When an artifact's on-mount connection check fails, the cadet currently gets a red light,
    an explanation, and nothing to do about it. This adds a button beside that message which
    opens the same lesson's backup build on the course site.

    Three edits per file: a BACKUP_ENDPOINT constant, the `.backup-*` CSS, and the JSX block
    that renders under the existing connection message.

WHAT IT DOES NOT DO -- READ THIS BEFORE PLANNING AROUND IT
    Patching the source does NOT change what any cadet sees. These artifacts are PUBLISHED on
    claude.ai, and claude.ai serves what was published, not what is in this repository. A
    patched artifact reaches cadets only when a human republishes it from a Claude session,
    which mints a NEW artifact URL and therefore requires updating that lesson's
    `activities.artifact_url`. Thirty published artifacts means thirty republishes.

    The slug does NOT change -- this is a hand patch, not a factory rebuild, and contract
    section 3.2 mints a slug per OFFERING. Submissions keep flowing to the same activity row.
    Only the claude.ai URL moves.

    So this script's real output is: the next republish of each artifact carries the button.
    New artifacts get it from the factory skill instead and never need this script.

WHY A SCRIPT AND NOT AN EDITOR
    Forty-six files, three edits each, in sources whose line endings differ by course and
    whose bytes are hashed against Supabase Storage. A hand pass would be 138 chances to
    rewrite a line ending. The anchors were verified to match exactly once in all 46 first;
    this refuses on anything else.

USE
    python scripts/artifacts/add_backup_button.py --course phys-215            # dry run
    python scripts/artifacts/add_backup_button.py --all-courses --commit
    python scripts/artifacts/add_backup_button.py --all-courses --revert --commit

    Standard library only. Dry-run by default. Idempotent: a file that already has the
    button is reported as unchanged, never double-patched.
"""

import argparse
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
COURSES = REPO / "_builder" / "courses"

# ── The three edits ──────────────────────────────────────────────────────────

ANCHOR_CONST = (
    rb'const SUBMIT_ENDPOINT =\n'
    rb'  "https://dfpm-physics\.github\.io/Core_Preflights/site/student/interaction-submit\.html";'
)
ADD_CONST = b'''const SUBMIT_ENDPOINT =
  "https://dfpm-physics.github.io/Core_Preflights/site/student/interaction-submit.html";

// Backup transport, offered only when the connection check fails. This is a ROUTER on the
// course site, NOT a direct link to a backup lesson: the artifact sends its own
// INTERACTION_ID and the site resolves which build to open.
//
// The indirection is the whole point. A published artifact cannot be edited in place --
// changing one means republishing it on claude.ai, which mints a new artifact URL and means
// updating the lesson row that points at it. So the artifact must never learn a URL that
// could move. It knows two things that never move: this page, and its own slug. Which
// lessons have a backup, where each lives, and whether one is withdrawn are all editable on
// the site alone, with no artifact republished.
const BACKUP_ENDPOINT =
  "https://dfpm-physics.github.io/Core_Preflights/site/student/backup.html";'''

ANCHOR_CSS = rb'  \.conn-msg \{ font-size: 11px; color: #dc2626; margin-top: 4px; line-height: 1\.5; \}'
ADD_CSS = b'''  .conn-msg { font-size: 11px; color: #dc2626; margin-top: 4px; line-height: 1.5; }
  /* Backup-version button. Navy outline, matching .study-btn -- deliberately NOT amber,
     however much a degraded-mode warning wants to be. THEME_REFERENCE reserves amber for
     the extension bubble, the timer warn state and the yellow readiness flag, and closes
     the connection-light exception with "do not let it spread". This does not spread it. */
  .backup-row { margin-top: 10px; }
  .backup-btn { display: block; box-sizing: border-box; width: 100%; text-align: center;
                padding: 9px 10px; background: var(--white); color: var(--navy);
                border: 1.5px solid var(--navy); border-radius: var(--radius-sm);
                font-size: 13px; font-weight: 600; text-decoration: none; cursor: pointer; }
  .backup-btn:hover { background: #f1f5f9; }
  .backup-hint { font-size: 11px; color: var(--text-muted); margin-top: 6px; line-height: 1.5; }'''

ANCHOR_JSX = rb'\{connStatus === "unavailable" && <div className="conn-msg">\{connMsg\}</div>\}'
ADD_JSX = b'''{connStatus === "unavailable" && <div className="conn-msg">{connMsg}</div>}
            {connStatus === "unavailable" && (
              <div className="backup-row">
                {/* A user-clicked anchor with rel and NO target, exactly like the Submit
                    button. The sandbox blocks scripted navigation; in Claude's React runtime
                    a real click routes through the external-link handler. window.open would
                    silently do nothing. */}
                <a className="backup-btn" href={BACKUP_ENDPOINT + "?i=" + INTERACTION_ID}
                   rel="noopener noreferrer">
                  Open the backup version &rarr;
                </a>
                <p className="backup-hint">
                  Same lesson, same report, same submission &mdash; but it runs on your own free
                  Google AI Studio key and <strong>the experience is less polished</strong>. Try
                  Re-check first; the Claude version is still the intended path.
                </p>
              </div>
            )}'''

EDITS = [("BACKUP_ENDPOINT constant", ANCHOR_CONST, ADD_CONST),
         (".backup-* CSS", ANCHOR_CSS, ADD_CSS),
         ("backup button JSX", ANCHOR_JSX, ADD_JSX)]


def detect_nl(b: bytes) -> bytes:
    lf, crlf = b.count(b"\n"), b.count(b"\r\n")
    if crlf == lf:
        return b"\r\n"
    if crlf == 0:
        return b"\n"
    raise SystemExit(f"mixed line endings ({crlf} CRLF of {lf} LF) - refusing to guess")


def patch(src: bytes, revert: bool = False):
    """Returns (new_bytes, note). Refuses on anything it does not recognise."""
    nl = detect_nl(src)
    has = b"BACKUP_ENDPOINT" in src

    if revert:
        if not has:
            return src, "no button"
        for name, anchor, added in EDITS:
            want = added.replace(b"\n", nl)
            base = re.search(anchor.replace(rb"\n", rb"\r\n") if nl == b"\r\n" else anchor,
                             src, re.S)
            if want not in src or not base:
                raise SystemExit(f"  cannot revert cleanly [{name}] - hand edits present")
            src = src.replace(want, base.group(0), 1)
        return src, "reverted"

    if has:
        return src, "already patched"

    for name, anchor, added in EDITS:
        pat = anchor.replace(rb"\n", rb"\r\n") if nl == b"\r\n" else anchor
        literal = added.replace(b"\n", nl)
        new, n = re.subn(pat, lambda m: literal, src, flags=re.S)
        if n != 1:
            raise SystemExit(f"  FAILED [{name}]: matched {n}, expected 1 - shape has drifted")
        src = new
    return src, "patched"


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--course")
    ap.add_argument("--all-courses", action="store_true")
    ap.add_argument("--revert", action="store_true", help="remove the button again")
    ap.add_argument("--commit", action="store_true")
    a = ap.parse_args()

    courses = (sorted(p.name for p in COURSES.iterdir() if p.is_dir())
               if a.all_courses else ([a.course] if a.course else []))
    if not courses:
        ap.error("need --course or --all-courses")

    total = changed = 0
    for course in courses:
        d = COURSES / course / "artifacts"
        if not d.exists():
            continue
        files = sorted(d.glob("*.jsx"))
        if not files:
            continue
        print(f"\n=== {course}: {len(files)} artifact(s) ===")
        for p in files:
            src = p.read_bytes()
            out, note = patch(src, revert=a.revert)
            total += 1
            if out == src:
                print(f"  {p.name[:66]:<66} {note}")
                continue
            changed += 1
            delta = len(out) - len(src)
            print(f"  {p.name[:66]:<66} {note} ({delta:+,} B)"
                  + ("" if a.commit else "  [DRY RUN]"))
            if a.commit:
                p.write_bytes(out)

    print(f"\n{total} artifact(s) | {changed} {'reverted' if a.revert else 'patched'}")
    if not a.commit:
        print("dry run - nothing written. Re-run with --commit.")
    elif changed:
        print("\nThese sources are ahead of what cadets see. The button reaches a cadet only")
        print("when a human republishes that artifact on claude.ai and updates its")
        print("activities.artifact_url. Push the sources with sync_artifacts.py push --commit.")


if __name__ == "__main__":
    main()
