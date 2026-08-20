#!/usr/bin/env python3
r"""
patch_artifacts.py -- apply the 2026-08-20 resilience fix set to the Claude artifact sources.

WHY A SCRIPT AND NOT AN EDITOR. There are 51 artifacts across three courses and two dialects.
PROJECT.md's sharp-edges table records what hand-editing them costs: a Python text-mode read
silently converted CRLF to LF and turned a 12-string substitution into 6,327 insertions and 6,327
deletions, with the three real changes invisible inside it. Everything here reads and writes
BYTES, detects each file's own line ending, and REFUSES on an anchor that does not match exactly
the expected number of times -- the same contract `to_gemini.py` runs under, for the same reason.

WHAT IT CHANGES (see CHANGELOG 2026-08-20):

  0  phys-110 only: BACKUP_ENDPOINT + the backup button it never had
  1  .conn-row / .conn-msg / .backup-row get a width cap        -- the start-screen overflow
  2  .backup-btn becomes navy-FILLED, matching Submit           -- bolder, still inside the theme
  3  rawCall steps DOWN the model ladder on 429, not just 404   -- the real cadet-facing bug
  4  errorMessage gains a `quota` case                          -- 429 stopped being "wait and Retry"
  5  the two tail grounding blocks are deferred by phase        -- ~18% off every graded turn
  6  the error bar offers "Continue on Gemini" beside Retry     -- a mid-lesson escape hatch
  7  the handoff carries the transcript, so Gemini resumes      -- no restart from zero
  8  submit sends &v=claude and records the model that wrote it -- transport + downgrade telemetry

WHAT IT DOES NOT CHANGE -- THE SLUG. `INTERACTION_ID` is load-bearing identity: `activities.slug`
is globally UNIQUE and every student report hangs off that row, so minting a new one would orphan
the work of every cadet who has already finished. Contract 3.2 requires a fresh suffix for a NEW
OFFERING; republishing a fix into the SAME offering is not that. This script asserts byte-equality
of the slug line before it writes, so the rule cannot be broken by accident.

ORDER MATTERS. Step 0 runs first so that every later step -- which assumes BACKUP_ENDPOINT and the
backup CSS exist -- sees one dialect instead of two.

RELATIONSHIP TO to_gemini.py. Steps 3-5 were first written INSIDE the porter, because only the
Gemini builds needed them. They are now wanted in both, so they live here and the porter detects
and skips whatever this script has already applied. If you change a shared anchor here, run the
porter over all three dialects before you commit.

USAGE
    python scripts/artifacts/patch_artifacts.py                 # dry run, every course
    python scripts/artifacts/patch_artifacts.py --course phys-215
    python scripts/artifacts/patch_artifacts.py --only lesson_02 --verbose
    python scripts/artifacts/patch_artifacts.py --commit

Stdlib only, dry-run by default (CORE.md section 4).
"""

import argparse
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[1]
COURSES = ROOT / "_builder" / "courses"

# Reuse the porter's newline machinery rather than copying it. If these two tools ever disagreed
# about what a line ending is they would corrupt each other's output, so they share one answer.
sys.path.insert(0, str(HERE))
from to_gemini import detect_nl, adapt  # noqa: E402

# UTF-8 bytes for the non-ASCII characters that appear in anchors and replacements. A bytes
# literal cannot hold them directly, and the wrong escape produces a silent NO-MATCH, not an error.
ARROW = b"\xe2\x86\x92"   # -> RIGHTWARDS ARROW
DASH = b"\xe2\x80\x94"    # -- EM DASH
BOX = b"\xe2\x94\x80"     # the section-rule character in the source's banner comments


class Patcher:
    """Anchored byte substitution that aborts rather than half-applying."""

    def __init__(self, src: bytes, name: str):
        self.src = src
        self.name = name
        self.nl = detect_nl(src)
        self.log = []

    def sub1(self, pattern: bytes, repl: bytes, why: str, count: int = 1):
        # A lambda, never a template string: the replacement is JS source full of regex literals
        # and backslashes, which re.sub would otherwise read as group references.
        literal = repl.replace(b"\n", self.nl)
        new, n = re.subn(adapt(pattern, self.nl), lambda m: literal, self.src, flags=re.S)
        if n != count:
            raise SystemExit(f"  FAILED [{self.name}] {why}: matched {n}, expected {count}")
        self.src = new
        self.log.append(why)

    def has(self, needle: bytes) -> bool:
        return needle in self.src


def slug_of(src: bytes) -> bytes:
    """The declaration wraps to a second line when the slug is long, so the newline is part of
    what has to be tolerated -- PHYS 110's slugs are long enough that all five of them wrap."""
    m = re.search(rb'const INTERACTION_ID =\s*"([a-z0-9-]+)";', src)
    return m.group(1) if m else b""


