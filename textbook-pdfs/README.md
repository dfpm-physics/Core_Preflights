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

The `/setup-preflight` skill sets your `textbook_base_path` config value automatically
once the files are in place. If you add the files after running setup, re-run
`/setup-preflight` to update and verify the path.

## Approved-reference manifest (`rag-manifest.txt`)

`rag-manifest.txt` (in this folder) is the **committed** list of approved `reference_pdf`
paths — one per line, `#`-comments ignored. The PDFs are gitignored, so this manifest is the
shared contract that keeps the reference **names identical across every clone**; anyone running
`/preflight-analyze` resolves each entry under their `textbook_base_path`.

- The faculty **Lessons** creator populates its "Reference PDF" dropdown from this file, so authored
  preflights only reference approved names.
- Each line is a path **relative to `textbook_base_path`** exactly as stored in
  `assignments.reference_pdf` (e.g. `Text_Book_PDFs/215 Sections/Electric Charge, Coulomb's Law.pdf`).
- **To add a new reference:** add the exact path here and commit. A browser "Add new…" entry only
  stores the string on one assignment — it does not update this shared list.
- Regenerate from the live DB if it drifts: `select distinct reference_pdf from assignments …`.
