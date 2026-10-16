# P1-R3-S102 — COM-04 Dual-Mode (Manual + Automatic) Save-my-spot Remediation

| | |
|---|---|
| **Step** | P1-R3-S102 |
| **Agent** | R3 — Application & Integration Engineer |
| **Frozen RC1 baseline** | `c4fc1482dce12d9357a6df91ced921cc0a19d417` (`integration/p1-rc1-s67`) |
| **Worktree / branch** | `wt-r3-p1-s102-com04-dual-mode` / `r3/p1-s102-com04-dual-mode` |
| **Owner decision** | RELEASE OPTION B (real comms in scope) + SAVE MY SPOT OPTION C (manual **and** automatic), using **existing CRM fields only** — no new columns, groups, statuses, stages or migrations |
| **Mode** | Code remediation + focused tests. **No** production deploy/migration, **no** real email/SMS, **no** provider call, **no** COM-04 activation, **no** push/merge |

> **CRITICAL (final rule):** automatic sending is **NOT** declared production-ready. Code and tests passing only means the *logic and safety gates* are implemented and verified with mocked providers. Real automatic customer delivery additionally requires separate business approval, a controlled delivery verification against a verified isolated target, and explicit production activation.

---

## 0. Scope discipline

Implemented with existing fields only. **No** new DB column, customer group, eligibility status, workflow stage or migration was added (migration 0205 is **not** applied — its column is read fail-closed). R1-owned environment/config files were **not** modified. Anything that cannot be enforced with existing fields is recorded as a **limitation** in §7, not silently worked around.

---

## 1. Existing CRM field mapping (verified against the disposable-UAT schema + source)

Accepted values confirmed from `information_schema` / `pg_constraint` / `pg_enum` on `hivic-uat-disposable` (read-only) and cross-checked against the frozen source. No field was assumed.

| Business condition | Table | Column | Accepted values | Current implementation |
|---|---|---|---|---|
| Eligibility outcome | `jobs` | `eligibility_outcome` (enum) | `likely_eligible` \| `needs_onsite_confirmation` \| `does_not_appear_eligible` | `officialOutcomeForDelivery` (`followups.server.ts:34-36`); `launchGroup(eligibility_outcome, insulation)` (`hot-leads-send.server.ts:122`) |
| Eligibility provenance | `jobs` | `eligibility_decision_source` | `system` \| `admin` (others held) | `followups.server.ts:32` |
| Manual-review flag | `jobs` | `eligibility_review_required` (bool) | true held | `followups.server.ts:33` |
| Insulation declaration | `indicative_estimates` | `insulation_declared` | `none` \| `present` \| (other→unknown) | `joInsulation` (`followups.server.ts:97`); `price.insulation` |
| Ceiling size known? | `indicative_estimates` | `area_m2` (numeric), `area_source` | `measured`\|`estimated`\|`declared`\|`assumed`\|`none`\|`typical_default` | `savedPriceFromEstimate`; `assumed = area_source==="typical_default"` (`hot-leads-send.server.ts:99`) |
| Owner-stated area | `jobs` | `estimated_area_m2`, `estimated_area_unknown` | numeric / bool | `noSizeEstimateBlocker`, office variant gate |
| Service area | `properties` | `address_line`, `suburb`, `postcode` | free text | **No coverage gate in the sender** → §7 limitation |
| Contact consent | `owner_contact_consents` | `consent_status` | `granted` \| (other→no) | `hasCurrentOwnerContactConsent` (`comms.server.ts:23`) |
| Opt-out | `customer_email_optouts` / `lead_campaign_responses` | `opted_out_at` | timestamp/null | `hot-leads-send.server.ts:94` |
| Spot saved / desk-check | `lead_campaign_responses` | `spot_saved_at`, `desk_check_status` | ts/null; `not_needed`\|`pending`\|`looks_eligible`\|`not_eligible`\|`needs_onsite_check` | `hot-leads-send.server.ts:95,68` |
| Job status | `jobs` | `stage` (enum, 33 values incl. `cancelled`,`complete`,`on_hold`) | see enum | `hot-leads-send.server.ts:83`; `emailSuppression` `ESTIMATE_STAGES`/`INELIGIBLE_STAGES` |
| Delivery history / idempotency | `customer_email_sends` | `idempotency_key`, `status`, `purpose` | `sending`\|`sent`\|`failed`\|`delivered_unrecorded` | `reserve`/`reservationAllowed` (`emailsafety.core.ts:68`) |
| COM-04 switches | `workflow_settings` | `customer_comms_enabled`, `save_my_spot_real_send_enabled` | bool (2nd col via **0205, unapplied**) | `realSendingOn` (`hot-leads-send.server.ts:28`) |
| Approved templates | `launch-campaign` / `save-spot-offer` | variant | `no_insulation_owner_size` \| `no_insulation_assumed_size` \| `reviewed_under_r2` | `launchGroup` + `save-spot-offer.core` |