# ---------------------------------------------------------------------------
# 0 -- phys-110 only: the backup button it was never built with
# ---------------------------------------------------------------------------
# The five PHYS 110 artifacts were built outside the preflight-kit, before the backup router
# existed. They have no BACKUP_ENDPOINT, no backup CSS and no button -- so their Gemini builds
# have been sitting on the server unreachable from the lesson the whole time. Everything after
# this point assumes one dialect, so this runs first.

def add_backup_button(p: Patcher):
    if p.has(b"BACKUP_ENDPOINT"):
        return False

    p.sub1(
        rb'(const SUBMIT_ENDPOINT =\r\n  "https://dfpm-physics\.github\.io/Core_Preflights'
        rb'/site/student/interaction-submit\.html";)',
        b'const SUBMIT_ENDPOINT =\n'
        b'  "https://dfpm-physics.github.io/Core_Preflights/site/student/interaction-submit.html";\n'
        b'\n'
        b'// Backup transport, offered when the connection check fails and again if the tutor dies\n'
        b'// mid-lesson. This is a ROUTER on the course site, NOT a direct link to a backup build:\n'
        b'// the artifact sends its own INTERACTION_ID and the site resolves which build to open.\n'
        b'//\n'
        b'// The indirection is the whole point. A published artifact cannot be edited in place, so\n'
        b'// it must never learn a URL that could later move; the router can be repointed any time\n'
        b'// without touching anything already published.\n'
        b'const BACKUP_ENDPOINT =\n'
        b'  "https://dfpm-physics.github.io/Core_Preflights/site/student/backup.html";',
        "phys-110: BACKUP_ENDPOINT")

    # CSS goes immediately after .conn-msg, which is where the kit dialect keeps it.
    p.sub1(
        rb"  \.conn-msg \{ font-size: 11px; color: #dc2626; margin-top: 4px; line-height: 1\.5; \}",
        b"  .conn-msg { font-size: 11px; color: #dc2626; margin-top: 4px; line-height: 1.5; }\n"
        b"  /* Backup-version button. Navy FILL, matching .start-btn and .submit-btn -- deliberately\n"
        b"     NOT amber, however much a degraded-mode warning wants to be. THEME_REFERENCE reserves\n"
        b"     amber for the extension bubble, the timer warn state and the yellow readiness flag,\n"
        b"     and closes the connection-light exception with \"do not let it spread\". Navy is the\n"
        b"     theme's own primary-action fill, so this borrows nothing and spreads nothing. */\n"
        b"  .backup-row { width: 100%; max-width: 480px; margin-top: 10px; }\n"
        b"  .backup-btn { display: block; box-sizing: border-box; width: 100%; text-align: center;\n"
        b"                padding: 11px 10px; background: var(--navy); color: var(--white);\n"
        b"                border: 1.5px solid var(--navy); border-radius: var(--radius-sm);\n"
        b"                font-size: 14px; font-weight: 600; text-decoration: none; cursor: pointer;\n"
        b"                transition: background .15s; }\n"
        b"  .backup-btn:hover { background: var(--navy-light); }\n"
        b"  .backup-hint { font-size: 11px; color: var(--text-muted); margin-top: 6px; line-height: 1.5; }",
        "phys-110: backup CSS")

    # PHYS 110 renders the connection block INSIDE a .start-card, so the row is already width-
    # constrained by its parent and the overflow that bit PHYS 215 cannot happen here.
    p.sub1(
        rb'(              \{connStatus === "unavailable" && <div className="conn-msg">\{connMsg\}</div>\})',
        b'              {connStatus === "unavailable" && <div className="conn-msg">{connMsg}</div>}\n'
        b'              {connStatus === "unavailable" && (\n'
        b'                <div className="backup-row">\n'
        b'                  {/* A user-clicked anchor with rel and NO target, exactly like the Submit\n'
        b'                      button. The sandbox blocks scripted navigation; in Claude\'s React\n'
        b'                      runtime a real click routes through the external-link handler.\n'
        b'                      window.open would silently do nothing. */}\n'
        b'                  <a className="backup-btn" href={BACKUP_ENDPOINT + "?i=" + INTERACTION_ID}\n'
        b'                     rel="noopener noreferrer">\n'
        b'                    Open the backup version &rarr;\n'
        b'                  </a>\n'
        b'                  <p className="backup-hint">\n'
        b'                    Same lesson, same report, same submission &mdash; it runs on your own free\n'
        b'                    Google AI Studio key. Try Re-check first; the Claude version is still the\n'
        b'                    intended path.\n'
        b'                  </p>\n'
        b'                </div>\n'
        b'              )}',
        "phys-110: backup button markup")
    return True


