# P1-R3-COM-09 — Personal Estimate & Ready Check CTA Integration Report

**Agent:** R3 — Communications / Application Developer
**Step:** P1-R3-COM-09-PERSONAL-ESTIMATE-AND-READY-CHECK-CTA-INTEGRATION-01
**Date:** 2026-10-15
**Final verdict:** `COM09_IMPLEMENTED_TESTED`

---

## 1. Executive summary

COM-09 closes the two route-level dependencies COM-08 left open, at the application + local-integration level:

- **DEP-1** — a dedicated, secure, **read-only personal-estimate route** that serves the customer's frozen saved pricing.
- **DEP-2** — the **Template 8 "Book my Ready Check" CTA** is now bound to the customer's own existing, token-bound Ready Check booking workflow.

Both were implemented in an isolated worktree starting from the verified COM-08 commit, with **no migration**, **no provider calls**, **no real sends**, and **no browser UAT claimed**. The saved estimate is treated as immutable: nothing on the new route recalculates with current pricing, calls the public calculator, creates/updates an estimate, mutates the pricing cohort, or edits values via URL parameters. The booking CTA reuses the existing `/estimate/$token` acceptance + time-picker workflow, so all existing eligibility/authorization/duplicate gates remain enforced and opening the link does **not** auto-book.

