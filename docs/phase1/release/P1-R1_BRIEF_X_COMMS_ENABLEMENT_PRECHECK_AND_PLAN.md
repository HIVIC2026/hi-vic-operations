# Brief X — Customer communications: pre-enablement check and enablement plan

Agent: R1 · Phase 1 · 19 Oct 2026 · **Read-only investigation — no switch changed, nothing sent, no deploy**

Scope: the six questions the owner asked before enabling `customer_comms_enabled`. Not a full project audit.

Evidence method: live Preview UI as the authorised office account `admin@hivic.test` (read-only pages) plus
source inspection. No production/shared database was queried; no service-role script was run.

Evidence: `docs/phase1/uat/P1-R1_BRIEF_X_BROWSER_EVIDENCE/21_admin_operations_preview_switches.png`,
`22_admin_templates.png`, `23_template_measured_quote_approval.png`, `24_templates_approval_matrix.png`,
`19_admin_pricing_settings.png`, `20_admin_enquiry_estimate.png`.

---

## 1. Bottom line

1. **`customer_comms_enabled` is a master permission, not a send button.** Turning it on alone delivers
   nothing: every real delivery path also needs its own switch **and** the delivery adapter, which is
   separately **Paused**.
2. **It can be enabled safely in a "portal-only" mode** (comms + quotes on, delivery adapter left off).
   In that mode quotes become `released` so the owner can see and accept them **in the app**, while no
   email or SMS can leave the system. That is enough to finish the HV-2594 journey.
3. **Real customer email/SMS is NOT ready to enable**: the measured-quote template is unapproved, the
   delivery adapter is off with "connection health unverified", and several customer templates are still
   draft or unrecorded.
4. **HV-2594 can be validated first, safely** — it is excluded from the real-send paths by job source and
   by the COM-04 recipient boundary.

---

## 2. Current switch state — live evidence (question 1, partial)

`/admin/operations-preview` (read-only), banner: **"Automation paused · 7 controls"**,
**"Connection health unverified"**, last loaded 19 Oct 04:39 Melbourne.

| Control | Live state | What it gates |
|---|---|---|
| **Customer messages** (`workflow_settings.customer_comms_enabled`) | **Paused** | Master permission — "Global permission only; consent and sending rules still apply." |
| **Customer delivery adapter** (`customer_delivery_settings.enabled`) | **Paused** | The Base44 bridge that actually carries email. "Setting only; connection health not tested." |
| Save my spot | Paused | needs `save_my_spot_real_send_enabled` **and** master **and** adapter |
| Insulation-details email | Paused | "Approved by Jo 9 Oct; still needs global customer messages permission and delivery adapter permission." |
| Quotes (`auto_send_quote` **and** master) | Paused | quote release to the owner |
| **Mitti** (`auto_send_mitti`) | **Enabled** | pre-existing; not a customer message |
| Installer offers | Paused | office-picks mode pauses automatic offers |
| Electrician offers | Paused | office-picks mode pauses automatic offers |

Business volume behind the switch at this moment (same page): **1169 leads**, 60 spot-saved,
**0 active jobs**, 23 closed, 19 needing classification, 148 unreviewed photos/videos, 1211 customer records.

### What actually reads `customer_comms_enabled`

| Consumer | File | Needs anything else? |
|---|---|---|
| Every outbound message (mandatory guard) | `comms.server.ts:15` `assertCustomerCommsEnabled` | + owner consent (`assertCustomerDeliveryAllowed`) |
| Quote release / approve / sweep | `quotes.server.ts:105,197,212,234` | **and** `auto_send_quote` |
| **Trade invite emails** | `trade-access.functions.ts:41` | none — **sends via Supabase auth when office clicks Send** |
| Ready Check invitation | `ready-check-invitation.server.ts:83` | **and** `save_my_spot_real_send_enabled` |
| Save-my-spot / Group B bulk send | `hot-leads-send.server.ts:30,352` | **and** delivery adapter enabled |
| Coverage email | `coverage.functions.ts:99` | + owner consent + adapter |
| Enquiry email drafting | `enquiry-groups.server.ts:250` | prepare-only; works with comms OFF |
| SMS | `sms.server.ts` (Twilio AU1 direct) | + the message type's own switch |