# ---------------------------------------------------------------------------
# 1 + 2 -- the start screen: width cap and a bolder button
# ---------------------------------------------------------------------------

def fix_start_screen(p: Patcher, kit_dialect: bool):
    # `.start` is a centering flex column (align-items: center), which overrides the default
    # stretch -- so a child with no max-width sizes to its own MAX-CONTENT. For .backup-row that
    # is the entire hint sentence on one unwrapped line, which is what drags the button out past
    # every card on screen. The cards escape it only by carrying max-width: 480px; three siblings
    # did not. Capping all three, not just the visible offender, is what stops the next paragraph
    # added here from quietly reintroducing it.
    #
    # PHYS 110 renders the same block inside a .start-card, so its parent already does this and
    # these three rules are not present to patch.
    if not kit_dialect:
        return

    p.sub1(
        rb"  \.conn-row \{ display: flex; align-items: center; gap: 8px; margin: 10px 0 2px; \}",
        b"  .conn-row { width: 100%; max-width: 480px; box-sizing: border-box;\n"
        b"              display: flex; align-items: center; gap: 8px; margin: 10px 0 2px; }",
        "conn-row width cap")

    p.sub1(
        rb"  \.conn-msg \{ font-size: 11px; color: #dc2626; margin-top: 4px; line-height: 1\.5; \}",
        b"  .conn-msg { width: 100%; max-width: 480px; box-sizing: border-box;\n"
        b"              font-size: 11px; color: #dc2626; margin-top: 4px; line-height: 1.5; }",
        "conn-msg width cap")

    # The comment is replaced along with the rule it explains: it argued for the OUTLINE
    # treatment, and left above a filled button it would document the opposite of the code.
    p.sub1(
        rb"  /\* Backup-version button\. Navy outline, matching \.study-btn -- deliberately NOT amber,\r\n"
        rb"     however much a degraded-mode warning wants to be\. THEME_REFERENCE reserves amber for\r\n"
        rb"     the extension bubble, the timer warn state and the yellow readiness flag, and closes\r\n"
        rb"     the connection-light exception with \"do not let it spread\"\. This does not spread it\. \*/\r\n"
        rb"  \.backup-row \{ margin-top: 10px; \}",
        b"  /* Backup-version button. Navy FILL, matching .start-btn and .submit-btn -- still\n"
        b"     deliberately NOT amber, however much a degraded-mode warning wants to be.\n"
        b"     THEME_REFERENCE reserves amber for the extension bubble, the timer warn state and the\n"
        b"     yellow readiness flag, and closes the connection-light exception with \"do not let it\n"
        b"     spread\". Navy is the theme's own primary-action fill, so promoting this button from\n"
        b"     outline to fill borrows nothing and spreads nothing.\n"
        b"     It was an outline until 2026-08-20, when the Gemini path stopped being a last resort:\n"
        b"     a cadet whose Claude account is capped needs the escape hatch to read as an action,\n"
        b"     not as a footnote under the thing that just failed.\n"
        b"     The width cap is not cosmetic -- see .conn-row above for what it prevents. */\n"
        b"  .backup-row { width: 100%; max-width: 480px; margin-top: 10px; }",
        "backup-row width cap + comment")

    p.sub1(
        rb"  \.backup-btn \{ display: block; box-sizing: border-box; width: 100%; text-align: center;\r\n"
        rb"                padding: 9px 10px; background: var\(--white\); color: var\(--navy\);\r\n"
        rb"                border: 1\.5px solid var\(--navy\); border-radius: var\(--radius-sm\);\r\n"
        rb"                font-size: 13px; font-weight: 600; text-decoration: none; cursor: pointer; \}\r\n"
        rb"  \.backup-btn:hover \{ background: #f1f5f9; \}",
        b"  .backup-btn { display: block; box-sizing: border-box; width: 100%; text-align: center;\n"
        b"                padding: 11px 10px; background: var(--navy); color: var(--white);\n"
        b"                border: 1.5px solid var(--navy); border-radius: var(--radius-sm);\n"
        b"                font-size: 14px; font-weight: 600; text-decoration: none; cursor: pointer;\n"
        b"                transition: background .15s; }\n"
        b"  .backup-btn:hover { background: var(--navy-light); }",
        "backup-btn navy fill")

    # The endpoint's own comment says the button appears only on a failed connection check. As of
    # change 6 that is no longer true, and this constant is now used from two places. PHYS 110's
    # copy is written correct at birth in add_backup_button(); this brings the kit dialect into
    # line so both say the same true thing and the porter needs one anchor instead of two.
    p.sub1(
        rb"// Backup transport, offered only when the connection check fails\. This is a ROUTER on the\r\n"
        rb"// course site, NOT a direct link to a backup lesson: the artifact sends its own\r\n"
        rb"// INTERACTION_ID and the site resolves which build to open\.\r\n",
        b"// Backup transport, offered when the connection check fails and again if the tutor dies\n"
        b"// mid-lesson. This is a ROUTER on the course site, NOT a direct link to a backup lesson:\n"
        b"// the artifact sends its own INTERACTION_ID and the site resolves which build to open.\n",
        "BACKUP_ENDPOINT comment covers both doors")

    # Soften the start-screen hint. It called the backup "less polished" while the Gemini path was
    # unproven; it has since outperformed a free Claude account, and a cadet being sent there by a
    # failure does not need to be talked out of the only thing still working.
    p.sub1(
        rb"                <p className=\"backup-hint\">\r\n"
        rb"                  Same lesson, same report, same submission &mdash; but it runs on your own free\r\n"
        rb"                  Google AI Studio key and <strong>the experience is less polished</strong>\. Try\r\n"
        rb"                  Re-check first; the Claude version is still the intended path\.\r\n"
        rb"                </p>",
        b"                <p className=\"backup-hint\">\n"
        b"                  Same lesson, same report, same submission &mdash; it runs on your own free\n"
        b"                  Google AI Studio key. Try Re-check first; the Claude version is still the\n"
        b"                  intended path.\n"
        b"                </p>",
        "start-screen hint softened")