---

## 2. Automatic eligibility rules (FILTER 1–8) — mapped to existing logic

The automatic path is `maybeAutoSendSaveSpot` → `sendSaveMySpot` → `sendOne` (the **same** sender and gates as manual). No separate automatic sender exists; this is the reuse the owner asked for.

| Filter | Rule | Enforced by (existing) | Automatic-send effect |
|---|---|---|---|
| 1 Eligibility | only `likely_eligible`; `needs_onsite_confirmation` is **not** treated as fully verified; conflicting evidence / review-required held | `launchGroup` → group `likely`; onsite group blocked from the standard list (`hot-leads-send.server.ts:123`) | ineligible/onsite are not auto-sent as Save-my-spot |
| 2 Existing insulation | prefer explicit `none`; missing data is **not** assumed `none` | `price.insulation` from `indicative_estimates.insulation_declared` | missing/unknown → no auto-send |
| 3 Service area | must be in-Victoria + covered | **not enforced from postcode** | **LIMITATION (§7)** — not auto-verified; Office manual review covers |
| 4 Contact permission | granted consent, no opt-out/suppression; missing ≠ permission | `hasCurrentOwnerContactConsent`, opt-out reads, fail-closed on read error | missing consent → skipped |
| 5 Customer/job status | exclude saved-spot, cancelled/complete, beyond-stage | `stage` check, `spot_saved_at`, `emailSuppression` stages | excluded |
| 6 Delivery history | once-per-home; provider-accepted = attempted; uncertain never auto-retried | `customer_email_sends` idempotency + `reservationAllowed` + `delivered_unrecorded` never retried | no duplicates / no auto-retry |
| 7 Approved template | variant only when data supports it; no invented measurements | `noSizeEstimateBlocker` (assumed-size held), office-variant gate | no applicable template → no auto-send |
| 8 COM-04 activation | BOTH switches on; missing 0205 column / read error / disabled → fail closed | `realSendingOn` | switches off → blocked |

Historical/backlog customers are **not** auto-sent: `maybeAutoSendSaveSpot` fires only from the post-Gate-1 router for a new official decision; the scheduled backlog workers (`processPendingInitialEstimateEmails`, `processDueFollowups`) serve the Step-3/Base44 path and require the master switch + a configured adapter (both OFF today). No historical bulk send was added.

---

## 3. Manual sending behaviour (preserved)

Office manual sending is unchanged in flow: `sendSaveMySpot` (Leads list) and `prepareOfficeSaveSpot` (reviewed three-variant copy). It keeps **every** mandatory gate — COM-04 (`realSendingOn`), consent, opt-out, recipient boundary (§4), approved template, once-per-home idempotency, and audit logging. Manual may review a customer who fails automatic selection, but never bypasses a safety gate. No Office UI redesign.

---

## 4. Test-recipient boundary (PART 1) — design

New pure module `src/lib/comms-test-recipient.core.ts`, consulted on the **final resolved recipient immediately before the provider call** on both real paths (Save-my-spot/Resend and Step-3/Base44).

**Environment model (explicit):**
- `HIVIC_COM04_ENV=production` → boundary **inactive** (unchanged production behaviour).
- Any other value **or unset** → **non-production**, fail-closed.

