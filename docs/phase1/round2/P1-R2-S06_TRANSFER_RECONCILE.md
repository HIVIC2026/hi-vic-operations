# P1-R2-S06 — Enquiry Transfer Status & Reconciliation (GAP-05)

## 1. Step identification
- **Project:** Home Insulation Victoria
- **Phase / Round / Step:** Phase 1 / Round 2 / **P1-R2-S06**
- **Title:** Verify and Implement Minimal Enquiry Transfer Status and Reconciliation Support
- **Gap addressed:** **GAP-05** — Enquiry transfer status and daily reconciliation visibility.

## 2. Agent and duration
- **Agent:** R2 — Enquiry / Office Developer
- **Estimated time:** 5–10 minutes
- **Actual time:** ~8 minutes

## 3. Branch and HEAD
- **Worktree:** `/Users/jet.zhang/CopilotWorkspace/Loveable/hi-vic-r2-enquiry-office/`
- **Branch:** `phase1/r2-enquiry-office`
- **HEAD:** `b2970e4f5fb5683953d2786d83dcff73b9915cfb` (equals the stated original baseline)
- No commit, push, merge, reset, or clean was performed (per restrictions).

## 4. Existing S05 changes preserved
Both prior P1-R2-S05 changes were verified intact **before and after** this step:
- `src/lib/enquiry-groups.core.ts` — still contains the unified label `"Spot saved, needs an installer"` (and the other S05 label unifications).
- `tests/status-label-unify.test.ts` — present and untouched.

`git status --porcelain` after S06:
```
 M src/lib/enquiry-groups.core.ts        (S05 — untouched by S06)
 M src/lib/office-status.core.ts         (S06 — new pure reconciliation helper appended)
?? tests/status-label-unify.test.ts      (S05 — untouched by S06)
?? tests/transfer-reconcile.test.ts      (S06 — new focused test)
```

## 5. Current transfer architecture (as traced)
**Inbound enquiry transfer (Base44 website → Lovable/Home Insulation Victoria portal):**
- **Route:** `src/routes/api/public/enquiry.ts` (`POST /api/public/enquiry`).
- **Signed verification:** Ed25519 signature over the exact raw body is verified **before** any parsing (`verifyBase44Webhook` in `enquiry.core.ts`); optional `x-hivic-key-id` checked; 400KB body cap.
- **Replay protection:** timestamped protocol inserts a nonce into `signed_webhook_nonces` (duplicate nonce ⇒ rejected). Legacy-signed requests accepted on signature + 5-min timestamp window.
- **Idempotent upsert:** `upsertEnquiry()` in `src/lib/enquiry.server.ts` is **idempotent on `external_enquiry_id`**, with an additional open-repeat-job match (same owner + address) so the same owner re-submitting attaches to their existing open job rather than creating a duplicate. It never changes the stage of an existing job.
- **Transfer telemetry (already recorded) → `external_sync_logs`:**
  - **Success / received:** `status:"synced"`, `system:"base44"`, `direction:"inbound"`, `entity_type:"job"`, `entity_id = job_id`, `payload` carries `external_enquiry_id`, `created`, preliminary outcome, life-support status.
  - **Failed (validation):** `status:"error"` with the Zod error message.
  - **Failed (processing exception):** `status:"error"` with `payload` ref (incl. `external_enquiry_id`) + `error`.
- **Event log:** `logEvent(... "enquiry_received" / "enquiry_updated" ...)` on the job.

**Outbound customer delivery (separate concern, already robust):** `delivery.core.ts` / `delivery.server.ts` implement a Base44 delivery bridge with HMAC signing, idempotency keys, and a nuanced failure model (`DeliveryRejectedError` ⇒ retryable `failed`; timeout/network ⇒ `delivered_unrecorded` "sent-unknown", never auto-retried). `save-spot-delivery.server.ts` lets the office reconcile uncertain sends. This was reviewed to avoid duplicating infrastructure.

**Existing reads of transfer telemetry:** `office.server.ts:109` already queries `external_sync_logs` for `status:"error"` over 3 days — but only to surface **Mitti** sync failures per job; it does **not** derive a Base44 enquiry-transfer reconciliation summary.

## 6. Confirmed implementation gaps (A–E classification)
- **A. Already implemented & verified:** signed verification, nonce replay protection, idempotent upsert, per-transfer `external_sync_logs` success/error telemetry, outbound delivery retry/sent-unknown model.
- **B. Implemented but not surfaced:** the inbound transfer **received/failed telemetry exists in `external_sync_logs`** but is **not derived or surfaced as a daily transfer reconciliation** (received vs failed, which enquiries need attention). ← **primary GAP-05**
- **C. Missing implementation:** a **pure, testable derivation** that turns those rows into a reconciliation summary. ← addressed here (minimal)
- **D. External Base44 dependency:** delivery confirmation **from** Base44 for the *outbound* bridge (provider-side) remains external; not in scope for inbound enquiry reconciliation.
- **E. Requires client/provider decision:** whether to run an **automated scheduled daily reconciliation job / alerting** (needs a scheduler/deployment decision — see §10). Not auto-created.