# ---------------------------------------------------------------------------
# 3 + 4 -- the model ladder actually steps on a usage limit
# ---------------------------------------------------------------------------

def fix_model_ladder(p: Patcher):
    p.sub1(
        rb"async function rawCall\(activeModelRef, body, \{ retries = 3 \} = \{\}\) \{",
        b"// Advance one rung down the ladder. Returns false at the bottom.\n"
        b"// The ref NEVER climbs back, which is what makes `current !== MODEL_CANDIDATES[0]` at\n"
        b"// report time an exact answer to \"was this session downgraded\", with no extra state to\n"
        b"// keep in sync. finalizePayload relies on that.\n"
        b"function stepModel(activeModelRef) {\n"
        b"  const i = MODEL_CANDIDATES.indexOf(activeModelRef.current);\n"
        b"  if (i > -1 && i < MODEL_CANDIDATES.length - 1) {\n"
        b"    activeModelRef.current = MODEL_CANDIDATES[i + 1];\n"
        b"    return true;\n"
        b"  }\n"
        b"  return false;\n"
        b"}\n"
        b"\n"
        b"async function rawCall(activeModelRef, body, { retries = 3 } = {}) {",
        "stepModel helper")

    # The trailing comment is dialect-dependent: the kit writes one, PHYS 110 does not. Match
    # either and emit the same thing for both, so the two dialects stop diverging here.
    p.sub1(
        rb"    if \(res\.status === 404\) \{[^\r\n]*\r\n"
        rb"      const i = MODEL_CANDIDATES\.indexOf\(activeModelRef\.current\);\r\n"
        rb"      if \(i > -1 && i < MODEL_CANDIDATES\.length - 1\) \{\r\n"
        rb"        activeModelRef\.current = MODEL_CANDIDATES\[i \+ 1\];\r\n"
        rb"        continue;\r\n"
        rb"      \}\r\n"
        rb"      throw \{ kind: \"model\", status: 404 \};\r\n"
        rb"    \}\r\n",
        b"    if (res.status === 404) {                       // model unavailable " + ARROW
        + b" next candidate\n"
        b"      if (stepModel(activeModelRef)) continue;\n"
        b"      throw { kind: \"model\", status: 404 };\n"
        b"    }\n"
        b"    // 429 is a RATE limit or a USAGE limit, and the two want opposite things. A per-minute\n"
        b"    // rate limit clears by itself, so back off first. A daily or account usage cap does not\n"
        b"    // clear at all, so once the retries are spent, step DOWN -- the lighter tier is the whole\n"
        b"    // reason a second candidate is listed, and it is metered separately.\n"
        b"    //\n"
        b"    // Until 2026-08-20 there was no branch here and a 429 fell through to `request`, whose\n"
        b"    // message tells the cadet to \"wait a moment and Retry\". For a usage cap that is advice\n"
        b"    // which never comes true: the cadet retries into the same wall until they give up. The\n"
        b"    // Gemini builds carried the identical defect and were fixed first.\n"
        b"    if (res.status === 429) {\n"
        b"      if (attempt < retries) { await sleep(backoffMs(attempt)); attempt++; continue; }\n"
        b"      if (stepModel(activeModelRef)) { attempt = 0; continue; }\n"
        b"      throw { kind: \"quota\", status: 429 };\n"
        b"    }\n",
        "429 steps down the ladder")

    # The other two failures a cadet can actually act on. Both predate the error bar having a
    # button in it, so both sent the cadet looking for a route that was not on screen -- `capacity`
    # offered "a different account", and `model` offered the instructor. Neither mentioned the
    # backup at all from inside a lesson, because from inside a lesson there was no way to reach it.
    p.sub1(
        rb"        \? \"The tutor service is at capacity right now and didn't free up after several tries\. "
        rb"On a free Claude account this can be a usage/capacity limit that resets later " + DASH
        + rb" wait a bit and Retry, or use a different account\.\"\r\n",
        b"        ? \"The tutor service is at capacity right now and didn't free up after several\"\n"
        b"          + \" tries. On a free Claude account this can be a usage or capacity limit that\"\n"
        b"          + \" resets later. Retry in a few minutes, or continue on Gemini below \" + \"" + DASH
        + b"\" + \" it\"\n"
        b"          + \" runs the same lesson and keeps what you have done so far.\"\n",
        "capacity message points at the handoff")

    p.sub1(
        rb"      return \"The tutor model isn't available to this account\. Try a different Claude "
        rb"account, or tell your instructor the preflight may need an updated model\.\";\r\n",
        b"      return \"No tutor model is available to this account. Continue on Gemini below to\"\n"
        b"        + \" finish the lesson, and tell your instructor the preflight may need an updated\"\n"
        b"        + \" model.\";\n",
        "model message points at the handoff")

    p.sub1(
        rb"    case \"model\":\r\n",
        b"    case \"quota\":\n"
        b"      return \"This Claude account has reached its usage limit, and the lighter backup model\"\n"
        b"        + \" is capped too. Continue on Gemini below " + DASH + b" it runs the same lesson, keeps\"\n"
        b"        + \" what you have done so far, and submits the same report. Or wait for the limit to\"\n"
        b"        + \" reset and Retry.\";\n"
        b"    case \"model\":\n",
        "quota error message")


