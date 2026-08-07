# Textbook PDFs

This folder holds the OpenStax PDF files used by the `/preflight-analyze` skill
to ground its physics analysis. The PDFs are **not committed to the repo** (too large,
~968 MB) — you download them from the shared Teams folder.

## Folder Structure

```
textbook-pdfs/
  phys-215/       ← Physics 215 PDF sections go here
  phys-110/       ← Physics 110 PDF sections go here
```

Each file is a short excerpt from the OpenStax textbook corresponding to one lesson's
reading. File names match the `reference_pdf` field on each assignment in the database
(e.g., `Electric Charge, Coulomb's Law.pdf`).

## How to Download

1. Open the shared **Teams channel** for the Physics department
2. Go to **Files** → `Core_Preflights_PDFs`
3. Download the `phys-215` folder (and `phys-110` if you teach that course)
4. Place the downloaded folder contents here so the structure looks like:
   ```
   textbook-pdfs/
     phys-215/
       Electric Charge, Coulomb's Law.pdf
       Vector Form of Coulomb's Law.pdf
       ... (one file per lesson)
     phys-110/
       ...
   ```

## `textbook_base_path` does NOT point at this folder

**This is the single most common way to end up grading without grounding, and it fails
silently.** Read this before setting the config value.

The folder above is where the *files* go. It is not what the *manifest* says. Every entry in
`rag-manifest.txt` — and every `reference_pdf` string in the live database — begins
`Text_Book_PDFs/<NNN> Sections/`, because that is the shape the Fall 2026 term builders wrote
and 111 live activities now store. Changing it would be a data migration, so the path prefix
stays and the machine bridges the gap.

`/preflight-analyze` resolves **`textbook_base_path` + the manifest entry**. So the base must be
a directory that *contains* a `Text_Book_PDFs/` tree:

```
<textbook_base_path>/
  Text_Book_PDFs/
    110 Sections/      <- the phys-110 PDFs
    215 Sections/      <- the phys-215 PDFs
```

Two supported ways to get there — either is fine:

- **Put the PDFs in that layout directly** and point `textbook_base_path` at its parent. Simplest
  on a fresh machine; the repo's `phys-215/`/`phys-110/` folders then stay empty.
- **Keep the PDFs in this repo folder and link to them.** What the reference machine does. The
  repo folder is gitignored, so the ~968 MB stays out of git either way:
  ```powershell
  # Windows (no admin needed for a junction; run from the folder that will be the base)
  New-Item -ItemType Directory Text_Book_PDFs -Force
  New-Item -ItemType Junction "Text_Book_PDFs\215 Sections" -Target "<repo>\textbook-pdfs\phys-215"
  New-Item -ItemType Junction "Text_Book_PDFs\110 Sections" -Target "<repo>\textbook-pdfs\phys-110"
  ```
  ```bash
  # macOS / Linux
  mkdir -p Text_Book_PDFs
  ln -s "<repo>/textbook-pdfs/phys-215" "Text_Book_PDFs/215 Sections"
  ln -s "<repo>/textbook-pdfs/phys-110" "Text_Book_PDFs/110 Sections"
  ```

**Verify it. Do not assume it.** The check is read-only and instant:

```
python scripts/grounding/check_grounding.py
```

It prints `k of N` per course and exits non-zero if anything is missing. This matters because a
failure here is invisible at runtime: `/preflight-analyze` warns once and then grades the whole
cohort without textbook context. Nothing downstream looks different.

`/setup-preflight` derives this value for you and has always used the correct rule. The
`{repo_root}/textbook-pdfs/{course_id}/` form that appeared in `PROJECT.md` until 2026-08-07
resolves **0 of 58** entries.

## Approved-reference manifest (`rag-manifest.txt`)

`rag-manifest.txt` (in this folder) is the **committed** list of approved `reference_pdf`
paths — one per line, `#`-comments ignored. The PDFs are gitignored, so this manifest is the
shared contract that keeps the reference **names identical across every clone**; anyone running
`/preflight-analyze` resolves each entry under their `textbook_base_path`.

- The faculty **Lessons** creator populates its "Reference PDF" dropdown from this file, so authored
  preflights only reference approved names.
- Each line is a path **relative to `textbook_base_path`** exactly as stored in
  `activities.content.reference_pdf` (e.g. `Text_Book_PDFs/215 Sections/Electric Charge, Coulomb's Law.pdf`).
- **To add a new reference:** add the exact path here and commit. A browser "Add new…" entry only
  stores the string on one assignment — it does not update this shared list.
- Regenerate from the live DB if it drifts:
  `select distinct content->>'reference_pdf' from app.activities where modality='written' …`.

**Regenerated 2026-08-07, and it had drifted badly.** It listed 29 entries, all Physics 215, while
the live database used 57 — so every one of the 28 Physics 110 references was missing and the
dropdown offered a phys-110 author nothing at all. One entry was also two filenames joined by
`" + "`, matching no file, which is why `preflight-41` has been grading ungrounded. It is now 58
entries and all 58 resolve.

Two consequences of that drift are **not** fixed by regenerating this file:

- The concatenated string is still stored on `preflight-41` and `preflight-41-training` in the live
  database. That needs a separate, dry-run-gated data fix.
- The lesson editor's dropdown could not load this file at all from the live site between the
  2026-07-28 promotion and 2026-08-07: `lessons.html` fetched it with one `../` too many, left over
  from when the page lived at `site/app/faculty/`. It resolved above the Pages root and 404'd —
  while working locally, where the extra `../` clamps harmlessly at the server root. That is fixed.
