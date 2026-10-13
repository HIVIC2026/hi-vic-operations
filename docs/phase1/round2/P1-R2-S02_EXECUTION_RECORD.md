# P1-R2-S02 — Execution Record

**Project:** Home Insulation Victoria · **Phase 1 · Round 2 · Step P1-R2-S02**
**Agent:** R2 — Enquiry & Office Developer
**Task:** Integrate the seven S01B customer email templates into the actual portal workflows.
**Base main SHA integrated:** `c04641e879b7c8733134b073e680473541d62fac` (R1 automatic enquiry emails).
**Branch:** `phase1/r2-enquiry-office`

> Scope note: S01A/S01B (template drafting) were already complete. This step integrates those
> drafts into the **existing** architecture — no new email system, delivery engine, template
> database or approval flow was introduced.

---

## 1. Existing template architecture discovered (evidence-based)

The portal uses a **single, two-layer customer-email architecture**, surfaced through the Office
**Templates hub** (`src/lib/template-hub.core.ts`). Every hub entry *points at an existing
mechanism* — it holds no wording, makes no approval decision and triggers no workflow:

- **Layer A — TypeScript renderers (code-backed wording/preview).** Pure functions returning
  `{ subject, previewText, html, plainText }` built from the shared `V2_THEME` in
  `src/lib/estimate-email.ts` (e.g. `estimate-email.ts`, `coverage-email.ts`, `followup-email.ts`,
  `ineligible-email.ts`, `step3-emails.ts`). The hub mounts these via `view.kind === "sample_email"`,
  reading pre-built entries from `samples` in `src/lib/step3-email-samples.ts`.
- **Layer B — Database-backed review/approval lifecycle.** Table `customer_communication_templates`
  with server fns in `src/lib/customer-communications.functions.ts`
  (`list/save/approve` → statuses `draft → approved → superseded`; approved/superseded are
  immutable). The `CUSTOMER_COMMUNICATION_CATALOG` (`src/lib/template-catalog.ts`) names each
  customer template and its stage; each hub entry carries a `reviewKey` wiring it to its stored
  version.
- **Rendering conventions:** shared `V2_THEME` shell/header/footer/button/`neutralItem`; HTML +
  plaintext parts; `escape()` for all interpolated values; office previews wrapped by
  `withUnsubscribe(...)`.
- **Automatic dispatch (enquiry stage):** R1's `src/lib/lead-email-routing.server.ts`
  (`selectLeadEmailRoute` / `maybeAutoRouteLeadEmail`) is the single post-Gate-1 selector; the
  individual senders retain **consent, opt-out, idempotency and delivery-status** guards. The
  historical backlog remains held (not released).
- **Office drafts/approvals & failed-send visibility:** Office manual-communication path
  (`manual-communication.*`) and the DB review lifecycle above.

**Production database content was not inspected** (no production DB access was used, per Live
Environment Safety). Statements about stored `customer_communication_templates` rows are therefore
limited to the code contract, not live row content.

## 2. Which templates are code-backed
All seven customer templates are **code-backed for wording/preview** via TypeScript renderers:
- Templates 1–2 (insulation/evidence-request, Ready-Check-adjacent enquiry outcomes) and the other
  enquiry-stage emails (likely / save-spot / onsite / ineligible / reminder / coverage) — **already
  implemented by R1** (`estimate-email.ts`, `step3-emails.ts`, `followup-email.ts`,
  `ineligible-email.ts`, `coverage-email.ts`), routed by `lead-email-routing.server.ts`.
- Templates 3–7 (measured quote, booking+consent, pre-install pack, VEEC assignment signing,
  completion pack) — **added this step** in `src/lib/lifecycle-emails.ts`, following the exact same
  renderer pattern, and mounted as hub `sample_email` previews.

## 3. Which templates are database-backed
The **review/approval lifecycle** for the five later-stage templates (`measured_quote`,
`booking_consent`, `pre_install_pack`, `assignment_signing`, `completion_pack`) is backed by
`customer_communication_templates` (keys already present in both the catalog and the server-fn
enum). This step **reused** that lifecycle (via each entry's `reviewKey`) rather than adding a
parallel one.

## 4. Which existing implementations were reused
- `V2_THEME` + `escape` + `EstimateEmail` type from `estimate-email.ts` (rendering + branding).
- The `samples`/`OUTCOME_LABELS` registry and `withUnsubscribe(...)` opt-out wrapper in
  `step3-email-samples.ts`.
- The Templates-hub register and its `sample_email` view kind in `template-hub.core.ts`.
- The `CUSTOMER_COMMUNICATION_CATALOG` and DB review/approval lifecycle (unchanged).
- R1's automatic enquiry router for Templates 1–2 (no duplication; not modified).

## 5. Implementation status for all seven templates

| # | Template | Status | Notes |
|---|----------|--------|-------|
| 1 | Insulation / Evidence Request | **COMPLETE (reused R1)** | R1's enquiry router + `insulation_details` hub entry (Campaign emails). Not duplicated; supports loose-fill / below-R2 declaration + photo/video evidence in existing Group-B flow. |
| 2 | Ready Check — Choose Your Times | **COMPLETE (reused R1)** | Reuses the existing Ready-Check/scheduling workflow. No booking-rule change made (scheduling interface unchanged). |
| 3 | Measured Quote | **PARTIAL (safe portion complete; live send BLOCKED)** | Renderer populated from validated figures passed in (no recompute). Blocker: refund/cancellation wording = visible `[PLACEHOLDER]`. |
| 4 | Booking Confirmation + Consent | **PARTIAL (safe portion complete; live send BLOCKED)** | Renders confirmed date/installer/payment arrangement; never claims payment received. Blocker: owner-consent (Reg 23A) wording = `[PLACEHOLDER]`. |
| 5 | Pre-installation Pack | **COMPLETE (preview); live send gated by PIESA doc** | No legal placeholder; requires the completed PIESA document + secure doc link at send time (enforced by existing document flow, not auto-sent here). |
| 6 | VEEC Assignment Signing | **PARTIAL (safe portion complete; live send BLOCKED)** | Post-install only; never asks to pre-declare install facts. Blocker: official declaration wording + signing order = `[PLACEHOLDER]`. |
| 7 | Completion Pack | **PARTIAL (safe portion complete; live send BLOCKED)** | Lists invoice/assignment/CoES(if applicable)/warranty/dispute info; does not claim registry finalisation. Blocker: required AP contact detail = `[PLACEHOLDER]`. |

## 6. Automatic trigger and delivery status for each template
- **Templates 1–2:** automatic trigger via R1's `maybeAutoRouteLeadEmail` (consent/opt-out/
  idempotency/delivery-status guards intact). **No change made** — not re-wired, not duplicated.