# ---------------------------------------------------------------------------
# 5 -- defer the two tail grounding blocks until the phase that needs them
# ---------------------------------------------------------------------------

def fix_prompt_phases(p: Patcher):
    p.sub1(
        rb"function buildSystemPrompt\(cadetId, localTime\) \{",
        b"// phase: \"probe\" (default) | \"report\" | \"extension\" -- see sysFor() in the component.\n"
        b"function buildSystemPrompt(cadetId, localTime, phase) {",
        "buildSystemPrompt takes a phase")

    # The kit precedes ${REPORT_FORMAT} with a label line; PHYS 110's builds go straight to it.
    # That line is part of what the TUTOR reads, so it is carried through exactly as found --
    # never added to a build that did not have it, never dropped from one that did.
    LABEL = b"OUTPUT_REPORT_FORMAT (produce exactly this structure):"
    has_label = p.has(LABEL)
    label_pat = (rb"OUTPUT_REPORT_FORMAT \(produce exactly this structure\):\r\n"
                 if has_label else rb"")
    label_repl = (b'"\\nOUTPUT_REPORT_FORMAT (produce exactly this structure):\\n" + REPORT_FORMAT'
                  if has_label else b'"\\n" + REPORT_FORMAT')

    # The graded system prompt is resent in FULL on every turn. EXTENSION_PROBLEMS and
    # REPORT_FORMAT are ~11,400 chars of it -- about 18% -- and neither is needed while the tutor
    # is still probing topics. Both sit at the very TAIL, which is why they can be dropped without
    # disturbing a single line above them.
    p.sub1(
        rb"\$\{TEXTBOOK_REFERENCE\}\r\n"
        rb"\r\n"
        rb"\$\{LESSON_CONFIG\}\r\n"
        rb"\r\n"
        rb"\$\{EXTENSION_PROBLEMS\}\r\n"
        rb"\r\n"
        + label_pat +
        rb"\$\{REPORT_FORMAT\}`;\r\n"
        rb"\}",
        b"""${TEXTBOOK_REFERENCE}

${LESSON_CONFIG}
${phase === "extension" ? "\\n" + EXTENSION_PROBLEMS + "\\n" : ""}\\
${phase === "probe" || !phase
    ? ""
    : """ + label_repl + b"""}`;
}""",
        "tail blocks made conditional")

    # WHERE the integrity fingerprint goes depends on the dialect: the kit names the report marker
    # as a constant, PHYS 110 inlines the literal inside isReportMsg and defines no such constant.
    # Anchor on whichever exists and re-emit it unchanged. The injected code must then not NAME
    # REPORT_MARKER either -- doing so shipped five PHYS 110 Gemini builds that threw
    # `ReferenceError` on the first assistant turn, inside a useEffect that returns early until a
    # graded conversation is under way, so every check in this repo passed first.
    MARKER_CONST = b'const REPORT_MARKER = "# JiTT Conversation Report";'
    ISREPORT_FN = (b'function isReportMsg(content) '
                   b'{ return content.includes("# JiTT Conversation Report"); }')
    if p.has(MARKER_CONST):
        anchor, keep = re.escape(MARKER_CONST), MARKER_CONST
    elif p.has(ISREPORT_FN):
        anchor, keep = re.escape(ISREPORT_FN), ISREPORT_FN
    else:
        raise SystemExit(f"  FAILED [{p.name}]: no report-marker anchor for INTEGRITY_ASKED")

    p.sub1(
        anchor,
        keep + b"""

// The close sequence is fixed by the tutor prompt: summary -> the integrity question, which it
// must ask VERBATIM and then WAIT for -> the report. So seeing that question means the report is
// at most one turn away, and the mandated wait is what guarantees the lead time needed to put
// REPORT_FORMAT back in context before it is used. Two alternates, because a model that lightly
// rewords the opener still says the rest.
const INTEGRITY_ASKED =
  /one last thing before I put together your report|did you receive any outside help during this conversation/i;""",
        "integrity-question fingerprint")

    # Alignment spaces and the trailing comment are both optional: the kit writes one space and a
    # comment, PHYS 110 pads to a column and writes none.
    p.sub1(
        rb'  const sysRef *= useRef\(""\);[^\r\n]*\r\n',
        b"  const sysRef = useRef(\"\");        // study mode's prompt, and the graded opener\n"
        b"  const sysArgsRef = useRef(null);  // { cadetId, localTime } -- graded only\n"
        b"  const reportPhaseRef = useRef(false);\n",
        "prompt-phase refs")

    p.sub1(
        rb"    const sys = selectedMode === \"graded\"\r\n"
        rb"      \? buildSystemPrompt\(cadetId\.trim\(\), new Date\(\)\.toLocaleString\(\)\)\r\n"
        rb"      : buildStudySystemPrompt\(\);\r\n"
        rb"    sysRef\.current = sys;\r\n",
        b"    const localTime = new Date().toLocaleString();\n"
        b"    const sys = selectedMode === \"graded\"\n"
        b"      ? buildSystemPrompt(cadetId.trim(), localTime, \"probe\")\n"
        b"      : buildStudySystemPrompt();\n"
        b"    sysRef.current = sys;\n"
        b"    sysArgsRef.current = selectedMode === \"graded\"\n"
        b"      ? { cadetId: cadetId.trim(), localTime: localTime }\n"
        b"      : null;\n"
        b"    reportPhaseRef.current = false;\n",
        "startSession records the prompt args")

    p.sub1(
        rb"  const lzReady = useLzString\(\);\r\n",
        b"  const lzReady = useLzString();\n"
        b"\n"
        b"  // Compose the system prompt for the CURRENT phase instead of reusing one built at start.\n"
        b"  // Study mode is untouched: it needs its practice problems from turn one and never\n"
        b"  // produces a report, so it keeps the prompt built in startSession.\n"
        b"  function sysFor() {\n"
        b"    const a = sysArgsRef.current;\n"
        b"    // Belt and braces on the primary trigger: once the report exists we are in the\n"
        b"    // extension, and once active time passes the whole planned budget the close can arrive\n"
        b"    // on any turn -- so stop deferring rather than risk a report with no format to use.\n"
        b"    const overBudget =\n"
        b"      activeSecRef.current >= PROBE_TOPIC_COUNT * PER_TOPIC_BUDGET_MIN * 60;\n"
        b"    const phase = hasReport ? \"extension\"\n"
        b"      : (reportPhaseRef.current || overBudget) ? \"report\"\n"
        b"      : \"probe\";\n"
        b"    if (!a) return sysRef.current;\n"
        b"    return buildSystemPrompt(a.cadetId, a.localTime, phase);\n"
        b"  }\n",
        "sysFor() phase composer")

    # Every ongoing turn composes for its phase. (The opener deliberately still uses `sys`.)
    p.sub1(rb"callTutor\(activeModelRef, history, sysRef\.current,",
           b"callTutor(activeModelRef, history, sysFor(),",
           "callTutor sites use sysFor()", count=3)

    p.sub1(
        rb"  useEffect\(\(\) => \{\r\n"
        rb"    if \(mode !== \"graded\" \|\| hasReport\) return;\r\n",
        b"  // Phase trigger. Runs before the report-detection effect below and on the same\n"
        b"  // messages, so the format is restored one turn AHEAD of the report that needs it.\n"
        b"  useEffect(() => {\n"
        b"    if (mode !== \"graded\" || reportPhaseRef.current) return;\n"
        b"    const m = messages[messages.length - 1];\n"
        b"    if (!m || m.role !== \"assistant\") return;\n"
        b"    if (INTEGRITY_ASKED.test(m.content) || isReportMsg(m.content)) {\n"
        b"      reportPhaseRef.current = true;\n"
        b"    }\n"
        b"  }, [messages, mode]);\n"
        b"\n"
        b"  useEffect(() => {\n"
        b"    if (mode !== \"graded\" || hasReport) return;\n",
        "phase trigger effect")


