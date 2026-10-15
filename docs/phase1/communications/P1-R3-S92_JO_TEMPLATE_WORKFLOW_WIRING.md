# P1-R3-S92 — Jo Email Template Workflow Wiring

**Project:** Home Insulation Victoria
**Phase:** Phase 1 · **Round:** RC1 · **Step:** P1-R3-S92
**Agent:** R3 — Communications & Automation Engineer
**Browser access:** NOT REQUIRED (not used)
**Status:** COMPLETE

---

## 1. Actual baseline SHA

| Item | Value |
|---|---|
| Integration worktree | `wt-p1-rc1-s67-integration` |
| Integration branch | `integration/p1-rc1-s67` |
| Integration branch HEAD at start | **`92a60bc8222fbadb7e6310fa7f8d2ea6399ad48f`** |
| Underlying application baseline | `4194630dfb1a1312d59967c61879c983388e5084` |
| S84 documentation commit | `92a60bc8` (confirmed present on HEAD) |
| S92 feature branch | `r3/p1-s92-jo-template-wiring` |
| S92 worktree | `wt-r3-p1-s92-jo-wiring` |
| Branch created from | `92a60bc8` (verified, not assumed) |
| S92 local commit | single commit on the branch above (`git log -1` on `r3/p1-s92-jo-template-wiring`) |
| Parent of S92 commit | `92a60bc8` |