**Fail-closed rule:** in non-production a **real** recipient (not an RFC-reserved test address) requires a valid, non-empty allow-list `HIVIC_COM04_TEST_RECIPIENTS`. Missing / empty / invalid allow-list ⇒ a real recipient is **blocked** — a real customer is **never** allowed merely because the allow-list variable is absent (PART 1.2). Provably-synthetic addresses (`example.*`, `.test`, `.invalid`, `.localhost`, mailinator, `+qa@`, `qa…`) are not real customers and remain permitted without an allow-list, so legitimate synthetic test flows are not broken.

**PART 1.3 (no qa_test bypass):** the boundary itself never special-cases `job.source`. qa_test sends are re-routed to Jo's inbox by the TEST sender (`test-send.core.ts`) **before** any provider contact (PART 1.5), so a qa_test job cannot reach a real customer; the real (non-qa_test) path is always validated by the boundary (PART 1.4).

**PART 1.6:** production safety does **not** depend on a silently-missing variable — production must opt in explicitly (`HIVIC_COM04_ENV=production`); forgetting to do so fails **closed** (blocks sends), the safe direction.

---

## 5. Exact source changes

**New**
- `src/lib/comms-test-recipient.core.ts` — `testRecipientBoundary()`, `commsEnvironment()`, `parseTestRecipientAllowlist()`, `allowlistIsInvalid()`.
- `tests/p1-r3-s102-com04-dual-mode.test.ts` — 25 focused tests.

**Modified (application)**
- `src/lib/hot-leads-send.server.ts` — import + early boundary check on real sends (before reservation) **and** a final check immediately before `resendSend(...)`.
- `src/lib/followups.server.ts` — import + boundary check before the Step-3 `deliverTracked` provider call (qa_test already held by `officialOutcomeForDelivery`).

