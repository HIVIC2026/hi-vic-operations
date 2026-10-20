# Repair release verification — 20 Oct 2026 (sanitized)

Not published. No sends, provider writes, invoices, payments, claims, role/account changes, or historical backfills.
Machine-readable rows: `docs/audits/2026-10-20-repair-release-verification.json`.

## Revision
- Starting HEAD `2f10067a`; report written at HEAD `089f587a` (working copy, harness-managed commits).
- Patch `hivic-final-repairs.patch`: SHA-256 `e93171f4…bc9fe`, 298,898 bytes, verified. 27 diff paths in the file (brief said 29).
- Hand-reconciled conflicts: `src/lib/AGENTS.md`, `src/lib/bulk-import.functions.ts`, `src/lib/installer-intake.server.ts`. No shared file replaced wholesale.

## Migration
- Sequence 0213 (after 0210–0212). Pending copy `docs/pending-migrations/0213_bulk_import_fencing.sql` (+ rollback) proven on PGlite (bulk fencing 18/0).
- Applied live as `drizzle/migrations/0156_0213_bulk_import_fencing.sql`; types regenerated. Normalized SQL (comments/transaction wrapper/whitespace removed) is identical to the pending copy.
- Read-back: raw bulk tables + attachment-repair table have no anon/authenticated grants; service_role retained; RPCs execute as postgres/service_role only. Readers: server/admin only. No backfill (9,570 pending rows / 54 analysed batches untouched).

## Requested repairs
- **Office QA function IDs**: new `scripts/qa-serverfn-resolve.ts` reads dev IDs from the target's served transform, or accepts a build SHA-256 ID only when present in the served compiled client. Unresolved => FAILED diagnostic + probes NOT_RUN (never a permission result). Test `tests/qa-serverfn-resolve.test.ts` 6/0 (incl. live preview resolution).
- **Office reads stalled** (found while proving getPipeline/listByStatus): two lookups sent all ~1,600 job ids in one URL (gateway 400 + client retries ≈ 60 s each, ~184 s total). Now batched by 200 and fail closed. loadOffice 184 s -> 3.1 s; getPipeline 2.6 s / listByStatus 2.3 s HTTP 200 as TEST Office.
- **getImportDraftFor**: failed attendance read or missing job rejects with zero writes; genuine null stays unknown. 4 actual-source tests (receipt suite 31/0).
- **Practice shim**: `count: "exact"` on normal selects now returns the real total (PostgREST behaviour); fixed 13 false failures in installer-intake-edit-db (now 18/0).

## Office proof (existing TEST accounts, TEST job HV-2111 snapshot/restore)
Standalone `qa-office-writes` run: ALL PASSED — ID resolution (dev), 9 non-Office refusals (installer/REC/owner × delete/restore/setEligibility: "Admin only.", DB unchanged), parity before/deleted/restored (1602 = 1602), desktop+phone delete/restore/classification, audits, snapshot restored, owner answers and 3 real deleted jobs untouched.
In the release run the same step FAILED with a timeout (see below) — kept visible.