**Net effect of flipping only the master switch:** quotes can become `released` (portal-visible) and the
trade-invite "Send" button becomes live. **No email and no SMS can be delivered**, because the delivery
adapter is off and each messaging path keeps its own switch.

---

## 3. Historical queued/draft material — would enabling auto-send it? (question 2)

| Backlog | Who drains it | Auto-sends after enabling? |
|---|---|---|
| Quotes `status=draft`, `release_state=queued` | `releaseQueuedQuotes` (`quotes.server.ts:211-214`) | **No.** The sweep selects `status='issued'` **and** `release_state='queued'`. Quotes created while locked are **draft**/queued and are never promoted by it. |
| Quotes `status=issued` + `queued` (only possible if previously issued) | same sweep | **Yes** — would be released and logged as `*_quote_released`. **Count unknown in this environment** (no DB read was performed) → treat as a residual risk and check before enabling. |
| Visit reminders | `sweepVisitReminders` (`daily-brief.server.ts:11-38`) | **No.** It only *enqueues* (`enqueue_external_action`) and skips `qa_test` jobs; the comment states delivery "follows the sending switches". |
| Enqueued external actions (`external_actions` queue) | dispatched by the **delivery bridge**, not in-app (no in-app dispatcher exists) | **No** while the adapter is Paused. |
| Owner paperwork / verification codes | `owner-gates.server.ts:183`, `owner-verify.server.ts:46` | Queued only; drained by the bridge. |
| `customerDeliveryState = pending_comms_lock` | `comms.server.ts:40` | Becomes `ready_to_send` on enable, but still needs consent and the adapter. |

**Conclusion:** enabling the master switch does **not** trigger a retroactive bulk send. The one thing to
verify before enabling is whether any quote is sitting at `status='issued' + release_state='queued'`.

---

## 4. Email and SMS configuration and send path (question 3)

**Email — Base44 delivery bridge**

* `src/lib/delivery.server.ts`: config lives only in the service-role-only row
  `customer_delivery_settings` (id=1) — `provider`, `endpoint_url`, `hmac_secret`, `enabled`.
  Disabled/missing/invalid ⇒ adapter is `null` ⇒ **nothing can be delivered**. Secret never logged.
* Current state: adapter **Paused** and the page states **"Connection health unverified"** — no live
  connection check has ever been performed.
* Quote emails follow the same bridge (Step-3 / Base44 path), guarded additionally by the COM-04
  recipient boundary (`testRecipientBoundary`) immediately before the provider call — wired in
  `followups.server.ts:181` and `hot-leads-send.server.ts:93,304`.

**SMS — Twilio AU1 direct**

* `src/lib/twilio-au1.server.ts`: posts to `https://api.sydney.au1.twilio.com`, credentials from env
  `TWILIO_AU1_ACCOUNT_SID / TWILIO_AU1_API_KEY_SID / TWILIO_AU1_API_KEY_SECRET`, read per call.
* Env values are server-side and **could not be read here** → **SMS readiness = UNVERIFIED**.
* Gated by `customer_comms_enabled` **and** the message type's own switch (`sms.server.ts:1`).

**COM-04 recipient boundary** (`comms-test-recipient.core.ts`)

* `HIVIC_COM04_ENV=production` ⇒ boundary inactive (real recipients allowed).
* **Anything else (including unset) ⇒ fail-closed**: a valid non-empty `HIVIC_COM04_TEST_RECIPIENTS`
  allow-list is required; missing/empty ⇒ **every** send is blocked.
* Reserved test domains: `example.com/.org/.net`, `.test`, `.invalid`, `.localhost` only.
  ⚠️ The TEST homeowner address **`qa.journey.1f577d0e025e@hivic-test.example` is NOT reserved**
  (`.example` ≠ `.example.com`) — an email to it would be **blocked** in non-production unless it is
  added to the allow-list. Good for safety; means UAT email tests need an explicit allow-list entry.

