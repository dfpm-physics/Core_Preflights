# PREP documentation

- `operations/` — course-director and system operating guides.
- `architecture/` — platform and data-model design.
- `contracts/` — frozen or externally consumed interfaces.
- `decisions/` — design agreements and implementation specifications.
- `audits/` — point-in-time system reviews. Records, not living documents.
- `findings/` — one defect each, written for a *successor* to verify independently and fix. A work
  order with a status, closed when the fix lands. Distinct from `audits/` by who acts next: an audit
  describes a system to a reader, a finding assigns work. See `findings/README.md` — everything here
  is publicly served, so findings carry **no student identifiers**, only the query that locates them.
- `app/` — build notes and plans from the PREP v2 (`app` schema) work. Historical.
- `ROADMAP.md` — the living work tracker.

The deployed static website lives under `site/`. AI instructions and skills live under `.ai/`.