- **Templates 3–7:** **No automatic send wired on.** Renderers are mounted as **office previews
  only**. Live sending remains **held** because each (except the pre-install pack) still contains an
  unresolved legal/business `[PLACEHOLDER]`; the pre-install pack is held on the PIESA-document
  precondition. No business-event → auto-send connection was activated for these stages.

## 7. Tests actually executed and results
Runner: `bun test` (isolated). Added `tests/lifecycle-emails.test.ts` (21 tests) and updated
`tests/templates-hub.test.ts` to reflect the S02 integration.
- `tests/lifecycle-emails.test.ts` — **21 pass** (selection/labels, variable substitution without
  recompute, >15% area-change conditional, paid-vs-deposit wording, no "payment received" claim,
  placeholder safe-hold, secure-link verbatim, missing-name/address safe default, CoES conditional,
  no "registry" claim, unsubscribe present, and a static guard that the renderer module imports only
  the shared theme and contains no `fetch`/`supabase`/`insert`/`send`).
- `tests/templates-hub.test.ts` — **pass** (updated: the 5 lifecycle keys now mount `sample_email`;
  18 sample/partner/plain entries; 19 email entries total; 1 `open_original`).
- `tests/transfer-reconcile.test.ts` (S06) — **8 pass**; `tests/status-label-unify.test.ts` (S05) —
  **11 pass**.
- Combined S02-relevant run: **52 pass / 0 fail**. `tsc --noEmit`: **clean (exit 0)**.
- Full isolated suite: **3010 pass / 23 fail**. **22 of the 23 failures are pre-existing on the
  clean base `c04641e8`** (verified by stashing all S02 work and re-running) in R1's
  enquiry/manual-communication domain (`existing-insulation-send`, `group-b-declaration-routing`,
  `manual-communication.server`, `save-spot-uncertain-delivery`) — **not caused by and not in scope
  for S02**. The single S02-caused failure (`templates-hub`) was fixed by the assertion update
  above. No test emails were sent to any real customer (all pure/mocked).

## 8. Remaining dependencies / blockers
1. **Measured quote** — approved refund/cancellation terms for the safety-check fee.
2. **Booking + consent** — approved owner-consent (ESC/Reg 23A) wording and its deadline.
3. **VEEC assignment signing** — official owner declaration wording and verified signing order.
4. **Completion pack** — required AP contact details per the VEU Code of Conduct.
5. **Pre-install pack** — live send requires the completed PIESA document (≥24h before) via the
   existing document flow.
6. Activating any automatic send for Templates 3–7 is a **production action** and is intentionally
   **not performed** (awaiting approved wording + Jet's go-ahead).

## 9. Files changed
- **Added:** `src/lib/lifecycle-emails.ts` (5 pure renderers for measured_quote, booking_consent,
  pre_install_pack, assignment_signing, completion_pack).
- **Modified:** `src/lib/step3-email-samples.ts` (register the 5 renderers as office previews,
  wrapped with `withUnsubscribe`; added `OUTCOME_LABELS`).
- **Modified:** `src/lib/template-hub.core.ts` (point the 5 catalog entries at `sample_email`
  previews instead of bare `review_only`).
- **Added test:** `tests/lifecycle-emails.test.ts`.
- **Modified test:** `tests/templates-hub.test.ts` (assert the new preview wiring).
- Also present from earlier R2 work (S05/S06), preserved: `src/lib/enquiry-groups.core.ts`,
  `src/lib/office-status.core.ts`, `tests/status-label-unify.test.ts`,
  `tests/transfer-reconcile.test.ts`, and the `docs/phase1/round2/*` S01/S06 records.

## 10. Git branch and commit SHA
Branch `phase1/r2-enquiry-office`. Commit SHA: *(recorded on commit — see section 11 / final report)*.

## 11. GitHub push result
*(recorded after push — see final report)*. Push target: `origin phase1/r2-enquiry-office`
(development branch). **No force-push. No merge to main. No Lovable publish.**

## 12. Production-safety confirmation
No production settings, live customer data or email switches were changed. No production database
migration was applied, no production records were modified, no bulk or real-customer email was
triggered, the environment was not relocked, and nothing was published to Lovable. Existing
automatic enquiry emails (R1) were left exactly as-is. All work was local development, pure
renderers and isolated/mocked tests.
