# P1-R3-COM-08 — Jo Lowe Eight Approved Email Templates — Implementation Report

**Project:** Home Insulation Victoria · **Phase:** 1 · **Round:** RC1
**Step:** P1-R3-COM-08-JO-EIGHT-EMAIL-TEMPLATE-IMPLEMENTATION-01
**Agent:** R3 — Communications & Automation Engineer · **Date:** 2026-10-15
**Task type:** LOCAL CODE WRITE · **Browser:** not required · **Real sends:** OFF (not authorised)

---

## 1. Starting HEAD

- **Authoritative COM-04 integration HEAD:** `d49af17ead30e1aa03dac2625c9d808c492d1e1b`
  (branch `release/p1-rc1-com04`, worktree `wt-p1-rc1-com04-integration`), verified present and equal to the baseline the brief specifies. COM-04 source commit `fb3724f6de83f302621c4dacdf3f6d7a88ced045` also confirmed present.
- The outdated `wt-p1-rc1` HEAD `3a3b554d` (the research branch) was **not** used for implementation, per the brief.
- R1's integration worktree was **not** modified. R5/R6 environments untouched.

## 2. Implementation branch

- **Branch:** `r3/p1-rc1-com08-templates`
- **Dedicated worktree:** `wt-r3-p1-com08-templates` (created from `d49af17e`).

## 3. Files changed

| File | Type | Purpose |
|---|---|---|
| `src/lib/jo-email-templates.core.ts` | NEW (pure, no I/O) | Eight renderers, deterministic `selectJoTemplate()` routing, CTA mapping, immutable saved-pricing snapshot type for Template 8 |
| `tests/jo-email-templates.test.ts` | NEW | 31 automated tests covering routing, CTA, wording, review gate, removal allowance, saved-pricing immutability, fail-closed safety |

No existing files modified; no dependency/lockfile changes committed (a temporary local `typescript` install used only for `tsc --noEmit` was reverted). No schema/data changes.

## 4. Eight-template mapping

| # | Scenario | Template id | Status |
|---|---|---|---|
| 1 | Eligible / no insulation / size unknown | `eligible_no_insulation_size_unknown` | IMPLEMENTED — 150 m² "estimated, not measured", Save My Spot |
| 2 | Eligible / no insulation / size known | `eligible_no_insulation_size_known` | IMPLEMENTED — customer area "based on the size you provided", Save My Spot |
| 3 | Eligible / below-R2 reviewed / size unknown | `eligible_below_r2_reviewed_size_unknown` | IMPLEMENTED — review gate required, $15/m² allowance (informational), Save My Spot |
| 4 | Eligible / below-R2 reviewed / size known | `eligible_below_r2_reviewed_size_known` | IMPLEMENTED — same gate + removal wording, customer area |
| 5 | Potentially eligible / unknown insulation / size unknown | `potentially_eligible_unknown_size_unknown` | IMPLEMENTED — upload CTA, **no** Save My Spot (Group B) |
| 6 | Potentially eligible / unknown insulation / size known | `potentially_eligible_unknown_size_known` | IMPLEMENTED — upload CTA, customer area |
| 7 | Ineligible | `ineligible` | IMPLEMENTED — specific reason + Review-my-result CTA, no Save My Spot |
| 8 | Ready Check invitation (saved spot) | `ready_check_invitation` | IMPLEMENTED — saved snapshot, personal estimate link, Book-my-Ready-Check CTA |

All copy is Jo Lowe's verbatim wording from `docs/phase1/communications/P1-JO-EMAIL-TEMPLATES-2026-10-15.md`, including the shared footer and PIESA/AP line items. No eligibility rules invented; no PIESA/PIISA processing, payments, scheduling, or external provider integrations added.

## 5. Routing implementation

`selectJoTemplate(input)` is pure and deterministic. It distinguishes all eight branches and enforces:

- **Below-R2 (T3/T4) require a verified review:** only `deskCheckStatus === "looks_eligible"` with `insulation === "present"` unlocks them. This matches the DB gate `lead_campaign_responses.desk_check_status IN (... 'looks_eligible' ...)` (migration 0112) and the existing `campaignSaveAllowed()` rule in `launch-campaign.core.ts`.
- **Unknown insulation is never treated as below R2** — it falls to the potentially-eligible (upload) templates.
- **Ready Check invitation fails closed:** returns `null` when no readable saved snapshot is available (no public-calculator substitute).
- **Group B restriction preserved:** potentially-eligible templates return `upload_media` only, never `save_my_spot`.

## 6. Saved pricing implementation

