# Audits

Point-in-time reviews of the system. **Like `docs/decisions/` and `docs/contracts/`, these are records,
not living documents** — they are superseded by the next audit, never refreshed in place, and are
deliberately *not* registered in `docs/DOC-SOURCES.json`. A finding here describes the system as it
stood on the date in the filename.

When a finding is acted on, the fix is recorded in `CHANGELOG.md` and, where it changes how the system
is operated, in `.ai/instructions/CORE.md` — not by editing the audit.

---

## 2026-08-07 — full system audit

Six parallel read-only specialist reviews, cross-refereed. **94 findings** (9 Critical/Blocker,
24 High, 32 Medium, 30 Low). No repository file was modified, no database connection was made, and no
script was executed during the audit.

**Start here:** [`2026-08-07-SYSTEM-AUDIT.md`](2026-08-07-SYSTEM-AUDIT.md) — executive summary, the
nine Critical/Blocker findings, three structural root causes, a phased remediation plan sequenced
against a live system, and (§10) the course director's clarifications from the review session.

| Report | Lens | Findings |
|---|---|---|
| [`2026-08-07-security.md`](2026-08-07-security.md) | RLS policies, edge functions, untrusted input, secrets & PII, auth/session | 17 |
| [`2026-08-07-database.md`](2026-08-07-database.md) | Both migration chains, schema-vs-code drift, triggers, JSONB contracts, the `public` legacy | 14 |
| [`2026-08-07-frontend.md`](2026-08-07-frontend.md) | Module layering, duplication, constant sets, CSS, performance, a11y | 16 |
| [`2026-08-07-onboarding.md`](2026-08-07-onboarding.md) | Fresh clone → verified lesson cycle; legacy inventory; proposed target state | 21 |
| [`2026-08-07-python.md`](2026-08-07-python.md) | Dry-run/idempotency compliance, script inventory, duplication, portability | 15 |
| [`2026-08-07-docs-tests.md`](2026-08-07-docs-tests.md) | Doc accuracy, broken references, CHANGELOG rotation, test coverage matrix | 13 |

**Scope excluded:** the artifact library, which was being actively edited during the audit —
`site/faculty/artifacts.html`, `site/js/faculty-artifacts.js`, `scripts/artifacts/**`, `_builder/**`,
`docs/operations/PUBLISH-ARTIFACT.md`, `supabase/migrations/023_artifact_sources_storage*.sql`,
`tests/browser/test-artifacts.html`. See §9 of the master report for what still needs a pass there —
notably the Supabase Storage bucket policies introduced by migration `023`, which sit entirely outside
the RLS model audited here.

**Standing caveat:** every finding is static analysis against committed source. There is no migration
ledger in the repository — the only record of what has actually been applied is prose in
`CHANGELOG.md`. The master report's §2 lists the read-only verification queries to run before acting
on any schema-level recommendation.

---

## Earlier

- [`../app/LEGACY-AUDIT-2026-07-20.md`](../app/LEGACY-AUDIT-2026-07-20.md) — pre-cutover audit of the
  legacy `public` frontend, kept with the v2 build notes it belongs to.
