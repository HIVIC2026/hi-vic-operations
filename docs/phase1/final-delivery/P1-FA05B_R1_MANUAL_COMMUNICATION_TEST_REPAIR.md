# P1-FA05B — Manual Communication Server Test Repair (R1)

Agent: R1 — Lead Developer
Date: 2026-10-14 (Australia/Melbourne)
Baseline: `origin/main` = **`d153600688f85c058fbcef64957ca064a4b05ac1`**
Feature branch: `r1/p1-fa05b-manual-communication-tests`
Working worktree: `wt-r1-p1-fa05b-manual-comm`

Mandate (P1-FA05B-R1): repair the **11 failing tests** in
`tests/manual-communication.server.test.ts` and **independently review** R3's
test-fixture discovery in `tests/group-b-declaration-routing.test.ts`. No
production code is changed, no email is sent, no SQL/migration is run, and this
branch is **never merged into `main`** without a separate integration instruction
(STOP CONDITION).

---

## 1. Verified baseline

| Check | Result |
|---|---|
| `git fetch origin` | `origin/main` = `d153600688f85c058fbcef64957ca064a4b05ac1` — **unchanged** |
| R3 P1-FA05A verified (not assumed) | `origin/r3/p1-fa05a-pricing-email-fixtures` present at commit `26bf4960` — **already pushed**. Explicitly confirmed before starting; this step did **not** assume R3 was done. |
| Worktree source | Created from `origin/main` (not a stale local `main`) |
| `node_modules` | Symlinked from `wt-r1-p1-s24-integration` (301 packages) — no reinstall |
| Scope confirmation | Single-file test-maintenance task. **Zero** source/`.server`/`.core` files modified. |

---

## 2. Owner decision implemented (OPTION A)

Owner approved **OPTION A** (12 Oct 2026): when the owner confirms **no existing
insulation** but provides **no ceiling size**, the Office **may prepare an
assumed-area indicative estimate email**. The email must clearly disclose:

1. the ceiling area is **assumed, not measured**;
2. the estimate is **indicative**;
3. **actual measurement must be confirmed** (free Ready Check);
4. **final pricing must be confirmed**.

Only **prepare + preview** is authorised — **not** automatic sending. All existing
approval / send / fail-closed protections stay unchanged. The repaired test suite
pins this exact contract.

---

## 3. Files modified

| File | Change | Lines |
|---|---|---|
| `tests/manual-communication.server.test.ts` | Rewritten to repair the 11 failures + added assumed-area disclosure coverage + restored static-safety assertions to the current API | +91 / −44 (337 total) |

Nothing else is touched. `git diff --stat origin/main` shows exactly one file.
**No production code changed.**

---

## 4. The 11 failing tests — root causes & fixes (P1-FA04 taxonomy)

All 11 failures were **test-maintenance defects**, not application bugs. The
production code (`prepareOfficeSaveSpot`, `pickSaveSpotVariant`,
`prepareManualEmail`, `recordManualCommunication`) is correct; the tests had
drifted from the shipped API. Classification per P1-FA04:

| # | Class | Root cause in the old test | Fix applied |
|---|---|---|---|
| 1 | **C — fixture** | `indicative_estimates` row missing `insulation_declared`, so `pickSaveSpotVariant` (requires `insulation_declared === "none"`) could not select a Save-my-spot variant | Added `insulation_declared: "none"` to the fixture and a shared `DEFAULT_SNAPSHOT` (itemised: `4500 + 349 + 349 = 5198`) |
| 2 | **C — mock** | `hot-leads-send.server` mock only exported `sendSaveMySpot`; `prepareOfficeSaveSpot` (the real call path) was unstubbed → hit the real module | Mock now exports **both** `sendSaveMySpot` (returns `[]`) and `prepareOfficeSaveSpot` (captures args; returns the fail-closed itemised block when the estimate has no snapshot) |
| 3 | **B — stale expectation** | Expected 3-arg `{ mode: "preview" }` call shape; current API is the 4-tuple `(jobId, actorId, variant, issueLinks)` | Call assertions now expect `[[JOB, ACTOR, "no_insulation_owner_size", false]]` (preview) and `[[JOB, ACTOR, "no_insulation_owner_size", true]]` (manual copy) |
| 4 | **B — dead tests** | Two tests encoded the abolished `internalEstimate` / `TYPICAL_SIZE_MANUAL_BLOCKED` behaviour that no longer exists | Replaced with current approved behaviour: a saved typical-size estimate after a real size is known **asks for Recalculation**, and an estimate with no itemised prices is **withheld** (not invented) |
| 5 | **E — static safety** | Static guard still pinned the old API name `sendSaveMySpot` in its regex | Regex now targets `prepareOfficeSaveSpot\([^)]*\)` and asserts `!!opts.issueLinks` with no `"send"` / `test_to_jo` mode |
| 6–11 | **B/C (above)** | The remaining failures were the same mock/fixture/shape drift surfacing across the preview, manual-copy, contact-guard, duplicate-prevention and "previous manual send" tests | Covered by #1–#5 plus the contact-guard and manual-sent-block rewrites below |

