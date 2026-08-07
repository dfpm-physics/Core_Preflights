#!/usr/bin/env python3
"""
verify.py — prove the kit is intact and the localizer is safe, in a fresh environment.

    python3 tools/verify.py

Four checks, in increasing order of how much they'd hurt to get wrong:

1. PAYLOAD INTACT — the seven verbatim files match MANIFEST.sha256. Catches a corrupted
   transfer, a stray editor save, or a well-meaning "small fix" to a frozen contract.
2. IDENTITY IS A NO-OP — localizing with the pilot's own profile must reproduce those
   seven files byte for byte. If it doesn't, the localizer is mutating something it
   shouldn't, and every port inherits that mutation.
3. A REAL PORT IS CLEAN — localizing with a fully different profile leaves no baseline
   strings behind, produces no doubled substitutions, and preserves code identifiers.
4. IDEMPOTENT — two runs agree.

Exits non-zero on any failure. Run it after unpacking the kit and after editing anything
under tools/.
"""

import hashlib
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile

KIT = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = KIT / "MANIFEST.sha256"

# Substrings that only appear when a rule fired inside another rule's output.
DOUBLE_SUB = re.compile(
    r"USAFA USAFA|State U State U|\bstudent student\b|\bchemistry chemistry\b"
    r"|Vol\. \d Vol|Policy Policy|Code Code"
)

# Never rendered to a learner; renaming them breaks CSS-to-JSX bindings.
PROTECTED = ["cadetId", "cadet-id", "--cadet-bg", "--cadet-border"]

PASS, FAIL = "  PASS  ", "  FAIL  "
failures = []


def report(ok: bool, label: str, detail: str = "") -> None:
    print(f"{PASS if ok else FAIL}{label}{('  — ' + detail) if detail else ''}")
    if not ok:
        failures.append(label)


def sha(path: pathlib.Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def localize(profile: pathlib.Path, out: pathlib.Path) -> str:
    # Both halves of the pipe must agree on a codec, and pinning only one is worse than
    # pinning neither — it turns a mangled string into a crash.
    #
    # Parent side: without an explicit codec, text=True decodes using the locale encoding
    # (cp1252 on Windows), so the em-dash in localize.py's "clean — no baseline" line
    # arrives mangled and check 3 fails on an intact kit.
    #
    # Child side: localize.py prints "·" and "—", and when its stdout is a PIPE rather than
    # a console, Python encodes them with the locale encoding too — emitting 0xb7 / 0x97,
    # which are not valid UTF-8. Pinning only the parent's decode makes the reader thread
    # raise UnicodeDecodeError, which leaves proc.stdout as None, and check 3 dies with a
    # TypeError instead of a readable failure. PYTHONIOENCODING is what makes the child
    # encode what the parent has been told to expect.
    env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
    proc = subprocess.run(
        [sys.executable, str(KIT / "tools" / "localize.py"), str(profile), "-o", str(out)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        env=env,
    )
    if proc.returncode != 0:
        print(proc.stdout + proc.stderr)
        sys.exit("localize.py failed — cannot continue")
    return proc.stdout


def main() -> None:
    print("\n1. verbatim payload matches MANIFEST.sha256")
    if not MANIFEST.exists():
        report(False, "MANIFEST.sha256 present")
    else:
        for line in MANIFEST.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            digest, _, rel = line.partition("  ")
            path = KIT / rel
            if not path.exists():
                report(False, rel, "missing")
            else:
                report(sha(path) == digest, rel, "" if sha(path) == digest else "hash mismatch")

    tmp = pathlib.Path(tempfile.mkdtemp(prefix="preflight-verify-"))
    try:
        print("\n2. identity profile is a true no-op")
        ident_out = tmp / "identity"
        localize(KIT / "examples" / "COURSE_PROFILE.phys215.md", ident_out)
        for line in MANIFEST.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            digest, _, rel = line.partition("  ")
            out_file = ident_out / rel
            ok = out_file.exists() and sha(out_file) == digest
            report(ok, rel, "" if ok else "localizer altered a file it should not touch")

        print("\n3. a full port is clean")
        port_out = tmp / "port"
        stdout = localize(KIT / "examples" / "COURSE_PROFILE.chem201-example.md", port_out)
        report("clean — no baseline" in stdout, "leftover scan reports clean")

        doubled = [
            f"{p.relative_to(port_out)}:{m.group()}"
            for p in port_out.rglob("*.md")
            for m in [DOUBLE_SUB.search(p.read_text(encoding="utf-8", errors="replace"))]
            if m
        ]
        report(not doubled, "no doubled substitutions", "; ".join(doubled[:3]))

        skill = (port_out / "skill/preflight-factory-v2/SKILL.md").read_text(encoding="utf-8")
        theme = (port_out / "sources/THEME_REFERENCE.md").read_text(encoding="utf-8")
        for ident in PROTECTED:
            present = ident in skill or ident in theme
            report(present, f"code identifier preserved: {ident}")

        crlf_src = (KIT / "contracts/INTERACTION-PREFILL-LINK.md").read_bytes()
        crlf_out = (port_out / "contracts/INTERACTION-PREFILL-LINK.md").read_bytes()
        report(
            (b"\r\n" in crlf_src) == (b"\r\n" in crlf_out),
            "line endings preserved in contracts",
        )

        print("\n4. idempotent")
        port_out_2 = tmp / "port2"
        localize(KIT / "examples" / "COURSE_PROFILE.chem201-example.md", port_out_2)
        same = all(
            (port_out_2 / p.relative_to(port_out)).exists()
            and sha(port_out_2 / p.relative_to(port_out)) == sha(p)
            for p in port_out.rglob("*.md")
        )
        report(same, "two runs produce identical output")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print()
    if failures:
        print(f"{len(failures)} check(s) FAILED:")
        for f in failures:
            print(f"  · {f}")
        sys.exit(1)
    print("all checks passed — kit is intact and the localizer is safe to run\n")


if __name__ == "__main__":
    main()
