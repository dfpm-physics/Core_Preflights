# Tutor setup file

A small JSON file that holds everything the Assignments page needs to set up an interactive tutor: its id, title, link and objectives.
A director makes the tutor with the AI builder, gets this file, and drops it on the tutor card of an assignment instead of typing an id
and a link by hand.

Reading a file only fills the tutor boxes. **Nothing is saved until the director clicks Save.**

This is a new, separate format. It does not replace the prefill address in `INTERACTION-PREFILL-LINK.md`, which keeps working.

## Shape

```json
{
  "format": "prep-tutor",
  "version": 1,
  "slug": "lesson-02-electric-charge-3a8e4e18",
  "course": "phys-215",
  "title": "Electric Charge, Coulombic Force",
  "description": "One line about the tutor.",
  "url": "https://claude.ai/public/artifacts/...",
  "objective_keys": ["charge-quantization-conservation", "coulomb-inverse-square"],
  "objectives": [{ "key": "coulomb-inverse-square", "label": "Coulomb's law: inverse square and sign rule" }],
  "lesson_no": 2
}
```

| Field | Required | Rule |
|---|---|---|
| `format` | yes | Exactly `prep-tutor`. |
| `version` | yes | The number `1`. A file with any other version is refused. |
| `slug` | yes | The tutor id: lowercase letters, numbers and hyphens. The same rule the form applies to a typed id, and the id the tutor lesson posts to. |
| `course` | yes | The course code the tutor belongs to, for example `phys-215`. Compared without regard to case with the course the page is on. A file for another course is refused. |
| `title` | yes | At most 200 characters. |
| `description` | no | At most 500 characters. |
| `url` | no | Where cadets open the tutor. Must start with `http://` or `https://`. Without it the tutor can be saved as a draft, but the form asks for a link before it is published. |
| `objective_keys` | no | A list of objective keys (letters, numbers, hyphens, underscores; at most 80 characters each). |
| `objectives` | no | A list of `{ "key", "label" }`. Where a key appears here its label is used; a key given only in `objective_keys` is labelled with itself. At most 20 objectives in all. |
| `lesson_no` | no | A whole number from 0 to 32767. It fills the assignment number only when that box is empty. |

**Unknown fields are ignored**, so a later version of the builder may add some without breaking this reader. Anything outside the
rules above makes the whole file refused, with a sentence that names what is wrong. A file is read once, in the browser; it is never
uploaded anywhere.

## What each field does

- `slug`, `url`, `title` and `description` fill the Tutor id, Tutor link, Tutor title and Tutor description boxes. A title equal to the
  assignment title is left out, because the tutor title defaults to it.
- A slug already used by another assignment is handled exactly as typing that id would be: the save refuses it and says so.
- On a saved assignment that already has a linked tutor, a different `slug` is a replacement. The save asks the same question it asks
  for a replacement made any other way, with the number of reports and cadets affected.
- `objective_keys` and `objectives` are written to `assignments.objectives`, the list of `{ key, label }` the whole assignment shares,
  in the same Save. A save without a file does not touch that column. No schema change is needed: the column already exists.
- `lesson_no` is shown in the summary and, when the assignment number box is empty, put there.

## Making files for tutors that already exist

`scripts/artifacts/make_tutor_files.py` builds one file per published tutor from the course catalogues that the artifact tools keep
under `_builder/courses/<course>/index.json`. It is read-only on the repository, prints what it would write, and writes only with
`--out <folder>`.

## Producing the file

The tutor builder does not emit this file yet. Until it does, a director uses the prefill link, or a file made by the script above.
