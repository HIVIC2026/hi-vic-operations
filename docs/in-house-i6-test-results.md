# I6 isolated test and regression report

No SQL, publication, communication switch changes or provider delivery. Each file ran in its own Bun process, with scrubbed environment and a fetch-denial preload. All database tests use local practice databases.

## Current requested run

85 files: 1094 pass / 5 fail / 3 skip / 0 errors.

| Isolated file | Pass | Fail | Skip | Baseline 5fadf36 |
|---|---:|---:|---:|---|
| tests/allocation-hardening-db.test.ts | 7 | 0 | 0 | 7 pass / 0 fail / 0 skip |
| tests/allocation.core.test.ts | 27 | 0 | 0 | 27 pass / 0 fail / 0 skip |
| tests/auto-offer-switches-practice-db.test.ts | 2 | 0 | 0 | 2 pass / 0 fail / 0 skip |
| tests/auto-offer.core.test.ts | 26 | 0 | 0 | 26 pass / 0 fail / 0 skip |
| tests/autoadvance.test.ts | 20 | 0 | 3 | 19 pass / 0 fail / 3 skip |
| tests/booking-gaps.test.ts | 7 | 0 | 0 | 7 pass / 0 fail / 0 skip |
| tests/booking-overdue-needs.test.ts | 2 | 0 | 0 | 2 pass / 0 fail / 0 skip |
| tests/fixes-day.test.ts | 11 | 0 | 0 | 11 pass / 0 fail / 0 skip |
| tests/in-house-advance-server.test.ts | 2 | 0 | 0 | Absent (new test) |
| tests/in-house-batch-email.test.ts | 4 | 0 | 0 | Absent (new test) |
| tests/in-house-batch-practice-db.test.ts | 10 | 0 | 0 | Absent (new test) |
| tests/in-house-batch-server.test.ts | 9 | 0 | 0 | Absent (new test) |
| tests/in-house-batch.core.test.ts | 10 | 0 | 0 | Absent (new test) |
| tests/in-house-booking-practice-db.test.ts | 25 | 0 | 0 | Absent (new test) |
| tests/in-house-events-practice-db.test.ts | 1 | 0 | 0 | Absent (new test) |
| tests/in-house-flag-practice-db.test.ts | 2 | 0 | 0 | Absent (new test) |
| tests/in-house-held-messages.test.ts | 109 | 0 | 0 | Absent (new test) |
| tests/in-house-held-presentation.test.ts | 5 | 0 | 0 | Absent (new test) |
| tests/in-house-mitti-forms.test.ts | 42 | 0 | 0 | Absent (new test) |
| tests/in-house-needs-server.test.ts | 2 | 0 | 0 | Absent (new test) |
| tests/in-house-needs.core.test.ts | 5 | 0 | 0 | Absent (new test) |
| tests/in-house-pull-back-practice-db.test.ts | 3 | 0 | 0 | Absent (new test) |
| tests/in-house-suppression.test.ts | 26 | 0 | 0 | Absent (new test) |
| tests/in-house.core.test.ts | 10 | 0 | 0 | Absent (new test) |
| tests/install-clearance.test.ts | 10 | 1 | 0 | 10 pass / 1 fail / 0 skip |
| tests/installer-paid-electricians-read-paths.test.ts | 12 | 0 | 0 | Absent (new test) |
| tests/installer-paid-electricians.test.ts | 6 | 0 | 0 | 5 pass / 0 fail / 0 skip |
| tests/mitti-audit-route.test.ts | 13 | 0 | 0 | 13 pass / 0 fail / 0 skip |
| tests/mitti-autoform.test.ts | 27 | 1 | 0 | 27 pass / 1 fail / 0 skip |
| tests/mitti-complete.test.ts | 12 | 0 | 0 | 12 pass / 0 fail / 0 skip |
| tests/mitti-completed-refresh.test.ts | 4 | 0 | 0 | 4 pass / 0 fail / 0 skip |
| tests/mitti-contact-consent.test.ts | 3 | 0 | 0 | 3 pass / 0 fail / 0 skip |
| tests/mitti-e2e-practice-db.test.ts | 1 | 0 | 0 | 1 pass / 0 fail / 0 skip |
| tests/mitti-e2e-repairs.test.ts | 7 | 0 | 0 | 7 pass / 0 fail / 0 skip |
| tests/mitti-electrician-options.test.ts | 10 | 0 | 0 | 10 pass / 0 fail / 0 skip |
| tests/mitti-fixes-template-practice-db.test.ts | 4 | 0 | 0 | 4 pass / 0 fail / 0 skip |
| tests/mitti-form-health.test.ts | 11 | 0 | 0 | 11 pass / 0 fail / 0 skip |
| tests/mitti-form-link.test.ts | 2 | 0 | 0 | 2 pass / 0 fail / 0 skip |
| tests/mitti-form-schema.test.ts | 12 | 0 | 0 | 12 pass / 0 fail / 0 skip |
| tests/mitti-identity-reuse.test.ts | 27 | 0 | 0 | 27 pass / 0 fail / 0 skip |
| tests/mitti-immediate.test.ts | 5 | 0 | 0 | 5 pass / 0 fail / 0 skip |
| tests/mitti-instant-notice-switch.pglite.test.ts | 4 | 0 | 0 | 4 pass / 0 fail / 0 skip |
| tests/mitti-invite.core.test.ts | 18 | 0 | 0 | 18 pass / 0 fail / 0 skip |
| tests/mitti-invite.server.test.ts | 16 | 0 | 0 | 16 pass / 0 fail / 0 skip |
| tests/mitti-journey-guard.test.ts | 2 | 0 | 0 | 2 pass / 0 fail / 0 skip |
| tests/mitti-link.test.ts | 4 | 0 | 0 | 4 pass / 0 fail / 0 skip |
| tests/mitti-membership.test.ts | 9 | 0 | 0 | 9 pass / 0 fail / 0 skip |
| tests/mitti-new-answers-23oct.test.ts | 24 | 0 | 0 | 24 pass / 0 fail / 0 skip |
| tests/mitti-pickup-auto.test.ts | 35 | 0 | 0 | 35 pass / 0 fail / 0 skip |
| tests/mitti-pickup.test.ts | 10 | 0 | 0 | 10 pass / 0 fail / 0 skip |
| tests/mitti-practice-access.test.ts | 1 | 0 | 0 | 1 pass / 0 fail / 0 skip |
| tests/mitti-practice.test.ts | 2 | 0 | 0 | 2 pass / 0 fail / 0 skip |
| tests/mitti-provisional-handover-db.test.ts | 2 | 0 | 0 | 2 pass / 0 fail / 0 skip |
| tests/mitti-pull-worker.test.ts | 3 | 0 | 0 | 3 pass / 0 fail / 0 skip |
| tests/mitti-reading-23oct-fixes.test.ts | 7 | 0 | 0 | 7 pass / 0 fail / 0 skip |
| tests/mitti-ready-check-published-templates.test.ts | 9 | 0 | 0 | 9 pass / 0 fail / 0 skip |
| tests/mitti-ready-check-stage.test.ts | 7 | 0 | 0 | 7 pass / 0 fail / 0 skip |
| tests/mitti-retry-core.test.ts | 63 | 0 | 0 | 63 pass / 0 fail / 0 skip |
| tests/mitti-retry-route.test.ts | 3 | 0 | 0 | 3 pass / 0 fail / 0 skip |
| tests/mitti-retry-sweep.test.ts | 44 | 0 | 0 | 44 pass / 0 fail / 0 skip |
| tests/mitti-sync-overlap-fixes.test.ts | 1 | 0 | 0 | 1 pass / 0 fail / 0 skip |
| tests/mitti-sync-overlap.test.ts | 1 | 0 | 0 | 1 pass / 0 fail / 0 skip |
| tests/mitti-sync-skip-closed.test.ts | 4 | 0 | 0 | 4 pass / 0 fail / 0 skip |
| tests/mitti-test-routing.test.ts | 9 | 0 | 0 | 9 pass / 0 fail / 0 skip |
| tests/mitti-webhook.core.test.ts | 13 | 0 | 0 | 13 pass / 0 fail / 0 skip |
| tests/mitti-webhook.server.test.ts | 16 | 0 | 0 | 16 pass / 0 fail / 0 skip |
| tests/mitti.core.test.ts | 27 | 0 | 0 | 27 pass / 0 fail / 0 skip |
| tests/office-needs-me.test.ts | 6 | 0 | 0 | 6 pass / 0 fail / 0 skip |
| tests/office-needs-snapshot.test.ts | 7 | 0 | 0 | 7 pass / 0 fail / 0 skip |
| tests/owner-email-auto-reply-events-practice-db.test.ts | 5 | 0 | 0 | 5 pass / 0 fail / 0 skip |
| tests/owner-email-auto-reply.test.ts | 58 | 1 | 0 | 58 pass / 1 fail / 0 skip |
| tests/owner-email-presentation.test.ts | 6 | 0 | 0 | 6 pass / 0 fail / 0 skip |
| tests/owner-email-review.test.ts | 5 | 0 | 0 | 5 pass / 0 fail / 0 skip |
| tests/owner-email-send-outlook.test.ts | 11 | 0 | 0 | 11 pass / 0 fail / 0 skip |
| tests/owner-email-send-retry.test.ts | 6 | 0 | 0 | 6 pass / 0 fail / 0 skip |
| tests/owner-email-triggers.test.ts | 16 | 2 | 0 | 16 pass / 2 fail / 0 skip |
| tests/pays-own-electricians.test.ts | 3 | 0 | 0 | Absent (new test) |
| tests/piesa-times.test.ts | 22 | 0 | 0 | 22 pass / 0 fail / 0 skip |
| tests/pilot.test.ts | 24 | 0 | 0 | 24 pass / 0 fail / 0 skip |
| tests/ready-check-times-flow-db.test.ts | 12 | 0 | 0 | 12 pass / 0 fail / 0 skip |
| tests/ready-check-times-link-db.test.ts | 1 | 0 | 0 | 1 pass / 0 fail / 0 skip |
| tests/ready-check-times.core.test.ts | 31 | 0 | 0 | 31 pass / 0 fail / 0 skip |
| tests/rectification-pricing.test.ts | 2 | 0 | 0 | 2 pass / 0 fail / 0 skip |
| tests/rectification-windows-db.test.ts | 6 | 0 | 0 | 6 pass / 0 fail / 0 skip |
| tests/rectification.core.test.ts | 6 | 0 | 0 | 6 pass / 0 fail / 0 skip |