---

## 5. Templates, legal copy and approval (question 4)

`/admin/templates` — 19 email, 4 Mitti, 17 compliance items. "Viewing here never sends, saves or connects."
Live approval state per template:

| Customer email template | Approval (live) |
|---|---|
| Likely eligible estimate | **Locked as approved** (project record, 1 Oct 2026) |
| Save your spot | **Approved final by Jo Lowe, 7 Oct 2026** |
| Save your spot — no ceiling size | Requested by Jo 8 Oct — **no stored approval record** |
| Needs onsite confirmation estimate | **Not recorded** |
| Insulation details (Group B) | **Real sending not approved (held)** |
| Ineligible result | **Not recorded** |
| Estimate not opened reminder | **Not recorded** |
| No partner in service area | **Not recorded** |
| **Measured quote (after Ready Check)** | **Draft wording for review — not approved; live sending held** |
| Booking confirmation + ESC consent | **Draft — not approved; live sending held** |
| Pre-installation pack | **Draft — not approved; live sending held** |
| Final VEEC assignment signing | **Draft — not approved; live sending held** |
| Completion email + certificate pack | **Draft — not approved; live sending held** |
| Partner emails (welcome, application changes/decline, installer invitation) | Approved (8 Oct 2026 / project record) |
| REC partnership invitation | Not recorded |
| Partner portal login | Draft — Jo to approve |

**The template this journey needs — "Measured quote (after Ready Check)" — is unapproved.**
Everything downstream of acceptance (booking + ESC consent, pre-install pack, VEEC assignment signing,
completion + certificate) is also unapproved.

---

## 6. Can HV-2594 be validated before opening real customer comms? (question 5)

**Yes — with the portal-only configuration (§9 Step 1).** Reasons, all verified:

1. **Job is excluded from real-send paths by source** (`source = "qa_test"`):
   * `daily-brief.server.ts:21` — visit reminders skip `qa_test`.
   * `coverage.functions.ts:87` — "Customer email is blocked for TEST journeys. Nothing was sent."
   * `allocation.server.ts:220,236` and `ap-queue.server.ts:40` — qa_test excluded.
2. **Recipient is synthetic** (`@hivic-test.example`) and the COM-04 boundary blocks real recipients in
   non-production anyway.
3. **With the adapter left off, no message can leave at all** — release only changes state and writes an
   event; delivery follows the switches.
4. Owner consent for HV-2594 is on record: *"Contact consent — Granted 18 Oct 2026"*.

---

## 7. Must-do before enabling — blockers vs non-blockers (question 6)

### 7.1 BLOCKING (must be closed before any real customer email/SMS)

| # | Item | Why blocking | Owner action |
|---|---|---|---|
| B1 | **"Measured quote (after Ready Check)" template is draft, not approved** | Quote emails cannot be sent on this journey at all | Approve the copy in Customer communications |
| B2 | **Delivery adapter Paused + "Connection health unverified"** | No email can be delivered; health never tested | Enable adapter **and** run a verified connection/health test with a test recipient |
| B3 | **COM-04 environment/allow-list not decided** | Non-production fails closed (all real sends blocked); production needs explicit `HIVIC_COM04_ENV=production` | Decide env; for UAT add the test addresses to `HIVIC_COM04_TEST_RECIPIENTS` |
| B4 | **SMS readiness unverified** (`TWILIO_AU1_*` not readable here) | SMS may silently fail or, worse, succeed unexpectedly | Confirm creds + one monitored test send |
| B5 | **Any quote at `status='issued'` + `release_state='queued'`** | The sweep would release it to real owners on enable | Office check before flipping the switch |
| B6 | Downstream customer templates unapproved (booking/ESC, pre-install, VEEC signing, completion) | The journey after acceptance cannot be communicated | Approve before the relevant stage, not before Step 1 |

### 7.2 NON-BLOCKING (record, do not hold the switch for these)

