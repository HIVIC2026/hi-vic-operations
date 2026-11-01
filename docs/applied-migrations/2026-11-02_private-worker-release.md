# Approved private Team date-of-birth release — 2 November 2026

- Applied only `d64a63d`'s `2026-11-02_private_worker_birth_dates.sql`, journaled as `drizzle/migrations/0186_private_worker_birth_dates.sql`.
- Original archived here byte-for-byte; no saved-work SQL or other migration applied. Verified at approximately 10:45 AEDT.
- Live catalog confirms four required identity columns, RLS enabled, own-business-admin/office SELECT policy excluding qa_office, and matching atomic add function. Function execution: service_role yes; authenticated/anon no. No new trigger is defined by this migration; existing worker triggers remain in place.
- Database tooling regenerated schema types. No application behaviour changed in this release.

## Verification without live records

Practice before applying: 7 passed / 0 failed. Final related checks: 8 passed / 0 failed, 34 assertions.

`tests/jo-morning-private-dob-db.test.ts` now reads the applied journal and additionally proves service-role Lead/Crew creation, optional email, compatibility with inspected live INSERT constraints/triggers, unauthorized execution denial, and forced failure of the second identity write rolling back the worker. Existing practice test checks own-business admin versus another business/ordinary user and office reads.

The current Team form calls `addTeamPerson` → authenticated `tradeAddTeamPerson` → `add_team_installer_with_identity`, with all seven matching arguments. Creation returns immediately with no sender/provider follow-through. Live columns, defaults, constraints and insert triggers were checked read-only against that write.

**Actual live Team creation/browser end-to-end: NOT RUN.** It would create live data, explicitly prohibited. Schema compatibility plus practice insert success is not a claim that a real live form was submitted.

## Unchanged data and safeguards

Before/after fingerprints equal:

| Scope | Count | Fingerprint |
|---|---:|---|
| Workers | 48 | a6e6421a68d0ec0311a5822803983cf0 |
| Businesses | 25 | 98f5c692de442ca8f592d0b32885fde5 |
| Workflow settings | — | d3e276553014e4214a18741df869c7da |

New private identity table contains zero rows. No settings, records, sends or publishing actions were performed. Saved-work functions remain absent and SQL pending.

Effective table privilege probes showed inherited anon/authenticated table privileges beyond the explicit migration grants. RLS has only the authenticated private SELECT policy and no client write policy, so public reads/client writes remain denied; creation function is service-only. No extra privilege changes were made outside the exact approved SQL.

Jo will publish separately. After publication, Jo can check adding a real authorized installer to Team with required date of birth; this release did not create a test person.