## Failing tests (all also fail at 5fadf36)

### tests/install-clearance.test.ts
- wording (decision 186) > wired at the two places clearance is established and in the 15-minute tick; the server never talks to a provider itself
- Baseline: 1 failure(s); unchanged failure reproduced independently.
### tests/mitti-autoform.test.ts
- sweepReadyCheckForms > wired into the 15-minute tick, never sends to owners; stage only via the shared Mitti hold
- Baseline: 1 failure(s); unchanged failure reproduced independently.
### tests/owner-email-auto-reply.test.ts
- decision 386 wording (DRAFT O76a–O76j) > one draft file per answer, rendered HTML equals the file (bun scripts/render-decision-386-drafts.ts)
- Baseline: 1 failure(s); unchanged failure reproduced independently.
### tests/owner-email-triggers.test.ts
- O51 review request (decision 105) > decision 335: the My job review screen exists; still held until a Google review link is set
- source pins: each trigger calls its sender exactly once with its key > workflow call sites: each fires once, best-effort (.catch) so the action never breaks
- Baseline: 2 failure(s); unchanged failure reproduced independently.

Baseline full matched-existing run: 67 files; 812 pass / 5 fail / 3 skip; 63 passing files / 4 failing files, no execution errors. New files do not exist at baseline.

## Quote regression: every historical commit isolated