Existing immutable snapshot data is **reused, not replaced**:

- `lead_campaign_responses` (migration `0124_spot_price_snapshot.sql`) already stores `saved_estimate_id`, `saved_total`, `saved_veu_discount`, `saved_gross_total`, `saved_area_m2`, `saved_insulation`, `saved_estimate_url` — commented *"Never updated afterwards."*
- `pricing-cohort.core.ts` provides `settingsVersion`, `savedTotalsAuthoritative`, and a fail-closed `PricingCohortUnknownError` (new price never assumed for a possibly-protected customer).
- Template 8 renders **only** from a `Readonly<…>` `SavedPricingSnapshot`; it never recalculates with current rates. Tests prove that mutating current rates / the snapshot object does not change the rendered figures.
- The personal estimate page remains read-only w.r.t. the snapshot; any optional recalculation would create a separate new estimate (existing cohort design), never mutate the original.

## 7. CTA mapping

| Template | CTA(s) |
|---|---|
| 1, 2, 3, 4 | `save_my_spot` (→ `/estimate/{token}/campaign`) |
| 5, 6 | `upload_media` (→ `/estimate/{token}/video`) — no Save My Spot |
| 7 | `review_result` (→ job result review) |
| 8 | `book_ready_check` (→ existing Ready Check booking workflow) + personal estimate link (saved pricing) |

## 8. Migration decision

**No new migration created.** The integrity requirement (immutable saved customer total, gross total, VEU rebate, ceiling area, and pricing version) is already satisfied by migration 0124 + the pricing-cohort snapshot. Per the brief, a migration is created only if the existing schema cannot safely satisfy the requirement — it can.

- **Documented gap (optional, deferred):** `saved_installation`, `saved_piesa_fee`, `saved_ap_fee` are **not** snapshotted as separate line items (COM-07 §3). The saved **totals** are authoritative and immutable, so financial consistency is preserved; the per-line fee breakdown for Template 8 is a display refinement that can be added later via a forward-only migration (`01xx_spot_fee_breakdown.sql`) + a `saveCampaignSpot` update, without touching historical rows. Not required for RC1 integrity.

## 9. Communication safety checks

COM-04 fail-closed behaviour preserved — this task adds **pure renderers/routing only** and changes no send path:

- Real Save My Spot sending still requires `customer_comms_enabled === true` **and** `save_my_spot_real_send_enabled === true` (unchanged in `hot-leads-send.server.ts`).
- Delivery adapter restrictions, consent (`hasCurrentOwnerContactConsent`), idempotency keys, `job_communications` audit, and manual preview/copy behaviour all unchanged.
- **No real sends enabled. No emails/SMS sent.** No provider calls occur in the new module (it is pure string rendering). Provider testing would use mocks.

## 10. Automated test results

- **New suite `tests/jo-email-templates.test.ts`: 31 pass / 0 fail (49 assertions)** via `bun test`.
  Covers: all eight templates, routing, CTA selection, known/unknown ceiling area + default 150 m², below-R2 review gate, Group B restriction, removal-allowance wording (and that it is **not** added to the quoted total), saved-pricing immutability, pricing-change-after-save, missing-snapshot fail-closed handling, communication-switch intent, and absence of provider calls during manual preparation.
- **`tsc --noEmit`** (project `tsconfig.json`, TS 5.6.3): **0 errors in the new files.** Pre-existing baseline-only TS lib diagnostics in unrelated files (`enquiry.core.ts`, `office.functions.ts`, `admin.pipeline.tsx`) are present on the unmodified `d49af17e` under this TS version and are **not** introduced by COM-08.
- Targeted existing regressions re-run green (e.g. `existing-insulation-send.test.ts` 5/5). No browser verification claimed.

## 11. Remaining blockers

- **DEP-1 (token-based estimate links as token I/O):** `estimatelink.core.ts` (token rules, 30-day TTL, service-role only) and `customer_estimate_links` exist; wiring a *dedicated read-only personal-estimate route* that serves the saved snapshot for the Template 8 link is a follow-up server task (token validation / expiry / cross-customer prevention are modelled but a route-level integration test needs the live server).
- **DEP-2 (Ready Check booking URL):** a real `bookings` (`kind='ready_check'`) workflow and booking panels exist; the exact public token-bound "Book my Ready Check" URL for saved-spot invitations is not a verified standalone route — **reported as a dependency, not fabricated.**
- **GAP (optional):** per-line saved fee breakdown (installation/PIESA/AP) — see §8.

## 12. Commit SHA

See FINAL RESPONSE below (local commit only; not pushed, not merged).