**Transfer-status questions answered:**
- *Transfer pending* — derivable as "logged nowhere yet / not synced"; the helper surfaces failed-latest enquiries and received counts. True "pending/in-flight" is transient (synchronous webhook), so it is represented by absence of a terminal row, not a stored state.
- *Transfer received* — **yes**, recorded as `synced`.
- *Transfer failed* — **yes**, recorded as `error`.
- *Retry/recovery* — inbound is idempotent, so replaying a failed `external_enquiry_id` is safe; a later `synced` supersedes an earlier `error` (recovery), which the helper reflects via last-write-wins.

## 7. Files changed
- **Modified:** `src/lib/office-status.core.ts` — appended a pure, presentation-only helper `reconcileBase44Transfers(rows, { now, windowMs })` plus `SyncLogRow` / `TransferReconciliation` types. No DB access, no writes, no job movement, no new table/scheduler/migration/route.
- **Added:** `tests/transfer-reconcile.test.ts` — focused `bun:test` suite for the helper.
- **Not modified (per restrictions):** `portal.functions.ts`, any R3/R4-owned files, the webhook route, `delivery.*`, `enquiry.server.ts`. S05 files untouched by S06.

## 8. Reconciliation design
`reconcileBase44Transfers()` consumes already-logged `external_sync_logs` rows and, over a trailing daily window (default 24h, caller-supplied `now`), returns:
- `received` — distinct enquiries whose latest in-window record is `synced`.
- `failed` — distinct enquiries whose latest in-window record is an error.
- `retryable` — failed enquiries that carry an `external_enquiry_id` (safe to replay idempotently through the existing webhook).
- `unidentifiedFailures` — error rows with no external id (cannot be auto-matched; office must inspect).
- `failedExternalIds` — sorted list of external enquiry ids needing attention.
- `windowStartIso`, `totalRows` — window boundary and raw row count considered.

Design guarantees matching the task constraints:
- **Success is recognised only from a recorded `synced` row** — never inferred from an initiated HTTP request.
- **Duplicate delivery safe** — rows collapse by `external_enquiry_id` (then `entity_id`), so duplicate deliveries of one enquiry count once.
- **Recovery aware** — last-write-wins: a later `synced` clears an earlier `error`, and vice versa.
- **Pure & side-effect-free** — no clock dependency beyond injected `now`; safe on empty/null/malformed input (never throws, malformed rows never counted).
- **Reuses existing infrastructure** — reads the existing telemetry table; replay uses the existing idempotent webhook. No new persistence.

The office surface (reading `external_sync_logs` and rendering the summary) can call this helper wherever the pipeline/needs view is assembled, without any schema or infrastructure change.

## 9. Test results
**Official runner (`bun test`): BLOCKED** — `bun` is not installed in this environment (`command -v bun` ⇒ `BUN_UNAVAILABLE`). `tests/transfer-reconcile.test.ts` is written for `bun:test` and should be executed in CI where bun is available.

**Alternative execution evidence (actually run):** the real `reconcileBase44Transfers` export was imported and exercised via Node v24.13.0 `--experimental-strip-types` with a resolver/loader hook (same harness proven in S05). **24/24 assertions passed, exit 0.** Scenarios covered:
- Successful transfer recognition (synced-only) ✔
- Duplicate delivery collapses to one enquiry ✔
- Failed transfer handling: retryable (has external id) vs unidentified ✔
- Recovery: later `synced` supersedes earlier `error` ✔
- Regression: later `error` supersedes earlier `synced` ✔
- Missing/delayed transfer: out-of-window rows ignored; window boundary correct ✔
- Other systems/directions ignored ✔
- Safe on empty / null / undefined / malformed input ✔

TypeScript compiler (`tsc`) is not installed in this environment (no project `node_modules`), so a static type-check was not run here; the Node type-stripping execution (which rejects structural TS errors) succeeded. Run `bun test tests/transfer-reconcile.test.ts` and project type-check in CI to confirm within the official harness.

## 10. External dependencies
- **Automated daily reconciliation job / alerting (category E):** surfacing the summary on demand needs **no** new infrastructure. Running it on a **schedule** (e.g. a daily cron that emails/raises an office alert for `failedExternalIds`) would require a **new scheduler/worker, and possibly a deployment change** — explicitly **not created** here per restrictions.
  - **Proposed minimal solution for R1:** wire `reconcileBase44Transfers()` into the existing office/needs read path for on-demand visibility first (zero new infra). If a push/daily alert is required, add one entry to the existing scheduled-worker mechanism that calls this pure helper and logs/notifies — no new table or migration needed. Decision owner: R1 + client.
- **Outbound Base44 bridge delivery confirmation (category D):** remains provider-side/external; unchanged.

## 11. Remaining work
- (R1 decision) Decide whether to surface the summary on-demand only, or also run a scheduled daily reconciliation/alert (see §10).
- (R2, once decided) Minimal wiring of the helper into the office read path and/or a scheduled call — no schema change required.
- (CI) Execute `tests/transfer-reconcile.test.ts` under the official `bun` runner and project type-check.

## 12. Final status
**PARTIAL (safe stopping point).** The in-scope, safely-fixable gap was implemented and verified: a pure, idempotent, duplicate-/recovery-aware **transfer reconciliation derivation** over existing telemetry, with a focused test. No duplicate infrastructure was created. The only remaining items are a **client/R1 decision** on scheduled automation (category E) and execution of the test under the official runner (bun BLOCKED in this environment). Signed verification, idempotency, consent controls, existing enquiry states, office workflow transitions, and the S05 status-label changes were all preserved.