# ---------------------------------------------------------------------------
# 6 + 7 -- a mid-lesson escape hatch that keeps the cadet's place
# ---------------------------------------------------------------------------

def fix_handoff(p: Patcher):
    # The style for the button added below. It lives HERE and not with the other CSS because it
    # belongs to the handoff, not to the start screen -- every dialect gets the handoff, including
    # PHYS 110, whose start-screen rules this script does not otherwise touch. Identical in all
    # three dialects, so one anchor covers them.
    p.sub1(
        rb"  \.error-retry \{ margin-left: 10px; padding: 2px 10px; font-size: 12px; font-weight: 600;\r\n"
        rb"                 background: var\(--white\); color: #dc2626; border: 1px solid #fecaca;\r\n"
        rb"                 border-radius: var\(--radius-sm\); cursor: pointer; \}",
        b"  .error-retry { margin-left: 10px; padding: 2px 10px; font-size: 12px; font-weight: 600;\n"
        b"                 background: var(--white); color: #dc2626; border: 1px solid #fecaca;\n"
        b"                 border-radius: var(--radius-sm); cursor: pointer; }\n"
        b"  /* Retry stays the quiet one and this stays filled: by the time both are on screen,\n"
        b"     Retry has usually already failed. Navy, not amber -- see .backup-btn for why. */\n"
        b"  .error-transfer { margin-left: 8px; padding: 3px 10px; font-size: 12px; font-weight: 600;\n"
        b"                    background: var(--navy); color: var(--white); border: 1px solid var(--navy);\n"
        b"                    border-radius: var(--radius-sm); cursor: pointer; text-decoration: none;\n"
        b"                    display: inline-block; }\n"
        b"  .error-transfer:hover { background: var(--navy-light); }",
        "error-transfer style")

    p.sub1(
        rb"  const submitUrl = \(mode === \"graded\" && submitReady\)\r\n"
        rb"    \? SUBMIT_ENDPOINT\r\n"
        rb"        \+ \"#t=interaction\"\r\n",
        b"  const submitUrl = (mode === \"graded\" && submitReady)\n"
        b"    ? SUBMIT_ENDPOINT\n"
        b"        + \"#t=interaction\"\n"
        b"        + \"&v=claude\"          // transport marker -- optional, additive, contract section 8\n",
        "submit URL carries the transport marker")

    # Placed immediately after submitUrl so both live-URL computations sit together, and above the
    # start-screen return so the chat view can see it.
    #
    # The banner comment is matched by LOOKAHEAD, not consumed. It is `//` in the kit dialect and
    # `/* ... */` in PHYS 110's, and both pad the line with a run of box-drawing characters whose
    # length varies -- so the alternative is counting characters in order to retype them exactly.
    p.sub1(
        rb"    : null;\r\n"
        rb"\r\n"
        rb"(?=  (?://|/\*) " + BOX + BOX + rb" Render: start screen)",
        b"    : null;\n"
        b"\n"
        b"  // Mid-lesson handoff to the Gemini backup. The transcript rides in the URL HASH, for the\n"
        b"  // same reason the submit contract does: a hash is never sent to a server, so the\n"
        b"  // conversation stays out of every access log between here and the backup page.\n"
        b"  //\n"
        b"  // Computed only once an error is on screen. Compressing a growing transcript on every\n"
        b"  // render would run ~12 times a session and buy the cadet nothing they can see.\n"
        b"  //\n"
        b"  // Trimmed oldest-first if the URL would grow unusable, and it degrades to a PLAIN link\n"
        b"  // rather than a broken one: a cadet who arrives with no history has lost their place, but\n"
        b"  // a cadet who arrives on a truncated URL has lost the lesson.\n"
        b"  const handoffUrl = React.useMemo(() => {\n"
        b"    if (!error) return null;\n"
        b"    const base = BACKUP_ENDPOINT + \"?i=\" + INTERACTION_ID + \"&go=1\";\n"
        b"    if (!lzReady || !window.LZString || !messages.length) return base;\n"
        b"    for (const n of [messages.length, 40, 20, 10, 4]) {\n"
        b"      const msgs = messages.slice(-n)\n"
        b"        .map((m) => ({ r: m.role, c: m.content, h: !!m.hidden }));\n"
        b"      const url = base + \"#h=\" + window.LZString.compressToEncodedURIComponent(\n"
        b"        JSON.stringify({ v: 1, id: INTERACTION_ID, mode: mode,\n"
        b"                         name: cadetId.trim(), msgs: msgs }));\n"
        b"      if (url.length <= 60000) return url;\n"
        b"    }\n"
        b"    return base;\n"
        b"  }, [error, messages, lzReady, cadetId, mode]);\n"
        b"\n",
        "handoffUrl")

    p.sub1(
        rb"            \{error\.retry && <button className=\"error-retry\" onClick=\{error\.retry\}>Retry</button>\}\r\n",
        b"            {error.retry && <button className=\"error-retry\" onClick={error.retry}>Retry</button>}\n"
        b"            {handoffUrl && (\n"
        b"              <a className=\"error-transfer\" href={handoffUrl} rel=\"noopener noreferrer\">\n"
        b"                Continue on Gemini &rarr;\n"
        b"              </a>\n"
        b"            )}\n",
        "error bar offers the handoff")