165 / 165 historical runs completed (baseline plus every chronological commit through pre-request HEAD d2662305).

**First failing commit: 7fa6e374** (passing parent 3f364798). Changed payment reader explicitly selects/filters businesses.in_house; original practice businesses schema has no such column. Quote generation safely stops, producing zero live quotes. C1 later additionally needs pays_own_electricians. This is a practice-schema regression, not a duplicate send. Repair appends false-default flag columns to the practice schema; all original concurrency, one-live-quote, issued/released and exactly-once owner sender assertions remain byte-identical. Current isolated test: 1 pass / 0 fail / 7 assertions. No production payment read fallback or weakened hold introduced. 2b6ccb82 was already failing and is not the first failure; recovery code unchanged.

| Order | Commit | Subject | Isolated result |
|---:|---|---|---|
| 0 | 5fadf36c | Merge pull request #99 from HIVIC2026/fix/install-area-product | 1 pass / 0 fail |
| 1 | ae24a4f7 | Work in progress | 1 pass / 0 fail |
| 2 | d21d9760 | Changes | 1 pass / 0 fail |
| 3 | 82d9de2c | Changes | 1 pass / 0 fail |
| 4 | b428391f | Changes | 1 pass / 0 fail |
| 5 | 7c6fa926 | Changes | 1 pass / 0 fail |
| 6 | 7bb2bad5 | Changes | 1 pass / 0 fail |
| 7 | 09580313 | Changes | 1 pass / 0 fail |
| 8 | b0acf591 | Changes | 1 pass / 0 fail |
| 9 | f8acf986 | Changes | 1 pass / 0 fail |
| 10 | 8427caf2 | Ran focused tests on build() | 1 pass / 0 fail |
| 11 | 25bd1cb0 | Changes | 1 pass / 0 fail |
| 12 | 6d2adfe4 | Lovable update | 1 pass / 0 fail |
| 13 | 8f0f6edc | Work in progress | 1 pass / 0 fail |
| 14 | 343bf39c | Changes | 1 pass / 0 fail |
| 15 | 32b99ca2 | Changes | 1 pass / 0 fail |
| 16 | 3f364798 | Changes | 1 pass / 0 fail |
| 17 | 7fa6e374 | Changes | 0 pass / 1 fail (zero live quotes) |
| 18 | fbe5c435 | Changes | 0 pass / 1 fail (zero live quotes) |
| 19 | 6662cf56 | Changes | 0 pass / 1 fail (zero live quotes) |
| 20 | 95436f26 | Changes | 0 pass / 1 fail (zero live quotes) |
| 21 | af62b3b1 | Fixed in-house PIESA pricing | 0 pass / 1 fail (zero live quotes) |
| 22 | cdcfb00e | Changes | 0 pass / 1 fail (zero live quotes) |
| 23 | ae25cd3a | Changes | 0 pass / 1 fail (zero live quotes) |
| 24 | 27479523 | Changes | 0 pass / 1 fail (zero live quotes) |
| 25 | 5fa12205 | Fixed in-house migrate events | 0 pass / 1 fail (zero live quotes) |
| 26 | 327a0d9f | Changes | 0 pass / 1 fail (zero live quotes) |
| 27 | 8bda15e9 | Changes | 0 pass / 1 fail (zero live quotes) |
| 28 | 630f969a | Changes | 0 pass / 1 fail (zero live quotes) |
| 29 | 01036187 | Changes | 0 pass / 1 fail (zero live quotes) |
| 30 | fc71f3df | Changes | 0 pass / 1 fail (zero live quotes) |
| 31 | 7740827c | Changes | 0 pass / 1 fail (zero live quotes) |
| 32 | 15e2c39b | Changes | 0 pass / 1 fail (zero live quotes) |
| 33 | db586341 | Changes | 0 pass / 1 fail (zero live quotes) |
| 34 | 86a6f970 | Added allocation screen route | 0 pass / 1 fail (zero live quotes) |
| 35 | a0461946 | Work in progress | 0 pass / 1 fail (zero live quotes) |
| 36 | f432288b | Changes | 0 pass / 1 fail (zero live quotes) |
| 37 | f5033a94 | Changes | 0 pass / 1 fail (zero live quotes) |
| 38 | b5515e35 | Changes | 0 pass / 1 fail (zero live quotes) |
| 39 | 525fc409 | Changes | 0 pass / 1 fail (zero live quotes) |
| 40 | f9ad8c58 | Changes | 0 pass / 1 fail (zero live quotes) |
| 41 | ee78c1ba | Fixed in-house batch emails | 0 pass / 1 fail (zero live quotes) |
| 42 | 97c18913 | Changes | 0 pass / 1 fail (zero live quotes) |
| 43 | 0584b636 | Changes | 0 pass / 1 fail (zero live quotes) |
| 44 | 696c3304 | Changes | 0 pass / 1 fail (zero live quotes) |
| 45 | 937d9b9e | Changes | 0 pass / 1 fail (zero live quotes) |
| 46 | 469c316b | Changes | 0 pass / 1 fail (zero live quotes) |
| 47 | 9ab75765 | Changes | 0 pass / 1 fail (zero live quotes) |
| 48 | 45aa9f2d | Changes | 0 pass / 1 fail (zero live quotes) |
| 49 | f9d962e6 | Changes | 0 pass / 1 fail (zero live quotes) |
| 50 | 527770ef | Changes | 0 pass / 1 fail (zero live quotes) |
| 51 | daa16e76 | Implemented in-house suppression | 0 pass / 1 fail (zero live quotes) |
| 52 | 124ceda8 | Changes | 0 pass / 1 fail (zero live quotes) |
| 53 | d9f0415b | Changes | 0 pass / 1 fail (zero live quotes) |
| 54 | 12b070dd | Changes | 0 pass / 1 fail (zero live quotes) |
| 55 | e276b392 | Changes | 0 pass / 1 fail (zero live quotes) |
| 56 | 54c60f21 | Changes | 0 pass / 1 fail (zero live quotes) |
| 57 | 808d6729 | Changes | 0 pass / 1 fail (zero live quotes) |
| 58 | b0b75665 | Changes | 0 pass / 1 fail (zero live quotes) |
| 59 | 40d33df2 | Fixed missed-delete, reads, & skips | 0 pass / 1 fail (zero live quotes) |
| 60 | 9eecbea6 | Changes | 0 pass / 1 fail (zero live quotes) |
| 61 | 500b587e | Changes | 0 pass / 1 fail (zero live quotes) |
| 62 | 1002c87b | Restored refresh logic only | 0 pass / 1 fail (zero live quotes) |
| 63 | 179c59bc | Changes | 0 pass / 1 fail (zero live quotes) |
| 64 | 1ae5dfdb | Changes | 0 pass / 1 fail (zero live quotes) |
| 65 | b6687f1f | Changes | 0 pass / 1 fail (zero live quotes) |
| 66 | b7b29bc9 | Changes | 0 pass / 1 fail (zero live quotes) |
| 67 | 65bd9481 | Changes | 0 pass / 1 fail (zero live quotes) |
| 68 | 913bc5e3 | Changes | 0 pass / 1 fail (zero live quotes) |
| 69 | aab3a26e | Changes | 0 pass / 1 fail (zero live quotes) |
| 70 | 5619d823 | Changes | 0 pass / 1 fail (zero live quotes) |
| 71 | 0a2ace7e | Changes | 0 pass / 1 fail (zero live quotes) |
| 72 | 2548f90e | Added partner pickers | 0 pass / 1 fail (zero live quotes) |
| 73 | b6c134b7 | Changes | 0 pass / 1 fail (zero live quotes) |
| 74 | 398f2291 | Changes | 0 pass / 1 fail (zero live quotes) |
| 75 | b134555e | Changes | 0 pass / 1 fail (zero live quotes) |
| 76 | 2a8b2a05 | Changes | 0 pass / 1 fail (zero live quotes) |
| 77 | d73921f6 | Changes | 0 pass / 1 fail (zero live quotes) |
| 78 | a83d0e48 | Changes | 0 pass / 1 fail (zero live quotes) |
| 79 | 6500d542 | Fixed Melbourne booking view | 0 pass / 1 fail (zero live quotes) |
| 80 | 196bdb8c | Changes | 0 pass / 1 fail (zero live quotes) |
| 81 | 7853c803 | Changes | 0 pass / 1 fail (zero live quotes) |
| 82 | 0361afc1 | Changes | 0 pass / 1 fail (zero live quotes) |
| 83 | 50c64921 | Changes | 0 pass / 1 fail (zero live quotes) |
| 84 | 356fc0f2 | Changes | 0 pass / 1 fail (zero live quotes) |
| 85 | 28fa2f94 | Changes | 0 pass / 1 fail (zero live quotes) |
| 86 | cbb87977 | Changes | 0 pass / 1 fail (zero live quotes) |
| 87 | 9c353c81 | Added Mitti form tests | 0 pass / 1 fail (zero live quotes) |
| 88 | 7c2c9da9 | Changes | 0 pass / 1 fail (zero live quotes) |
| 89 | b1d53439 | Changes | 0 pass / 1 fail (zero live quotes) |
| 90 | 07d0a07a | Changes | 0 pass / 1 fail (zero live quotes) |
| 91 | 721b6cf6 | Changes | 0 pass / 1 fail (zero live quotes) |
| 92 | c0543f6b | Changes | 0 pass / 1 fail (zero live quotes) |
| 93 | 2d11ba06 | Changes | 0 pass / 1 fail (zero live quotes) |
| 94 | 02acbf70 | Changes | 0 pass / 1 fail (zero live quotes) |
| 95 | 0a3e26b0 | Changes | 0 pass / 1 fail (zero live quotes) |
| 96 | 030585cd | Changes | 0 pass / 1 fail (zero live quotes) |
| 97 | 897c8b36 | Changes | 0 pass / 1 fail (zero live quotes) |
| 98 | aecd4a0c | Changes | 0 pass / 1 fail (zero live quotes) |
| 99 | f4e85adf | Changes | 0 pass / 1 fail (zero live quotes) |
| 100 | 03f0a3bd | Changes | 0 pass / 1 fail (zero live quotes) |
| 101 | 85b430cf | Changes | 0 pass / 1 fail (zero live quotes) |
| 102 | f8472801 | Changes | 0 pass / 1 fail (zero live quotes) |
| 103 | 5ffbd627 | Changes | 0 pass / 1 fail (zero live quotes) |
| 104 | ba8db4d5 | Changes | 0 pass / 1 fail (zero live quotes) |
| 105 | b19fd611 | Changes | 0 pass / 1 fail (zero live quotes) |
| 106 | 3ef57820 | Changes | 0 pass / 1 fail (zero live quotes) |
| 107 | e10fb84f | Changes | 0 pass / 1 fail (zero live quotes) |
| 108 | 1ad9a855 | Changes | 0 pass / 1 fail (zero live quotes) |
| 109 | 1df0ba1e | Changes | 0 pass / 1 fail (zero live quotes) |
| 110 | 6418148b | Restored clearance flow | 0 pass / 1 fail (zero live quotes) |
| 111 | cc5d27be | Changes | 0 pass / 1 fail (zero live quotes) |
| 112 | 843e1449 | Changes | 0 pass / 1 fail (zero live quotes) |
| 113 | b2568f70 | Changes | 0 pass / 1 fail (zero live quotes) |
| 114 | 59ea17e6 | Changes | 0 pass / 1 fail (zero live quotes) |
| 115 | 2b6ccb82 | Recovered missing emails | 0 pass / 1 fail (zero live quotes) |
| 116 | b8a65a92 | Changes | 0 pass / 1 fail (zero live quotes) |
| 117 | 81434d88 | Changes | 0 pass / 1 fail (zero live quotes) |
| 118 | 4935c894 | Changes | 0 pass / 1 fail (zero live quotes) |
| 119 | 2a81b460 | Changes | 0 pass / 1 fail (zero live quotes) |
| 120 | bebec5c7 | Changes | 0 pass / 1 fail (zero live quotes) |
| 121 | 6ec6cccb | Changes | 0 pass / 1 fail (zero live quotes) |
| 122 | d967dc0a | Changes | 0 pass / 1 fail (zero live quotes) |
| 123 | 6e9bfca5 | Changes | 0 pass / 1 fail (zero live quotes) |
| 124 | 67d4d616 | Changes | 0 pass / 1 fail (zero live quotes) |
| 125 | 57569824 | Changes | 0 pass / 1 fail (zero live quotes) |
| 126 | 566f9486 | Changes | 0 pass / 1 fail (zero live quotes) |
| 127 | b4c7331d | Fixed agent task blocking logic | 0 pass / 1 fail (zero live quotes) |
| 128 | a5ecb4a7 | Changes | 0 pass / 1 fail (zero live quotes) |
| 129 | 55b31fec | Changes | 0 pass / 1 fail (zero live quotes) |
| 130 | cc86fad9 | Fixed assessments write scope | 0 pass / 1 fail (zero live quotes) |
| 131 | 83dd7bc1 | Changes | 0 pass / 1 fail (zero live quotes) |
| 132 | 29717879 | Changes | 0 pass / 1 fail (zero live quotes) |
| 133 | a3b7866d | Changes | 0 pass / 1 fail (zero live quotes) |
| 134 | 4edf8c17 | Changes | 0 pass / 1 fail (zero live quotes) |
| 135 | 2e94d2c0 | Changes | 0 pass / 1 fail (zero live quotes) |
| 136 | 184f9d72 | Changes | 0 pass / 1 fail (zero live quotes) |
| 137 | 14965e62 | Changes | 0 pass / 1 fail (zero live quotes) |
| 138 | 7b57651a | Changes | 0 pass / 1 fail (zero live quotes) |
| 139 | e3d9d0ea | Implemented overdue checks flow | 0 pass / 1 fail (zero live quotes) |
| 140 | 57041628 | Work in progress | 0 pass / 1 fail (zero live quotes) |
| 141 | eb6867a4 | Changes | 0 pass / 1 fail (zero live quotes) |
| 142 | 0549ca27 | Changes | 0 pass / 1 fail (zero live quotes) |
| 143 | 9188a195 | Changes | 0 pass / 1 fail (zero live quotes) |
| 144 | 363c36ab | Changes | 0 pass / 1 fail (zero live quotes) |
| 145 | f37eb2e4 | Changes | 0 pass / 1 fail (zero live quotes) |
| 146 | aa44abab | Changes | 0 pass / 1 fail (zero live quotes) |
| 147 | efe98b7d | Changes | 0 pass / 1 fail (zero live quotes) |
| 148 | cad2e7ed | Changes | 0 pass / 1 fail (zero live quotes) |
| 149 | 57cd88cb | Implemented PIESA rate removal | 0 pass / 1 fail (zero live quotes) |
| 150 | 662ab24b | Changes | 0 pass / 1 fail (zero live quotes) |
| 151 | dadf988b | Changes | 0 pass / 1 fail (zero live quotes) |
| 152 | 2f051342 | Changes | 0 pass / 1 fail (zero live quotes) |
| 153 | c09ef128 | Changes | 0 pass / 1 fail (zero live quotes) |
| 154 | 58668259 | Changes | 0 pass / 1 fail (zero live quotes) |
| 155 | 262807b3 | Changes | 0 pass / 1 fail (zero live quotes) |
| 156 | 69ca297d | Changes | 0 pass / 1 fail (zero live quotes) |
| 157 | 04d6d56a | Changes | 0 pass / 1 fail (zero live quotes) |
| 158 | 30d35aa5 | Changes | 0 pass / 1 fail (zero live quotes) |
| 159 | 9d9f429e | Work in progress | 0 pass / 1 fail (zero live quotes) |
| 160 | 4f2ad1d8 | Changes | 0 pass / 1 fail (zero live quotes) |
| 161 | acf58d2d | Changes | 0 pass / 1 fail (zero live quotes) |
| 162 | d7786430 | Changes | 0 pass / 1 fail (zero live quotes) |
| 163 | e441eca5 | Added auto rectification sched | 0 pass / 1 fail (zero live quotes) |
| 164 | d2662305 | Changes | 0 pass / 1 fail (zero live quotes) |