**Verification:** 19 new integration tests (running the real server resolvers against a real Postgres engine via the project's PostgREST shim) all pass; the full suite shows **no regressions** (334 files / 3188 pass / 3 pre-existing unrelated failures); `tsc --noEmit` is clean; the production build succeeds. Browser UAT is explicitly left to R6.

---

## 2. Starting branch and HEAD

- **Branch:** `r3/p1-rc1-com08-templates` (the COM-08 implementation)
- **HEAD:** `b2dcc567032891eab790593a3988d24caa7c5389` — *feat(comms): COM-08 implement Jo Lowe eight email templates…*

## 3. Final branch and HEAD

- **Branch:** `r3/p1-rc1-com09-cta-integration`
- **Implementation commit (FINAL_HEAD):** `b729821496c3480a157a45e05e718242b236c1f0` — all code + tests.
- This report is a follow-up documentation commit on top of that implementation commit.

## 4. Worktree isolation

- **Worktree:** `/Users/jet.zhang/CopilotWorkspace/Loveable/wt-r3-p1-com09-cta-integration` (created from COM-08; new branch).
- Main repo left on `main` @ `4ef62eae`; the COM-08 branch left at `b2dcc567`; no other agent's worktree edited. No merge, no rebase of shared branches, **no push**. Local commit only.
- Existing dev servers (8080 / 8081 / 8082) were not started, stopped, or modified by this task.

## 5. Existing architecture findings (Tasks A & D — verified, not assumed)

**Personal estimate token (reuse, unchanged):**
- `src/lib/estimatelink.core.ts` defines the model COM-08 referred to: `LINK_PURPOSE="step3_estimate"`, `LINK_TTL_DAYS=30`, 256-bit base64url token (`newToken`), `isWellFormedToken` (`/^[A-Za-z0-9_-]{43,128}$/`), `linkUsable` (active **and** unexpired). Tokens are stored in `customer_estimate_links` and are **reusable** (not single-use) within their 30-day window.
- The campaign (Save-My-Spot) link and the Step-3 indicative link are the **same** `customer_estimate_links` row (purpose `step3_estimate`) — `launch-campaign.server.ts` and `estimatelink.server.ts` both resolve by that token. So the Template 8 personal-estimate link reuses this exact token; **no new token semantics and no TTL extension** were introduced.

**Saved estimate persistence:**
- The authoritative frozen Save-My-Spot totals live in `lead_campaign_responses`: `saved_total`, `saved_veu_discount`, `saved_gross_total`, `saved_area_m2`, `saved_insulation`, `spot_saved_at` (written once by `saveCampaignSpot`, `launch-campaign.server.ts:155–178`).
- Fee settings are frozen on `indicative_estimates.snapshot.settings` (`piesa_assessment_inc_gst`, `ap_management_inc_gst`, `r5_install_inc_gst_per_m2`, `indicative_veec_value`).
- `pricing-cohort.server.ts` exposes `savedTotalsAuthoritative` (`cohort === "legacy_saved_spot"`), confirming the saved totals — not recomputed values — are authoritative for protected/saved customers.

**Existing public/customer routes:**
- `/estimate/$token` (`estimate.$token.tsx` → `getPublicEstimate` → `resolvePublicEstimate`) is the Step-3 **indicative** estimate page. It re-derives the estimate via `refreshIndicativeEstimate` on read — i.e. it is *not* the saved-snapshot read-only view, confirming a dedicated route was genuinely missing (DEP-1).
- The customer Ready Check "booking" workflow already exists on that same page: view the estimate (records `view_count`, satisfying the `priceSeenBlocker`), then `acceptReadyCheck(token, meta, picks)` inserts a `ready_check_acceptances` row + time picks and advances the job; the `bookings` row (`kind='ready_check'`) is created later by office/trade dispatch. This is the workflow DEP-2 binds to.

**Customer-estimate auth model:** the token is the only credential; `resolvePublicEstimate` maps token → job → owner, so a token can only ever resolve its own customer. COM-09 preserves exactly this.

## 6. DEP-1 implementation — read-only personal-estimate route

**Files (new):**
- `src/lib/personal-estimate.core.ts` (pure) — URL builders + immutable saved-snapshot/view builder, fail-closed.
- `src/lib/personal-estimate.server.ts` (service-role, I/O) — `resolvePersonalEstimate(token)` read-only resolver and `template8SnapshotForJob(jobId)`.
- `src/lib/personal-estimate.functions.ts` — `getPersonalEstimateFn` public no-login server fn (mirrors `getPublicEstimate`).
- `src/routes/my-estimate.$token.tsx` — the read-only page.

**Route:** `GET /my-estimate/{token}` (public, no login; the token is the only credential).

**Resolver behaviour (`resolvePersonalEstimate`):**
1. Validates the token with the **existing** rules: well-formed, `purpose=step3_estimate`, `status=active`, and within the existing 30-day expiry (`linkUsable`). Generic `null` on any failure.
2. Resolves `job_id` from the link; rejects a deleted job.
3. Reads the frozen saved totals from `lead_campaign_responses` (requires `spot_saved_at`) and the frozen fee settings from the current estimate's `snapshot.settings`.
4. Builds the immutable view via the pure core and **fails closed** (returns `null`) if any authoritative amount is missing.
5. Returns a **public whitelist** only: the customer's own `job_number`, their own formatted address, and their saved pricing + the two URLs. No internal ids, no other-customer data, nothing editable.

**Saved-pricing integrity guarantees:** the saved total/rebate/gross are read verbatim; the installation line is derived **only** from the frozen gross minus the frozen PIESA/AP fees. If those frozen fees are absent, the route returns a limited view (omits the fabricated split) and the email snapshot fails closed — historical amounts are never back-filled with current rates. No `refreshIndicativeEstimate`, no `whatIfEstimate`, no public-calculator fallback (asserted by test).

## 7. DEP-2 implementation — Ready Check CTA binding

**Files (modified):** `src/lib/jo-email-templates.core.ts`
- Added an **optional** `readonly readyCheckBookingUrl?: string` to `SavedPricingSnapshot` (optional so COM-08 snapshots, which predate the binding, still render unchanged — the COM-08 test suite is green).
- Template 8's `renderReadyCheckInvitation` now emits `[Book my Ready Check →](<readyCheckBookingUrl>)` when a URL is present (bare placeholder otherwise, preserving COM-08 behaviour).
- `template8SnapshotForJob(jobId)` populates `personalEstimateUrl` **and** `readyCheckBookingUrl` from the customer's own usable link.

**Booking URL:** `/estimate/{token}` — the customer's own existing token-bound Ready Check workflow. The CTA does not bypass eligibility, does not bypass prerequisites, does not trigger payment, does not trigger communications, and does not create a booking merely by being opened (the customer must view the estimate — `priceSeenBlocker` — and then explicitly accept + pick times). No parallel booking system was created.

## 8. Exact routes implemented / reused

| Route | Action |
|---|---|
| `/my-estimate/$token` | **NEW** (DEP-1) read-only saved-estimate page. |
| `/estimate/$token` | **REUSED** (DEP-2) existing Step-3 estimate + Ready Check acceptance + time picker (the booking workflow). |

## 9. Token and authorization model

- Token = the existing `customer_estimate_links` (purpose `step3_estimate`) value. No new token type, no TTL change (still 30 days), single credential.
- Public read-only route is authorized by token→job→owner mapping; cross-customer isolation is structural (a token resolves exactly one job's saved totals).
- The booking path keeps all existing authorization: token validation, active-link check, price-seen gate, and the office/trade-created `bookings` row with its own rules.
- Read-only route performs **no writes** (asserted: the server module contains no `.insert/.update/.upsert`).

## 10. Saved pricing integrity evidence

- `savedTotalsAuthoritative` / `legacy_saved_spot` cohort: saved totals are authoritative (pricing-cohort.core.ts:57–69).
- The read-only resolver reads `lead_campaign_responses` frozen totals and derives the line split from frozen `snapshot.settings` fees; it never reads current rates.
- Tests: INT-03/INT-16 mutate current fee settings and confirm the displayed saved amount does not move and the saved row is unchanged; the email snapshot is `Object.freeze`d; missing fees → limited view (no invented installation) and fail-closed email.

## 11. Ready Check booking integration evidence

- CTA URL = `/estimate/{token}` (existing workflow), asserted in tests (INT-01/08/09/11/12).
- The new read-only page links **out** to the booking page; it contains no accept/insert mutation of its own (asserted).
- Repeated reads/opens create no duplicates and no booking side-effects (INT-09/10/12 asserted against the real resolver).

## 12. Source files changed

Modified:
- `src/lib/jo-email-templates.core.ts` (optional `readyCheckBookingUrl`; Template 8 CTA binding)
- `src/routeTree.gen.ts` (regenerated to register `/my-estimate/$token`)

New:
- `src/lib/personal-estimate.core.ts`
- `src/lib/personal-estimate.server.ts`
- `src/lib/personal-estimate.functions.ts`
- `src/routes/my-estimate.$token.tsx`
- `tests/com09-personal-estimate-cta.test.ts`

## 13. Database changes

**NONE.** No migration was required — the existing `customer_estimate_links`, `lead_campaign_responses`, `indicative_estimates`, `jobs`, and `properties` schema is sufficient. Nothing was applied to any database; tests use an isolated in-process Postgres (PGlite), never the live local Supabase.

## 14. Test commands and results

**New COM-09 tests** (`tests/com09-personal-estimate-cta.test.ts`, real resolvers on PGlite + PostgREST shim):
```
bun test tests/com09-personal-estimate-cta.test.ts
→ 19 pass · 0 fail (71 expect() calls)
```
Covers INT-01…INT-16 (URL binding, token rules/TTL, fail-closed snapshot, real resolver happy path, cross-customer isolation, invalid/missing/expired token, missing-snapshot fail-closed, current-price-change immunity, read-only/no-side-effect, Template 8 CTA + back-compat, Templates 1–7 unaffected, no-provider/no-send/no-writes, no parallel booking system).

**Full regression suite:**
```
bun ./scripts/test-isolated.ts 8
→ 334 files · 3188 pass · 3 fail
```
The 3 failures are all in `tests/s20r01-automatic-enquiry-emails.test.ts` and are **pre-existing / unrelated** to COM-09 (that file imports none of the COM-09 code; its 3 failing cases are about automatic enquiry-email sending). COM-09 introduced **no new failures** and **no regressions**.

## 15. TypeScript and build results

- **TypeScript:** `bunx tsc --noEmit` → **0 errors** (whole project, including all new files and the regenerated route tree).
- **Production build:** `bun run build` → **exit 0** (client + server bundles built; nitro output generated). Only pre-existing `createServerFn().inputValidator()` deprecation notices appear project-wide; the new server fn uses the current `.validator()` API and adds no new deprecation.
  - Note: an initial build attempt failed with a host-sandbox `CODEBUDDY_BROKER_DENY` during nitro's `copyPublicAssets`; this is an environment/policy denial, not a code error, and the build succeeds on a normal (non-sandboxed) invocation.

## 16. Communication safety verification

- No provider adapter, no `realSendingOn`, no send call in any COM-09 file (asserted by test; the new server module performs **no writes at all**).
- COM-04 dual-switch guard untouched: real Save-My-Spot sending still requires `customer_comms_enabled === true` **AND** `save_my_spot_real_send_enabled === true`.
- **Local environment confirmed OFF** (read directly from local Supabase `workflow_settings`): `customer_comms_enabled=false`, `save_my_spot_real_send_enabled=false`, and all `auto_send_*=false`.
- The isolated test runner forces `SUPABASE_URL=127.0.0.1:54321` and removes `ALLOW_PROD_SUPABASE`; COM-09 tests mock the Supabase client entirely (PGlite), so no live DB and no provider are touched.
- **Safety observation (pre-existing, not introduced by COM-09):** the tracked `.env` in this branch points at the **production** Supabase URL. COM-09 never used it (tests force a local env and mock the client; the build does not connect), and it was left unmodified. Recommend a separate owner decision to untrack/rotate it.

## 17. Remaining dependencies

- **Browser UAT (R6)** is required and out of scope here (see §18).
- The saved-email **send** path is unchanged and remains gated by the COM-04 dual switch; wiring `template8SnapshotForJob` into an actual send orchestration is a communications-run concern, not a route dependency.
- The committed production `.env` (pre-existing) should be addressed by the owner (untrack/rotate); it did not affect this task.

## 18. R6 browser UAT handoff

R6 must verify the following **through a real browser** (none of these are claimed as passed here):

| ID | Check |
|---|---|
| B01 | Customer opens a valid personal estimate link (`/my-estimate/{token}`). |
| B02 | The displayed estimate matches the frozen saved snapshot (total, rebate, gross, area, line items). |
| B03 | An expired or invalid token is rejected (no saved figures shown). |
| B04 | Customer A cannot open Customer B's estimate. |
| B05 | The customer clicks "Book my Ready Check" and lands on `/estimate/{token}`. |
| B06 | The correct existing Ready Check booking workflow opens (estimate + acceptance + time picker). |
| B07 | Booking requires a legitimate customer action (view → accept + times); opening alone books nothing. |
| B08 | Repeated opening creates no duplicate acceptances/bookings. |
| B09 | No unexpected communications occur (dual switches OFF). |
| B10 | No pricing changes after Save My Spot (saved figures stay frozen). |

**Harness notes for R6:**
- **Local runtime:** from the COM-09 worktree, run the app against **local** Supabase (`SUPABASE_URL=http://127.0.0.1:54321`, PG `127.0.0.1:54322`). Do **not** use the committed production `.env`.
- **Test fixture shape:** a job that has (a) an active `customer_estimate_links` row (purpose `step3_estimate`, `expires_at` in the future) and (b) a `lead_campaign_responses` row with `spot_saved_at` set and non-null `saved_total` / `saved_veu_discount` / `saved_gross_total`. Fees come from the current `indicative_estimates.snapshot.settings`.
- **Valid token:** use an existing active link token for a saved-spot job (or mint one via the existing Step-3 issue flow). URL: `/my-estimate/{token}`; booking: `/estimate/{token}`.
- **Expired token:** set `customer_estimate_links.expires_at` to a past timestamp (or `status='revoked'`) → route must show "not available".
- **Expected DB results after B01–B10:** the read-only route performs no writes (link `view_count`/saved rows unchanged by the personal-estimate page); only the existing `acceptReadyCheck` path (on `/estimate/{token}`) may create a `ready_check_acceptances` row, and only after the customer accepts. `bookings` (`kind='ready_check'`) is created later by office/trade, not by opening a link.
- Do not include live tokens or credentials in any report.

## 19. Final verdict

**`COM09_IMPLEMENTED_TESTED`** — DEP-1 and DEP-2 are implemented and verified by application-level integration tests (real resolvers, real Postgres engine, no network), with no migration, no regressions, clean typecheck, and a successful build. Communication safeguards are intact and all local send switches are OFF. Browser UAT is explicitly **not performed** and is handed to R6.

---

### FINAL RESPONSE FORMAT

```
STEP: P1-R3-COM-09-PERSONAL-ESTIMATE-AND-READY-CHECK-CTA-INTEGRATION-01
STARTING_BRANCH: r3/p1-rc1-com08-templates
STARTING_HEAD: b2dcc567032891eab790593a3988d24caa7c5389
IMPLEMENTATION_BRANCH: r3/p1-rc1-com09-cta-integration
FINAL_HEAD: b729821496c3480a157a45e05e718242b236c1f0
WORKTREE_ISOLATED: YES (wt-r3-p1-com09-cta-integration)

DEP1_PERSONAL_ESTIMATE_ROUTE: IMPLEMENTED  (/my-estimate/{token}, read-only, fail-closed)
DEP2_READY_CHECK_CTA: IMPLEMENTED  (Template 8 "Book my Ready Check" -> existing /estimate/{token} workflow)

PERSONAL_ESTIMATE_URL: /my-estimate/{token}   (new read-only saved-estimate route; token is the only credential)
READY_CHECK_URL: /estimate/{token}             (existing token-bound Ready Check acceptance + time picker)

TOKEN_VALIDATION: PASS   (existing isWellFormedToken + purpose=step3_estimate + active)
TOKEN_EXPIRY: PASS       (existing 30-day TTL reused; linkUsable enforced; no extension)
CROSS_CUSTOMER_ISOLATION: PASS  (token->job->owner; tested with two distinct customers)
SAVED_PRICING_INTEGRITY: PASS  (frozen totals + frozen fees; current-price changes do not move them; no fabrication)
BOOKING_WORKFLOW_INTEGRATION: PASS  (reuses existing /estimate/$token; no parallel system; no auto-book)

NO_REAL_SEND: VERIFIED  (no provider call; no writes; COM-04 dual switch intact; local switches OFF)
DATABASE_MIGRATION: NONE

SOURCE_FILES_CHANGED:
  M src/lib/jo-email-templates.core.ts        (optional readyCheckBookingUrl; Template 8 CTA binding)
  M src/routeTree.gen.ts                      (regenerated: registers /my-estimate/$token)
  A src/lib/personal-estimate.core.ts         (pure fail-closed snapshot builder + URL builders)
  A src/lib/personal-estimate.server.ts       (read-only resolver + Template 8 snapshot builder)
  A src/lib/personal-estimate.functions.ts    (public no-login server fn)
  A src/routes/my-estimate.$token.tsx         (read-only saved-estimate page)
  A tests/com09-personal-estimate-cta.test.ts (19 integration tests)

NEW_TEST_RESULTS: 19 pass / 0 fail  (real resolvers on PGlite + PostgREST shim; INT-01..INT-16)
REGRESSION_TEST_RESULTS: 334 files · 3188 pass · 3 fail — all 3 pre-existing in
  tests/s20r01-automatic-enquiry-emails.test.ts (unrelated; imports no COM-09 code). No new failures/regressions.
TYPESCRIPT_RESULT: CLEAN — bunx tsc --noEmit = 0 errors
BUILD_RESULT: PASS — bun run build exit 0 (client+server+nitro output). (One earlier host-sandbox
  CODEBUDDY_BROKER_DENY during copyPublicAssets was an environment denial, not a code error; build succeeds normally.)

BROWSER_UAT: NOT_PERFORMED — R6 FOLLOW-UP REQUIRED  (B01–B10 handoff in report §18)

REMAINING_BLOCKERS:
  - None blocking COM-09 code/verification.
  - R6 browser UAT required (out of scope).
  - Pre-existing safety note: the tracked .env points at PRODUCTION Supabase; unused by COM-09
    (tests force local + mock client) but should be untracked/rotated by the owner.

REPORT_PATH: docs/phase1/communications/P1-R3-COM-09_PERSONAL_ESTIMATE_READY_CHECK_INTEGRATION_REPORT.md
COMMIT_SHA: b729821496c3480a157a45e05e718242b236c1f0   (local commit only; not pushed, not merged; this report is a follow-up doc commit)

FINAL_VERDICT: COM09_IMPLEMENTED_TESTED
```