The task statement's baseline was **verified against the actual repository** and confirmed:
`integration/p1-rc1-s67` HEAD is `92a60bc8` ("docs(S84): RC1 candidate 4194630d compatible with
disposable UAT env"), sitting directly on `4194630d`.

**No shared RC1 worktree was modified. No merge, cherry-pick, push or deployment was performed.**

---

## 2. Existing workflow call graph (as audited, before this step)

```
Post-Gate-1 official decision (jobs.eligibility_outcome)
  │
  ├── lead-email-routing.server.ts :: selectLeadEmailRoute(jobId)
  │     └─ enquiry-groups.core :: automaticLeadEmail(...)  ->  route.email
  │
  ├── route "offer_spot"        -> hot-leads-send.server :: sendSaveMySpot
  │                                 -> step3-emails :: renderStep3SaveSpot  (Jo-locked 7 Oct HTML)
  ├── route "request_insulation"-> hot-leads-send.server :: sendAutomaticInsulationDetails
  │                                 -> estimate-email :: renderLaunchCampaignEmail (group "onsite")
  └── route "ineligible"        -> followups.server :: sendDecisionIneligibleEmail
                                    -> ineligible-email :: renderIneligibleEmail

Separate outcome delivery (the customer's eligibility-result email)
  └── followups.server :: sendInitialEstimateEmail
        -> estimate-email :: renderEstimateEmail({ outcome: "likely" | "onsite" })

Office manual communication (A1)
  └── manual-communication.server :: prepareManualEmail
        -> hot-leads-send.server :: prepareOfficeSaveSpot   /  followups.server :: prepareIneligibleEmailForOffice
```

**S89 finding confirmed:** templates implemented 8/8, wired 0/8. `selectJoTemplate()` and the eight
renderers existed in `src/lib/jo-email-templates.core.ts` but **no production path called them**.

Legacy renderer selection points identified for the customer outcome emails:

| Legacy selection | Location | Outcome vocabulary |
|---|---|---|
| `renderEstimateEmail({ outcome: "likely" \| "onsite" })` | `estimate-email.ts:145` | likely / onsite |
| `renderIneligibleOutcomeEmail(...)` | `estimate-email.ts:384` | ineligible |

COM-09 (DEP-1/DEP-2) was integrated and confirmed present: `template8SnapshotForJob(jobId)` at
`personal-estimate.server.ts:92`, building the frozen snapshot via `buildTemplate8Snapshot`.

---

## 3. Modified call graph (after this step)

```
Post-Gate-1 official decision
  │
  ├── SENDERS UNCHANGED (locked Jo-approved HTML, see §12)
  │     offer_spot         -> renderStep3SaveSpot
  │     request_insulation -> renderLaunchCampaignEmail
  │
  └── followups.server :: sendInitialEstimateEmail                      [GAP-1: T1–T6]
        └─ joOutcomeMail(...)
             └─ jo-outcome-email.core :: renderJoOutcomeEmail
                  ├─ joRoutingInputFor(facts)      -> JoRoutingInput
                  ├─ selectJoTemplate(...)         -> JoTemplateId | null     <-- CANONICAL SELECTOR
                  ├─ renderJoEstimateEmail(...)    -> Jo's verbatim copy
                  └─ renderJoIneligibleEmail(...)  -> Jo's verbatim copy
             └─ null (no Jo template) => renderEstimateEmail  (fail-closed fallback)

      followups.server :: renderPreliminaryIneligibleMail                [GAP-1: T7]
        └─ renderJoOutcomeEmail(outcome: "does_not_appear_eligible")
             (falls back to ineligible-email :: renderIneligibleEmail when no link exists)

NEW Office-only Template 8 path                                          [GAP-2: T8]
  ready-check-invitation.functions.ts :: getReadyCheckCandidates
                                      :: prepareReadyCheckInvitation    (render only)
                                      :: sendReadyCheckInvitation      (COM-04 gated)
        │  every entry point: requireAdmin(context.supabase)  ->  role "office"
        └─ ready-check-invitation.server
             ├─ ready-check-invitation.core :: readyCheckInvitationBlocker  (authorisation, job,
             │                                  eligibility, saved spot, snapshot)
             ├─ personal-estimate.server :: template8SnapshotForJob(jobId)  (COMP-09, fail closed)
             ├─ jo-outcome-email.core :: renderJoReadyCheckInvitationEmail
             │     └─ jo-email-templates.core :: renderJoReadyCheckInvitation   (existing renderer)
             └─ COM-04: customer_comms_enabled && save_my_spot_real_send_enabled
```

---

## 4. Templates 1–7 wiring (GAP-1)

### 4.1 New module: `src/lib/jo-outcome-email.core.ts` (pure)

A single, pure wiring layer. It performs four jobs and nothing else:

1. `joRoutingInputFor(facts)` — translates this repo's outcome vocabulary into `JoRoutingInput`.
2. `selectJoOutcomeTemplate(facts)` — delegates to the canonical `selectJoTemplate()`.
3. Renders through the **existing** `renderJoEstimateEmail()` / `renderJoIneligibleEmail()`.
4. Wraps Jo's copy into the existing approved email shell so the delivery pipeline's
   `{ subject, html, plainText }` shape is unchanged.

No template copy was authored, edited or re-approved. Jo's placeholders are filled with the
**existing authorised** customer pages.

### 4.2 Outcome vocabulary mapping

| This repo | Jo |
|---|---|
| `likely_eligible` | `likely_eligible` |
| `needs_onsite_confirmation` | `needs_onsite_confirmation` |
| `does_not_appear_eligible` | `ineligible` |
| `insulationDeclared` `none`/`present` | `none`/`present` |
| anything else / missing | `unknown` (**never** promoted) |
| `area.source === "typical_default"` | `ceilingSizeKnown: false` |
| `desk_check_status === "looks_eligible"` | `deskCheckStatus: "looks_eligible"` |
| any other `desk_check_status` | **absent** (unreviewed) |

### 4.3 Template → outcome table

| T | Outcome | Insulation | Desk check | Ceiling size | Wired into |
|---|---|---|---|---|---|
| 1 | likely_eligible | none | – | unknown | `sendInitialEstimateEmail` |
| 2 | likely_eligible | none | – | known | `sendInitialEstimateEmail` |
| 3 | likely_eligible | present | `looks_eligible` | unknown | `sendInitialEstimateEmail` |
| 4 | likely_eligible | present | `looks_eligible` | known | `sendInitialEstimateEmail` |
| 5 | needs_onsite_confirmation | unknown | – | unknown | `sendInitialEstimateEmail` |
| 6 | needs_onsite_confirmation | unknown | – | known | `sendInitialEstimateEmail` |
| 7 | does_not_appear_eligible | – | – | – | `renderPreliminaryIneligibleMail` |

### 4.4 CTA binding

| CTA | Destination | Notes |
|---|---|---|
| `save_my_spot` (T1–T4) | `/estimate/{token}/campaign` | the existing Save-my-spot page |
| `upload_media` (T5/T6) | `/estimate/{token}/video` | the existing Group B upload page; **never** Save my spot |
| `review_result` (T7) | `/estimate/{token}` | the existing result page |
| calculator line (T1–T6) | `/estimate/{token}#calculator` | the customer's own estimate page, never the public calculator |

A CTA whose URL is missing **throws** rather than shipping a dead button
(`missingCta` guard). Figures missing for T1–T6 also throws — never a $0 email.

### 4.5 Review gates preserved

- T3/T4 are reachable **only** with `deskCheckStatus === "looks_eligible"`. Any other verdict
  (`not_eligible`, `needs_onsite_check`, `pending`, `not_needed`, null) is passed to the selector as
  **absent**, so `selectJoTemplate()` cannot return T3/T4.
- Existing insulation without a review falls through to T5/T6 (the media-upload path), which never
  claims eligibility.
- Unknown insulation is never treated as confirmed below-R2.
- Covered by 5 tests in `A3`.

### 4.6 Fail-closed behaviour

`renderJoOutcomeEmail()` returns `null` when no Jo template applies. `sendInitialEstimateEmail` then
uses the previous renderer, so an outcome Jo has no approved template for keeps its existing email.
The ineligible path likewise falls back when the job has no active estimate link.

---

## 5. Template 8 — Office manual trigger (GAP-2)

**Owner decision implemented: OPTION A — OFFICE MANUAL TRIGGER.**

### 5.1 New files

| File | Role |
|---|---|
| `src/lib/ready-check-invitation.core.ts` | pure guards, messages, idempotency key, COM-04 switch rule |
| `src/lib/ready-check-invitation.server.ts` | Office-orchestrated prepare / send / worklist |
| `src/lib/ready-check-invitation.functions.ts` | Office entry points (`requireAdmin`) |

### 5.2 The flow

1. An authorised Office user opens the saved-spot worklist (`getReadyCheckCandidates`) and selects
   **one** named job.
2. Office initiates **“Prepare Ready Check Invitation”** (`prepareReadyCheckInvitation`).
3. The system validates, in this order: **authorisation → job exists/not deleted/not closed →
   official eligibility → saved spot → complete snapshot**.
4. The saved pricing snapshot is loaded with the existing
   `template8SnapshotForJob(jobId)` (COM-09). Missing or incomplete ⇒ **fail closed**.
5. Template 8 is rendered with the existing `renderJoReadyCheckInvitation()`.
6. Office sees a **preview** (subject, html, plain text, saved figures, both CTAs) and may confirm.
7. Office initiates **“Send”** (`sendReadyCheckInvitation`) — a separate action that re-runs every
   safeguard at send time. The preview is never trusted.
8. A `workflow_events` audit row records the Office user for both prepare and send.

### 5.3 What was deliberately NOT built

There is **no automatic trigger**. Nothing in the new modules reacts to installer availability,
geographic area, a schedule, customer activity, or Save-my-spot completion:

- `ready-check-invitation.core.ts` takes exactly six facts:
  `jobExists, deleted, closed, officialEligible, savedSpot, snapshot`.
- `ready-check-invitation.server.ts` exposes exactly three async functions, all taking an explicit
  `jobId`, and contains no `setInterval`, `setTimeout`, `cron` or event listener.
- No existing send path (`hot-leads-send.server.ts`, `launch-campaign.server.ts`,
  `enquiry-groups.core.ts`) references the T8 renderer.
- Enforced by 4 tests in `B2`.

---

## 6. Office authorization enforcement

Two layers, reusing the established pattern:

| Layer | Mechanism |
|---|---|
| Entry points | `requireAdmin(context.supabase)` — the existing Office authorisation used by `hot-leads.functions.ts`, `owner-gates.functions.ts`, etc. All three T8 entry points call it. |
| Server / pure | Every server function requires `actor: { userId, role: "office" \| "none" }`; `officeAuthorized()` requires `role === "office"` **and** a non-null `userId`. |

A non-Office role or a missing user id is refused before any read of the snapshot, so an
unauthorised call never even renders the customer's saved pricing. Covered by 3 tests in `B1`.

---

## 7. Preview / confirmation behaviour

- **Prepare** is render-only: it never contacts the provider, never reserves a
  `customer_email_sends` row and never records a communication. It **does** write one
  `workflow_events` row (`ready_check_invitation:prepared`) naming the Office user.
- The preview returns the subject, HTML, plain text, the saved figures and both CTA URLs, so Office
  can check the pricing and links before anything leaves the building.
- **Send** is a distinct action that re-checks authorisation, the snapshot, both switches, consent,
  suppression and idempotency. The preview result is never carried into send as a permission.
- This mirrors the existing STEP 17/32 prepare/send separation used by
  `manual-communication.server.ts`.

---

## 8. COM-04 safety verification

Both switches remain **OFF**. Real sending requires BOTH, read fresh from `workflow_settings`:

| Guard | Behaviour |
|---|---|
| `customer_comms_enabled` | must be `=== true` |
| `save_my_spot_real_send_enabled` | must be `=== true` |
| Missing settings row | fail closed (blocked) |
| `NULL` switch value | fail closed (null is never "on") |
| Owner contact consent | must be current and `granted` |
| Suppression / unsubscribe | `suppressionFor(jobId, "ready_check_invitation", to)` |
| Opt-out / bounce / test recipient | permanent suppression |
| Once-per-home idempotency | `customer_email_sends` key `ready_check_invitation:{jobId}` |
| Delivery adapter | must be configured |
| Prepared-but-not-sent | zero provider calls |

All S86 Option A dual-switch requirements are preserved: this path uses the **same** settings row
and the same "both must be true" rule as `realSendingOn()` in `hot-leads-send.server.ts`.

**No new sender was created.** Delivery goes through the existing `configuredDeliveryAdapter()` /
`DeliveryAdapter` interface.

### 8.1 `EmailPurpose` extension (TS-only, no migration)

`EmailPurpose` in `emailsafety.core.ts` gained one additive member, `"ready_check_invitation"`, so
the T8 email can use the existing suppression check. Because a Ready Check invitation answers a spot
the customer saved, it is exempt from the 14-day new-enquiry backlog window (as `"followup"` already
is). **All other suppression rules are unchanged**: opt-out, bounce, test recipient, job progression
and the backlog cutoff still apply.

This is a TypeScript union extension only. **No migration was created or required.**

---

## 9. Saved pricing and CTA integrity

| Requirement | Implementation |
|---|---|
| Personal estimate link | `/my-estimate/{token}` — from COM-09 `personalEstimateUrl(token)`, unchanged |
| Booking CTA | `/estimate/{token}` — from COM-09 `readyCheckBookingUrl(token)`, the **existing** workflow |
| Frozen values only | `template8SnapshotForJob` reads `lead_campaign_responses` saved totals + the frozen `indicative_estimates.snapshot.settings`. Nothing is recalculated. |
| Fee breakdown preserved | `buildTemplate8Snapshot` derives installation/PIESA/AP from the frozen fees |
| Incomplete snapshot | `buildTemplate8Snapshot` returns `null` ⇒ blocker ⇒ nothing prepared/sent |
| Expired / invalid token | `linkUsable()` (existing 30-day TTL rules) ⇒ no snapshot ⇒ fail closed |
| Read-only | The snapshot type is `Readonly<...>` and `Object.freeze`d; the T8 path performs **no** writes to any pricing table |
| No auto-booking | The booking CTA opens the existing page; the customer must still view and confirm |
| No public calculator | The only calculator link in T8 is the customer's own `/my-estimate/{token}` |
| Immutability | Rendering twice is byte-identical (test B4) |

**No new saved-price columns were added.** The COM-09 columns already in use
(`saved_total`, `saved_veu_discount`, `saved_gross_total`, `saved_area_m2`, `saved_insulation`,
`spot_saved_at`) were sufficient.

---

## 10. Automated test results

### 10.1 New wired-path contract tests (GAP-3)

`tests/p1-r3-s92-jo-wired-templates.test.ts`

**61 tests · 61 pass · 0 fail**

| Group | Coverage | Result |
|---|---|---|
| A1 | correct template per outcome (T1–T7) | 8 pass |
| A2 | known/unknown area variants | 2 pass |
| A3 | T3/T4 review gates | 4 pass |
| A4 | T5/T6 media-upload CTA | 2 pass |
| A5 | T7 ineligible routing | 2 pass |
| A6 | pricing values reach the renderer | 5 pass |
| A7 | legacy renderer no longer used for these outcomes | 5 pass |
| B1 | Office-only initiation | 3 pass |
| B2 | no automatic trigger | 4 pass |
| B3 | missing / expired snapshot fails closed | 5 pass |
| B4 | saved pricing + CTAs | 4 pass |
| B5 | duplicate prevention + audit trail | 2 pass |
| C | COM-04 dual switch, consent, suppression, idempotency | 15 pass |

All DB-backed tests execute the **real** server modules against a real Postgres engine (PGlite)
through the project's PostgREST shim. The provider is a counting mock.

### 10.2 Pre-existing suites (re-run after the change)

| Suite | Result |
|---|---|
| Jo template tests (`jo-email-templates.test.ts`) | 31 pass · 0 fail |
| COM09 personal estimate (`com09-personal-estimate-cta.test.ts`) | 19 pass · 0 fail |
| COM06 (`com06-t05-t07.test.ts`) | 7 pass · 0 fail |
| COM04 / S20-R01 (`comms.test.ts`, `email-safety.test.ts`, `s20r01-automatic-enquiry-emails.test.ts`) | pass |
| Save-my-spot lock (`save-spot-only-approved.test.ts`) | 3 pass · 0 fail |
| Step 3 parity (`step3-email-parity.test.ts`) | 8 pass · 0 fail |
| `estimate-email.test.ts` | 17 pass · 0 fail |

### 10.3 Full isolated regression (recorded)

| Run | Files | Pass | Fail | Time |
|---|---|---|---|---|
| Baseline (before this step) | 336 | **3217** | **0** | 120 s |
| After this step | 337 | **3278** | **0** | 93 s |
| Delta | +1 | **+61** | 0 | — |

`bun ./scripts/test-isolated.ts 8`. The +61 is exactly the new S92 contract suite; **no pre-existing
test was lost or skipped**.

### 10.4 TypeScript

`npx tsc --noEmit -p tsconfig.json` → **0 errors** (project-wide). Verified against the same
TypeScript 5.9.3 toolchain as the `wt-p1-rc1-s67-integration` baseline.

> Note: the TypeScript toolchain matters. An initial dependency clone carried TS 5.6.3 and reported
> 22 pre-existing errors in untouched files (`enquiry.core.ts`, `office.functions.ts`,
> `admin.pipeline.tsx`). The deps were re-cloned from `wt-p1-rc1-s67-integration` (TS 5.9.3) to match
> the integration baseline, after which the project is clean.

### 10.5 Application build

`bun run build` → **exit 0**: `✓ built in 3.16s`, `✓ built in 3.65s`, `✓ built in 670ms`,
`[nitro] ✔ Generated public .output/public`.

> Note: the first build attempt failed on a stale `node_modules/.nitro` cache carried over by the
> dependency clone, and repeat builds fail on `emptyOutDir` clearing the 887-file `.output`
> directory. Both are IDE safe-delete-guard artefacts of the local sandbox, **not** compile errors.
> A clean run (cache cleared, output renamed aside) completes with exit 0.

### 10.6 One pre-existing test updated (not weakened)

`tests/email-safety.test.ts` → “senders wire the guards” asserts a count of `withUnsubscribe(`
occurrences in `followups.server.ts`. The new T7 path adds a third, correctly-unsubscribed email
path, so the count moved 2 → 3.

The invariant was **strengthened**, not weakened: the test now also asserts that the number of
`withUnsubscribe(` calls is at least the number of `adapter.deliver(` calls, so no customer email
path can ship without a working unsubscribe link. No assertion was removed or relaxed.

---

## 11. Files changed

### New (5)

```
src/lib/jo-outcome-email.core.ts
src/lib/ready-check-invitation.core.ts
src/lib/ready-check-invitation.server.ts
src/lib/ready-check-invitation.functions.ts
tests/p1-r3-s92-jo-wired-templates.test.ts
```

### Modified (3)

| File | Change |
|---|---|
| `src/lib/followups.server.ts` | Jo outcome render helpers; T1–T6 in `sendInitialEstimateEmail`; T7 in `renderPreliminaryIneligibleMail`; exported `joRecipientFacts` |
| `src/lib/emailsafety.core.ts` | additive `"ready_check_invitation"` member on `EmailPurpose`; backlog-window exemption for it |
| `tests/email-safety.test.ts` | structural count 2 → 3 plus a strengthened invariant (see §10.4) |

### Deliverable (1)

```
docs/phase1/communications/P1-R3-S92_JO_TEMPLATE_WORKFLOW_WIRING.md
```

### Not touched

- `src/lib/jo-email-templates.core.ts` (the eight renderers) — **no template was rebuilt or edited**
- `src/lib/personal-estimate.core.ts` / `.server.ts` (COM-09) — reused as-is
- `src/lib/step3-emails.ts`, `estimate-email.ts` renderers, `hot-leads-send.server.ts`
- Any S91 fixture or UAT database object

---

## 12. Remaining blockers

1. **No Office UI exists yet for the T8 actions.**
   The three server functions (`getReadyCheckCandidates`, `prepareReadyCheckInvitation`,
   `sendReadyCheckInvitation`) are wired and authorised but have **no route/component**. An Office
   screen must be built before the manual trigger is operable. *(Blocker for R6 UAT, not for this
   step.)*
2. **The Save-my-spot campaign email keeps its own Jo-locked HTML renderer.**
   Templates T1–T4 are wired into the **outcome** email (`sendInitialEstimateEmail`). The separate
   hot-leads "Save my spot" campaign (`renderStep3SaveSpot` / `renderLaunchCampaignEmail`) still uses
   the Jo-approved 7 Oct HTML, which is locked by `save-spot-only-approved.test.ts` and
   `step3-email-parity.test.ts`.
   **Rationale:** that HTML is separately Jo-approved and byte-locked; replacing it is a content
   change beyond this step's scope and would have broken locked goldens.
   **Recommendation (owner decision needed):** confirm whether the hot-leads campaign email should
   also move to Jo's 15 Oct copy in a later step.
3. **COM-04 switches remain OFF**, so no T8 send can occur in UAT. This is intentional and required.
4. **`EmailPurpose` union extension** (§8.1) is a source change that must be included verbatim when
   this branch is integrated, or the T8 suppression check will not compile.

---

## 13. Integration instructions for R1 / R2

1. Merge branch `r3/p1-s92-jo-template-wiring` (base `92a60bc8`) into the RC1 integration branch.
   All nine files must travel together; `src/lib/emailsafety.core.ts` in particular.
2. **Do not** merge into `integration/p1-rc1-s67` before R2's S91 fixture work is reconciled — this
   branch adds no fixtures and conflicts are expected only in `followups.server.ts`.
3. After merging, re-run the full isolated regression: `bun ./scripts/test-isolated.ts 8`.
   Expected: baseline 3217 pass + 61 new = **3278 pass, 0 fail**.
4. If the Save-my-spot campaign is later moved to Jo's copy (§12.2), update
   `save-spot-only-approved.test.ts` and `step3-email-parity.test.ts` goldens in the same change.
5. Keep `customer_comms_enabled = false` and `save_my_spot_real_send_enabled = false` until the owner
   explicitly authorises real sending.

---

## 14. UAT scenarios required for R6

All scenarios run with **both COM-04 switches OFF** unless stated. No real email may be sent.

### Templates 1–7 (T1–T7)

| # | Scenario | Expected |
|---|---|---|
| U1 | Eligible, no insulation, no size given | T1 rendered; 150 m² “estimated, not measured”; Save-my-spot CTA |
| U2 | Eligible, no insulation, size given | T2 rendered; “based on the size you provided” |
| U3 | Existing insulation, **not** desk-checked | **Not** T3/T4; falls to T5/T6 with the upload-media CTA |
| U4 | Existing insulation, Office records “looks eligible” | T3/T4 rendered with the removal note; Save-my-spot CTA |
| U5 | Potentially eligible, no size | T5 rendered; upload CTA; no Save-my-spot button |
| U6 | Potentially eligible, size given | T6 rendered; upload CTA |
| U7 | Ineligible | T7 rendered; reason shown; review-result CTA; no pricing table |
| U8 | Both switches OFF | Rendered for preview; **zero** provider calls |

### Template 8 (T8)

| # | Scenario | Expected |
|---|---|---|
| T1 | Office opens the saved-spot worklist | Only saved-spot, eligible, open jobs listed |
| T2 | Office selects a saved-spot job → Prepare | Preview shows the saved figures and both CTAs; nothing sent |
| T3 | Non-Office role → Prepare / Send | Refused; **zero** provider calls |
| T4 | Saved spot with an incomplete snapshot | Refused; nothing prepared |
| T5 | Expired estimate token | Refused; nothing prepared |
| T6 | Expired snapshot then Office confirms Send | Refused; **zero** provider calls |
| T7 | Office sends the same job twice | First accepted; second refused; no second provider call |
| T8 | Preview then Send | Both `workflow_events` rows written, naming the Office user |
| T9 | Personal estimate CTA | Opens `/my-estimate/{token}`, shows saved pricing, read-only |
| T10 | Booking CTA | Opens `/estimate/{token}`; **does not** auto-book |
| T11 | Current rates change after the spot was saved | Invitation still shows the **saved** figures |

### COM-04

| # | Scenario | Expected |
|---|---|---|
| C1 | Both switches OFF → Send | Blocked; zero provider calls |
| C2 | Master ON, save-my-spot OFF → Send | Blocked; zero provider calls |
| C3 | Missing settings row → Send | Blocked; zero provider calls |
| C4 | Consent missing or withdrawn → Send | Blocked; zero provider calls |
| C5 | Unsubscribed / bounced customer → Send | Blocked; zero provider calls |
| C6 | Duplicate send | Zero additional provider calls |

---

## 15. Guardrails observed

| Guardrail | Status |
|---|---|
| Real communications sent | **NONE** (both switches OFF; provider mocked) |
| Production writes | **NONE** |
| Shared database writes | **NONE** (isolated PGlite) |
| Push / merge / deploy | **NONE** |
| Browser used | **NO** |
| RC1 integration | **NOT claimed** — committed to the R3 branch only |