## Portal QA `--label release --budget 1200` (12:05–12:17 UTC, local preview): 76 passed, 7 failed, 4 NOT_RUN
Failed: office writes run timeout (standalone rerun passed); installer B5 (TEST job has no live assignment); C1 and C5 (old "quote/photos = Visited" expectations contradict the approved attendance rule — harness needs Jo's rule, not code change); C16 (expects measurements on unknown attendance; now preliminary estimate); emails existing-insulation-send 3 fails (repeated ×5, pre-existing, outside this patch); email aggregate row.
NOT_RUN: REC onboarding click-through, Office approve/send-back/Save my spot, owner signing/booking/payment, installer onboarding signing.

## Test suites (each file in its own process)
Passing: bulk fencing 18, actual handlers 7, review UI 39, receipt 31, readiness 16, QA access 16, launcher 7, screen rules 14, first-response retry 10 / sweep 12 / phase1 20 / practice 7, Group-B 66 (6 files), s20r01 51, official forms 45, QA safety 6, Outlook 28+21+9, privacy 8, jobfile 14, installer suites (20 files), Office suites (16 files), 9 other shim users.
Failing (visible): `bulk-import-confirm-resume` 0/8, `-confirm-sidefx` 0/3, `-lease-fence` 0/2, `-confirm-files` 2/1 — old in-memory fakes of the pre-RPC confirm path (`admin.rpc` missing); superseded by the new SQL/handler suites, not rewritten. `office-final-uat` D1 (stale source-text assertion on enquiry page). `piesa-future-date-runtime` harness-isolation check (sandbox has network/credentials).
Typecheck clean; build OK; retired-term scan 0 customer-visible.

## Connections (read-only)
- HISTORICAL/SUPERSEDED (generic comparison; see current diagnosis below) — Mitti: structure evidence `docs/audits/2026-10-20-mitti-structure-evidence.json` (question labels/types only). Ready Check 13 missing (3 near-label matches), priced 3 missing (extras block absent), PIISA 35 missing (18 reworded near matches — wording mismatch, needs mapping decision), PIESA saved ID none; candidate has only 4 header items => 43 genuinely absent. No parser defect shown; nothing saved/selected/approved.
- Outlook: credentials unavailable — NOT_RUN. Xero: real-job switch off; not re-checked this turn.

## Remaining first-slice limits
Signed-in installer save/reload matrix, per-zone evidence/prefill, action-boundary evidence deadlines, discrepancy holds and readiness panels remain unbuilt/NOT_RUN. Video storage cap 200 MiB < 250 MB still needs approval.

## Office QA harness acceptance addendum — 20 Oct 2026 (reviewed at ee7a7865)
Fixes in `scripts/qa-office-writes.ts`, `scripts/qa-serverfn-resolve.ts`, new pure `scripts/qa-office-response.ts`:
- All five targets (office.functions getPipeline/listByStatus/deleteJob/restoreJob, portal.functions setEligibility) resolve from the served dev transform or the served compiled client only; the row records target, mode and a build identity hash. A name served with two IDs, two functions sharing one ID, or a file mismatch -> unresolved, no calls made.
- Replies decode with the framework's standard plugins (src/start.ts registers no adapters). Redirects (manual), HTML, non-JSON, undecodable, framed, envelope-less and HTTP-200 error envelopes are blocked/failed, never passed.
- Reads must decode to a well-formed pipeline/list; writes need decoded `{ok:true}` plus a strict TEST-job readback. Before/after DB reads throw on error or missing row; events/protected-job reads check errors.
- A refusal passes only on the decoded handler error "Admin only." with an unchanged TEST row. Generic 500/403, HTML or unresolved endpoints are not authorization evidence.
- Persistent pre-mutation snapshot and verified restore are unchanged.

Tests: `bun test ./tests/qa-office-response.test.ts ./tests/qa-serverfn-resolve.test.ts` -> 16 pass / 0 fail (HTTP-200 serialized error, framework-format thrown error, malformed results, DB read failure/missing row, duplicate/mismatched IDs, identity). Typecheck clean.

Signed-in run: `bun scripts/qa-office-writes.ts --base http://localhost:8080 --budget 500 --personas rec,owner` (local preview, dev mode, identity dev:3fee4c24234ce27c). Rows: `docs/audits/2026-10-20-office-writes-rows.json`.
- PASSED: resolution; 6/9 refusals (REC and owner × deleteJob/restoreJob/setEligibility, all decoded "Admin only.", DB unchanged); Office parity before/deleted/restored (15 -> 14 -> 15, sums 1605/1604/1605); desktop + phone delete/restore/classification journeys; audit events; TEST snapshot restored; owner answers unchanged; 3 protected real jobs untouched.
- Earlier run of the same harness BLOCKED all six refusals as undecodable — exactly the false-pass the old harness would have hidden; fixed by using the framework plugins.
- NOT_RUN: installer refusals (3) — the only TEST installer login is the excluded Deep account. Production/compiled-build target — not run (no deployed run requested; IDs are never inferred from a local build).
- Exit status 1 because of the NOT_RUN rows.

## Acceptance findings A/B — 20 Oct 2026 (reviewed at ee7a7865, fixed on latest HEAD)
### A) Installer attendance
- `installer-ready-check.core.ts`: a confirmed Ready Check booking / `ready_check_scheduled` stage now returns `booked` before any attendance shortcut; attendance never hides, cancels or completes it.
- `installer-progress.core.ts`: eligibility-unresolved branch keeps Office ownership but is attendance-aware (attended+unquoted: no second visit; quoted+not attended: preliminary; quoted+unknown: confirm visit). Current-draft branch for quoted+not attended now says preliminary, onsite Ready Check still required. Released/issued quote precedence and all release guards unchanged.
- `installerRcState`: missing job and the booking-date read now fail closed (previously missing job returned null, booking error ignored). `getMyIntakeProgress`: jobs read must succeed and find the row (`requireJobRead`); every other progress read fails closed (`requireReads`).
- Tests: `tests/installer-attendance-acceptance.test.ts` 5/0 (confirmed booking, both early branches, released precedence, read failure/missing/real null). Related suites pass: ready-check 6, handoffs 9, progress-truth 23, two-route 8, dad-trial-db 6, commercial-db 16.
### B) Mitti saved-form diagnosis
- `flattenDefinition` now reads header_items + items (nested children or flat parent_id), types deterministically (explicit type, else known Mitti type key, else structural key), and never walks option/config/metadata objects. `definitionReadable` marks metadata-only/unsupported envelopes `schema: "unreadable"` — not proof of absence. Shared prefill consumers (`mitti.core` flatten, item IDs, response sets, `getTemplateDefinition` endpoint) untouched.
- PIISA saved as native A3 (stable IDs present) is compared with `a3MissingFields`, not the generic short-form spec. Every result records `schemaBasis`; generic passes state labels/counts/types only.
- Tests: `tests/mitti-form-schema.test.ts` 4/0 (sanitized definition with header item, metadata before type key, labelled option object; unreadable envelope; native A3 against the sanitized live A3 fixture). installer-led 17, mitti-form-health 11, mitti.core 27, piisa-a3 6, official-prefill 10, ready-check-variants 18 — all pass.
- Read-only re-check of saved forms (one GET each, sanitized counts only; nothing saved/selected/approved): Ready Check identity verified, 13 label-level gaps (labels/counts/types basis); priced 3 (extras block); PIISA native A3 15 contract gaps (was 35 under the wrong generic spec); PIESA no saved ID (NOT_RUN). officialFormUseBlocker holds PIISA/PIESA only; Ready Checks are held by their schema issues. Label/count/type and native ID/alias/crew response-set checks do not establish compliance approval. Required flags, choices and repeating/conditional structure were NOT verified. The PIESA 43 figure is a schema-issue count against a 4-header-item candidate — NOT re-checked this pass and not proof that the questions are absent.

## Upload-UI follow-up patch — 20 Oct 2026 (hivic-intake-upload-ui.patch)
- Patch verified: 31,250 bytes, SHA-256 cf2bf53c…486c5. Base 2f10067a; current file hashes differed, so hunks were reconciled (not whole-file replaced). Flow file: 3/3 hunks applied. Editor: 4/6 applied, 2 rejected hunks hand-merged (Save releases `saveFlight`; quote summary uses `quoteFileCount`; both AttachFiles wrapped in `changeFiles`, disabled while any file op runs). Shared `AttachFiles` unchanged; optional `AttachedFile.purpose` preserved; `MyIntakeDetailsCard` mapper keeps explicit purpose.
- Deliberate deviation: the patch listed unlabelled legacy files as quotes. Current HEAD rule (Jo's later addendum) keeps them UNCLASSIFIED until explicitly labelled, so Add Job and the editor show them in neither upload list, never count them as a quote, and Add Job now notes they are kept. The test's 4 legacy assertions were updated to that rule; nothing is retagged.
- Test harness adapted to HEAD dependencies (shared Melbourne date helper, commercial core, QuoteCommercialFields).
- Results: `node --test --experimental-test-isolation=none --test-reporter=spec tests/installer-intake-upload-ui.test.mjs` 9/0 (Node 22 needs the experimental flag name). `bunx tsgo --noEmit` clean. Related: create-roundtrip-db + installer-progress* + installer-intake* 128/0. Build OK. Retired-terms scan: 56 matches, 0 customer-visible.
- Receipt merge hazard verified: `installerIntakeState` still has all EIGHT checked reads incl. preliminary estimate (`estErr`), `preliminaryAreaM2`, `attended`/`onsiteMeasured`, and fee null-count rejection.
- NOT_RUN: signed-in TEST-installer upload/save/reopen (desktop/mobile) — the available session is Jo's admin account; the only TEST installer login is the excluded Deep account; no identities provisioned. Full portal QA not repeated (no affected gate).
- Not live-ready: NOT_RUN rows above and earlier blockers (per-zone carry-forward/photo controls, Mitti approvals, video cap approval, install-day Mitti link review) remain.
- Attachment-race fix + claim snapshot: see docs/qa/installer-two-route-2026-10-20.md (24/0 practice DB, 9/0 UI).
- 13:34 continuation: deadline labels added (3/0); per-zone scope NOT IMPLEMENTED; signed-in browser NOT_RUN (no isolated TEST installer/backend). See QA report.

## Release-closure bundle (2026-10-20 20:40 UTC)
- `hivic-release-closure.patch` 60,048 B, SHA-256 63b28040…f095df822: 11 files, all hunks applied to latest tree without fuzz/offset. RC hunk = only the `booked == null || done == null` fail-closed guard; newer onsite logic untouched.
- Results (fresh processes): existing-insulation-send 7/0; qa-persona-exclusion 6/0; owner-gate-attendance-readers 19/0; mitti-form-schema 12/0; installer-intake-upload-ui 9/0; installer-create-roundtrip-db 24/0; installer-upload-revision 34/0; typecheck PASS; build OK; retired-term scan 0 customer-visible. Node 22 rejects `--test-isolation=none`, so .mjs suites ran with default isolation.
- Upload-lock patch reconciliation: parent-owned lock, explicit purpose propagation and commercial helpers kept; its old unlabelled-equals-quote behaviour stays superseded (absent purpose = unclassified).
- Persona correction: earlier Office rec/owner refusals passed, but the old bootstrap still visited the excluded installer before skipping assertions — earlier installer NOT_RUN did not prove no sign-in. Exclusion now precedes lookup/sign-in.
- Main patch "27 vs 29": diff-header artefact (27 git headers + 2 plain receipt diffs); all 29 components included.
- Historical: full portal 76 pass / 7 fail / 4 NOT_RUN retained. Legacy pre-RPC bulk fake tests are not a green gate.
- Remaining: per-zone carry-forward/pre-removal controls from separate brief NOT_IMPLEMENTED per this record; authenticated TEST installer browser NOT_RUN; final bounded `--personas rec,owner` run NOT_RUN; site-hold and document-retry fixes deferred to separate pass. Not published.
