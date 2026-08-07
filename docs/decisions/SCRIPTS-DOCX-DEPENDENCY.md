# `python-docx` and `tzdata` under `scripts/` — declaring dependencies that were already there

**Date:** 2026-08-07 · **Decided by:** Matthew Recker · **Executed by:** Claude
**Status:** done

---

## The problem

`.ai/patterns/python.md` states the dependency policy in two rows of its settings table, and it is
unambiguous: **everything under `scripts/` is standard library only**, so a teammate can clone the
repo and immediately grade, build or sync with no install step. Adding a dependency there "is a
decision recorded in `docs/decisions/`, not a side effect of needing an import."

Three files under `scripts/` have imported `python-docx` since the Fall 2026 term was built:

| File | Uses it for |
|---|---|
| `scripts/fall2026/build_fall_preflights.py` | parsing `Physics215_Preflight_Questions_v12.docx` |
| `scripts/fall2026/build_110_preflights.py` | parsing `Physics110_Preflight_Questions_v2.docx` |
| `scripts/fall2026/extract_preflight_figures.py` | pulling the embedded JiTT figures out of the same DOCX |

It is not in `requirements.txt`, has no decision record, and is not mentioned in `MACHINE-SETUP.md`.
The `docs/audits/2026-08-07-SYSTEM-AUDIT.md` finding is **C9**.

**Why it stayed invisible for so long is the interesting part**, and the pattern file predicted it
almost exactly: the failure mode of an undeclared dependency is that `import docx` simply *works* on
the machine that already has it. The policy fails silently rather than loudly. Nobody who could run
the term builder had a reason to notice, and the person who could not run it got an `ImportError`
naming a module that appears nowhere in the repository's setup instructions.

## The second dependency, found by running the thing

Fixing the hardcoded path (audit finding **C8**) made `build_110_preflights.py` runnable on Windows
for the first time. It immediately failed on a different line, and the failure was not the DOCX:

```
zoneinfo._common.ZoneInfoNotFoundError: 'No time zone found with key America/Denver'
```

**`zoneinfo` is standard library, but it ships no data.** It reads the operating system's IANA time
zone database, and Windows does not have one; the documented fallback is the `tzdata` package from
PyPI. So `ZoneInfo("America/Denver")` — which both builders use to write DST-aware UTC deadlines —
works on macOS and Linux and raises on a stock Windows machine, including the course director's.

This is why the two term builders had only ever been run on macOS, and it is the same shape as the
hardcoded `/Users/caseypellizzari/…` path in the same file: a machine-specific assumption that the
code had no way to state. It cost nothing on the machine that had it and made the script
unrunnable everywhere else.

Both builders **write due dates**. A missing tz database is not a degraded result there, it is a
hard stop — which is the good outcome. The bad version of this bug would have silently produced
naive local times.

## The decision

**Declare both. Do not remove them, and do not pretend `scripts/` is still uniformly stdlib.**

1. `python-docx` and `tzdata` are pinned in `requirements.txt` alongside `psycopg2-binary`.
2. Both policy statements (`.ai/patterns/python.md`, `.ai/instructions/CORE.md` §2) are amended to
   name these carve-outs explicitly rather than describing a rule the tree does not follow.
3. This record exists because the policy requires the reason to be written down.

The two are separable in principle — `tzdata` is a data package for a stdlib module, not a
third-party API — but they are needed by exactly the same two files, so splitting the record would
create two documents that must be read together.

## Why the standard library was not enough

The policy's own test is the right one: *reach outside for a data format with a hostile spec, never
for a convenience wrapper over something you can write in ten lines.*

A `.docx` is an Office Open XML package — a ZIP container of XML parts wired together by
relationship files, with paragraph styles, run-level formatting, and embedded images addressed
indirectly through `document.xml.rels`. `zipfile` and `xml.etree` are both stdlib, so a
reimplementation is *possible*; it is not ten lines, and every hour spent on it would be spent
re-deriving a spec that already has a correct implementation. This is the case the carve-out is for.

`tzdata` does not even need the argument. It is not an alternative to writing something ourselves —
there is nothing to write. It is the data `zoneinfo` already expects to find, supplied on a platform
that does not ship it.

## The lesson worth keeping

**Neither of these was findable by reading the code.** `import docx` and `from zoneinfo import
ZoneInfo` both look like ordinary imports, and both resolve fine on the machine the file was written
on. The audit that flagged C8 and C9 was static analysis, and it caught the first one only because
`python-docx` is visibly not stdlib. It could not have caught `tzdata`, because `zoneinfo` *is*.

What caught it was fixing C8 and then running the script. **A portability finding is confirmed by
execution on the target platform, not by inspection** — and this repo's target platform is Windows.

## Why not remove the scripts instead

They are **term builders, not one-time scripts.** Spring 2027 needs them, against a new source DOCX
and a new syllabus schedule. Archiving them would move the dependency problem to whoever un-archives
them, at the moment they are least able to absorb it.

## What this does NOT license

- **The two-tier rule still holds.** `scripts/` remains standard-library-by-default. This is one
  named exception in one directory, for one file format, and the next one needs its own record.
- **Nothing on the deploy path gains a dependency.** The shipped site under `site/` is unchanged and
  still has no build step, no `package.json`, and no install of any kind (CORE.md §2).
- **`pymupdf` and `pdfplumber` are still not dependencies.** They are installed on the course
  director's machine for an *agent* to read a PDF with — nothing under `scripts/` imports either,
  and nothing should start.

## Consequence for onboarding

The three files now require `requirements.txt` to have been installed, which was already the entry
condition for anything under `supabase/admin/`. `docs/operations/MACHINE-SETUP.md` covers that step.
A machine that only runs the lesson cycle never touches these files at all — they are term-build
tooling, run twice a year by a course director.