# ---------------------------------------------------------------------------
# 8 -- record which model actually wrote the report
# ---------------------------------------------------------------------------

def fix_telemetry(p: Patcher):
    p.sub1(
        rb"function finalizePayload\(raw, activeSec, msgs\) \{",
        b"// `model` is the model that produced the REPORT, not the one the session opened on.\n"
        b"// stepModel never climbs back, so a value other than MODEL_CANDIDATES[0] is proof the\n"
        b"// session was downgraded at some point -- which is the question worth answering when a\n"
        b"// cohort's reports come back thinner than usual.\n"
        b"function finalizePayload(raw, activeSec, msgs, model) {",
        "finalizePayload takes the model")

    p.sub1(
        rb"  d\.completed = true;\r\n",
        b"  d.completed = true;\n"
        b"  d.model = model || null;\n"
        b"  d.model_downgraded = !!(model && model !== MODEL_CANDIDATES[0]);\n",
        "payload records the model")

    p.sub1(
        rb"finalizePayload\(data, activeSecRef\.current, messages\)",
        b"finalizePayload(data, activeSecRef.current, messages, activeModelRef.current)",
        "report payload passes the model")

    p.sub1(
        rb"finalizePayload\(data, activeSecRef\.current, history\)",
        b"finalizePayload(data, activeSecRef.current, history, activeModelRef.current)",
        "repair payload passes the model")


