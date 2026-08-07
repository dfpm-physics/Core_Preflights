# Backend Options — where the reports actually go

This is the decision that determines whether a port takes an afternoon or a fortnight. Make it
before you build a single artifact, because a wrong endpoint fails **silently**: the student has
the full conversation, clicks Submit, sees a page, and the work reaches nothing.

---

## Option A — reuse the existing receiver (recommended, and usually correct)

If the new course lives in the same department deployment, change **one value**: `course_id` in
`COURSE_PROFILE.md`. The endpoints stay byte-identical. The receiver resolves each submission by
slug, and slugs are namespaced by lesson number and topic, so two courses coexist without
collision as long as their topics differ.

What you still have to do per course:

1. Register each lesson on the Lessons page via the prefill link (course id must be the new one).
2. Confirm the course id exists in the site's course list before the first artifact goes out. A
   prefill link with an unknown course id will save under nothing useful.
3. Watch for **slug collisions** across courses. `lesson-02-electric-charge` is unique enough;
   `lesson-01-introduction` is not. If two courses could both mint the same slug, prefix the
   topic slug with the course short code and record that decision in the profile.

Cost: minutes. Risk: near zero. This is the path for a second USAFA physics course.

---

## Option B — stand up your own receiver

Required when the deployment leaves the existing site: another institution, another department,
or a course that must not share a database. The artifact side of the kit is unchanged — only the
two URLs in the profile move.

### What the receiver must do

It is a **static page**, not an API. GitHub Pages cannot accept a POST, which is why the whole
transport is a URL hash. Reproduce this behavior exactly or the contract is broken:

1. **Accept a hash payload**, not a query string. Format:
   `…/interaction-submit.html#t=interaction&i=<slug>&r=<lz>&d=<lz>`, parsed with
   `URLSearchParams`. The hash is deliberate: fragments are never sent to servers or written to
   access logs, so student work stays out of request logs.
2. **Decompress `r` and `d`** with the same LZ-String codec the artifact uses
   (`compressToEncodedURIComponent` / `decompressFromEncodedURIComponent`). Version-match the
   library; a codec mismatch decodes to garbage, not to an error.
3. **Resolve `i` against the activity slug.** An unresolvable slug must fail loudly to the
   student, not quietly to the log. This is the single most common deployment failure.
4. **Store `r` as the human-readable transcript** and `d` as the structured content record.
5. **Auto-grade from `d.effort`.** Absent `d`, do not write a grade — and surface that state to
   the instructor rather than leaving a committed submission silently ungraded.
6. **Finalize on first commit.** On a graded lesson the first report submitted is the one that
   counts; a second is refused. The artifact tells students exactly this, so the receiver must
   behave that way.
7. **Authenticate the student** and write under their session. The kit assumes the receiver knows
   who is submitting; the artifact collects only a last name, for the report header.

### What the faculty page must do

The prefill link (`contracts/INTERACTION-PREFILL-LINK.md`) opens a new-lesson form with query
parameters filled in and **writes nothing automatically**. Reproduce the parameter names exactly
— `new`, `id`, `course`, `title`, `url`, and the optional `policy`, `desc`, `iid`, `ititle`,
`idesc`, `num`, `due_m`, `due_t`, `pub`. Unknown keys are ignored, which means a typo is
invisible rather than an error. There is no parameter for objectives; the director sets those by
hand after Save.

### Sequence that avoids losing work

1. Deploy the receiver and the faculty page.
2. Register one throwaway lesson and submit one artifact session end to end, as a student.
3. Confirm the grade was written from `d.effort` and the transcript is readable.
4. *Then* build the real lessons.

Cost: days, mostly in auth and the database schema. The artifact side is free.

---

## Option C — no backend (pilot / evaluation only)

Legitimate for a single-section trial where you want the tutoring behavior without the pipeline:
build the artifacts, drop the Submit wiring, and have students paste the report into whatever
you already collect assignments with.

Be clear-eyed about what you give up. Without `d` there is no auto-grade, no cohort rollup, and
no misconception aggregation — which is to say, no JiTT loop. You get a good tutor and none of
the intelligence that motivated the system. **Do not run this at scale**: a hand-carried report
looks, from the student's side, exactly like a successful submission, and the failure only
surfaces when someone tries to grade a thousand of them.

If you go this way, say so explicitly in `COURSE_PROFILE.md` so no future build assumes a
receiver exists.
