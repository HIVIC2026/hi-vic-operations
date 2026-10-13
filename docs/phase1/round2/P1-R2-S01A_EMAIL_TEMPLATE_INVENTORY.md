# P1-R2-S01A — Complete Phase 1 Email Template Inventory

**Project:** Home Insulation Victoria · **Phase 1 / Round 2 / Step S01A**
**Agent:** R2 — Enquiry / Office Developer · **Type:** Investigation / documentation only
**Branch:** `phase1/r2-enquiry-office` · **HEAD:** `b2970e4f5fb5683953d2786d83dcff73b9915cfb`
**S05/S06 preserved:** yes (no production code modified; docs-only).

> **Scope & method.** Evidence gathered by reading the latest source under `src/lib/**`. Every classification below cites the file/line evidence that supports it. **Verified facts** are drawn from code; **recommendations** are clearly labelled. No business rules or templates were invented; where the workflow stage has no email evidence, it is marked **NOT REQUIRED (no evidence)** rather than assumed.

---

## 0. How email templates exist in this codebase (two mechanisms)

1. **Hard-coded renderers** — TypeScript functions that build subject/HTML/plaintext (e.g. `renderSaveSpotFromLikelyEmail`). Approval is recorded in code comments and, for enquiry-stage drafts, in `templateFor()` via `approval: "approved" | "draft"` (`enquiry-groups.core.ts:156–161`).
2. **DB-backed content templates** — `customer_communication_templates` table with a `draft → approved → superseded` lifecycle, edited/approved in-app via `customer-communications.functions.ts` (`saveCustomerCommunicationDraft`, `approveCustomerCommunicationDraft`). The **catalog of 10 keys** is fixed by a Zod enum (`customer-communications.functions.ts:6`) and mirrored for presentation in `template-catalog.ts` (`CUSTOMER_COMMUNICATION_CATALOG`).

A template can therefore be: rendered in code, present as a catalog slot awaiting DB content, or both. Classifications below reflect this.

**Send paths (verified):**
- **Automatic / campaign & reminders** → `customer_email_sends` rows written by `hot-leads-send.server.ts` and `followups.server.ts` (idempotency keys, provider status). Campaign gated by `LAUNCH_COPY_APPROVED` (`launch-campaign.server.ts:21,227,274`).
- **Manual office-prepared drafts** → `enquiry-groups.core.ts` `templateFor()` + `sendHolds()`; `contactExclusion()` enforces consent/opt-out/bounce.
- **Spot-saved confirmation** → sent from the campaign save path (`launch-campaign.server.ts:318–327`).
- **Ready Check times** → sent from `installer-ready-check.server.ts:74`.

---

## 1. Consolidated inventory table

Legend — **EXISTS** = approved renderer/content in code; **DRAFT** = present but explicitly not approved; **MISSING** = required slot with no rendered content (DB draft workflow only); **UNKNOWN** = required status not determinable from code; **N/R** = not required under Phase 1 (no evidence of an email).

