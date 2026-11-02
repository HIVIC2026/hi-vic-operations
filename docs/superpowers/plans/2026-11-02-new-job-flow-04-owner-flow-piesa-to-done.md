# New job flow — Part 4: owner flow from PIESA booking to done — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Job flow steps 7–11 send the approved owner messages and pages — PIESA booked, clear to install / upgrades needed, one confirm-sign-and-pay page, deposit received, install booked, one "All done" email with one sign-and-pay page, after-install reminders — and every legally required copy (PIESA, consent, CoES, warranty + instructions, rebate form, dispute and contact details) reaches the owner on time, paid or not.

**Architecture:** Builds on the existing in-house path: `owner-booked-notice.core.ts` (Part 3) gains the PIESA and install versions; the deposit request sender (`deposit-request.server.ts`, key `install-deposit:v1:{invoice}`) becomes "You're clear to install" so a job can never get both; the All done sender (`emailOwnerInstallComplete`, key `install-complete:v1:{job}`) replaces O44 + O45. Two new owner screens on My job (`?screen=clear`, `?screen=finish`) reuse the existing signing and payment server pieces (`signOwnerPiesaConfirmation`, `signOwnerConsent`, `signOwnerVeecAssignment` path, `createStepCheckout`). Every new or reworded send ships behind an `*_APPROVED = false` constant; new text types start switched off.

**Tech Stack:** TypeScript, TanStack Start, React, Supabase, bun:test, MJML email kit, Stripe (existing checkout).

**Spec:** `docs/superpowers/specs/2026-11-02-new-job-flow-design.md` (rev 31) + `docs/hiv-touchpoint-decisions.md` (exact wording; latest dated decision wins; "Decisions from the electrician + SWMS chat" wins). Overview: `2026-11-02-new-job-flow-00-overview.md`. Part 3 plan: `2026-11-02-new-job-flow-03-owner-flow-to-acceptance.md`.

## Global Constraints