| Item | Note |
|---|---|
| `auto_send_mitti` already **Enabled** | Pre-existing; Mitti template IDs are still unset so creation is rejected, and `qa_test` routes to the TEST assignee. Owner decision, unrelated to this switch. |
| Installer / Electrician offers Paused | Expected — office-picks mode is deliberate. |
| Quote estimate tolerance 15% | HV-2594 variance is 0%, so no hold. |
| Unrecorded "Not recorded" templates (onsite confirmation, ineligible, reminder, no partner) | Needed only when those journeys are launched. |
| Existing UI defects DEF-02 … DEF-05 (P2) | Cosmetic/misleading copy, not delivery-related. |

---

## 8. Proposed enablement plan

### Step 1 — Portal-only enablement (safe, recommended now)

**Changes (2 fields, no code, no deploy):**

| Setting | From | To |
|---|---|---|
| `workflow_settings.customer_comms_enabled` | false | **true** |
| `workflow_settings.auto_send_quote` | false/unchanged | **true** |
| `customer_delivery_settings.enabled` | false | **unchanged — leave off** |
| `save_my_spot_real_send_enabled` | — | **unchanged — leave off** |

**Impact:** quotes generated by the office become `status=issued`, `release_state=released` → the owner
sees and can accept them in the portal; `releaseQueuedQuotes` can run; the workflow advances.
**No email and no SMS can leave the system** (adapter off, COM-04 fail-closed, qa_test excluded).

**Risks and mitigations**

| Risk | Likelihood | Mitigation |
|---|---|---|
| A real (non-TEST) job's quote also becomes released | Low — 0 active jobs, no quote exists on HV-2594 | Do it **immediately after** generating the HV-2594 quote and confirm only that quote changed; supersede any unintended release |
| Office clicks "Send" on a **trade invite** (now unblocked, sends via Supabase auth) | Low | Instruction: do not use trade-invite Send during the window; it is the only path not covered by the adapter |
| Release is not fully reversible once an owner sees/accepts a quote | Medium | Supersede the quote + log the reason; for TEST jobs this is harmless |

**Verification steps (all read-only, in the browser)**

1. Generate the measured quote on HV-2594 → expect **$4,298 subtotal − $1,120 = $3,178** customer total.
2. Assert quote `status=issued`, `release_state=released`, `sent_at` set.
3. Owner portal `/owner/42fcec2e-…` shows the quote and an **Accept** control.
4. Accept → stage moves to `measured_quote_accepted`; `workflow_events` records acceptance.
5. **Assert no outbound delivery**: `/admin/operations-preview` still shows the delivery adapter Paused;
   no new `sent` rows in job communications; no provider activity.
6. Continue the authorised TEST journey (Xero Demo ≤1 invoice, TEST payment, electrician, manual PIESA, F-1).

**Rollback:** set `customer_comms_enabled=false` and `auto_send_quote=false` (same two fields). Any quote
already released stays visible — supersede it if it must be withdrawn. No data loss; no customer was
contacted because nothing was delivered.

### Step 2 — Real customer communications (later, owner decision)

Only after **B1–B6** are closed. Sequence: approve the measured-quote template → enable delivery adapter →
run a monitored connection-health test to an allow-listed test address → send **one** real message to a
test recipient → confirm delivery in the provider → then enable per-path switches (`save_my_spot…`, SMS
types) one at a time. **Rollback:** flip the same switch back; the boundary and consent gates remain in place.

---

## 9. Evidence gaps (stated honestly)

* `auto_send_quote` could not be read separately from `customer_comms_enabled` — the control shows their
  **AND**, and no UI exposes the raw value.
* Counts of `status='issued' + release_state='queued'` quotes and of queued external actions were **not**
  read (no DB access performed by design).
* `TWILIO_AU1_*` credentials and `HIVIC_COM04_ENV` / `HIVIC_COM04_TEST_RECIPIENTS` are server-side env
  values and could not be inspected from the browser.
* Provider-side (Base44 bridge / Twilio) health is unverified — the app itself says so.

---

*Read-only investigation. No switch was changed, no message was sent, no code was modified, no deploy
was performed. Committed locally on `r1/brief-x-measurement-ui`, not pushed.*