| # | Email scenario | Trigger (verified) | Recipient / Sender | Required P1? | Status | Template location (evidence) | Approval | Auto/Manual send | Gap | Dependencies | Action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **Preliminary estimate — likely eligible (known size)** | Enquiry group `likely_size` | Owner / Office or campaign | Yes | **EXISTS** | `renderSaveSpotFromLikelyEmail` `estimate-email.ts:581`; "APPROVED by Jo Lowe, 7 Oct 2026" `:577`; `templateFor` `approval:"approved"` `enquiry-groups.core.ts:158` | Approved | Both (campaign + manual) | — | Calculator/rebate figures, estimate link | **KEEP** |
| 2 | **Preliminary estimate — likely eligible (assumed size)** | `likely_no_size` | Owner / Office | Yes | **EXISTS** | same renderer, typical-home wording; `enquiry-groups.core.ts:159` `approval:"approved"` | Approved | Both | — | Assumed reference area | **KEEP** |
| 3 | **Insulation / optional video request** | `insulation_check` | Owner / Office | Yes | **DRAFT** | `renderInsulationVideoEmail` `estimate-email.ts:547`; "DRAFT (not yet approved…)" `:543`; `enquiry-groups.core.ts:160` `approval:"draft"` | **Not approved** | Manual (locked: "No manual send path yet") | Needs Jo approval; wiring = S02 | Calculator URL, secure `/video` link | **MODIFY/APPROVE** (S01) |
| 4 | **Preliminary ineligible result** | `otherReason==="not_eligible"` | Owner / Office | Yes | **EXISTS** | `renderIneligibleOutcomeEmail` `estimate-email.ts:384`; `renderIneligibleEmail` `ineligible-email.ts:15`; `enquiry-groups.core.ts:161` `approval:"approved"` | Approved | Manual | — | Result review only | **KEEP** |
| 5 | **Estimate-not-opened reminder (3 days)** | `estimate_unopened_3d` | Owner / Automatic | Yes | **EXISTS** | `renderFollowupEmail` `followup-email.ts:32`; "approved outcome-email theme" `:2`; sent via `followups.server.ts` | Approved (theme) | Automatic | Confirm copy with Jo (recommendation) | Estimate link | **KEEP** |
| 6 | **No partner in service area / coverage unavailable** | REC+installer coverage conclusively absent | Owner / Office or auto | Yes | **EXISTS** | `renderCoverageUnavailableEmail` `coverage-email.ts:4`; "approved outcome-email theme" | Approved (theme) | Office (sample in `step3-email-samples.ts:66`) | Confirm trigger wiring (recommendation) | Coverage check (REC + installer) | **KEEP** |
| 7 | **Save My Spot — likely eligible (campaign)** | Group B onsite / hot-leads campaign | Owner / Automatic | Yes | **EXISTS** | `renderLaunchCampaignEmail` `estimate-email.ts:509`; old v9 "RETIRED" `:508–510`; uses approved save-spot copy | Approved | Automatic (`hot-leads-send.server.ts`) | — | `LAUNCH_COPY_APPROVED`, campaign link | **KEEP** |
| 8 | **Save My Spot — offer variants (no insulation / under-R2 reviewed)** | Recorded facts select variant | Owner / Automatic | Yes | **EXISTS** | `renderSaveSpotOfferEmail` `save-spot-offer.core.ts:130`; "Jo-approved three-variant… (Jo, 12 Oct 2026)" `:1`; sent `hot-leads-send.server.ts:210` | Approved | Automatic | — | Calculator choice, rebate | **KEEP** |
| 9 | **Spot saved confirmation (email + SMS)** | Owner first saves spot | Owner / Automatic | Yes | **EXISTS** | `renderSpotSavedEmail`/`renderSpotSavedSms` `spot-saved-messages.core.ts:37–43`; "APPROVED by Jo Lowe, 7 Oct 2026" `:2` | Approved | Automatic (`launch-campaign.server.ts:327`) | — | Rebate value, my-job URL | **KEEP** |
| 10 | **Ready Check — choose times** | Installer requests office-arranged Ready Check | Owner / Office→owner | Yes | **DRAFT** | `renderRcTimesEmail` `installer-ready-check.core.ts:51`; "DRAFT owner email (Jo to approve)" | **Not approved** | Office-triggered (`installer-ready-check.server.ts:74`) | Needs Jo approval | Installer business name, `/times` link | **MODIFY/APPROVE** |
| 11 | **Measured quote (after Ready Check)** | Stage `measured_estimate_ready` → quote | Owner / Office | Yes | **MISSING** | Catalog slot `measured_quote` `template-catalog.ts:14`; enum `customer-communications.functions.ts:6`; **no hard-coded renderer** (grep empty) | DB draft lifecycle only (none approved found) | DB-managed; no renderer | No rendered body in code | Priced quote, Customer Acceptance + VEU factsheet forms | **CREATE** (content via DB workflow) |
| 12 | **Booking confirmation + ESC consent** | Stage `booking_consent` (3·Booked) | Owner / Office | Yes | **MISSING** | Catalog `booking_consent` `:15`; enum `:6`; no renderer | DB draft lifecycle only | DB-managed | No rendered body | Install date, Reg 23A ESC consent form | **CREATE** |
| 13 | **Pre-installation pack** | Stage `pre_install_pack` (4·Before install) | Owner / Office | Yes | **MISSING** | Catalog `pre_install_pack` `:16`; enum `:6`; no renderer | DB draft lifecycle only | DB-managed | No rendered body | PIESA copy (≥24h), consumer docs | **CREATE** |
| 14 | **Final VEEC assignment signing** | Stage `assignment_signing` (5·After install) | Owner / Office | Yes | **MISSING** | Catalog `assignment_signing` `:17`; enum `:6`; no renderer | DB draft lifecycle only | DB-managed | No rendered body | Final Activity 48 VEEC assignment | **CREATE** |
| 15 | **Completion email + certificate pack** | Stage `completion_pack` (6·Complete) | Owner / Office | Yes | **MISSING** | Catalog `completion_pack` `:18`; enum `:6`; no renderer | DB draft lifecycle only | DB-managed | No rendered body | Tax invoice, certificates, warranties, dispute info | **CREATE** |
| 16 | **Estimate email (generic base)** | Base used by other renderers | Owner | Yes (internal) | **EXISTS** | `renderEstimateEmail` `estimate-email.ts:145` | Approved (base) | n/a (composition) | — | Shared theme | **KEEP** |