- Read root `AGENTS.md`, `src/AGENTS.md`, `src/lib/AGENTS.md`, `scripts/AGENTS.md` first; run `bun scripts/scan-retired-terms.ts` before workflow work. `docs/HIV_WORKFLOW_SOURCE_OF_TRUTH.md` + `src/config/workflow-decisions.ts` change in the same commit as any rule they state.
- "Home Insulation Victoria" in full; owners see "electrical safety check (PIESA)", "rebate", "electrical upgrades" (never "fixes", "repairs needed"). Trades see PIESA, SWMS, Part C without explanation.
- Owner-facing phones are the installer's or electrician's OFFICE phone; missing → held with an office note, never a worker's mobile.
- "You're booked" contact block: `{business} · {office phone} · {business email}` + `Rebate certificates created by Home Insulation Victoria (Accredited Person A003654).`
- Payment (Jo 2 Nov, answers 1 and 21 — 21 supersedes 3 and 5): the 10% deposit (10% of the price after the $349) is paid on the ONE confirm-and-pay page (PIESA owner declarations + ESC consent + pay), which opens straight after the PIESA result — including when electrical upgrades are still to come. The install day can only be booked after the deposit is paid (existing `installDepositBlocker` kept). Booking before the upgrades day is a warning only; the GO check still needs the Part C + Certificate of Electrical Safety (Part 9). No "deposit by 2pm the day before" rule. The rest on install day. Never state an install duration.
- Rentals (Jo 2 Nov, answers 7 and 22): the owner answers the rental questions in the quick taps after "It's your turn" (Part 3 Task 19: `rentalAnswersFor`, `accessPersonFor`, `tenantFor`). The person who lets the trades in (when it isn't the owner) gets the PIESA and install "You're booked" texts and the day-before texts (Task 15); the tenant always gets the cl 23 notice by text + email once the install day is booked (Task 16); the owner still gets every job message. Owner-occupied homes: unchanged.
- The signed ESC consent copy goes to the owner straight away when they sign, on its own — never held until a bank-transfer deposit lands (answer 10).
- Official forms keep official wording (DEECA PIESA owner declarations, ESC consent Section 2 ticks, ESC VEEC form). Owners see each form before signing ("View the full form").
- Warranty + manufacturer's instructions go with the "All done" email whether or not the balance is paid. Signed rebate form copy within 10 business days of signing.
- Do not contact (Part 3 Tasks 1, 2, 17 — office button or an owner STOP reply): automatic messages stop; compliance sends (`esc_consent_copy`, `piesa_copy`, `veec_assignment_copy`, `install_complete`, `completion_pack`, `install_deposit_paid`, `non_compliance_notice`) still go, also to owners who unsubscribed.
- Any owner wording not given verbatim in the decisions file = "draft → Jo approves" first; its send stays behind an `*_APPROVED = false` flag.
- New SQL only in `docs/pending-migrations/` with PGlite proof; never applied live. TEST jobs → test-send. Templates register (`template-hub.core.ts`) updated with every wording change.

## Review Focus

1. **Owner never pays the balance** → the All done email still sends at completion with tax invoice, rebate form, warranty, manufacturer's instructions, contact details and dispute info; `warranty_copy_provided` is recorded; the signed rebate form copy still goes once signed; the paid-in-full completion pack does not. Task 10 test.
2. **Job already past a step when this part ships** (deposit already requested in the old wording, O28 already sent, consent already signed at acceptance, PIESA already confirmed on P6) → exactly one version of each message, and the confirm-and-pay page shows already-done steps as done instead of asking again. Tasks 3, 5, 14 tests.
3. **Do not contact set after the PIESA** → no "You're clear to install", no upgrades email, no reminders; the filled PIESA still goes as a standalone `piesa_copy`, and Deposit received / All done still go. Task 2 test.
4. **Upgrades done on another day** (answer 21) → owner gets "upgrades needed" (with the PIESA) which leads straight to the confirm-and-pay page; they can pay the deposit and the install can be booked (warning) before the upgrades day; once the certificate is uploaded the owner gets the updated PIESA (with Part C) and the certificate by the existing PIESA/CoES copies — no second deposit request; the GO check refuses the install until the Part C + certificate are in (Part 9). Tasks 2, 4 tests.
5. **Owner signs on the confirm page but pays by bank transfer later** → signatures are saved once; the signed consent copy goes straight away on its own (existing O63 sender, `esc_consent_copy`) and exactly once; "Deposit received" never carries it again (answer 10). Tasks 5 and 6 tests.

---

### Task 1: "You're booked" — PIESA and install versions (#38, #46)

**Files:**
- Modify: `src/lib/owner-booked-notice.core.ts` (Part 3), `src/lib/in-house-booking.core.ts` (`bookingNotice` delegates `piesa`/`install`), `src/lib/in-house-booking.server.ts` (`notifyOwnerBooked`: PIESA uses the electrician's business), `src/lib/template-hub.core.ts`
- Test: `tests/owner-booked-notice.test.ts` (extend)

**Interfaces:**
- Consumes: Part 3 `ownerBookedNotice(f: BookedFacts)`, `OWNER_BOOKED_V2_APPROVED`, `TradeContact`; Part 6 `electricianBusinessFor(jobId): Promise<TradeContact | null>`; Part 2 balance-on-install-day amount (`balanceCents` from `payments.core`).
- Produces: `BookedFacts` gains `installDeadline?: string` (PIESA) and `balanceCents?: number` (install).

- [ ] **Step 1: Write the failing test** (verbatim):

```ts
const viking = { name: "Viking Electrical", officePhone: "03 9111 1111", email: "jobs@viking.example" };
const p = ownerBookedNotice({ kind: "piesa", firstName: "Sarah", startIso: "2026-11-06T23:00:00Z", whoName: "Dan Lee", business: viking, changed: false, installDeadline: "2026-12-06" }) as { text: string; sms: string };
expect(p.text).toContain("You're booked for your electrical safety check (PIESA)");
expect(p.text).toContain("A licensed electrician checks your switchboard, ceiling wiring and downlights are safe to insulate over. It's already paid for.");
expect(p.text).toContain("Before they arrive");
expect(p.text).toContain("someone 18+ home"); // ✓ switchboard + ceiling hatch access ✓ someone 18+ home ✓ pets away
expect(p.text).toContain("The 30-day rule: Your insulation must be installed within 30 days of this check, or it has to be done again. Rapid Insulation will call you to book your install day.");
expect(p.text).toContain("Need to change it? Call Viking Electrical on 03 9111 1111.");
expect(p.text).toContain("Viking Electrical · 03 9111 1111 · jobs@viking.example");
expect(p.sms).toBe("Home Insulation Victoria: Hi Sarah, you're booked for your electrical safety check (PIESA): Sat 7 Nov, 10:00am. Dan Lee from Viking Electrical is coming. Need to change it? Call Viking Electrical on 03 9111 1111.");
const i = ownerBookedNotice({ kind: "install", firstName: "Sarah", startIso: "2026-11-12T21:00:00Z", whoName: "Tom Ray", business: rapid, changed: false, balanceCents: 141200 }) as { text: string; sms: string };
expect(i.text).toContain("Lead Installer: Tom Ray");
expect(i.text).toContain("Your balance: The rest of your payment, $1,412.00, is due on install day. We'll send you a link to pay by card or bank transfer.");
expect(i.text).not.toMatch(/How long|hours|Wrong time|Change day/);
expect(i.sms).toBe("Home Insulation Victoria: Hi Sarah, you're booked for your insulation install: Fri 13 Nov, 8:00am. Tom Ray from Rapid Insulation is coming. Need to change it? Call Rapid Insulation on 03 9000 0000.");
```
  Plus: install "Before they arrive" has the 4 approved ticks (clear the way to the ceiling hatch, someone 18+ home, power off while they work in the ceiling, pets away); no electrician business on file → `{ held }` for the PIESA version; the PIESA "30-day rule" names the INSTALLER (from the job's installer business) while the change line names the ELECTRICIAN.
- [ ] **Step 2: Run** `bun test tests/owner-booked-notice.test.ts` — expect FAIL.
- [ ] **Step 3: Implement**; keep purpose `in_house_booked` and key `in-house-booked:v1:{booking}:{worker}`.
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** `feat(booking): approved PIESA and install "You're booked" emails + texts`.

### Task 2: PIESA result routing — one owner message per result

**Files:**
- Create: `src/lib/piesa-result-route.core.ts`
- Modify: `src/lib/piesa-delivery.core.ts` + `piesa-delivery.server.ts` (owner copy only when the route says `standalone_copy`; installer copy wording, Task 4), `src/lib/deposit-request.core.ts` (`depositRequestEligible` basis)
- Test: `tests/piesa-result-route.test.ts`

**Interfaces:**
- Consumes: Part 3 `doNotContactOn`; Part 6 events `coes_uploaded` (certificate in) and the Mitti A3/A4 facts already read by `electrical-clearance.server.ts`.
- Produces:
  - `type PiesaResultRoute = "clear_to_install" | "upgrades_needed" | "standalone_copy"`
  - `piesaResultRoute(f: { outcome: "all_clear" | "upgrades_needed"; upgradesDoneSameDay: boolean; doNotContact: boolean; newFlow: boolean }): PiesaResultRoute[]`
  - `depositOpenAfterPiesa(f: { outcome: "all_clear" | "upgrades_needed" | null }): boolean` — true as soon as a PIESA result is recorded, whatever it is (Jo 2 Nov, answer 21: the confirm-and-pay page opens straight after the result, including when upgrades are still to come).

- [ ] **Step 1: Write the failing test**

```ts
const r = (o: Partial<Parameters<typeof piesaResultRoute>[0]>) => piesaResultRoute({ outcome: "all_clear", upgradesDoneSameDay: false, coesUploaded: false, doNotContact: false, newFlow: true, ...o });
expect(r({})).toEqual(["clear_to_install"]);
expect(r({ outcome: "upgrades_needed" })).toEqual(["upgrades_needed"]);
expect(r({ outcome: "upgrades_needed", upgradesDoneSameDay: true })).toEqual(["clear_to_install"]); // done on the day: "Upgrades: Done", certificate follows
expect(r({ doNotContact: true })).toEqual(["standalone_copy"]);
expect(r({ outcome: "upgrades_needed", doNotContact: true })).toEqual(["standalone_copy"]);
expect(r({ newFlow: false })).toEqual(["standalone_copy"]);                                         // old-flow job keeps O28
expect(depositOpenAfterPiesa({ outcome: "upgrades_needed" })).toBe(true);   // upgrades still to come
expect(depositOpenAfterPiesa({ outcome: "all_clear" })).toBe(true);
expect(depositOpenAfterPiesa({ outcome: null })).toBe(false);
```
  Server: for a new-flow job the owner O28 email is NOT sent when the route is `clear_to_install`/`upgrades_needed` (those emails carry the PIESA); the installer copy always sends.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement**; `depositRequestEligible` and `installDepositDueNow` (`payments.core.ts`) use `depositOpenAfterPiesa` — the deposit is due once the PIESA result is in, replacing the 26 Oct "fixes signed off BEFORE the 10% deposit" order (answer 21). The installation booking still needs the deposit paid (`installDepositBlocker`, unchanged). Update `docs/HIV_WORKFLOW_SOURCE_OF_TRUTH.md` + `workflow-decisions.ts` in the same commit.
- [ ] **Step 4: Run** `bun test tests/piesa-result-route.test.ts tests/piesa-delivery.test.ts tests/deposit-request-task6.core.test.ts` — expect PASS.
- [ ] **Step 5: Commit** `feat(piesa): one owner message per safety check result; deposit opens straight after the result`.

### Task 3: "You're clear to install" email (#40)

**Files:**
- Modify: `src/lib/deposit-request-email.core.ts` (`renderInstallDepositOwnerEmail` step `request`), `src/lib/deposit-request.server.ts` (`ownerNotice`: attachments, link to `?screen=clear`), `src/lib/template-hub.core.ts`
- Test: `tests/clear-to-install-email.test.ts`

**Interfaces:**
- Consumes: Part 1 `filledPiesaPdf(jobId, { withPartC: boolean }): Promise<EmailAttachment>` and `prefilledEscConsentPdf(jobId): Promise<EmailAttachment>`; existing `coesAttachmentsFor(jobId)` (`completion-pack.server.ts`); Task 2 route.
- Produces: `CLEAR_TO_INSTALL_APPROVED = false as boolean`; `DepositMessageFacts` gains `checkedOn: string; electrician: string; upgrades: "None" | "Done"; firstName: string`. Purpose `install_deposit_request` and key `install-deposit:v1:{invoiceId}` unchanged (an owner already sent the old deposit request never gets this one).

- [ ] **Step 1: Write the failing test** (verbatim from `clear.png` + #40):

```ts
const m = renderInstallDepositOwnerEmail({ ...facts, firstName: "Sarah", installer: "Rapid Insulation", amountCents: 15700, deadline: "2026-12-06", checkedOn: "2026-11-07", electrician: "Viking Electrical", upgrades: "None" }, "request");
expect(m.subject).toBe("You're clear to install");
expect(m.text).toContain("Your electrical safety check (PIESA) is all clear. One last step to book your install day:");
expect(m.text).toContain("Confirm your safety check and pay your 10% deposit");
expect(m.text).toContain("$157.00 inc GST");
expect(m.text).toContain("Confirm and pay my deposit: https://");
expect(m.text).toContain("Takes about a minute. Card or bank transfer. Then Rapid Insulation will call you to book your install day.");
expect(m.text).toContain("Install by Saturday 6 December. The rebate rules need your insulation in within 30 days of the safety check. The rest of your payment is due on install day.");
expect(m.text).toContain("Electrical upgrades needed: None");
expect(m.text).toContain("Your signed safety check (PIESA) is attached. Please keep it: the VEU program says you must have it at least 24 hours before your install. Please don't let anyone into the ceiling before the install, or the check may need to be done again.");
expect(m.text).not.toMatch(/Stripe|to be confirmed|7 days after|Bank details/);
```
  Server: attachments = filled PIESA + pre-filled ESC consent; same-day upgrades → `upgrades: "Done"` (the certificate goes later by the existing CoES owner copy); this email is never sent again after later upgrades (Review Focus 4); any PIESA/consent PDF missing → held (`"Clear to install documents not ready"`), never sent without the PIESA. The existing `install_deposit_request` text is unchanged.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** (approval flag false → old wording, same key).
- [ ] **Step 4: Run** `bun test tests/clear-to-install-email.test.ts tests/deposit-request-task6*.test.ts` — expect PASS.
- [ ] **Step 5: Commit** `feat(deposit): "You're clear to install" email with the PIESA and consent form attached`.

### Task 4: "Electrical upgrades needed" email + text (#42); installer PIESA copy (#41)

**Files:**
- Create: `src/lib/upgrades-needed.core.ts`, `src/lib/upgrades-needed.server.ts`
- Modify: `src/lib/sms.core.ts` (type `upgrades_needed`, owner, `wordingApproved: true`, `quietHours: true`), `src/lib/piesa-delivery.core.ts` (`renderPiesaCopyEmail`: "Electrical upgrades needed" label; installer "Next" line), allocation tick (`src/routes/api/public/hooks/allocation-tick.ts`: call `sweepUpgradesNeeded`), `src/lib/template-hub.core.ts`
- Test: `tests/upgrades-needed.test.ts`, `tests/piesa-delivery.test.ts`

**Interfaces:**
- Consumes: Task 2 route; Part 6 `electricianBusinessFor`; Part 1 `filledPiesaPdf`.
- Produces: `UPGRADES_NEEDED_APPROVED = false as boolean`; `upgradesNeededEmail(i: { firstName; found: string[]; electrician: TradeContact; installBy: string; depositCents: number; confirmUrl: string }): { subject; text; html }` (button → `?screen=clear`, Task 5); `upgradesNeededText(first: string | null, electrician: string): string`; `sweepUpgradesNeeded(now?: Date): Promise<{ checked: number; sent: number }>`; key `upgrades-needed:v1:{piesaRecordId}`, purpose `upgrades_needed`.

- [ ] **Step 1: Write the failing test** (verbatim, #42 and #41):
  - email has each `found` item; `"1. Viking Electrical will quote the upgrades and book them with you directly. You pay them, not us."`; step 2 is the DRAFT (answer 21 replaces the approved "Once the upgrades are done, we'll email you…" line) `"2. You don't need to wait for the upgrades: confirm your safety check and pay your 10% deposit now, then Rapid Insulation will call you to book your install day."` with the deposit amount and button `"Confirm and pay my deposit"` → `?screen=clear`; never contains `"Once the upgrades are done, we'll email you"`; the 30-day rule with the install-by date; `"Viking Electrical · 03 9111 1111 · jobs@viking.example"`; signed PIESA attached.
  - `upgradesNeededText("Sarah", "Viking Electrical")` === `"Home Insulation Victoria: Hi Sarah, your safety check found electrical upgrades needed. Viking Electrical will quote and book them with you directly. Details in your email."`
  - installer PIESA copy: label `"Electrical upgrades needed"` (no "Repairs needed"); contains `"Next: call the owner and book the install in the portal. They pay their 10% deposit to lock it in."`
  - `upgradesDoneSameDay` → no upgrades email; one email per PIESA record; DNC → none (Task 2 sends the standalone copy).
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Draft → Jo approves (as a picture, flag off):** step 2 + button (answer 21), and — not in the decisions file — the heading/subject and the 30-day sentence. Draft: subject `"Your safety check found electrical upgrades needed"`; 30-day line reused from the PIESA "You're booked" (`"The 30-day rule: Your insulation must be installed within 30 days of this check, or it has to be done again."` + `"Install by {date}."`). Show Jo before the flag flips.
- [ ] **Step 4: Implement**; old fixes senders are removed in Task 13.
- [ ] **Step 5: Run** — expect PASS.
- [ ] **Step 6: Commit** `feat(upgrades): owner told the electrician quotes upgrades directly; installer PIESA copy says what's next`.

### Task 5: Confirm, sign and pay page (`?screen=clear`)

**Files:**
- Create: `src/lib/confirm-sign-pay.core.ts`, `src/lib/confirm-sign-pay.server.ts`, `src/components/owner/OwnerConfirmSignPay.tsx`
- Modify: `src/lib/owner-myjob.core.ts` (`OwnerScreen` adds `"clear"`; `currentOwnerAction`), `src/routes/my-job.$token.tsx` (render the screen), `src/lib/owner-link.functions.ts` (new `ownerConfirmSignPayStateFn`, `ownerConfirmSignPayFn` — literal `createServerFn` chains)
- Test: `tests/confirm-sign-pay.test.ts`

**Interfaces:**
- Consumes: `OFFICIAL_OWNER_DECLARATIONS`, `ownerPiesaConfirmFacts`, `signOwnerPiesaConfirmation` (`piesa-owner-confirm.*`); `signOwnerConsent`, `currentConsent` (`consent.server.ts`) and the four Section 2 tick texts from `consent.core.ts`; `createStepCheckout(jobId, returnUrl, step)` (`stripe.server.ts`) for `install_deposit`; `bankDetailLines` (`payments.core.ts`); Part 1 "View the full form" PDFs.
- Produces:
  - `CONFIRM_SIGN_PAY = { kicker: "ONE LAST STEP", title: "Confirm, sign and pay your deposit", step1: "Confirm your safety check", step2: "Sign the government consent form", step2Sub: "The law says we must tell the Essential Services Commission about every install before it happens. This is the Commission's own form.", step3: "Pay your 10% deposit", nameLabel: "Type your full name to sign steps 1 and 2", card: "Sign and pay by card", bank: "Sign and pay by bank transfer", viewForm: "View the full form ›" }`
  - `piesaConfirmTick(checkedOnLong: string): string` → `"I confirm the electrical safety check was done on 7 November. I understand that anyone going into the ceiling before the install may void it, and that this form goes to my installer and may go to the Essential Services Commission."`
  - `confirmSignPayFooter(installer: string, installBy: string): string` → `"Then Rapid Insulation will call you to book your install day. Install by Saturday 6 December."`
  - `type ConfirmSignPayState = { piesa: { checkedOn; electrician; result: "Safe to insulate" | "Electrical upgrades needed"; done: boolean }; consent: { name; address; phone; email; done: boolean; signedOn: string | null }; deposit: { amountCents: number; paid: boolean } }`
  - `confirmSignPayBlockers(i: { piesaTick: boolean; consentTicks: [boolean, boolean, boolean, boolean]; typedName: string; state: ConfirmSignPayState }): string[]` — ticks only required for steps not already done.
  - `confirmSignPay(jobId: string, session: OwnerSession, i: { piesaTick; consentTicks; typedName; method: "card" | "bank" }): Promise<{ checkoutUrl: string } | { bank: string[] }>` — signs only not-yet-signed steps with the ONE typed name, sends the signed consent copy at once through the existing `emailOwnerConsentCopy` (O63, purpose `esc_consent_copy`, Part 1 Task 15 PDF when its flag is on) whenever this call signed the consent (Jo 2 Nov, answer 10), then returns the card checkout or bank lines.

- [ ] **Step 1: Write the failing test**
  - Copy constants verbatim (above); the four consent ticks are the exact `consent.core.ts` Section 2 strings (`"I am the owner of the property listed above, or I am authorised to provide consent on behalf of the owner."`, `"The details listed above are complete and accurate."`, `"I consent to DC Construction Solutions Pty Ltd trading as Home Insulation Victoria sending the information in section 1 to the Essential Services Commission."`, `"I consent to the Commission sharing that information with WorkSafe and/or Energy Safe Victoria."`).
  - Blockers: missing any consent tick, the PIESA tick or the name → blocked; all present → `[]`.
  - In-flight (Review Focus 2): consent already signed at acceptance (old flow) → `state.consent.done = true`, its ticks not required, `signOwnerConsent` not called again; PIESA already confirmed on P6 → step 1 done, not re-signed.
  - Upgrades still to come (answer 21): `currentOwnerAction` returns `"clear"` straight after the PIESA result; the page shows Result `"Electrical upgrades needed"` (DRAFT; `"Safe to insulate"` stays for all clear), the PIESA tick text is unchanged and the confirmation records the result's `piesaRecordId`; when Part C is added later the owner is not asked to confirm again.
  - Bank transfer (Review Focus 5): signatures saved, returns bank lines with the job's invoice reference; `emailOwnerConsentCopy` called exactly once, before any payment exists; a second submit signs nothing new, sends no second copy and returns the same lines; deposit not marked paid. Card path: the copy is sent at signing too, not on the payment webhook.
  - A 6-digit code session is required (same `ownerSession` as other signing).
- [ ] **Step 2: Run** `bun test tests/confirm-sign-pay.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** (layout per `clear-page3.png`); `currentOwnerAction` returns `"clear"` when `depositOpenAfterPiesa` and deposit unpaid; "View the full form ›" opens Part 1's filled PIESA / pre-filled consent PDF.
- [ ] **Step 4: Run** the test, `bunx tsc --noEmit`, `bun run portal-qa` (My job clear screen at 390px) — expect PASS; gaps NOT_RUN.
- [ ] **Step 5: Commit** `feat(my-job): one page to confirm the safety check, sign the ESC consent and pay the deposit`.

### Task 6: Deposit reminders (#43), Deposit received (#44), Deposit paid office email (#45)

**Files:**
- Modify: `src/lib/deposit-request-email.core.ts` (steps `day3`/`day7`/`paid`, `renderInstallerDepositPaidEmail`), `src/lib/deposit-request.server.ts` (attachments on `paid`), `src/lib/template-hub.core.ts`
- Test: `tests/deposit-messages-v2.test.ts`

**Interfaces:**
- Consumes: Part 1 `depositReceiptPdf(jobId)`, `filledPiesaPdf(jobId, { ownerConfirmed: true })`.
- Produces: `DEPOSIT_MESSAGES_V2_APPROVED = false as boolean`. Purposes/keys unchanged (`install_deposit_day3|day7|paid`, `install_deposit_paid_office`). The signed ESC consent is NOT attached here: Jo's 2 Nov answer 10 sends it on its own at signing (Task 5), which overrides the #44 attachment list.

- [ ] **Step 1: Write the failing test** (verbatim):
  - reminder subject `"Reminder: one last step to book your install"`; body `"You're clear to install. Confirm your safety check and pay your 10% deposit, then Rapid Insulation will call you to book your install day. It takes about a minute."`; amount; button `"Confirm and pay my deposit"` → `?screen=clear`; `"Card or bank transfer."`; install-by date; `"The rest of your payment is due on install day."`; no `"Bank details: we'll send these"`, no `"(Stripe)"`.
  - paid: `"Deposit received, thanks!"`; `"We've got your $157.00 deposit. Rapid Insulation will call you from 03 9000 0000 to book your install day."`; `"Install by Saturday 6 December (30-day rule)."`; `"The rest of your payment, $1,412.00, is due on install day."`; `"Your receipt is attached."`; attachments = receipt + owner-confirmed PIESA (no consent PDF); no text message for `paid`. (The install is never booked before the deposit — answer 21 — so no booked-already variant.)
  - Reminders for a job whose upgrades are still to come leave out the opening `"You're clear to install."` sentence (delete, don't reword) and keep the rest.
  - office: subject `"HV-1234: deposit in, ready to book"`; `"Good news: Sarah's deposit is in 🎉"`; `"HV-1234 is ready to book. Give Sarah a call, agree the install day, then add it and your Lead Installer on the job."`; rows Owner / Phone / Address / Install by; button `"Book the install"`; `"Sarah pays the rest on install day."`
  - Consent copy exactly once (answer 10): whichever order signing and payment happen in, `esc_consent_copy` is sent once at signing and Deposit received never attaches a consent PDF.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement.** (Decision #44 wording "Install by {date} (30-day rule)" is assembled from the approved lines; the exact line order follows `dep-paid-p.png` — copy it from the picture in the build.)
- [ ] **Step 4: Run** `bun test tests/deposit-messages-v2.test.ts tests/deposit-request-task6*.test.ts tests/deposit-task6-completion.test.ts` — expect PASS.
- [ ] **Step 5: Commit** `feat(deposit): approved reminders, Deposit received with signed copies, office "deposit in" email`.

### Task 7: "We couldn't get in today" (#51)

**Files:**
- Modify: `src/lib/install-no-access-notice.core.ts` (`installNoAccessText`, `renderInstallNoAccessEmail`), its server (pass office phone + install-by date)
- Test: `tests/install-no-access-notice.test.ts` (update)

**Interfaces:**
- Produces: `InstallNoAccessFacts` gains `officePhone: string; installBy: string`; drops `newDays`.

- [ ] **Step 1: Write the failing test** — email and text contain `"Rapid Insulation will call you from 03 9000 0000 to book a new day."` and the 30-day rule with the install-by date; neither contains `"three new days"`, `"new days shortly"` or a job-page link to pick days; no office phone → held.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** (same keys).
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** `fix(no-access): installer will call from the office phone to book a new day`.

### Task 8: Owner told straight away when a booked visit can't go ahead (cl 24; Jo 2 Nov, answer 4)

Jo: when a trade drops a booked job ("Can't do this one"), email the owner straight away, before the office decides who takes it. Wording (Jo, answer 4): `"Your visit on {day} can't go ahead. We'll be in touch about a new day."` — the line is hers; the subject and greeting are drafts, shown to her as a picture in this part's build before the flag turns on. The tenant notice (cl 23) is Task 17.

**Files:**
- Create: `src/lib/visit-cancelled-owner.core.ts`, `src/lib/visit-cancelled-owner.server.ts`
- Modify: `src/lib/template-hub.core.ts`
- Test: `tests/visit-cancelled-owner.test.ts`

**Interfaces:**
- Consumes: Part 3 `BookedKind`; existing `sendGuardedOwnerEmail`.
- Produces:
  - `VISIT_CANCELLED_OWNER_APPROVED = false as boolean`; `VISIT_CANT_GO_AHEAD_LINE = (day: string) => \`Your visit on ${day} can't go ahead. We'll be in touch about a new day.\``.
  - `visitCancelledOwnerEmail(i: { firstName: string | null; startIso: string }): { subject: string; text: string; html: string }` — DRAFT subject `"Your visit on {Fri 13 Nov} can't go ahead"`, greeting `"Hi {first},"`, then the line; `{day}` = `Ddd D Mmm` Melbourne.
  - `queueVisitCancelledOwnerEmail(jobId: string, bookingId: string, by: "installer" | "electrician"): Promise<string>` — purpose `visit_cant_go_ahead`, key `visit-cancelled:v1:{bookingId}`, email only (no text), `"awaiting approval"` while the flag is false. Called by Part 5's "Can't do this one" handler (`tradeHandBack`) and Part 6's `electricianCantDo` when they cancel a confirmed booking; NOT called by "Owner cancelled" (the owner already knows).

- [ ] **Step 1: Write the failing test** — `visitCancelledOwnerEmail({ firstName: "Sarah", startIso: "2026-11-12T21:00:00Z" }).text` contains `"Your visit on Fri 13 Nov can't go ahead. We'll be in touch about a new day."`; server (fake db): a confirmed install booking + `queueVisitCancelledOwnerEmail(job, booking, "installer")` → exactly one send at the tap; the same for a PIESA booking dropped by the electrician; a second call → `"already attempted — not resent"`; flag false → `"awaiting approval"`, nothing recorded; Do not contact on → blocked (not a compliance send); TEST → test-send.
- [ ] **Step 2: Run** `bun test tests/visit-cancelled-owner.test.ts` — expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** `feat(owner-comms): tell the owner straight away when a booked visit can't go ahead`.

### Task 9: "All done" email (#52) — one email at completion, paid or not

**Files:**
- Modify: `src/lib/completion-emails.core.ts` (`renderInstallCompleteEmail`; `renderFinalInvoiceEmail` retired), `src/lib/approved-owner-emails.server.ts` (`emailOwnerInstallComplete`: attachments), `src/lib/veec-reminders.server.ts` (day 0 stays "carried by the All done email"), `src/lib/template-hub.core.ts`, `docs/templates/mjml/owner_O44.mjml`
- Test: `tests/all-done-email-v2.test.ts`

**Interfaces:**
- Consumes: Part 1 `taxInvoicePdf(jobId)`, `veecFormPdf(jobId, { forOwnerToRead: true })`, `productInstructionsFor(product): EmailAttachment | null`; existing `prepareWarrantyCopies` / `recordWarrantyCopyProvided` (`completion-pack.server.ts`); Part 6 `electricianBusinessFor`; Part 2 complaint line.
- Produces: `ALL_DONE_V2_APPROVED = false as boolean`; `InstallCompleteInput` gains `contacts: { ap: TradeContact; installer: TradeContact; electrician: TradeContact | null }`, `balanceCents: number`, `signAndPayUrl: string`. Purpose `install_complete`, key `install-complete:v1:{job}` unchanged.

- [ ] **Step 1: Write the failing test** (verbatim from `done2.png`):
  - subject `"All done, Sarah. Enjoy a warmer home!"` (current approved subject kept); heading `"All done. Enjoy a warmer home!"`; `"Rapid Insulation finished installing your ceiling insulation today."`
  - `"Two last things, one page"`; `"1. Sign your rebate form. It confirms what was installed and lets us claim the $2,380 rebate you've already had off your price."`; `"2. Pay your balance: $1,412.00, due today."`; button `"Sign and pay"` → `?screen=finish`; `"Takes about a minute. Card or bank transfer."`
  - summary: Installed `120 m² Bradford Gold R5.0`, Your rebate `$2,380 off`, Balance due today `$1,412.00`.
  - `"Something not right? Reply to this email or write to info@homeinsulationvictoria.com.au and we'll look into it."` + the ESC / Consumer Affairs Victoria line (dispute info at completion).
  - contacts block lists Home Insulation Victoria (Accredited Person) `info@homeinsulationvictoria.com.au`, the installer and the electrician, each name · phone · email (cl 26).
  - no `"Certificate of Completion"`, no `"lower"` bills claim, no `"VEEC incentive"`.
  - attachments: tax invoice, rebate form, installed product's warranty, manufacturer's instructions.
  - balance already paid in full → item 2 and "Balance due today" are left out (only the rebate form).
- [ ] **Step 2: Draft → Jo approves:** the approved picture says "Once it's all done, we'll send your completion pack: warranties and every signed form in one place." — that no longer fits (warranties now come in this email) and the contacts block has no approved wording. Draft: `"Attached: your tax invoice, the rebate form to read before you sign, your product warranty and the manufacturer's instructions (PDFs). Once it's all done, we'll send your signed forms."` + a "Your contacts" box. Show Jo before `ALL_DONE_V2_APPROVED` flips.
- [ ] **Step 3: Run** — expect FAIL.
- [ ] **Step 4: Implement**; a missing instructions file sends anyway and logs `product_instructions_missing` (office row), like a missing warranty.
- [ ] **Step 5: Run** `bun test tests/all-done-email-v2.test.ts tests/completion-pack-retry.test.ts` — expect PASS.
- [ ] **Step 6: Commit** `feat(completion): one All done email with invoice, rebate form, warranty, instructions, contacts and dispute info`.

### Task 10: Unpaid balance still gets every completion document (Review Focus 3)

**Files:**
- Test: `tests/unpaid-balance-completion.test.ts`
- Modify (only if the test finds gaps): `src/lib/completion-pack.server.ts`, `src/lib/veec-copy-email.server.ts`

**Interfaces:**
- Consumes: Task 9 sender, `sendCompletionPack`, `sendVeecCopyEmail`, `recordWarrantyCopyProvided`.

- [ ] **Step 1: Write the failing test** on a fake db: install recorded complete, balance unpaid →
  - `emailOwnerInstallComplete` sends once with warranty + instructions attached and records `warranty_copy_provided` (via `all_done_email`);
  - `sendCompletionPack` returns `{ outcome: "skipped", detail: "invoice not paid in full" }`;
  - owner signs the rebate form (still unpaid) → `sendVeecCopyEmail` sends on the next tick (≤10 business days rule met), regardless of the balance;
  - the same holds with "Do not contact" on (compliance purposes);
  - installer pay for an installer's own customer is still not released (reads Part 10's pay rule; skip the assertion with a `test.todo` naming Part 10 if it hasn't landed).
- [ ] **Step 2: Run** — expect FAIL only where a gap exists; fix minimally.
- [ ] **Step 3: Run** — expect PASS.
- [ ] **Step 4: Commit** `test(completion): unpaid balance still gets warranty, instructions and signed rebate form copy`.

### Task 11: Sign and pay page (`?screen=finish`)

**Files:**
- Create: `src/lib/sign-and-pay.core.ts`, `src/lib/sign-and-pay.server.ts`, `src/components/owner/OwnerSignAndPay.tsx`
- Modify: `src/lib/owner-myjob.core.ts` (`OwnerScreen` adds `"finish"`), `src/routes/my-job.$token.tsx`, `src/lib/owner-link.functions.ts` (`ownerSignAndPayStateFn`, `ownerSignAndPayFn`)
- Test: `tests/sign-and-pay.test.ts`

**Interfaces:**
- Consumes: the existing owner VEEC signing used by `ownerSignVeecAssignmentFn` (Section 4 Part B; acceptance consent is never used as the signature); `createStepCheckout` for `balance`; `bankDetailLines`; Part 1 `veecFormPdf`.
- Produces:
  - `SIGN_AND_PAY = { kicker: "TWO LAST THINGS", title: "Sign your rebate form and pay your balance", step1: "Sign your rebate form", step1Sub: "The government's official form (VEEC assignment). It confirms what was installed and lets us claim the rebate you've already had off your price.", viewForm: "View the full form (PDF) ›", tick: "I've read the form. The details are correct, and I assign the right to create the rebate certificates for this install to Home Insulation Victoria.", nameLabel: "Type your full name to sign", step2: "Pay your balance", dueToday: "due today", card: "Sign and pay by card", bank: "Sign and pay by bank transfer", footer: "Your tax invoice is attached to your email. Once both are done, we'll send your completion pack." }`
  - Summary rows: Installed `{date}`, Product `{product}, {m²} m²`, Address, Rebate (already off your price) `{$}`.
  - `signAndPay(jobId, session, i: { tick: boolean; typedName: string; method: "card" | "bank" }): Promise<{ checkoutUrl } | { bank: string[] } | { done: true }>`.

- [ ] **Step 1: Write the failing test** — constants verbatim; signing needs the tick + typed name; already signed → step 1 shows signed and only payment is asked; already paid → step 2 hidden and the button signs only; both done → `{ done: true }`; signing before the Lead Installer's Part B exists is refused with the existing VEEC order guard.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** (layout per `done-page.png`). Buttons keep the approved labels when both steps are open; with one step done they read `"Pay by card"` / `"Pay by bank transfer"` or `"Sign my rebate form"` (shown to Jo in the sign-off pictures).
- [ ] **Step 4: Run** the test + `bun run portal-qa` (finish screen, 390px) — expect PASS; gaps NOT_RUN.
- [ ] **Step 5: Commit** `feat(my-job): sign the rebate form and pay the balance on one page`.

### Task 12: After-install reminders day 1/3/7, then "Balance overdue" to the office (#53)

**Files:**
- Create: `src/lib/after-install-reminders.core.ts`, `src/lib/after-install-reminders.server.ts`
- Modify: `src/lib/balance-q21.server.ts` (stop day-5/due emails), `src/lib/veec-reminders.server.ts` (stop O61 + `veec_sign_reminder` days 1/3/7; keep day-10 office alert and copy retries), `src/lib/sms.core.ts` (type `after_install_reminder`, owner, quiet hours), `src/lib/office-needs.core.ts` (row `"Balance overdue"`), allocation tick
- Test: `tests/after-install-reminders.test.ts`

**Interfaces:**
- Consumes: install day (Melbourne date of the recorded completion), VEEC owner-signed state, balance paid state.
- Produces: `AFTER_INSTALL_REMINDERS_APPROVED = false as boolean`; `type AfterInstallDay = 1 | 3 | 7`; `afterInstallReminderDue(f: { installDay: string; veecSigned: boolean; balancePaid: boolean; done: AfterInstallDay[]; now: Date }): AfterInstallDay | null`; `afterInstallReminder(f: { day: AfterInstallDay; firstName; balance: string; veecSigned: boolean; balancePaid: boolean; link: string }): { subject; text; html; sms }`; `balanceOverdueForOffice(f): boolean` (after day 7, unpaid); key `after-install:v1:{job}:{day}`.

- [ ] **Step 1: Write the failing test**
  - due on days 1, 3, 7 after install day; nothing when both done; nothing after day 7 (office row instead).
  - only what's undone: both undone, day 1 → contains `"just 2 things left: sign your rebate form and pay your $1,412.00 balance"`; day 3 contains `"(it was due on install day)"`; day 7 contains `"your $1,412.00 balance is now overdue. Please pay today"` and `"If you've already paid, thanks and please ignore this."`; balance paid but form unsigned → no balance words; form signed but unpaid → no rebate-form words.
  - old senders: balance day-5/due and O61/`veec_sign_reminder` no longer send for jobs completed after ship; jobs that already got an old reminder for a day don't get the new one for the same day (in-flight).
- [ ] **Step 2: Draft → Jo approves:** the decisions file gives these phrases, not the full emails/texts or the one-thing-left versions. Draft from `bal.png` (ask the main session for it — not in the handoff folder) and show Jo before the flag flips.
- [ ] **Step 3: Run** — expect FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run** — expect PASS.
- [ ] **Step 6: Commit** `feat(after-install): one reminder on days 1, 3 and 7 for what's still undone, then office follows up`.

### Task 13: Faulty product or work notice (cl 27)

**Files:**
- Create: `src/lib/non-compliance-notice.core.ts`, `src/lib/non-compliance-notice.server.ts`, `src/lib/non-compliance-notice.functions.ts`
- Modify: office job page (button "Tell the owner: something didn't comply")
- Test: `tests/non-compliance-notice.test.ts`

**Interfaces:**
- Produces: `NON_COMPLIANCE_NOTICE_APPROVED = false as boolean`; `nonComplianceNotice(i: { firstName; what: string; fix: string; contact: TradeContact }): { subject; text; html }`; `sendNonComplianceNotice(jobId, actorId, i: { what: string; fix: string }): Promise<string>` (office only, one per office note id, compliance purpose `non_compliance_notice`, already in Part 3 Task 1's list, so Do not contact and Unsubscribe never block it).

- [ ] **Step 1: Draft → Jo approves** the wording (what we found, that any fix will meet the rules, who will contact them). Office process decided (Jo 2 Nov, answer 9): Jo decides and sends it the same day from an office button on the job page — no automatic trigger, no installer-side button.
- [ ] **Step 2: Write the failing test** — text contains `what` and `fix`; office-only (admin; installer and electrician sessions refused); sent only when the office presses the button, once per note; sends with Do not contact on and to an unsubscribed owner (compliance purpose).
- [ ] **Step 3: Run** — expect FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run** — expect PASS.
- [ ] **Step 6: Commit** `feat(office): tell the owner straight away when something didn't comply`.

### Task 14: Remove the old after-acceptance messages and screens

**Files:**
- Modify: `scripts/old-flow-inflight-count.ts` (Part 3) — add `OLD_FLOW_STEPS_P4`
- Remove/retire: `electrician-offer-email.core.ts` (E1) + `piesa_offer`; `piesa-times-reminder.{core,server}.ts` (E14 + text); `safety-check-emails.core.ts` (O26 pick a time, #76 booked email) + `safety_check_booked_owner`; `installer-planning-notice.core.ts` (I71 + `installer_planning_notice`); `fixes-times.core.ts` (`fixes_times_link`); `rectification-quote-email.core.ts` (O29) + `auto-fixes-quote-send.*`; fixes screen (`owner-fixes.core.ts`, `?screen=fixes`); `piesa-fixes-confirm*` (#91–93, P6F); `piesa-owner-confirm` request/reminder emails + `piesa_owner_confirm` texts (O71 — replaced by "You're clear to install" + the clear page; the confirmation record itself stays); P3 separate consent step (`?screen=book` consent) and O33/I65 install-day offering (`install-days-email.core.ts`, `install-clearance.*`, `install_clearance`); `renderFinalInvoiceEmail` (O45); balance day-5/7 emails (`balance-q21`) and separate rebate-form reminders (O61, `veec_sign_reminder`); `owner-myjob.core.ts` booking pick-time copy; `template-hub.core.ts`; retired-terms list
- Test: `tests/old-flow-removed-p4.test.ts`

**Interfaces:**
- Produces: `OLD_FLOW_STEPS_P4` (same shape as Part 3's).

- [ ] **Step 1: Run** `bun scripts/old-flow-inflight-count.ts` (read-only). If any REAL job is at an old step (electrician offer open, owner picking PIESA times, HIV fixes quote open, owner picking install days), STOP and ask Jo before removing that path. Paste the table in the PR.
- [ ] **Step 2: Write the failing test** — template-hub has no entries for the removed messages; their SMS types stay as history with `wordingApproved: false` and label prefix `Retired 2 Nov 2026 —`; no sweep or route calls the removed builders; no owner screen contains "offer you", "pick a time", "3 install days", "fixes", "Change day", "Wrong time"; `?screen=fixes` and `?screen=book` fall through to the job's current single-action screen.
- [ ] **Step 3: Run** — expect FAIL.
- [ ] **Step 4: Implement** removals (keep data readers that history screens still use).
- [ ] **Step 5: Run** `bun run test`, `bun scripts/scan-retired-terms.ts` — expect PASS / clean.
- [ ] **Step 6: Commit** `chore(owner-flow): remove old PIESA offer, fixes quote, pick-a-day and separate reminder messages`.

### Task 15: The access person gets the PIESA and install "You're booked" and day-before texts (Jo 2 Nov, answer 7)

**Files:**
- Create: `src/lib/access-person-texts.core.ts`, `src/lib/access-person-texts.server.ts`
- Modify: `src/lib/in-house-booking.server.ts` (`notifyOwnerBooked`: after the owner notice for `piesa`/`install`, call `textAccessPersonBooked`), `src/lib/approved-texts.server.ts` (the day-before sender also calls `textAccessPersonTomorrow` for PIESA and install visits), `src/lib/sms.core.ts` (types `access_person_booked`, `access_person_tomorrow`: audience owner-side contact, `wordingApproved: false`, quiet hours), `src/lib/template-hub.core.ts`
- Test: `tests/access-person-texts.test.ts`

**Interfaces:**
- Consumes: Part 3 Task 19 `type AccessPerson = { who: "owner" | "tenant" | "property_manager"; name: string; mobile: string }` and `accessPersonFor(jobId): Promise<AccessPerson | null>` (owner's quick-taps answers); Part 3 `ownerBookedNotice` (its `sms`) and `visitTomorrowText`; Task 1 `BookedFacts`.
- Produces: `ACCESS_PERSON_TEXTS_APPROVED = false as boolean`; `accessPersonNeedsTexts(a: AccessPerson | null, ownerMobile: string | null): boolean` (true only when `who` is tenant or property manager and the mobile differs from the owner's); `accessPersonBookedText(f: BookedFacts, a: AccessPerson): string | { held: string }` and `accessPersonTomorrowText(f: { kind: "piesa" | "install"; time: string; business: TradeContact }, a: AccessPerson): string | { held: string }` — DRAFT: the owner's approved texts with the access person's first name (Jo approves the wording as a picture in this part's build); `textAccessPersonBooked(jobId, bookingId): Promise<string>`, `textAccessPersonTomorrow(jobId, bookingId): Promise<string>`; keys `access-booked:v1:{bookingId}:{e164}`, `access-tomorrow:v1:{bookingId}:{e164}`.

- [ ] **Step 1: Write the failing test** — rental, tenant "Tina Lee" `0400 111 222`: PIESA booked → owner gets the owner email + text (unchanged) AND Tina gets one `access_person_booked` text starting `"Home Insulation Victoria: Hi Tina,"` with the day, time and the business office phone; install booked → same; Ready Check booking → nothing to Tina (the owner just answered the quick taps; access starts with the PIESA); day before PIESA/install → one `access_person_tomorrow` text each; owner-occupied (`null`) or `who: "owner"` → nothing extra; access mobile = owner mobile → nothing extra; changed time → a new booking key sends again; flag false → `"awaiting approval"`, nothing sent; TEST job → test-send; a STOP from Tina's number (`sms_optouts`) blocks her texts only; the owner's Do not contact doesn't stop Tina's texts (it is the owner's choice about the owner).
- [ ] **Step 2: Run** `bun test tests/access-person-texts.test.ts` — expect FAIL.
- [ ] **Step 3: Implement**; a missing office phone holds exactly like the owner's text.
- [ ] **Step 4: Run** `bun test tests/access-person-texts.test.ts tests/owner-booked-notice.test.ts tests/visit-tomorrow-office-phone.test.ts` — expect PASS.
- [ ] **Step 5: Commit** `feat(rentals): the person who lets the trades in gets the booked and day-before texts`.

### Task 16: Tenant notice by text and email once the install day is booked (cl 23; Jo 2 Nov, answers 7 and 22)

Jo: the tenant always gets the notice by text + email automatically once the install day is booked, with the date, the time, that the power is off for the day, and the business name + office phone. The owner gives the tenant's name, mobile and email in the quick taps (Part 3 Task 19). Wording to Jo as a picture in this part's build; flag off until then.

**Files:**
- Create: `src/lib/tenant-notice.core.ts`, `src/lib/tenant-notice.server.ts`
- Modify: `src/lib/in-house-booking.server.ts` (after an install booking is confirmed or its time changes → `sendTenantNotice`), `src/lib/sms.core.ts` (type `tenant_notice`, `wordingApproved: false`, quiet hours), `src/lib/template-hub.core.ts`
- Test: `tests/tenant-notice.test.ts`

**Interfaces:**
- Consumes: Part 3 Task 19 `rentalAnswersFor(jobId): Promise<RentalAnswers | null>` (`{ rented: boolean; tenant: TenantContact | null; access: AccessPerson | null }`, `TenantContact = { name; mobile; email }`); Part 3 `TradeContact`.
- Produces:
  - `TENANT_NOTICE_APPROVED = false as boolean`
  - `tenantNoticeNeeded(r: RentalAnswers | null): boolean` — true when the owner answered "rented".
  - `tenantNotice(f: { firstName: string | null; address: string; startIso: string; business: TradeContact }): { sms: string; email: { subject: string; text: string; html: string } } | { held: string }` — DRAFT wording; must contain the date, the time, `"power will be off for the day"`, the business name and office phone (no office phone → held).
  - `sendTenantNotice(jobId: string, bookingId: string): Promise<string>` — text to the tenant's mobile AND email to the tenant's email, always both; keys `tenant-notice:v1:{bookingId}:sms|email`; a new install time = a new notice; compliance send (the owner's Do not contact never blocks it); a rental with tenant details missing (quick taps taken before Part 3 Task 19 shipped, or an own customer who hasn't answered the rental text yet) → `"held: no tenant details"` + one office Needs me row `tenant_notice_held`.

- [ ] **Step 1: Write the failing test** — rented, tenant Tina (`0400 111 222`, `tina@example.com`), property manager lets us in: booking Fri 13 Nov 7:30am → one text AND one email to Tina, each containing `"Fri 13 Nov"`, `"7:30am"`, `"power will be off for the day"`, `"Rapid Insulation"`, `"03 9000 0000"`; time changed → a second notice with the new time; owner lives there → nothing; rented but tenant details missing → held + one Needs me row; flag false → `"awaiting approval"`; TEST → test-send; owner Do not contact on → still sends.
- [ ] **Step 2: Run** `bun test tests/tenant-notice.test.ts` — expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** `feat(rentals): tenant told the install day, time and power-off by text and email`.

### Task 17: In-flight matrix + sign-off

**Files:**
- Create: `tests/new-flow-inflight-p4.test.ts`
- Modify: `docs/HIV_WORKFLOW_SOURCE_OF_TRUTH.md`, `src/config/workflow-decisions.ts` (deposit opens straight after the PIESA result, even with upgrades to come; install booked only after the deposit; consent signed on the clear page and its copy sent at signing; access person and tenant texts at rentals; All done carries warranty + instructions; reminders day 1/3/7 then office)

- [ ] **Step 1: Write the failing test** — for each stage in `["assessment_booking","assessment_booked","piesa_complete","rectification_required","installation_scheduling","installation_booked","installation_complete"]`, seed a job that already got the OLD message for that step (old purpose/key rows), flip every Part 4 `*_APPROVED` flag, run the sweeps, assert no new message for the same step and exactly one for each later step; plus the confirm page in-flight cases from Task 5.
- [ ] **Step 2: Run** — expect FAIL until guards are complete; add any missing "old already sent" check.
- [ ] **Step 3: Run** `bun run test`, `bunx tsc --noEmit`, `bun run portal-qa` — expect green; gaps NOT_RUN.
- [ ] **Step 4: Phone pictures for Jo** — every changed email/text/page at ~430px, wording pasted as text, drafts marked as drafts, one question at a time in boxes. Flags flip one commit each after she says yes.
- [ ] **Step 5: Commit** `test(owner-flow): part 4 in-flight jobs get exactly one version of each message`; push `new-job-flow-part-4`; open PR (body ends with the session attribution); do not merge.

---

## Self-review notes

- Spec coverage (steps 7–11, Part 4 row): PIESA booked (T1), clear to install (T2–T3), upgrades needed (T4), confirm-and-pay page incl. ESC consent move and consent copy at signing (T5), deposit reminders / received / office (T6), install booked (T1), date can't be kept (T8), access person texts (T15), tenant notice (T16), no access (T7), CoES copy before install (T3), All done with contacts, dispute info, warranty + instructions (T9–T10), VEEC copy ≤10 business days (T10), sign-and-pay (T11), reminders + Balance overdue (T12), faulty notice from the office button (T13), removals (T14), in-flight (T17). "See you tomorrow" for PIESA/install is done in Part 3 Task 8. PIESA booked electrician email (#39) is Part 6; GO checks, ESC notice and 30-day/24h gates are Part 9.
- Types: `TradeContact`, `BookedKind`, `BookedFacts`, `ownerBookedNotice`, `doNotContactOn` come from Part 3 under those names.

## Open questions for Jo

None left for this part. Draft wording (upgrades email step 2, "can't go ahead", access-person texts, tenant notice) is approved from pictures at build time, each behind its own flag.

## Decided (Jo, 2 Nov evening)

- **Deposit and booking (answer 21, supersedes 3 and 5):** the confirm-and-pay page opens straight after the PIESA result, including when upgrades are still to come (Tasks 2, 4, 5); the install is booked only after the deposit; no "deposit by 2pm" rule and no booked-before-deposit messages.
- **Rentals (answers 7, 22):** the owner answers in the quick taps (Part 3 Task 19); the access person gets the booked and day-before texts (Task 15); the tenant always gets the notice by text and email (Task 16).
- **Consent copy (answer 10):** sent straight away when the owner signs, on its own (Tasks 5, 6).
- **"Can't do this one" (answer 4):** email the owner at once — "Your visit on {day} can't go ahead. We'll be in touch about a new day." (Task 8; picture to Jo, flag off).
- **"Didn't comply" notice (answer 9):** Jo decides and sends it the same day from an office button on the job page (Task 13).
- **Deposit amount (answer 1):** 10% of the price after the $349.

## Notes for the main session (not for Jo)

- "Signed PIESA copy to installer office" (#41) and "Deposit paid" office email (#45) are here (overview cross-part decision). `bal.png` and `dep-paid-p.png` are referenced by the decisions file but aren't in `/home/claude/handoff/`; Tasks 6 and 12 need them.

## Assumptions

- Part 1 provides: `filledPiesaPdf(jobId, opts: { withPartC?: boolean; ownerConfirmed?: boolean })` (filled DEECA form, 3 fixes), `prefilledEscConsentPdf(jobId)`, `signedEscConsentPdf(consentId)`, `depositReceiptPdf(jobId)`, `taxInvoicePdf(jobId)`, `veecFormPdf(jobId, { forOwnerToRead: true })` and `productInstructionsFor(product)` (Bradford, Pink Batts, Earthwool; ECOWOOL removed) — all returning `EmailAttachment`.
- Part 2 provides balance-on-install-day timing (`balanceDueAt` = install day) and the complaint line constant; Part 4 only changes the messages.
- Part 3 provides `owner-booked-notice.core.ts`, `TradeContact`, the Do-not-contact core/guards and `scripts/old-flow-inflight-count.ts`; Part 3 Task 1's compliance purpose list already holds `non_compliance_notice` (Task 13's send) and lets legal copies through an email Unsubscribe.
- Part 6 provides `electricianBusinessFor(jobId): Promise<TradeContact | null>` and a `coes_uploaded` workflow event when the Certificate of Electrical Safety is uploaded (by electrician link or installer office). Parts 5 and 6 call Task 8's `queueVisitCancelledOwnerEmail` from their "Can't do this one" handlers (Part 4 builds first).
- Part 3 Task 19 provides `AccessPerson`, `accessPersonFor(jobId)` and `rentalAnswersFor(jobId)` (owner's quick-taps answers); `null` = owner lives there or not answered — every rental rule here then falls back to today's behaviour.
- Other homes whose power would be cut by the install (e.g. units on one switchboard) aren't detected — the Ready Check doesn't ask — so no notice goes to them; not built.
- The existing `install_deposit_request` text ("You're clear to install, {first}! Please check your email to pay your deposit…") stays as approved; #40 only changes the email.
- The completion pack (sent once paid in full) keeps its current wording; it no longer carries the warranty for the first time (already recorded at All done).
- In-flight jobs are protected by keeping purposes/keys when rewording and by the count-then-ask step before any removal.
