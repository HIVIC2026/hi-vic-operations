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
- Mitti: structure evidence `docs/audits/2026-10-20-mitti-structure-evidence.json` (question labels/types only). Ready Check 13 missing (3 near-label matches), priced 3 missing (extras block absent), PIISA 35 missing (18 reworded near matches — wording mismatch, needs mapping decision), PIESA saved ID none; candidate has only 4 header items => 43 genuinely absent. No parser defect shown; nothing saved/selected/approved.
- Outlook: credentials unavailable — NOT_RUN. Xero: real-job switch off; not re-checked this turn.

## Remaining first-slice limits
Signed-in installer save/reload matrix, per-zone evidence/prefill, action-boundary evidence deadlines, discrepancy holds and readiness panels remain unbuilt/NOT_RUN. Video storage cap 200 MiB < 250 MB still needs approval.