### Catalog keys not separately rowed
`likely_estimate` and `onsite_estimate` and `ineligible_result` catalog keys (`template-catalog.ts:9–11`) correspond to rows 1–2, 7, and 4 above; `area_unavailable` → row 6; `estimate_unopened_3d` → row 5. They are listed in `CUSTOMER_COMMUNICATION_CATALOG` as content slots whose approved wording can also be managed through the DB lifecycle.

---

## 2. Verified facts vs recommendations

**Verified from code:**
- 10-key customer-communication catalog + DB draft/approve/supersede lifecycle (`customer-communications.functions.ts`, `template-catalog.ts`).
- Rows 1, 2, 4, 7, 8, 9 carry **explicit Jo approvals** in code comments / `approval:"approved"`.
- Rows 3 and 10 are **explicitly DRAFT / "Jo to approve"** in code.
- Rows 11–15 have **catalog slots and enum keys but no hard-coded renderer** (confirmed by empty grep for `renderMeasuredQuote|renderBookingConsent|renderCompletion|renderAssignment|renderPreInstall`).
- Automatic sending exists for campaign, spot-saved, and 3-day reminder; consent/opt-out/bounce enforced by `contactExclusion`; campaign gated by `LAUNCH_COPY_APPROVED`.

**Recommendations (not verified business rules):**
- Rows 11–15 should be authored and approved through the existing DB template lifecycle rather than new hard-coded renderers, to match the product's intended content-management pattern. (Decision: Jet/Jo.)
- Rows 5 and 6 are theme-approved; recommend an explicit Jo wording sign-off even though the theme is approved.

---

## 3. Templates requiring Jet's / Jo's review

| Priority | Template | Reason |
|---|---|---|
| **1** | **Insulation / video request** (row 3) | Explicit DRAFT; blocks `insulation_check`; V1 prepared in S01 — needs approval before S02 wiring. |
| **2** | **Ready Check — choose times** (row 10) | Explicit "DRAFT (Jo to approve)"; already triggered in office flow. |
| **3** | **Measured quote** (row 11) | MISSING rendered content; required for quote stage. |
| **4** | **Booking confirmation + ESC consent** (row 12) | MISSING; Reg 23A consent dependency. |
| **5** | **Pre-installation pack** (row 13) | MISSING; PIESA/consumer-doc dependency. |
| **6** | **Final VEEC assignment signing** (row 14) | MISSING; Activity 48 assignment dependency. |
| **7** | **Completion + certificate pack** (row 15) | MISSING; invoice/certificate/warranty dependency. |
| 8 | 3-day reminder (row 5) & coverage-unavailable (row 6) | Theme-approved; recommend explicit wording confirmation. |

---

## 4. Items deliberately NOT marked as required
No standalone email was invented for intermediate operational stages that show **no email evidence** in code (e.g. internal installer-allocation transitions, PIESA electrician scheduling, AP review). These are workflow/status transitions, not owner emails, and are left **N/R (no evidence)** rather than assumed.

---

## 5. Restrictions honoured
No production code modified; no emails sent; no sending enabled; no DB writes; no deploy/commit/push/merge; no R3/R4 files touched. S05/S06 changes preserved. This step is investigation + this document only.

## 6. Final status
**PASS (inventory complete).** Classification: **EXISTS ×8 (rows 1,2,4,5,6,7,8,9,16)**, **DRAFT ×2 (rows 3,10)**, **MISSING ×5 (rows 11–15)**, **UNKNOWN ×0**. Seven primary templates require Jet/Jo review (two DRAFT, five MISSING). Every classification is evidence-cited to source.