## Adjacent checks

Owner My job reader 2/0; cross-role job overview 2/0; installer home 20/0; installer screens 18/0; nextstep 13/0; scope 16/0; worker links 5/0; deposit-release 7/0; quiet-held 39/0; install-no-access 12/0; trade status 9/0 and payment dates 3/0; thirty-day-rule 21/0. Counts are pass/fail.

Automatic checks: latest build OK. Hosted multi-user/browser journeys NOT RUN (no authorized live mutation/delivery); no hosted PASS claim.

## Every changed project file

- `AGENTS.md`
- `docs/in-house-held-message-audit.md`
- `docs/in-house-i6-test-results.md`
- `roadmap.md`
- `src/components/owner/OwnerReadyCheckTimes.tsx`
- `src/components/portal/waiting.tsx`
- `src/components/trade/job-status.tsx`
- `src/lib/approved-texts.server.ts`
- `src/lib/deposit-release-notice.server.ts`
- `src/lib/fixes-times-link.server.ts`
- `src/lib/in-house-message.core.ts`
- `src/lib/install-booked-email.server.ts`
- `src/lib/install-clearance.server.ts`
- `src/lib/install-no-access-notice.server.ts`
- `src/lib/installer-home.core.ts`
- `src/lib/installer-planning-notice.server.ts`
- `src/lib/installer-texts.server.ts`
- `src/lib/job-next-action.core.ts`
- `src/lib/job-overview.server.ts`
- `src/lib/job-status.core.ts`
- `src/lib/job-status.server.ts`
- `src/lib/nextstep.core.ts`
- `src/lib/office-needs.core.ts`
- `src/lib/office-needs.server.ts`
- `src/lib/owner-email-triggers.server.ts`
- `src/lib/owner-fixes.server.ts`
- `src/lib/owner-link.functions.ts`
- `src/lib/owner-myjob.server.ts`
- `src/lib/owner-template-send.server.ts`
- `src/lib/portal.functions.ts`
- `src/lib/quiet-held-texts.server.ts`
- `src/lib/ready-check-booked-email.server.ts`
- `src/lib/ready-check-times-email.server.ts`
- `src/lib/thirty-day-rule.server.ts`
- `src/lib/trade-view.server.ts`
- `src/lib/visit-new-times.server.ts`
- `src/lib/waiting.functions.ts`
- `src/lib/worker-links.functions.ts`
- `src/routes/_authenticated/field.$jobId.tsx`
- `src/routes/_authenticated/owner.$jobId.tsx`
- `src/routes/my-job.$token.tsx`
- `tests/deposit-release-notice.test.ts`
- `tests/in-house-held-messages.test.ts`
- `tests/in-house-held-presentation.test.ts`
- `tests/install-clearance.test.ts`
- `tests/mitti-sync-overlap.test.ts`
