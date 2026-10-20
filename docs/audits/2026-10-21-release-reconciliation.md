# Release reconciliation — 21 Oct 2026 (measured 2026-10-21 08:18 AEDT). Not a new audit.

Older sections in 2026-10-20-installer-two-route-readiness.md, 2026-10-20-repair-release-verification.md and 2026-10-21-dad-installer-access-check.md that say "per-area controls NOT_IMPLEMENTED", "final bounded QA NOT_RUN" or "0214 not applied" are HISTORICAL. Current status:

## Integrated (by hunk, no fuzz)
- ready-check-correction-version.patch (36,898 B, 796005dd…829): applied, small offsets only.
- ready-check-area-safety-combined.patch (28,222 B, 7db675fb…5ff): all hunks applied except workflow.server.ts, which conflicted with the existing site-hold block; merged by hand inside the same evidence_outstanding branch — live site hold checked first, then live area blockers. Both preserved.
- migration-0214-release.patch (38,317 B, 6615b4ef…74cf): docs package added; 0214-reviewed.sql = pending migration (9524ea15…2450); wrapper 681e0801…7583.
- Test fixtures only: practice tables gained live columns documents.storage_path and evidence_requirements.verified_by/verified_at/notes; the two new harnesses stub ./file-links.server (used by the existing signed file-open link). No production restriction weakened.

## Results
- ready-check-correction-retry 13/0; ready-check-area-safety 11/0; ready-check-areas-db 11/0; site-hold-boundaries 34/0; intake-document-onsite 14/0; owner-gate-attendance 19/0; upload UI 9/0; create roundtrip 24/0; related hold/quote/Ready Check group 53 pass/1 skip/0 fail; typecheck clean; build OK; retired-term scan 0 customer-visible.
- The related-group case not counted among the 53: SKIPPED "installer changes the payer later on the same job > own -> to be arranged by installer is refused (office changes a chosen own electrician)".
- NOT_RUN (environment): brief-n/brief-o Ready Check suites need a disposable local stack at localhost:54331 that is not running here.
- Per-area: implemented, tested on practice database, and the schema (0214) is now LIVE (see 2026-10-21-0214-release/applied.md). Signed-in browser area save PASSED in the post-0214 rerun (2026-10-21-dad-installer-access-check.md): two areas saved/reloaded on mobile, before-photo uploaded while held. Two real defects were found and fixed (area observation key vs live field_key format rule; practice schemas). Sign-out browser step, failure-injection, regression matrix and cross-business refusal remain NOT_RUN.
- Mitti schema checks remain separate from any compliance/form approval (none granted).

## Bounded portal QA (--personas rec,owner, run 2026-10-20T20-40-46): 59 pass / 0 fail / 12 NOT_RUN — not rerun
1. setup "TEST sign-in installer" — persona excluded by --personas; no lookup or sign-in
2. /partner — persona excluded
3. /partner/add — persona excluded
4. /partner/workers — persona excluded
5. deleteJob direct call (installer refusal) — persona excluded
6. restoreJob direct call (installer refusal) — persona excluded
7. setEligibility direct call (installer refusal) — persona excluded
8. installer-test --installer-app-only — persona excluded; harness not started
9. REC onboarding click-through (sign, rates, insurance) — no TEST-scoped writable REC onboarding harness
10. Office write actions (approve, send back, Save my spot send) — needs dedicated TEST office scope
11. Owner signing / booking / payment choice — no TEST owner signing harness with restore
12. Installer onboarding signing + approval — excluded in --installer-app-only
Deep stays excluded before lookup/sign-in; HV-1351 business not used for writes.

## Video size (metadata only) — RESOLVED 2026-10-21 08:38 AEDT (21:38 UTC 20 Oct)
HISTORICAL: the earlier note read "job-files bucket: private, file_size_limit 209,715,200 bytes (200 MiB) … This is a capacity choice for Jo, not a business-approval blocker; no change made." That statement is superseded.
RESOLVED: the signed Activity 48 schedule text (src/lib/activity48-agreement-schedule.text.ts) requires before- and after-installation zone videos no larger than 250 MB; the affected upload routes have no lower app limit. Routine alignment applied as part of the authorised repair — no business-approval decision required.
Change: job-files.file_size_limit 209,715,200 -> 250,000,000 bytes (exactly decimal 250 MB, not 250 MiB), via the supported Storage administration API (validated, not raw SQL). Verified by readback: file_size_limit = 250,000,000; public=false, allowed_mime_types NULL, owner NULL — all unchanged. No customer objects touched; narrower bulk limits (50,000,000 bytes/member, 500,000,000 bytes/batch) and all storage/RLS policies, signed URL/auth checks unchanged. No 250 MB dummy upload performed.

## Live observations (Root, pre-publication) — not inferred fixed
HV2868 Office-review vs "Waiting for homeowner" label mismatch; HV2869 preview figures; batch 77313730… editable forms + "businessId Invalid uuid" on Open attachment; Outlook not connected; Xero Demo Company, real-job Xero off. Root to recheck after publication.
