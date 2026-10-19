# P1-R2-S01 — Insulation / Video Request Email V1 (Client Review)

## 1. Step identification
- **Project:** Home Insulation Victoria
- **Phase / Round / Step:** Phase 1 / Round 2 / **P1-R2-S01**
- **Title:** Prepare Insulation / Video Request Email V1 for Client Review
- **Gap addressed:** **GAP-01** — insulation/video request email copy requires finalisation and client (Jo) approval.

## 2. Agent and duration
- **Agent:** R2 — Enquiry / Office Developer
- **Estimated time:** 5–10 minutes
- **Actual time:** ~8 minutes

## 3. Branch and preservation
- **Worktree:** `/Users/jet.zhang/CopilotWorkspace/Loveable/hi-vic-r2-enquiry-office/`
- **Branch:** `phase1/r2-enquiry-office`
- **HEAD:** `b2970e4f5fb5683953d2786d83dcff73b9915cfb`
- **S05 preserved:** `enquiry-groups.core.ts` label unification + `tests/status-label-unify.test.ts` — intact, untouched.
- **S06 preserved:** `office-status.core.ts` reconciliation helper + `tests/transfer-reconcile.test.ts` + `docs/phase1/round2/P1-R2-S06_TRANSFER_RECONCILE.md` — intact, untouched.
- No reset/overwrite/discard. **Documentation-only** step: no source/template code modified.

## 4. Existing template findings (TASK 1)
The insulation/video request email **already exists in code as a DRAFT** and does not need to be re-invented — only finalised and approved.

- **Draft renderer:** `renderInsulationVideoEmail(input)` in `src/lib/estimate-email.ts`, explicitly commented *"DRAFT (not yet approved for sending): existing-insulation calculator + optional phone video invitation."*
- **Template registration:** `templateFor()` in `src/lib/enquiry-groups.core.ts` maps enquiry group `insulation_check` → `{ key: "insulation_video_request", purpose: "insulation_video_request", approval: "draft", label: "Calculator + optional phone video invitation (NEW DRAFT – needs approval before any send)" }`.
- **Catalogue / states:** office status `enquiry.video_asked` = "Video asked for" and `enquiry.video_in` = "Video in, desk check" (`office-status.core.ts`); `lead_campaign_responses.video_requested` / `media_received_at` track the request and media return.
- **Approved vs draft wording distinguished:**
  - *Approved* estimate copy exists (`renderSaveSpotFromLikelyEmail` — "APPROVED by Jo Lowe, 7 Oct 2026"; `step3_estimate`, `preliminary_ineligible` marked `approval: "approved"`).
  - The insulation/video request is the **only** enquiry-stage template still marked `approval: "draft"` — this is GAP-01.
- **Reused approved assets:** same visual shell (`likelyV2Shell`, `v2Header`, `v2Button`, `v2Footer`), `PUBLIC_CALCULATOR_URL`, referral/unsubscribe footer — so V1 matches approved emails without new design.
- **No new mandatory customer requirements invented:** the ask (optional short video, or skip and confirm at the free onsite check) mirrors the existing Ready Check flow.

## 5. Proposed Email V1 (TASK 2)
Full client-readable draft: `docs/phase1/round2/P1-R2-S01_CLIENT_REVIEW_DRAFT_V1.md` (labelled **DRAFT V1 — NOT APPROVED FOR SENDING**). Structure:
1. **Subject:** `{First name}, a quick next step for your insulation enquiry` (fallback without name).
2. **Greeting / hero:** "{First name}, help us check your existing insulation."
3. **Reason:** owner declared existing ceiling insulation; everything else passed; next step is checking that insulation.
4. **Requested details — Section 1:** "Check your estimate" → online calculator (potential VEU rebate).
5. **Video/photo instructions — Section 2 (optional):** 20–60s phone video via the ceiling hatch from a stable ladder; explicit safety warning *"don't climb into or walk through the roof space"*; skip-and-do-onsite fallback.
6. **Clear next action:** two buttons — *Open the calculator* and *Record or upload a video*.
7. **Help/contact wording:** if they can't record safely, do nothing — handled at the free onsite visit.
8. **Closing:** "A video helps us prioritise your enquiry. It doesn't confirm eligibility on its own — that is still confirmed at the free onsite check." + reference / refer-a-friend / unsubscribe footer.