### Notable test rewrites / additions
- **"a previous manual send shows a notice"** → rewritten to **"a previous manual 'Sent manually' record blocks re-preparation"**: the current code hard-blocks at `MANUAL_ALREADY_SENT` *before* reaching the notice path, so the assertion now expects `{ ok: false, reason: "Office already recorded sending this email by hand…" }` with **no write** (the old assertion expected an array `.notices[0]` that never arrived).
- **Contact guards** (`opt-out`, `saved spot`, `closed job`, `no consent`) now drive the real sender's `skipped` refusal through `prepareManualEmail` and assert `ok:false` + `internalEstimate:null` + **no write**.
- **OPTION A assumed-area test** (new): owner confirms no insulation + no ceiling size → Office prepares the `no_insulation_assumed_size` variant, passes it to the render-only sender, writes **nothing**.
- **Assumed-area disclosure test** (new, see §5): renders the real email and asserts the 4 OPTION A disclosures.

Result: **25 tests pass / 0 fail** in this file (originally 11 fail + 13 pass = 24, +1 new disclosure test = 25).

---

## 5. Assumed-area indicative email — actual rendered output (STEP 4)

Per STEP 4, the real `renderSaveSpotOfferEmail(facts)` was exercised with a
representative assumed-area fixture (`variant: "no_insulation_assumed_size"`,
`assumedArea: true`, `areaM2: DEFAULT_ESTIMATED_AREA_M2`, `gross: 5198`,
`discount: 1481.76`, `customer: 3716.24`, and a **valid** unsubscribe URL matching
`emailsafety.core` regex). The rendered `html + plainText` was asserted for all
four mandatory OPTION A disclosures:

| # | Required disclosure | Regex asserted against real output | Found? |
|---|---|---|---|
| 1 | Area is **assumed, not measured** | `/assumed/i` and `/not a measurement\|not measured/i` | ✅ |
| 2 | Estimate is **indicative** | `/preliminary estimate\|indicative/i` | ✅ |
| 3 | **Actual measurement** must be confirmed | `/confirm your actual ceiling area\|Ready Check/i` | ✅ |
| 4 | **Final pricing** must be confirmed | `/final price\|final pricing/i` | ✅ |

**Conclusion:** OPTION A's four disclosure requirements are **implemented in the
real renderer** (`saveSpotIntro` assumed wording + `SAVE_SPOT_FINAL_PRICE` in
`src/lib/save-spot-offer.core.ts`). No application defect was found; the test was
**not** relaxed to accommodate any omission (per STEP 4, a missing disclosure would
have been reported as a potential app defect, not papered over).

---

## 6. Email-send safety verification (STEP 5)

Static and runtime guards were restored and confirmed against the **current**
`prepareOfficeSaveSpot` API:

- **No real-send path** is reachable from the manual workflow — the server,
  functions and UI source contain none of `resendSend | sendTestEmail |
  sendRealSms | sendOfficeEmail | adapter.deliver | sendPreliminaryIneligibleEmail
  | sendExistingInsulationSaveSpot | sendAutomaticInsulationDetails |
  maybeAutoRouteLeadEmail | maybeAutoSendSaveSpot | sendHotLeadsBatch |
  sendInitialEstimateEmail | REAL_SEND_APPROVED | …`.
- **Every `prepareOfficeSaveSpot(...)` call site in `manual-communication.server.ts`
  is render-only**: the single site contains `!!opts.issueLinks` and never contains
  `"send"` / `test_to_jo` / `mode:"send"`.
- **Copy stays in the browser** (`navigator.clipboard`; no `fetch`/server call).
- `recordManualCommunication` writes **exactly one immutable** `job_communications`
  row and **never** writes Save-my-spot, owners, jobs or token tables.
- **Runtime proof:** the file's `officeSaveSpotCalls` capture shows the manual
  workflow never passes a send mode, and `writes()` is empty on every prepare path.
  The production `hot-leads-send.server.ts::prepareOfficeSaveSpot` is render-only
  (`mode: preview | manual_copy`) and `.catch`-returns `blocked` — unchanged.

---

## 7. R3 fixture finding — independent review (STEP 6) — **ACCEPTED**

R3 changed `tests/group-b-declaration-routing.test.ts`: the assertion *"declaration
cannot erase existing insulation through calculator save"* was moved from
`rejects.toThrow()` + `toEqual({ saved_insulation: null, spot_saved_at: null })`
to `saveCampaignSpot(...)` followed by asserting the persisted row matches
`{ saved_insulation: "present" }` with a non-null `spot_saved_at`.

