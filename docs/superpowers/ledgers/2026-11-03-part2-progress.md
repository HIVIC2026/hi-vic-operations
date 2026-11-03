# SDD ledger — plan: docs/superpowers/plans/2026-11-03-part2-electrician-calls-and-books.md
Spec: docs/superpowers/specs/2026-11-03-deep-first-job-design.md (Part 2)
Branch: part2-electrician-calls-and-books from origin/main (e1e7e34) + plan abb1fbf
Env: node_modules symlinked from /home/claude/hivic2026/hi-vic-operations (xlsx missing); run test files one at a time.
Jo decisions: swap after booking → cancel booking, new electrician books fresh.

## Preflight scan
| Rows | Produces / consumes | Finding |
|---|---|---|
| T1→T3 | bookerNotices / sendOwnJobPiesaNotices | consistent |
| T2→T3 | handOwnJobPiesa calls sendOwnJobPiesaNotices (defined T3) | ordering: T2 needs it first — Ruling: T2 defines a stub sendOwnJobPiesaNotices in own-job-piesa-notices.server.ts that only logs; T3 fills it in — cost if wrong: none |
| T2→T4 | own_job_piesa_handed due_at / deadline sweep | consistent |
| T3→T5 | createElectricianJobLink/revoke / swap | consistent |
| T3 self | piesaBookingProblem 30 days from paidAt | Ruling: keep as the plan says (the 30-day limit is the PIESA booking guard, not the install rule) — cost if wrong: a late booking is refused; office books by hand |
| T6 self | wording doc + TEST journey + PR | Ruling: T6 steps 1–2 dispatched; push/PR/SQL apply are controller steps |
Task 1: minor (deferred): setter audit insert unchecked; booker radio has no visible error on failed save; no DB test for setter/read
Task 1: complete (commits abb1fbf..0def8e8, review clean)
Task 2: Ruling: concern 1 (old own jobs already in the pending stage) — no action; Jo said 2 Nov no real jobs exist yet — cost if wrong: a stray test-era own job needs a manual office hand-over
Task 2: Ruling: concerns 2 (repeat round) and 3 (usual electrician fallback) are real gaps — sent to the fix loop with the review findings — cost if wrong: Deep's "usual electrician" jobs would hold
Task 2: Ruling: I2 (Mitti pickups) — fall back to mittiElectricianAtSafetyCheck (the installer's approved usual electrician), as the old path did — plan-mandated gap, spec says "the installer's own electrician" — cost if wrong: a job goes to the usual electrician instead of holding
Task 2: minor (deferred): rare racer-delete race; unchecked delete after failed move; holdOnce check-then-insert; extra in-house read; dead installer branch in autoOfferForJob; TEST/QA journeys (Task 6)
Task 2: fix round 1/5 (5 addressed, 0 open; commits 2a3c8c8..b56af1c)
Task 2: minor (deferred): notices failing after handed event never retried (Task 3 must own the retry); repair race on overlapping ticks; silent wait at own-job-piesa.server:115; prev-round electrician's proposals not superseded; tick ok on in-house read fail; hold item not rechecked
Task 2: complete (commits 0def8e8..b56af1c, review clean after 1 fix round)
Carry to Task 3: (a) sendOwnJobPiesaNotices owns its own retry, one key per send; (b) linkBookPiesa supersedes the job's 'proposed' appointment_proposals as pilot.functions.ts:472 does
Task 3: implementer hit weekly model limit mid-task (resets 5 Nov 5am); partial work saved on branch part2-task3-wip (unreviewed). Resume: dispatch a fresh implementer reading task-3-report.md if present, plus the WIP diff.