**No over-promising:** uses "potential" rebate; states no rebate figure, price, eligibility confirmation, or install date (all deferred to the onsite check).

## 6. Variables / placeholders (TASK 2)
From `InsulationVideoEmailInput` + shared constants:

| Placeholder | Source | Notes |
|---|---|---|
| `firstName` | owner record | optional; subject/hero fall back gracefully if absent |
| `captureUrl` | secure per-job `/estimate/{token}/video` link | validated: must be Home Insulation Victoria origin, correct path, no query/hash |
| `reference` | job reference | shown in footer |
| `referralUrl` | referral link | optional; validated via `validReferralUrl` |
| `PUBLIC_CALCULATOR_URL` | app constant | the public calculator button |
| unsubscribe / refer-a-friend | footer builder | standard approved footer |

## 7. Workflow mapping / send path (TASK 3)
*(Documented only — sending NOT enabled. Actual wiring belongs to S02.)*

- **Triggering enquiry state:** enquiry group `insulation_check` (owner declared existing insulation, other checks passed) → office status `enquiry.video_asked` ("Video asked for").
- **Existing email function:** `renderInsulationVideoEmail()` (`estimate-email.ts`) — builds subject/HTML/plaintext only; does not send.
- **Template selector:** `templateFor("insulation_check")` → `insulation_video_request` with `approval: "draft"`.
- **Consent requirements:** `contactExclusion()` requires `consent === "granted"`, not opted-out, not bounced, valid non-test email, primary contact, not already sent. The public webhook additionally gates customer email on `customerCommsEnabled()` + configured delivery adapter + `hasCurrentOwnerContactConsent()`.
- **Sender authorisation:** staff/admin context (`requireAdmin`) governs office-initiated sends; there is currently **no manual send path** for this purpose.
- **Test-mode restrictions:** `qa_test` source and test/example recipients are excluded (`isTestRecipient`); campaign pages support `testMode`.
- **Active send locks (`sendHolds`)** — all currently prevent sending:
  1. `"Customer communications are OFF"` when `commsEnabled` is false;
  2. `"New template – needs approval before sending"` because `approval === "draft"`;
  3. `"No manual send path yet – sending stays locked"` for non-estimate purposes (this one included).

## 8. Outstanding client decisions (CLIENT APPROVAL REQUIRED)
1. Approve the copy as-is, approve with changes, or not yet.
2. Confirm the **subject line**.
3. Confirm **tone**.
4. Confirm the **information requested** — video only, or also request specific photos (e.g. ceiling hatch / manhole).
5. Confirm the **safety wording**.
6. Keep the **calculator "check your estimate" section**, or make it video-request only.
7. Any specific wording changes marked on the preview.

Captured in the client review document for Jo to tick/comment.

## 9. Files modified
- **Added (docs only):** `docs/phase1/round2/P1-R2-S01_CLIENT_REVIEW_DRAFT_V1.md`
- **Added (docs only):** `docs/phase1/round2/P1-R2-S01_INSULATION_EMAIL_COPY.md` (this record)
- **No production code/templates modified.** No DB, deploy, commit, push, or merge. S05/S06 untouched.

## 10. Final status
**PASS (documentation-only).** The insulation/video request email already exists in code as the single remaining DRAFT template; V1 copy was reviewed, consolidated into a client-readable draft clearly labelled **DRAFT V1 — NOT APPROVED FOR SENDING**, and the full send-path mapping (trigger state, render function, variables, consent, sender authorisation, test-mode, and three active send locks) was documented. No email was sent, no sending enabled, no production template or data changed. Client (Jo) approval remains required before S02 wiring.