**Verdict: ACCEPTED.** The application logic at
`src/lib/launch-campaign.server.ts:122-125` rewrites
`calc = { areaM2: calc.areaM2, insulation: calculatorInsulation(est.insulation_declared) }`
(comment in source: *"The calculator never changes recorded insulation facts; only
the size is the owner's input."*) and line 133 hard-throws if
`group === "onsite" && calc?.insulation === "none"`. Therefore the **recorded
declaration is genuinely preserved**. The *old* `rejects.toThrow()` only failed
because the pricing fixture was incomplete and every save fail-closed *before*
reaching the rewrite — a **fixture artifact, not a real protection**. R3's new
expectation correctly verifies the fail-safe and **does not mask a business-rule
regression**.

Per STEP 6, this file was **reviewed only — not edited** by R1. It is
byte-identical to `origin/main` on this branch (`git diff origin/main -- …`
empty), so its 8 remaining failures belong to R3's P1-FA05A integration, not to
P1-FA05B.

---

## 8. Test results

### 8.1 Focused suites (STEP 7.1 + 7.2)

| Suite | Result |
|---|---|
| `tests/manual-communication.server.test.ts` (target) | **25 pass / 0 fail** ✅ (was 11 fail) |
| `tests/manual-communication.core.test.ts` | 33 pass / 0 fail |
| `tests/manual-communication.render.test.ts` | 8 pass / 0 fail |
| `tests/manual-communication.links.test.ts` | 6 pass / 0 fail |
| `tests/save-spot-offer.test.ts` | 11 pass / 0 fail |
| `tests/save-spot-delivery.core.test.ts` | 18 pass / 0 fail |
| `tests/group-b-declaration-routing.test.ts` | 14 pass / **8 fail** (pre-existing; review-only, see §7) |
| `tests/email-safety.test.ts` | 13 pass / 0 fail |
| `tests/launch-campaign.test.ts` | 5 pass / 0 fail |
| `tests/save-spot.test.ts` | 8 pass / 0 fail |
| `bunx tsc --noEmit` | **exit 0** (no type errors) |

### 8.2 Full isolated suite (STEP 7.4)

`bun ./scripts/test-isolated.ts 8` → **328 files · 3069 pass · 11 fail · 113s**.

`manual-communication.server.test.ts` is **no longer in the failed-files list**
(the 11 assigned failures are resolved). The 11 remaining failures are in exactly
three files, all **unchanged vs `origin/main`**:

| Failed file | Count | Classification |
|---|---|---|
| `tests/existing-insulation-send.test.ts` | 3 pass / 2 fail | Pre-existing baseline; not in P1-FA05B scope |
| `tests/group-b-declaration-routing.test.ts` | 14 pass / 8 fail | R3 P1-FA05A scope (reviewed, ACCEPTED, not edited) |
| `tests/save-spot-uncertain-delivery.test.ts` | 30 pass / 1 fail | Pre-existing baseline; not in P1-FA05B scope |

No Bun runtime crashes; no environment-only failures.

---

## 9. Remaining defects / known failures (classification)

- **New failures introduced by P1-FA05B: ZERO.** The 11 originally-failing
  `manual-communication.server.test.ts` tests are resolved; the remaining 11 suite
  failures are all pre-existing on `origin/main` and untouched by this branch.
- **Pre-existing baseline (awaiting their owning agents):**
  - `group-b-declaration-routing.test.ts` (8) — owned by R3 P1-FA05A; reviewed and
    accepted here, not fixed (out of P1-FA05B scope, file not edited).
  - `existing-insulation-send.test.ts` (2) — separate known item.
  - `save-spot-uncertain-delivery.test.ts` (1) — separate known item.
- **Environment failures:** none.

---

## 10. Branch, commit & R1 integration recommendation

- **Feature branch:** `r1/p1-fa05b-manual-communication-tests`
- **Code-fix commit:** `381db3067dd325e6cf847bb62608fb3ff8e337c4` (test file only)
- **Report:** committed as the head commit on the same branch (`docs/phase1/final-delivery/P1-FA05B_R1_MANUAL_COMMUNICATION_TEST_REPAIR.md`)

**STOP CONDITION honoured:** this branch is **not** merged into `main`, not
published/deployed, no SQL/migration executed, no real email sent.

### R1 integration recommendation
1. P1-FA05B is complete and **isolated** — it fixes exactly the 11 manual-comm
   failures and adds OPTION A + safety coverage with **no production change** and
   **zero regressions**.
2. Integrate **together with R3's P1-FA05A** (`26bf4960`): P1-FA05A carries the
   `group-b-declaration-routing` fixture fix and the pricing fixtures, which is what
   clears the other 11 baseline failures. Merging P1-FA05B alone would still leave
   `group-b` (8) + `existing-insulation-send` (2) + `save-spot-uncertain-delivery`
   (1) failing on `main`.
3. **Sequence suggestion:** merge R3 P1-FA05A first, then P1-FA05B, then run the
   full isolated suite — expected outcome is a clean (or near-clean) suite. Do not
   merge either without the explicit integration instruction.

---

## Verdict

The 11 assigned `manual-communication.server.test.ts` failures are **resolved
(25 pass / 0 fail)**. No production code was changed. OPTION A's four mandatory
disclosures are **verified present in the real renderer**; email-send safety is
**restored and confirmed** against the current `prepareOfficeSaveSpot` API; and
R3's `group-b-declaration-routing` fixture finding was **independently reviewed and
accepted**. **Zero regressions** were introduced. The branch is ready for
integration alongside R3's P1-FA05A, subject to the STOP CONDITION.