**Modified (tests — declare the production send path so the new boundary doesn't mask delivery-logic coverage)**
- `tests/s20r01-automatic-enquiry-emails.test.ts`, `tests/group-b-prehandoff.test.ts`, `tests/manual-communication.links.test.ts`, `tests/manual-communication.render.test.ts` — each sets `process.env["HIVIC_COM04_ENV"]="production"` (they exercise real sends to real recipients with a stubbed provider). No assertion was weakened; only the environment is declared.

---

## 6. Focused test results (mocked providers, no network)

- **New file** `tests/p1-r3-s102-com04-dual-mode.test.ts`: **25 pass / 0 fail** — boundary env separation, missing/empty/invalid allow-list (fail closed), allow-listed / non-allow-listed / test-shaped / qa_test recipients, `realSendingOn` fail-closed (master off, secondary off, 0205 column missing, read error), manual+automatic send gating with **ZERO provider calls**, and pure filter rules (opt-out/stage suppression; idempotency `reservationAllowed`).
- **Full isolated suite** (`bun ./scripts/test-isolated.ts 8`): **339 files · 3343 pass · 0 fail** (baseline 338/3318; +25 new, nothing broken).
- **TypeScript:** `tsc --noEmit` → **exit 0, 0 errors**.
- **Build:** `bun run build` → **exit 0** (SSR + client emitted). Client-bundle secret scan: **no `service_role`/`sb_secret_` value inlined**; only the public publishable key (by design). The known S99 B3-06 note (admin-client *module* shipped to browser, no secret value) is unchanged.

---

## 7. Remaining limitations

1. **Filter 3 service-area coverage is not auto-enforced.** The sender reads `properties.postcode/suburb` but there is no existing coverage table/rule it consults, so automatic Save-my-spot does **not** verify service coverage. Per the owner's "do not infer installer availability from postcode alone" and "no new fields", this is left to Office manual review rather than a guessed rule. **Recommend an explicit coverage source before widening automatic send.**
2. **`needs_onsite_confirmation`** is not auto-sent as a fully-verified Save-my-spot (correctly); a provisional invitation, if ever approved, must preserve that distinction in copy — a business decision, not implemented here.
3. **0205 column unapplied** ⇒ the COM-04 secondary switch is inoperable in production until applied under the controlled procedure (fail-closed meanwhile).
4. **No isolated non-production target** exists (Preview shares production) — the boundary mitigates real-customer risk in test/staging but is not a substitute for a separate environment.
5. **Automatic sending is not production-ready** (see §8).

---

## 8. COM-04 readiness verdict

- **Code + safety gates:** **READY** — both modes share `realSendingOn` + `sendOne`; the test-recipient boundary is implemented and tested; no path sends with switches off; uncertain outcomes are never auto-retried.
- **B-7 (real end-to-end delivery):** **NOT_READY** — unchanged from S99: 0205 unapplied, no isolated target, no controlled delivery verification, no delivery/bounce webhook. This step does **not** close B-7.
- **Automatic production sending:** **NOT production-ready** — requires the approvals in §9 and a verified isolated delivery test. Do not enable real automatic delivery on the strength of this step alone.

---

## 9. Required business approvals

| # | Approval | Blocks |
|---|---|---|
| A1 | Confirm Save-my-spot scope = manual + automatic (Option C) in writing | automatic activation |
| A2 | Apply migration **0205** to production (backup + rollback) | operating the secondary switch |
| A3 | Approve the specific end-to-end delivery test (recipient + window + path) | B-7 closure |
| A4 | Approve a non-production/isolated target (or signed containment) | safe delivery verification |
| A5 | Set `HIVIC_COM04_ENV=production` in the production environment at activation | production sending under the new boundary |
| A6 | Decide service-area coverage source (Filter 3) before widening automatic send | §7.1 |
| A7 | Confirm `needs_onsite_confirmation` provisional-invitation copy (if any) | §7.2 |

---

## 10. Integration instructions

1. Merge this branch into `integration/p1-rc1-s67` through normal review (no push/merge performed here).
2. **Production:** set `HIVIC_COM04_ENV=production`. Leave `HIVIC_COM04_TEST_RECIPIENTS` unset (boundary inactive). Activate COM-04 only via `realSendingOn` (both switches) after 0205 is applied and A3/A5 are approved.
3. **Staging/test:** set `HIVIC_COM04_ENV=nonproduction` and `HIVIC_COM04_TEST_RECIPIENTS` to the approved mailbox(es). Real recipients are then blocked; only allow-listed/synthetic addresses send.
4. No application behaviour changes in production other than the (inactive-by-default) boundary; the boundary adds no DB column and no migration.
5. Do not enable real automatic delivery without the §9 approvals and a verified isolated delivery run.

---

## 11. Mandatory step record

```
STEP:            P1-R3-S102
TITLE:           COM-04 Dual-Mode (Manual + Automatic) Save-my-spot Remediation
AGENT:           R3 — Application & Integration Engineer
DATE:            2026-10-16
BASELINE_SHA:    c4fc1482dce12d9357a6df91ced921cc0a19d417  (frozen RC1)
WORKTREE:        wt-r3-p1-s102-com04-dual-mode
BRANCH:          r3/p1-s102-com04-dual-mode

MODE:            TARGETED REMEDIATION + FOCUSED TESTS
  production writes ........ NONE
  migrations applied ....... 0  (0205 NOT applied)
  real email / SMS ......... NONE
  external provider calls .. NONE (mocked only)
  COM-04 switches changed .. NONE (both remain OFF)
  source changes ........... 2 app files + 1 new module + 1 new test + 4 test env declarations
  push / merge / deploy .... NONE

SCHEMA VERIFIED (read-only, hivic-uat-disposable):
  jobs.eligibility_outcome enum, jobs.stage enum (33), indicative_estimates.area_source/insulation_declared,
  lead_campaign_responses.desk_check_status CHECK, owner_contact_consents.consent_status,
  customer_email_optouts.opted_out_at, customer_email_sends.idempotency_key/status/purpose

TESTS:  new file 25/25; full isolated suite 339 files / 3343 pass / 0 fail
TYPES:  tsc --noEmit exit 0 (0 errors)
BUILD:  bun run build exit 0; no service_role/sb_secret_ value in client bundle

VERDICT: code + gates READY; B-7 NOT_READY; automatic sending NOT production-ready.
COMMIT:  local only (see below); NOT pushed, NOT merged, NOT deployed.
```