# ---------------------------------------------------------------------------

def patch(src: bytes, name: str, verbose: bool = False) -> bytes:
    p = Patcher(src, name)
    before = slug_of(src)

    added = add_backup_button(p)
    kit_dialect = not added   # PHYS 110 got its button here; the kit dialect already had one

    fix_start_screen(p, kit_dialect)
    fix_model_ladder(p)
    fix_prompt_phases(p)
    fix_handoff(p)
    fix_telemetry(p)

    after = slug_of(p.src)
    if not after or after != before:
        raise SystemExit(f"  FAILED [{name}]: slug changed {before!r} -> {after!r}")
    if verbose:
        for line in p.log:
            print(f"    - {line}")
    return p.src


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    ap.add_argument("--course", help="phys-110 | phys-215 | phys-310 (default: all)")
    ap.add_argument("--only", help="substring filter on the filename")
    ap.add_argument("--commit", action="store_true", help="write the files (default: dry run)")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    courses = [args.course] if args.course else ["phys-110", "phys-215", "phys-310"]
    total = changed = 0

    for course in courses:
        d = COURSES / course / "artifacts"
        if not d.is_dir():
            print(f"{course}: no artifacts directory - skipped")
            continue
        files = sorted(f for f in d.glob("*.jsx") if not args.only or args.only in f.name)
        if not files:
            continue
        print(f"\n{course} ({len(files)} artifacts)")
        for f in files:
            total += 1
            src = f.read_bytes()
            out = patch(src, f.name, args.verbose)
            if out == src:
                print(f"  {f.name}: unchanged")
                continue
            changed += 1
            delta = len(out) - len(src)
            print(f"  {f.name}: OK ({delta:+,} bytes)")
            if args.commit:
                f.write_bytes(out)

    print(f"\n{changed} of {total} artifacts patched.")
    if not args.commit:
        print("dry run - nothing written. Re-run with --commit.")


if __name__ == "__main__":
    main()
