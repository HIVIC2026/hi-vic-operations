# New job flow — Part 3: owner flow from enquiry to acceptance — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Job flow steps 1–6 for Home Insulation Victoria leads send the approved wording, record contact consent properly (named installer, 3-month re-ask, documents by link, "Do not contact"), and accept quotes with two ticks + a typed name on a 30-day quote — with no job ever getting both an old and a new version of a message.

**Architecture:** Wording stays in pure `*.core.ts` modules (bun tests quote the decisions file verbatim); sends stay in the existing guarded senders (`sendGuardedOwnerEmail`, `sendRealSms`, `sendOfficeEmail`). Where a message is reworded inside the same sender, the purpose and idempotency key are kept, so an in-flight job can only ever get one version. Where a new sender replaces an old one, the new sender checks the old purpose in `customer_email_sends` first. Every new or reworded send ships behind its own `*_APPROVED` constant defaulting `false` (Jo flips it after her phone sign-off); new text types start with their `sms_message_switches` entry off.

**Tech Stack:** TypeScript, TanStack Start, Supabase, bun:test, MJML email kit (`email-kit.core.ts`, `mail-mjml.core.ts`).

**Spec:** `docs/superpowers/specs/2026-11-02-new-job-flow-design.md` (rev 31) + `docs/hiv-touchpoint-decisions.md` (exact wording; latest dated decision wins; the "Decisions from the electrician + SWMS chat" section wins). Overview: `2026-11-02-new-job-flow-00-overview.md`.

## Global Constraints

- Read root `AGENTS.md`, `src/AGENTS.md`, `src/lib/AGENTS.md`, `scripts/AGENTS.md` before any edit; run `bun scripts/scan-retired-terms.ts` before workflow work. `docs/HIV_WORKFLOW_SOURCE_OF_TRUTH.md` + `src/config/workflow-decisions.ts` change in the same commit as any rule they state.
- Always "Home Insulation Victoria" in full on owner/trade screens and messages, never "HIV". Owners see "electrical safety check (PIESA)", "rebate" (never "VEU rebate"/"VEU discount"), "electrical upgrades" (never "fixes"). Trades see PIESA without explanation.
- Phone numbers shown to owners are always the installer's or electrician's OFFICE phone (`businesses.phone`), never a worker's mobile. No office phone on file → the send is HELD with an office note; never fall back to a worker's number.
- Contact block on "will call" and "You're booked": `{Installer} · {office phone} · {business email}`; "You're booked" adds `Rebate certificates created by Home Insulation Victoria (Accredited Person A003654).`
- Payment timing: $349 at acceptance, 10% deposit after the PIESA is clear, the rest on install day.
- Quotes are valid for 30 days: "Your quote is valid for 30 days, until {date}".
- Nothing new that isn't in the spec or decisions file. Any owner wording the decisions file does not give verbatim is a "draft → Jo approves" step, and its send stays behind an `*_APPROVED = false` flag.
- New SQL only in `docs/pending-migrations/` with a PGlite test; never applied live. No force pushes.
- TEST jobs (`source='qa_test'`) go to test-send. Templates register (`src/lib/template-hub.core.ts`) is updated in the same commit as every wording change.

## Review Focus

1. **Job already past a step when this part ships** → it gets exactly one of old/new for every message in this part (same purpose + key when reworded; new senders check the old purpose first). Task 20 matrix test, one row per existing stage.
2. **"Do not contact" set mid-job** (by the office button, Task 2, or by the owner replying STOP to any text, Task 17) → every automatic owner reminder/message stops, but the compliance sends (`esc_consent_copy` — sent on its own the moment the owner signs, Part 4; `piesa_copy`, `veec_assignment_copy`, `install_complete`, `completion_pack`, `install_deposit_paid` — "Deposit received", which carries the receipt and the confirmed PIESA; `non_compliance_notice`, Part 4 Task 13) still go — also to an owner who clicked Unsubscribe. Task 1 test lists both sets explicitly.
3. **Website lead whose phone consent is older than 3 months when their turn comes** → quick taps asks "Yes, {installer} can call me"; the job is not handed to the installer until they tap. Installer's own customers (consent at Add a job) are never re-asked. Task 5 tests.
4. **Installer with no office phone or no business email** → "will call" / "You're booked" are held with an office note, never sent with a worker's mobile or a blank. Tasks 6 and 7 tests.
5. **Quote sent before the 30-day change ships** → keeps the 14-day date it was sent with (owner was told that date); quotes sent after get 30 days. Task 9 test.

---

### Task 1: "Do not contact" flag stops automatic owner messages, never compliance sends

**Files:**
- Create: `src/lib/do-not-contact.core.ts`
- Modify: `src/lib/owner-email-send.server.ts` (`sendGuardedOwnerEmail`: the Do-not-contact read before the opt-out reads; compliance purposes pass an email Unsubscribe — `customer_email_optouts` / `lead_campaign_responses.opted_out_at` — but never a suppression event such as a bounce), `src/lib/sms.core.ts` (`SmsGateInput`, `smsBlocker`), `src/lib/sms.server.ts` (fill the new gate input)
- Test: `tests/do-not-contact.test.ts`

**Interfaces:**
- Produces:
  - `DO_NOT_CONTACT_SET_EVENT = "owner_do_not_contact_set"`, `DO_NOT_CONTACT_CLEARED_EVENT = "owner_do_not_contact_cleared"` (append-only `workflow_events`; latest wins; no SQL).
  - `COMPLIANCE_OWNER_EMAIL_PURPOSES: readonly string[]` = `["esc_consent_copy","piesa_copy","veec_assignment_copy","install_complete","completion_pack","install_deposit_paid","non_compliance_notice"]` (Part 4 Task 13 sends the last one; listed here so the guard exists before its sender).
  - `unsubscribeBlocks(x: { purpose: string; unsubscribed: boolean; suppressed: boolean }): boolean` — legal copies still go to owners who unsubscribed (overview "Decided from earlier approvals"); a suppression event (bounce/complaint) still blocks everything.
  - `doNotContactOn(events: { event_type: string; created_at: string }[]): boolean`
  - `doNotContactBlocks(x: { channel: "email" | "sms"; purpose: string; on: boolean }): string | null` → `"Owner asked not to be contacted"` or null. SMS is always blocked when on (no text is a compliance send).
  - `SMS_DO_NOT_CONTACT = "Owner asked not to be contacted"`; `SmsGateInput.doNotContact?: boolean` (owner audience only).

- [ ] **Step 1: Write the failing test**

```ts
const ON = [{ event_type: "owner_do_not_contact_set", created_at: "2026-11-10T01:00:00Z" }];
test("latest event wins", () => {
  expect(doNotContactOn(ON)).toBe(true);
  expect(doNotContactOn([...ON, { event_type: "owner_do_not_contact_cleared", created_at: "2026-11-11T01:00:00Z" }])).toBe(false);
});
test("compliance sends still go", () => {
  for (const p of ["esc_consent_copy","piesa_copy","veec_assignment_copy","install_complete","completion_pack","install_deposit_paid","non_compliance_notice"])
    expect(doNotContactBlocks({ channel: "email", purpose: p, on: true })).toBeNull();
});
test("unsubscribed owners still get the legal copies, nothing else", () => {
  expect(unsubscribeBlocks({ purpose: "piesa_copy", unsubscribed: true, suppressed: false })).toBe(false);
  expect(unsubscribeBlocks({ purpose: "quote_reminder", unsubscribed: true, suppressed: false })).toBe(true);
  expect(unsubscribeBlocks({ purpose: "piesa_copy", unsubscribed: false, suppressed: true })).toBe(true);
});
test("every automatic owner message stops", () => {
  for (const p of ["quote_reminder","in_house_booked","in_house_partner_call","spot_released","quote_accepted","estimate_followup_day2","install_deposit_day3","after_install_reminder","install_deposit_request","upgrades_needed"])
    expect(doNotContactBlocks({ channel: "email", purpose: p, on: true })).toBe("Owner asked not to be contacted");
  expect(doNotContactBlocks({ channel: "sms", purpose: "piesa_copy", on: true })).toBe("Owner asked not to be contacted");
});
test("smsBlocker refuses owner texts, not partner texts", () => {
  const base = { to: "0400000000", commsEnabled: true, typeSwitchOn: true, senderConfigured: true, optedOut: false, consent: true, isTestRecord: false, nowIso: "2026-11-10T01:00:00Z" };
  expect(smsBlocker({ ...base, type: "quote_reminder", doNotContact: true })).toBe(SMS_DO_NOT_CONTACT);
  expect(smsBlocker({ ...base, type: "job_offer", doNotContact: true })).toBeNull();
});
test("guarded owner email reads the flag before sending", () => {
  expect(readFileSync("src/lib/owner-email-send.server.ts", "utf8")).toContain("doNotContactBlocks(");
});
```

- [ ] **Step 2: Run** `bun test tests/do-not-contact.test.ts` — expect FAIL (module not found).
- [ ] **Step 3: Implement** the core; in `sendGuardedOwnerEmail` read the job's set/cleared events with the other safeguard reads and return `"blocked — Owner asked not to be contacted"` when `doNotContactBlocks` says so, and replace the single opt-out condition with `unsubscribeBlocks(...)` (suppression and the TEST boundary keep blocking exactly as today); in `sms.server.ts` read the same events for owner-audience types and pass `doNotContact`; in `smsBlocker` check it right after `optedOut`.
- [ ] **Step 4: Run** `bun test tests/do-not-contact.test.ts` and `bun test tests/sms*.test.ts` — expect PASS.
- [ ] **Step 5: Commit** `feat(owner-comms): do-not-contact flag stops automatic owner messages, keeps compliance sends` (add the rule to `HIV_WORKFLOW_SOURCE_OF_TRUTH.md`).

### Task 2: Office can set and clear "Do not contact"

**Files:**
- Create: `src/lib/do-not-contact.server.ts`, `src/lib/do-not-contact.functions.ts`
- Modify: office job page header component that renders the owner block (find via `office-job-page.server.ts` consumer in `src/routes/_authenticated/`), `src/lib/office-job-page.server.ts` (expose `doNotContact: boolean`)
- Test: `tests/do-not-contact.test.ts` (extend)

**Interfaces:**
- Consumes: Task 1 events and `doNotContactOn`.
- Produces: `setDoNotContact(jobId: string, actorId: string, on: boolean, note: string | null): Promise<{ on: boolean }>` (admin only; appends one event; no-op if already in that state); server fn `setDoNotContactFn` (literal `createServerFn(...).middleware([requireSupabaseAuth]).inputValidator(...).handler(...)` chain).

- [ ] **Step 1: Write the failing test** — on a fake db: set → one `owner_do_not_contact_set` event with `details.note`; set again → no second event; clear → `owner_do_not_contact_cleared`; a non-admin actor throws `"Only the office can change this."`.
- [ ] **Step 2: Run** `bun test tests/do-not-contact.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** the server + function; office job page shows a red pill "Do not contact" (with "· owner replied STOP" when the latest set event has `details.source = "sms_stop"`, Task 17) and a toggle button labelled `Do not contact` / `Allow contact again` (office screens only; labels are office-facing, not owner wording).
- [ ] **Step 4: Run** the test + `bunx tsc --noEmit` — expect PASS.
- [ ] **Step 5: Commit** `feat(office): set or clear Do not contact on a job`.

### Task 3: Contact consent names who may call, and is kept as a record

**Files:**
- Create: `src/lib/contact-consent-record.core.ts`
- Modify: `src/lib/enquiry.core.ts` (`planContactConsent` — snapshot fields), `src/lib/quick-taps.server.ts` (pass tap writes a consent row, Task 5)
- Test: `tests/contact-consent-record.test.ts`

**Interfaces:**
- Produces:
  - `type ContactConsentSnapshot = { who: string[]; purpose: string; methods: ("phone" | "visit")[]; expiresAt: string; wording: string }` stored in `owner_contact_consents.snapshot` (no SQL — the column exists).
  - `contactConsentSnapshot(i: { who: string[]; givenAt: string; wording: string }): ContactConsentSnapshot` — `purpose` = `"to book and carry out ceiling insulation under the Victorian Energy Upgrades program"`, `methods` = `["phone","visit"]`, `expiresAt` = givenAt + 3 calendar months (Melbourne date).
  - `PHONE_CONSENT_MONTHS = 3`; `phoneConsentCurrent(consentedAt: string | null, nowIso: string): boolean`.
  - `WEBSITE_CONSENT_WORDING` (Jo 2 Nov, answer 15, verbatim in Step 5) and `WEBSITE_CONSENT_LIVE_FROM_ISO: string | null = null`.
  - `contactConsentRecord(rows: { consented_at: string | null; snapshot: unknown; source: string }[], dnc: { event_type: string; created_at: string }[]): { owner…; who: string[]; purpose: string; methods: string[]; expiresAt: string | null; withdrawnAt: string | null } | null` — withdrawal date = the latest `owner_do_not_contact_set` (Task 1).
  - Consumed by Part 5 (Add a job tick naming the installer): `contactConsentSnapshot({ who: ["Home Insulation Victoria", installerName], ... })`.

- [ ] **Step 1: Write the failing test**

```ts
const s = contactConsentSnapshot({ who: ["Home Insulation Victoria", "Rapid Insulation"], givenAt: "2026-11-02T01:00:00Z", wording: "x" });
expect(s.methods).toEqual(["phone", "visit"]);
expect(s.expiresAt.slice(0, 10)).toBe("2027-02-02");
expect(phoneConsentCurrent("2026-08-01T00:00:00Z", "2026-11-02T00:00:00Z")).toBe(false);
expect(phoneConsentCurrent("2026-08-03T00:00:00Z", "2026-11-02T00:00:00Z")).toBe(true);
expect(contactConsentRecord([{ consented_at: "2026-11-02T01:00:00Z", snapshot: s, source: "website" }],
  [{ event_type: "owner_do_not_contact_set", created_at: "2026-11-20T00:00:00Z" }])?.withdrawnAt).toBe("2026-11-20T00:00:00Z");
```
  Plus: a row with an old snapshot (no `who`) → record with `who: ["Home Insulation Victoria"]` and `expiresAt` from `consented_at` (old rows stay readable).
- [ ] **Step 2: Run** `bun test tests/contact-consent-record.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** the core; `planContactConsent` adds `contactConsentSnapshot({ who: ["Home Insulation Victoria"], ... })` to the website consent snapshot (website leads don't have an installer yet; the installer is named at the Task 5 tap).
- [ ] **Step 4: Run** the test + `bun test tests/s1-consent-response.test.ts tests/mitti-contact-consent.test.ts` — expect PASS.
- [ ] **Step 5: Website consent line (Jo 2 Nov, answer 15 — approved):** export `WEBSITE_CONSENT_WORDING = "I agree to Home Insulation Victoria and the EEC-certified installer it picks for me contacting me about my ceiling insulation."` from `contact-consent-record.core.ts` and test it verbatim. Tom changes the homeowner form on homeinsulationvictoria.com.au — that is outside this repo, so it is a checklist item (Part 11 Task 3 go-live list: "Website consent line changed by Tom"), not a code task here. The website snapshot stores the wording the form actually sent when the form sends it; if it doesn't, `planContactConsent` stores `WEBSITE_CONSENT_WORDING` only for consents given after `WEBSITE_CONSENT_LIVE_FROM_ISO` (constant, `null` until Tom confirms the change is live; set in its own commit), older consents keep their stored wording. Test: consent at/after the cut-off → snapshot wording equals the constant; before it (or cut-off `null`) → unchanged.
- [ ] **Step 6: Commit** `feat(consent): contact consent record names who may call, for what, how and until when`.

### Task 4: "It's your turn" email + text open quick taps (one release message)

**Files:**
- Modify: `src/lib/spot-release.core.ts` (`WHAT_HAPPENS_NEXT`, `CONFIRM_BUTTON`, `spotReleasedText`), `src/lib/spot-release-email.core.ts` (`renderSpotReleasedEmail`), `src/lib/area-batch.server.ts` (`sendBatch`/`textOwner`: send the O77 email + `spot_released` text with the quick taps link; stop sending `quickTapsText`), `src/lib/area-batch.core.ts` (mark `quickTapsText`/`quickTapsReminderText` retired), `src/lib/sms.core.ts`, `src/lib/template-hub.core.ts`, `docs/templates/mjml/owner_O77.mjml`
- Test: `tests/spot-release.core.test.ts`, `tests/a48-b2-quick-taps.test.ts` (update)

**Interfaces:**
- Produces: `IT_IS_YOUR_TURN_V2_APPROVED = false as boolean` (in `spot-release.core.ts`); `renderSpotReleasedEmail(i: SpotReleasedEmailInput)` unchanged signature, `confirmUrl` now `quickTapsLink(myJobLink)`; `spotReleasedText(firstName: string | null, link: string, reminder?: boolean): string` (gains `firstName`).
- Consumes: `quickTapsLink` (area-batch.core).

- [ ] **Step 1: Write the failing tests** (verbatim, decisions #21/#22):

```ts
const e = renderSpotReleasedEmail({ firstName: "Sarah", confirmUrl: "https://x/my-job/t?screen=taps", unsubscribeUrl: null, reminder: false });
expect(e.text).toContain("Answer a few quick questions so we can book your free Ready Check. Just tap, it takes under a minute.");
expect(e.text).toContain("Confirm my details: https://x/my-job/t?screen=taps");
expect(e.text).toContain("1. Tap Confirm my details and answer a few quick questions.");
expect(e.text).toContain("2. An EEC-certified installer will call you to book your free Ready Check.");
expect(e.text).toContain("3. They'll measure up and confirm your quote.");
expect(e.text).not.toMatch(/3 times|text and email you/);
expect(spotReleasedText("Sarah", "L")).toBe("Home Insulation Victoria: Hi Sarah, it's your turn! Confirm a few quick details for your free Ready Check: L");
expect(spotReleasedText("Sarah", "L", true)).toBe("Home Insulation Victoria: Hi Sarah, just checking — it's your turn! Confirm a few quick details for your free Ready Check: L");
```
  Plus: `sendBatch` on a fake db sends ONE owner email (purpose `spot_released`, key `spot-release:v1:{job}:{batch}:released`) and ONE `spot_released` text per home, and no `quick_taps` text; with `IT_IS_YOUR_TURN_V2_APPROVED=false` a real job gets nothing and the batch result says `"It's your turn wording not switched on yet"`; TEST jobs go to test-send. Day-2 reminder sweep sends the reminder version once.
- [ ] **Step 2: Run** `bun test tests/spot-release.core.test.ts tests/a48-b2-quick-taps.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** the wording and the area-batch send (email via `sendGuardedOwnerEmail`, text via `sendRealSms` type `spot_released`); keep the existing quick taps claim per job + batch so a home already texted under the old `quick_taps` key is not sent the new one (in-flight).
- [ ] **Step 4: Run** the tests — expect PASS.
- [ ] **Step 5: Commit** `feat(release): one It's your turn email + text opens quick taps`.

### Task 5: 3-month phone consent re-ask in quick taps; release only after the tap

**Files:**
- Modify: `src/lib/quick-taps.core.ts` (go-question label), `src/lib/quick-taps.server.ts` (`viewOf` gets `consentCurrent`; pass writes a consent row naming the installer), `src/lib/in-house-batch.server.ts` (hand-off reads the new consent), `src/routes/my-job.$token.tsx` (taps screen label)
- Test: `tests/a48-b2-quick-taps.test.ts`

**Interfaces:**
- Consumes: `phoneConsentCurrent`, `contactConsentSnapshot` (Task 3); batch `installer_name` (existing).
- Produces: `quickTapsGoLabel(i: { installer: string | null; consentCurrent: boolean }): string`; `QUICK_TAPS_RECONSENT_SOURCE = "quick_taps_reconsent"`.

- [ ] **Step 1: Write the failing tests**
  - `quickTapsGoLabel({ installer: "Rapid Insulation", consentCurrent: false })` → `"Yes, Rapid Insulation can call me"` (Jo 2 Nov, verbatim).
  - `consentCurrent: true` → the existing approved go label (unchanged string from `QUICK_TAPS_COPY`).
  - A website lead whose latest granted consent is 4 months old: before the tap, `sendInHouseBatch`/hand-off refuses the job (`"Waiting for the owner to say the installer can call"`); after the pass tap, one `owner_contact_consents` row with `source: "quick_taps_reconsent"`, `snapshot.who` = `["Home Insulation Victoria","Rapid Insulation"]`, and the job hands off.
  - An installer's own customer (`source='installer'`) with a 4-month-old consent is never re-asked and hands off (decision: own customers consent at Add a job).
- [ ] **Step 2: Run** `bun test tests/a48-b2-quick-taps.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** — the pass tap always records the consent row naming the batch installer (so the named installer is on record for every website lead); the re-ask label shows only when consent is not current.
- [ ] **Step 4: Run** the test — expect PASS.
- [ ] **Step 5: Commit** `feat(quick-taps): ask again after 3 months and name the installer who will call`.

### Task 6: "{Installer} will call you" email + text (#23), replacing the draft DB template

**Files:**
- Create: `src/lib/owner-will-call.core.ts`
- Modify: `src/lib/in-house-batch-email.server.ts` (`sendInHousePartnerCall`, `sweepInHousePartnerCalls`: build from the core, not `customer_communication_templates`), `src/lib/sms.core.ts` (new type `owner_will_call`, `wordingApproved: true`, `quietHours: true`), `src/lib/template-hub.core.ts`
- Test: `tests/owner-will-call.test.ts`

**Interfaces:**
- Consumes: Part 2's contact block (see Assumptions) — `contactBlockLine(c: TradeContact): string`.
- Produces: `type TradeContact = { name: string; officePhone: string | null; email: string | null }` (exported here if Part 2 has not landed it); `OWNER_WILL_CALL_APPROVED = false as boolean`; `ownerWillCallEmail(i: { firstName: string | null; installer: TradeContact; unsubscribeUrl: string | null; test?: boolean }): { subject; html; text } | { held: string }`; `ownerWillCallText(firstName: string | null, installer: TradeContact): string | { held: string }`. Purpose stays `in_house_partner_call`, key stays `in-house-partner-call:v1:{job}` (one version per job).

- [ ] **Step 1: Write the failing test**

```ts
const rapid = { name: "Rapid Insulation", officePhone: "03 9000 0000", email: "office@rapid.example" };
const m = ownerWillCallEmail({ firstName: "Sarah", installer: rapid, unsubscribeUrl: null }) as { subject: string; text: string };
expect(m.subject).toBe("Rapid Insulation will call you");
expect(m.text).toContain("Hi Sarah,");
expect(m.text).toContain("Rapid Insulation is the EEC-certified installer for your home. They'll call you soon from 03 9000 0000 to book your free Ready Check.");
expect(m.text).toContain("At the Ready Check they'll measure up and confirm your quote. It's free, with no obligation.");
expect(m.text).toContain("Rapid Insulation · 03 9000 0000 · office@rapid.example");
expect(ownerWillCallText("Sarah", rapid)).toBe("Home Insulation Victoria: Hi Sarah, Rapid Insulation will call you soon from 03 9000 0000 to book your free Ready Check.");
expect(ownerWillCallEmail({ firstName: "Sarah", installer: { ...rapid, officePhone: null }, unsubscribeUrl: null })).toEqual({ held: "No office phone for Rapid Insulation" });
expect(ownerWillCallEmail({ firstName: "Sarah", installer: { ...rapid, email: null }, unsubscribeUrl: null })).toEqual({ held: "No business email for Rapid Insulation" });
```
  Server (fake db): no back-send — a pending job whose stage is past `ready_check_booking` or that already has a confirmed Ready Check booking gets nothing (`"not applicable"`); `OWNER_WILL_CALL_APPROVED=false` → `"awaiting approval"` and nothing recorded; a job with a prior `in_house_partner_call` send gets nothing.
- [ ] **Step 2: Run** `bun test tests/owner-will-call.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** core + sender (email + `owner_will_call` text, both after `assertCustomerDeliveryAllowed`); held results record one `owner_will_call_held` office event with the reason. Leave the DB template row untouched (stays draft, unread).
- [ ] **Step 4: Run** the test — expect PASS.
- [ ] **Step 5: Commit** `feat(release): approved "{Installer} will call you" email + text with office phone`.

### Task 7: Ready Check "You're booked" email + text (#24 + Fix 5)

**Files:**
- Create: `src/lib/owner-booked-notice.core.ts`
- Modify: `src/lib/in-house-booking.core.ts` (`bookingNotice` → delegates `ready_check` to the new core; `piesa`/`install` untouched here — Part 4), `src/lib/in-house-booking.server.ts` (`notifyOwnerBooked`: pass first name, business email; held when contact missing), `src/lib/template-hub.core.ts`
- Test: `tests/owner-booked-notice.test.ts`

**Interfaces:**
- Produces (Part 4 extends with `piesa` and `install`):
  - `type BookedKind = "ready_check" | "piesa" | "install"`
  - `type BookedFacts = { kind: BookedKind; firstName: string | null; startIso: string; whoName: string; business: TradeContact; changed: boolean }`
  - `ownerBookedNotice(f: BookedFacts): { subject: string; text: string; html: string; sms: string } | { held: string }`
  - `OWNER_BOOKED_V2_APPROVED: Record<BookedKind, boolean>` all `false`.
  - Key/purpose unchanged (`in-house-booked:v1:{booking}:{worker}`, `in_house_booked`).

- [ ] **Step 1: Write the failing test**

```ts
const f = { kind: "ready_check", firstName: "Sarah", startIso: "2026-11-03T22:00:00Z", whoName: "John Smith", business: rapid, changed: false } as const;
const n = ownerBookedNotice(f) as { text: string; sms: string };
expect(n.text).toContain("You're booked for your free Ready Check");
expect(n.text).toContain("Day: Tuesday 4 November");
expect(n.text).toContain("Arriving: 9:00am");
expect(n.text).toContain("Who's coming: John Smith, Rapid Insulation");
expect(n.text).toContain("They'll measure up and confirm your quote. It's free, with no obligation.");
expect(n.text).toContain("Need to change it? Call Rapid Insulation on 03 9000 0000.");
expect(n.text).toContain("Rapid Insulation · 03 9000 0000 · office@rapid.example");
expect(n.text).toContain("Rebate certificates created by Home Insulation Victoria (Accredited Person A003654).");
expect(n.text).not.toMatch(/Wrong time|Change time|job page/);
expect(n.sms).toBe("Home Insulation Victoria: Hi Sarah, you're booked for your free Ready Check: Tue 4 Nov, 9:00am. John Smith from Rapid Insulation is coming. Need to change it? Call Rapid Insulation on 03 9000 0000.");
expect(ownerBookedNotice({ ...f, business: { ...rapid, officePhone: null } })).toEqual({ held: "No office phone for Rapid Insulation" });
```
  Plus `changed: true` → heading starts `"Your time has changed"` (decision: Change time sends a new "You're booked" with "Your time has changed").
- [ ] **Step 2: Run** `bun test tests/owner-booked-notice.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** the core (MJML layout per `booked-both2.png`: heading, Day/Arriving/Who's coming table, lines, contact block); `notifyOwnerBooked` uses it for `ready_check` when `OWNER_BOOKED_V2_APPROVED.ready_check`, else the current `bookingNotice` (same key either way).
- [ ] **Step 4: Run** the test + `bun test tests/in-house-booking*.test.ts` — expect PASS.
- [ ] **Step 5: Commit** `feat(booking): approved Ready Check "You're booked" email + text`.

### Task 8: "See you tomorrow" texts use the business office phone (#25)

**Files:**
- Modify: `src/lib/approved-texts.core.ts` (visit-tomorrow builder), `src/lib/approved-texts.server.ts` (pass business name + office phone, never the worker's)
- Test: `tests/visit-tomorrow-office-phone.test.ts`

**Interfaces:**
- Produces: `visitTomorrowText(i: { kind: BookedKind; time: string; business: TradeContact }): string | { held: string }` (all three visits — Part 4 does not touch this).

- [ ] **Step 1: Write the failing test** — `ready_check` → `"Home Insulation Victoria: See you tomorrow at 9:00am for your free Ready Check (Rapid Insulation, 03 9000 0000)."`; `piesa` → `"…for your electrical safety check (PIESA) (Viking Electrical, 03 9111 1111)."`; `install` keeps "Reminder: power will be off while they work in the ceiling." with the office phone; no office phone → `{ held }`; source check: the server no longer reads `workers.phone` / `who.phone` for this text.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** `fix(texts): see-you-tomorrow texts use the business office phone`.

### Task 9: Quotes valid 30 days; reminders day 3 and 2 days before; expiry at day 30

**Files:**
- Modify: `src/lib/quote-expiry.core.ts`, `src/lib/quote-expiry.server.ts` (column for the expiry reminder stays `nudge_day10_at`), `src/lib/owner-quote-email.core.ts` (`renderQuoteReminderEmail`, validity line), `src/lib/quote-expired-email.core.ts` (no wording change), `docs/HIV_WORKFLOW_SOURCE_OF_TRUTH.md`, `src/config/workflow-decisions.ts`
- Test: `tests/quote-expiry.test.ts`

**Interfaces:**
- Produces: `QUOTE_VALID_DAYS = 30`; `QUOTE_30_DAY_FROM_ISO: string` (set to the release commit's UTC time in the release step); `quoteValidDaysFor(sentAt: string): 14 | 30`; `quoteExpiresAt(sentAt)` uses it; `QuoteTimerAction = "expire" | "nudge_expiry" | "nudge_day3" | null`; `quoteValidLine(validUntil: Date): string`; `QUOTE_EXPIRED_CANCEL_REASON = "Quote expired (30 days)"` for new quotes (old reason string kept recognised by "Send me a new quote").

- [ ] **Step 1: Write the failing test**
  - Sent 2026-11-10 (after cutover) → last valid day 10 Dec 2026, `quoteValidLine` = `"Your quote is valid for 30 days, until 10 December 2026."`.
  - Day 3 → `nudge_day3`; 2 days before expiry → `nudge_expiry`; day 30 end → `expire`.
  - Sent before `QUOTE_30_DAY_FROM_ISO` → 14-day expiry unchanged (Review Focus 5), expiry reminder still 2 days before its own expiry.
  - Reminder emails: `"Your VEU rebate"` never appears; contains `"Your rebate"`; expiry kind contains the valid line. Reminder texts (`quote_reminder`) unchanged (decision #32 "approved as is").
- [ ] **Step 2: Run** `bun test tests/quote-expiry.test.ts tests/quote-expiry-db.test.ts` — expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** `feat(quotes): 30-day quotes, reminders day 3 and 2 days before expiry`.

### Task 10: "Your quote is ready" email (#29): rebate wording, upgrades line, What's changed box, 30-day line, 3 PDFs

**Files:**
- Create: `src/lib/quote-changes.core.ts`
- Modify: `src/lib/owner-quote-email.core.ts` (`renderOwnerQuoteEmail`, `NOT_INCLUDED`, next line, rebate labels), `src/lib/quote-ready-notify.server.ts` (estimate facts + attachments), `src/lib/template-hub.core.ts`, `docs/templates/mjml/owner_O18.mjml` (if present)
- Test: `tests/owner-quote-email-v4.test.ts`

**Interfaces:**
- Consumes: Part 1's `customerAgreementPdf()`, `paymentTermsPdf()` and `statementOfRightsPdf()` (see Assumptions) as `EmailAttachment`.
- Produces:
  - `type EstimateVsQuote = { estimate: { areaM2: number | null; removal: boolean | null; price: number | null }; quote: { areaM2: number; removal: boolean; price: number } }`
  - `quoteChangeRows(x: EstimateVsQuote): { label: "Ceiling size" | "Old insulation removal" | "Your price"; estimate: string; quote: string }[]` — only changed rows; empty when nothing changed or no estimate.
  - `QUOTE_CHANGES_FOOTNOTE = "Your quote uses what the installer measured at your Ready Check."`
  - `OWNER_QUOTE_EMAIL_V4_APPROVED = false as boolean`; version `"v4-approved-2026-11-02"`.

- [ ] **Step 1: Write the failing test**

```ts
expect(quoteChangeRows({ estimate: { areaM2: 100, removal: false, price: 1630 }, quote: { areaM2: 120, removal: false, price: 1918 } }))
  .toEqual([{ label: "Ceiling size", estimate: "100 m²", quote: "120 m²" }, { label: "Your price", estimate: "$1,630", quote: "$1,918" }]);
expect(quoteChangeRows({ estimate: { areaM2: 120, removal: false, price: 1918 }, quote: { areaM2: 120, removal: false, price: 1918 } })).toEqual([]);
const m = renderOwnerQuoteEmail({ ...sample, changes: [...], validUntil: new Date("2026-12-10T12:00:00+11:00") });
expect(m.text).toContain("What's changed from your estimate");
expect(m.text).toContain("Your quote uses what the installer measured at your Ready Check.");
expect(m.text).toContain("Not included: electrical upgrades, only if the electrical safety check (PIESA) finds any. Your electrician quotes these directly, and nothing is done without your OK.");
expect(m.text).toContain("Your quote is valid for 30 days, until 10 December 2026.");
expect(m.text).not.toMatch(/VEU rebate|electrical fixes|held until/);
expect(m.text).toMatch(/electrical safety check \(PIESA\)/);
```
  Plus: no changes → no "What's changed" heading; server attaches exactly 3 PDFs named Customer Agreement, Payment terms, Statement of rights; any of them missing → quote email held (`"Quote documents not ready"`), never sent without them.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement**; estimate side from the saved estimate (`saved_area_m2`, `saved_total`, and the removal answer if recorded) as `ready-check-booked-email.server.ts` reads it. Same purpose + key as today.
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** `feat(quote-email): approved quote email with What's changed box and 3 documents`.

### Task 11: Quote page — two ticks, typed name, timing line, locked button

**Files:**
- Modify: `src/lib/owner-pages.core.ts` (`P2`), `src/lib/owner-quote-sign.core.ts` (`quoteSittingBlockers`), `src/routes/my-job.$token.tsx` (quote screen), `src/lib/owner-link.functions.ts` (`ownerAcceptQuoteFn` input)
- Test: `tests/owner-pages.core.test.ts`, `tests/quote-page-v2.test.ts`

**Interfaces:**
- Consumes: `quoteChangeRows`, `QUOTE_CHANGES_FOOTNOTE`, `quoteValidLine` (Tasks 9–10).
- Produces:
  - `P2.tick1`, `P2.tick2`, `P2.howYouPay`, `P2.timing`, `P2.signLabel`, `P2.button(safetyCheck)`, `P2.lockHint` (values below).
  - `quoteSittingBlockers(i: { tick1: boolean; tick2: boolean; typedName: string }): string[]`.
  - `ownerAcceptQuoteFn` input `signing: { authorityType; tick1: boolean; tick2: boolean; typedName: string; assistance }` (ESC `declarations` removed — they move to the confirm-and-pay page, Part 4).

- [ ] **Step 1: Write the failing test** (verbatim — touchpoint #33 + Fix 3 + lawyer Q8 + cl 20 + 2 Nov payment timing):

```ts
expect(P2.tick1).toBe("I accept this quote, the Customer Agreement and the payment terms, and I've been given my Statement of rights under the VEU program. I'm 18 or over, I own this home (or I'm allowed to sign for the owner), and I'm happy to get my documents by email.");
expect(P2.tick2).toBe("I understand my install must be done within 30 days of my electrical safety check (PIESA), as the rebate rules require.");
expect(P2.howYouPay).toBe("How you pay: $349 now for the electrical safety check (PIESA). 10% to book your install day. The rest on install day. Card or bank transfer, no fees.");
expect(P2.timing).toBe("Your install will be done within 30 days of your electrical safety check (PIESA). Your installer will confirm the day with you. Most installs are finished on the day they start.");
expect(P2.button("$349")).toBe("Accept and pay $349");
expect(quoteSittingBlockers({ tick1: true, tick2: false, typedName: "Sarah Brown" })).not.toEqual([]);
expect(quoteSittingBlockers({ tick1: true, tick2: true, typedName: "  " })).not.toEqual([]);
expect(quoteSittingBlockers({ tick1: true, tick2: true, typedName: "Sarah Brown" })).toEqual([]);
expect(JSON.stringify(P2)).not.toMatch(/VEU rebate|electrical fixes|7 days after|I assign my VEECs/);
```
  Plus route source checks: the quote screen renders links `Read the agreement (PDF) ›`, `Payment terms (PDF) ›`, `Statement of rights (PDF) ›`, the "(attached to your quote email)" note on tick 1, the What's changed box only when rows exist, the valid line, and the button is `disabled` until both ticks and a non-blank typed name.
- [ ] **Step 2: Run** `bun test tests/owner-pages.core.test.ts tests/quote-page-v2.test.ts` — expect FAIL.
- [ ] **Step 3: Implement**; remove `P2.tick2Sub`, `tick3`, `typeAgain`, `twoThings` old copy ("Two ticks, then accept" heading per `quotepage.png`). If Part 2 has landed a shared pay-line constant, use it and keep this test's string.
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** `feat(quote-page): two ticks, typed name and 30-day line before Accept and pay`.

### Task 12: Accepting records the typed name, Chris Lowe's counter-signature and documents-by-email consent; ESC consent no longer signed here

**Files:**
- Modify: `src/lib/owner-link.functions.ts` (`ownerAcceptQuoteFn.signQuoteSitting`), `src/lib/owner-gates.server.ts` (`signGateDoc` callers), `src/lib/assignment.server.ts` (`buildAcceptancePackage` reads the counter-signature)
- Create: `src/lib/acceptance-signature.core.ts`
- Delete use of: `prepareQuoteConsent` / `signOwnerConsent` from the acceptance path (they move to Part 4's confirm-and-pay page)
- Test: `tests/acceptance-signature.test.ts`, `tests/owner-quote-acceptance-b3.test.ts` (update)

**Interfaces:**
- Produces:
  - `AP_COUNTERSIGNER = { name: "Chris Lowe", role: "Director", phone: "0416 252 406", email: "info@homeinsulationvictoria.com.au" } as const`
  - `ACCEPTANCE_COUNTERSIGNED_EVENT = "acceptance_countersigned"`; details `{ quote_id, version, owner_typed_name, signed_at, countersigner: AP_COUNTERSIGNER, at }` with `at === signed_at` (same moment = fully executed).
  - `DOCUMENTS_BY_EMAIL_CONSENT_EVENT = "owner_documents_by_email_consent"` (cl 7), details `{ wording: P2.tick1, at }`.
  - `acceptanceSignatureRecord(i: { quoteId: string; version: number; typedName: string; signedAt: string }): { countersigned: …; documentsConsent: … }` (pure).
  - Consumed by Part 1's signed acceptance PDF builder (typed names of owner AND Chris Lowe, date/time).

- [ ] **Step 1: Write the failing test** — record has `countersigner.name === "Chris Lowe"`, `role === "Director"`, `at === signedAt`, `owner_typed_name === "Sarah Brown"` (trimmed, inner spaces collapsed); `signGateDoc` for `quote_acceptance` and `payment_terms` is called with `signatoryName: "Sarah Brown"` (the typed name, not the name on file); source check: `signQuoteSitting` no longer calls `signOwnerConsent` or `prepareQuoteConsent`; a second accept of the same quote version writes no second countersigned event.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** — write both events in the same `signQuoteSitting` call, after the gate signatures, keyed by quote id + version.
- [ ] **Step 4: Run** `bun test tests/acceptance-signature.test.ts tests/owner-quote-acceptance-b3.test.ts tests/signed-acceptance-pdf-b4.test.ts` — expect PASS.
- [ ] **Step 5: Commit** `feat(acceptance): typed-name signature, automatic Chris Lowe counter-signature, documents-by-email consent`.

### Task 13: "Owner accepted" office email (#36)

**Files:**
- Modify: `src/lib/installer-accepted-email.core.ts` (`renderInstallerAcceptedEmail`), its caller in `src/lib/payments.server.ts`, `src/lib/template-hub.core.ts`, `docs/templates/mjml/installer_I23.mjml`
- Test: `tests/installer-accepted-email.test.ts`

**Interfaces:**
- Consumes: Part 5's who-books setting `whoBooksPiesa(businessId): Promise<"office" | "electrician" | "either">` and the job's chosen electrician name (see Assumptions).
- Produces: `InstallerAcceptedInput` gains `whoBooks: "office" | "electrician" | "either"; electricianName: string | null`; `INSTALLER_ACCEPTED_V2_APPROVED = false as boolean`.

- [ ] **Step 1: Write the failing test** (decision #36, owner "Sarah"):
  - preview `"Book the PIESA now."`; lead contains `"has paid the $349 for the PIESA."`
  - office books: step 1 `"Book the PIESA: Pick your electrician on the job, call Sarah, then add the day and time in the portal within 2 business days."`
  - electrician books: step 1 `"Book the PIESA: Viking Electrical will call Sarah to book it."`
  - step 2 `"Electrical upgrades, if needed: Quote, book and invoice them with Sarah directly. Upload the Part C and Certificate of Electrical Safety before the install."`
  - step 3 `"Book the install: Call Sarah and add the install day and Lead Installer in the portal. Sarah pays her 10% deposit to lock it in. Install within 30 days of the PIESA."`
  - no `$` other than `$349`; no "offers", "3 install days", "Nothing for you to do".
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** (same office email key as today; old wording used while the flag is false). Steps 2–3 say "her" as approved; the sign-off paste (Task 20 Step 5) shows Jo the line with the owner's name instead ("Sarah pays …") as a wording choice at build time — no code waits on it.
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** `feat(installer-email): approved Owner accepted email — book the PIESA now`.

### Task 14: "Nearly there" Ready Check chase becomes an office email (#27)

**Files:**
- Modify: `src/lib/ready-check-chase.core.ts` (wording), its sender (where `ready_check_incomplete` SMS is sent) → `sendOfficeEmail`, `src/lib/sms.core.ts` (`ready_check_incomplete` stays for history, no new sends)
- Test: `tests/ready-check-chase-email.test.ts`

**Interfaces:**
- Produces: `readyCheckNearlyThereEmail(i: { jobNumber: string; address: string; missing: string[]; mittiFormUrl: string }): { subject: string; text: string; html: string }`; `READY_CHECK_CHASE_EMAIL_APPROVED = false as boolean`.

- [ ] **Step 1: Write the failing test** — subject `"HV-1234 Ready Check: nearly there"`; text has `"12 Example St, Box Hill still needs:"`, one `• {item}` line per missing item, `"Add them in Mitti and we'll prepare the owner's quote."`, button `"Open the Mitti form"` → the job's own Mitti form URL; the sender sends no text any more.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** (one email per job + chase revision, same claim as the old text, so a job already texted is not emailed for the same revision).
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** `feat(ready-check): nearly-there chase goes to the installer office by email`.

### Task 15: Enquiry/spot-saved touchpoint changes (#1, #12, #13, #19, #20)

Only the touchpoint-specific changes; the global fixes (price label, "Thousands…", PIESA naming, VEU box, removed estimate/calculator/My job home pages) are Part 2's.

**Files:**
- Modify: `src/components/portal/register-interest.tsx` / `src/lib/interest.core.ts` (button → `https://homeinsulationvictoria.com.au/homeowner`, no enquiry created), `src/lib/spot-saved-messages.core.ts` (O10 step 2, spot saved text), `src/lib/spot-only-copy.core.ts` (`PRE_RELEASE_FORBIDDEN` exemption for O10/spot-saved text only), `src/routes/estimate_.$token.campaign.tsx` (one-tap save from the email; Spot saved screen line; cut "and enjoy lower power bills for years to come"), `src/lib/owner-pages.core.ts` (`P1.photos*` removed), `src/routes/estimate_.$token.video.tsx`
- Test: `tests/enquiry-touchpoints-p3.test.ts`

**Interfaces:**
- Produces: `spotSavedText(first: string | null, rebate: string): string`; `O10_NEXT_STEP_2 = { title: "A certified installer will call you", body: "When an EEC-certified installer is available, they'll call you to book your free Ready Check. They'll measure up and confirm your quote." }`; `spotSavedBasedOn(i: { areaM2: number; insulation: string }): string`.

- [ ] **Step 1: Write the failing test** (verbatim):
  - `spotSavedText("Sarah", "$2,380")` === `"Home Insulation Victoria: Spot saved, Sarah! 🎉 Smart move: your $2,380 rebate is waiting. Spots are released in the order they were saved. When an EEC-certified installer is available, they'll call you to book your free Ready Check."` (no link).
  - `spotSavedBasedOn({ areaM2: 120, insulation: "no insulation" })` === `"Based on what you told us: 120 m² ceiling, no insulation."`
  - `PRE_RELEASE_FORBIDDEN` still rejects other pre-release copy but the O10 step 2 and spot saved text pass the spot-only check.
  - Register my interest href is the /homeowner URL and the component calls no enquiry-creating function.
  - The 3-questions page source has no "Got photos or a video? (optional)" box; the "3 quick questions" email and Spot saved screen photo/video asks remain.
  - Email "Save my free spot" link saves in one tap: GET with the email's token lands on the Spot saved screen after the canonical save (no second button).
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `bun test tests/enquiry-touchpoints-p3.test.ts` + existing spot-saved tests — expect PASS.
- [ ] **Step 5: Commit** `feat(enquiry): spot saved wording, one-tap save, installer-will-call next step`.

### Task 16: Remove pre-acceptance messages and screens from the old flow

**Files:**
- Create: `scripts/old-flow-inflight-count.ts` (read-only: counts REAL jobs at each old step; prints a table; never writes)
- Modify/remove: `src/lib/followup-email.ts` + `followups.server.ts` ("Just checking you got your estimate"); `src/lib/paperwork-copy-email.{core,server}.ts` + caller (O75); owner Ready Check times path — `ready-check-times-email.core.ts` (O11), `approved-texts.core.ts` `ready_check_times_owner` + `ready_check_booked_owner`, `ready-check-booked-email.{core,server}.ts` (O12 legacy), `run-portal.core.ts` owner texts (`run_time`, `run_time_reminder`), `src/components/owner/OwnerReadyCheckTimes.tsx`, `src/components/owner/OwnerRunTime.tsx` and their My job screens; `src/lib/template-hub.core.ts`; retired-terms list used by `scripts/scan-retired-terms.ts`
- Test: `tests/old-flow-removed-p3.test.ts`

**Interfaces:**
- Produces: `OLD_FLOW_STEPS_P3: { step: string; stages: string[]; events: string[] }[]` (used by the script and the test).

- [ ] **Step 1: Run** `bun scripts/old-flow-inflight-count.ts` against live (read-only). If ANY real job sits at an old Ready Check step (owner picking times, run window pending), STOP and ask Jo before removing that path (keep it for those jobs or move them by hand). Paste the table in the PR.
- [ ] **Step 2: Write the failing test** — template-hub has no entries for O75, "Just checking", O11, O12, `ready_check_times_owner`, `ready_check_booked_owner`, `run_time`, `run_time_reminder`; `SMS_MESSAGE_TYPES` keeps those keys with `wordingApproved: false` and label prefixed `Retired 2 Nov 2026 —` (history readable, nothing can send); source scan: no owner screen renders "offer you 3 times", "pick a time" or "Wrong time"; no sweep calls `renderFollowupEmail` or the O75 sender.
- [ ] **Step 3: Run** — expect FAIL.
- [ ] **Step 4: Implement** the removals (routes that served removed screens fall through to the job's current single-action screen, as Part 2's removed-page redirects do).
- [ ] **Step 5: Run** `bun run test` + `bun scripts/scan-retired-terms.ts` — expect PASS / clean.
- [ ] **Step 6: Commit** `chore(owner-flow): remove old pre-acceptance messages and pick-a-time screens`.

Trade-side legacy Ready Check messages (#35, #40–43, #47, #50) and "We need your usual electrician" (#28, #54) are removed by Part 7 (Tasks 8 and 9), per the overview's cross-part decisions.

### Task 17: An owner replying STOP turns on "Do not contact" (Jo 2 Nov, answer 8)

Today a STOP reply (`recordInboundReply` in `sms.server.ts`) records `sms_optouts` (texts stop) and closes open enquiries (`closeStoppedEnquiries`), but emails and automatic owner messages on a job past enquiry keep going. Jo: an owner replying STOP to any text turns on Do not contact; legal copies still go.

**Files:**
- Create: `src/lib/do-not-contact-stop.server.ts`
- Modify: `src/lib/sms.server.ts` (`recordInboundReply`, stop branch: call it after the `sms_optouts` upsert, before `closeStoppedEnquiries`)
- Test: `tests/do-not-contact-stop.test.ts` (memory PostgREST helper `tests/helpers/memory-postgrest.ts`)

**Interfaces:**
- Consumes: Task 1 `DO_NOT_CONTACT_SET_EVENT`, `doNotContactOn`; `toAuE164` (`sms.core.ts`).
- Produces: `setDoNotContactFromStop(db: any, phone: string, sid: string | null, now: string): Promise<number>` — for every non-deleted job whose owner mobile matches `phone` (compared with `toAuE164`, paged 200, stage not `cancelled`), appends one `owner_do_not_contact_set` event (`actor_id null`, `details: { source: "sms_stop", provider_message_id: sid, note: "Owner replied STOP" }`) unless Do not contact is already on; returns how many jobs it turned on. A read failure throws (fail closed; the caller already surfaces errors).

- [ ] **Step 1: Write the failing test** — two jobs with the owner's mobile (one at `measured_quote_accepted`, one at `installation_booked`) and one job with another mobile: STOP from `0400 000 000` (as `+61400000000`) → both matching jobs get one set event with `source: "sms_stop"`, the other job none, return value `2`; a second STOP → `0`, no new events; a job already on → untouched; a cancelled job → untouched; after it, `doNotContactBlocks({ channel: "email", purpose: "quote_reminder", on: true })` blocks and `piesa_copy` still goes (Task 1); source check: `recordInboundReply` calls `setDoNotContactFromStop(` inside `if (k === "stop")` before `closeStoppedEnquiries(`; a START reply does not clear Do not contact (only the office does, Task 2).
- [ ] **Step 2: Run** `bun test tests/do-not-contact-stop.test.ts` — expect FAIL (module not found).
- [ ] **Step 3: Implement** as in Interfaces.
- [ ] **Step 4: Run** `bun test tests/do-not-contact-stop.test.ts tests/do-not-contact.test.ts tests/sms*.test.ts` — expect PASS.
- [ ] **Step 5: Commit** `feat(owner-comms): an owner replying STOP turns on Do not contact; legal copies still go`.

### Task 18: Move every installer onto "installer calls and books" (overview cross-part decision)

The new flow is the existing in-house path (`businesses.in_house`), switched per business through the existing admin-checked `saveBusiness` → `save_in_house_partner` RPC (`pilot.functions.ts`; history in `admin_config_events`). This task adds the safety check before each move and one office action; it does not move anyone by itself. Order of moves is Part 11's: INSolation first (real runs), the rest after Jo OKs the real runs.

**Files:**
- Create: `src/lib/new-flow-move.core.ts`, `src/lib/new-flow-move.server.ts`, `src/lib/new-flow-move.functions.ts`
- Modify: `scripts/old-flow-inflight-count.ts` (Task 16; add `--business <id>` to count one installer's jobs), office business page (button "Move to the new flow", office only)
- Test: `tests/new-flow-move.test.ts`

**Interfaces:**
- Consumes: Task 16 `OLD_FLOW_STEPS_P3` (and Part 4's `OLD_FLOW_STEPS_P4` once landed); `readInstallerPaidElectricians(businessId)` (`installer-paid-electricians.server.ts`); the existing `save_in_house_partner` RPC.
- Produces:
  - `newFlowMoveBlockers(f: { inHouse: boolean; officePhone: string | null; email: string | null; electricians: number; piesaRateIncGst: number | null; oldStepJobs: { step: string; count: number }[] }): string[]` — `"Already on the new flow"`; `"No office phone"` / `"No business email"` (the "will call" and "You're booked" messages need both, Tasks 6–7); `"No electrician in Team"`; `"No PIESA rate on the rate card"`; one `"{n} real job(s) still at: {step}"` line per old step with jobs (Jo decides those first — Open question 1).
  - `moveInstallerToNewFlow(businessId: string, actorId: string): Promise<{ moved: true } | { moved: false; blockers: string[] }>` — admin only; reads facts fresh, refuses on any blocker, else calls `save_in_house_partner` with `p_in_house: true` and records `admin_config_events` `new_flow_moved` once.
  - Server fn `moveInstallerToNewFlowFn` (literal `createServerFn(...).middleware([requireSupabaseAuth]).inputValidator(...).handler(...)` chain).

- [ ] **Step 1: Write the failing test** — each blocker on its own; all clear → `[]`; server (mocked admin): clear business → RPC called once with `p_in_house: true`, one `new_flow_moved` event; second call → `{ moved: false, blockers: ["Already on the new flow"] }`, no second RPC; a business with 2 real jobs at the owner pick-a-time step → refused with `"2 real jobs still at: owner picking Ready Check times"`; non-admin → throws `"Only the office can change this."`.
- [ ] **Step 2: Run** `bun test tests/new-flow-move.test.ts` — expect FAIL.
- [ ] **Step 3: Implement**; the office button shows the blockers as a list when refused (never a silent no-op).
- [ ] **Step 4: Run** `bun test tests/new-flow-move.test.ts tests/in-house*.test.ts` — expect PASS.
- [ ] **Step 5: Commit** `feat(office): move an installer onto the new flow, only when nothing old is in flight`.

### Task 19: Rentals — the owner tells us in the quick taps (Jo 2 Nov, answers 7 and 22)

Jo: the OWNER answers in the quick taps after the "It's your turn" text (Task 4) — not the Mitti Ready Check. Installers' own customers (no "It's your turn") get the same rental quick taps by text straight after the installer adds the job (Jo 2 Nov, answer 24) — not on the Add a job form. "Do you live there or is it rented?"; if rented: the tenant's name, mobile and email, and who lets us in (owner / tenant / property manager + name + mobile). Parts 4, 5 and 6 read the answers.

**Files:**
- Create: `src/lib/rental-answers.core.ts`, `src/lib/rental-answers.server.ts`, `src/lib/own-customer-rental-taps.server.ts`
- Modify: `src/lib/quick-taps.core.ts` (`QuickTapAnswers.rental`, new steps after the existing questions and before the go-question; `QUICK_TAPS_COPY` gains the labels), `src/lib/quick-taps.server.ts` (`saveQuickTaps` stores them in the existing `quick_taps_answered` event details — no SQL), `src/routes/my-job.$token.tsx` (taps screen), `src/lib/template-hub.core.ts`
- Modify (answer 24): `src/lib/onsite-ready-check.server.ts` (Add a job save path: after the job is created, call `textOwnRentalTaps`), `src/lib/sms.core.ts` (type `own_customer_rental_taps`, owner audience, `wordingApproved: false`, quiet hours)
- Test: `tests/rental-answers.test.ts`, `tests/a48-b2-quick-taps.test.ts` (extend), `tests/own-customer-rental-taps.test.ts`

**Interfaces:**
- Produces (answer 24): `OWN_CUSTOMER_RENTAL_TAPS_APPROVED = false as boolean`; `ownCustomerRentalTapsText(i: { firstName: string | null; installer: string; link: string }): string` — DRAFT `"Home Insulation Victoria: Hi {first}, {installer} has added your ceiling insulation job. A few quick questions about your home: {link}"` (Jo approves the wording as a picture at build time); `textOwnRentalTaps(jobId: string): Promise<string>` — only for `channel === "installer_sourced"`, once per job (key `own-rental-taps:v1:{jobId}`), link = the job's quick-taps screen showing ONLY the rental questions (`quickTapsLink(myJobLink)` with `?only=rental`); `"awaiting approval"` while the flag is off; a send failure never fails Add a job; Do not contact blocks it.
- Produces (`rental-answers.core.ts`):
  - `type AccessPerson = { who: "owner" | "tenant" | "property_manager"; name: string; mobile: string }` (mobile `+614…` via `toAuE164`)
  - `type TenantContact = { name: string; mobile: string; email: string }`
  - `type RentalAnswers = { rented: boolean; tenant: TenantContact | null; access: AccessPerson | null }`
  - `RENTAL_TAPS = { livesThere: "Do you live there or is it rented?" /* Jo, verbatim */, livesOptions: ["I live there", "It's rented"], tenantName: "Tenant's name", tenantMobile: "Tenant's mobile", tenantEmail: "Tenant's email", whoLetsIn: "Who'll let us in?", whoOptions: ["Me (the owner)", "The tenant", "The property manager"], accessName: "Their name", accessMobile: "Their mobile" }` — every label except `livesThere` is DRAFT (Jo approves at build time).
  - `rentalAnswersProblems(a: Partial<RentalAnswersInput>): string[]` — when rented: tenant name, a valid Australian mobile and an email are required; who-lets-us-in required; property manager needs name + mobile; "the tenant" reuses the tenant's details; "me" = the owner's details.
  - `rentalAnswersFromTaps(details: unknown): RentalAnswers | null` (`null` = not asked, an old tap).
- Produces (server): `rentalAnswersFor(jobId: string): Promise<RentalAnswers | null>`, `accessPersonFor(jobId: string): Promise<AccessPerson | null>` (`null` when the owner lives there, `who` is the owner, or not asked), `tenantFor(jobId: string): Promise<TenantContact | null>` — latest `quick_taps_answered`; a read failure throws. Consumed by Part 4 (Tasks 15, 16), Part 5 (Tasks 3, 5), Part 6 (Task 9). The office job page shows them read-only and the office can correct them (writes a new `rental_answers_corrected` event; latest wins).

- [ ] **Step 1: Write the failing test** — "I live there" → `{ rented: false, tenant: null, access: null }` and no extra questions; "It's rented" + tenant Tina Lee / `0400 111 222` / `tina@example.com` + property manager Pat Ng / `0400 333 444` → `access = { who: "property_manager", name: "Pat Ng", mobile: "+61400333444" }`, `tenant.email === "tina@example.com"`; "The tenant" → access = Tina's details; rented with no tenant email → `rentalAnswersProblems` contains the email problem and the pass tap is refused; a landline → refused; an old tap without the questions → `null`; `RENTAL_TAPS.livesThere === "Do you live there or is it rented?"`; own customer (answer 24): Add a job → one `own_customer_rental_taps` text (flag on), key once per job; flag off → `"awaiting approval"`, nothing sent; Home Insulation Victoria lead → no such text; the `?only=rental` screen shows only the rental questions and saves through `saveQuickTaps`, then `rentalAnswersFor` returns them; not answered → `null`; TEST → test-send.
- [ ] **Step 2: Run** `bun test tests/rental-answers.test.ts tests/a48-b2-quick-taps.test.ts` — expect FAIL.
- [ ] **Step 3: Implement**; the Mitti Ready Check is NOT changed (answer 22).
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** `feat(quick-taps): owner tells us if it's rented, the tenant's details and who lets us in; own customers get the questions by text`.

### Task 20: In-flight matrix — one of old/new per job per message

**Files:**
- Create: `tests/new-flow-inflight-p3.test.ts`
- Modify: `docs/HIV_WORKFLOW_SOURCE_OF_TRUTH.md`, `src/config/workflow-decisions.ts` (part-3 rules: 30-day quotes, two ticks + typed name, counter-signature, 3-month re-ask, do-not-contact)

**Interfaces:**
- Consumes: every sender changed in Tasks 4–14.

- [ ] **Step 1: Write the failing test** — for each stage in `["ready_check_ready_to_schedule","ready_check_booking","ready_check_booked","measured_quote_ready","awaiting_quote_acceptance","measured_quote_accepted"]`, seed a fake-db job that already received the OLD message for that step (old purpose/key rows in `customer_email_sends` / SMS claims), flip every Part 3 `*_APPROVED` flag to true, run the sweeps, and assert zero new sends for that step and exactly one send for later steps. Also: a quote accepted before ship has no `acceptance_countersigned` event and Part 1's PDF builder still renders it (falls back to the old acceptance page).
- [ ] **Step 2: Run** — expect FAIL until the guards from Tasks 4–14 are wired.
- [ ] **Step 3: Implement** any missing "old purpose already sent" checks the matrix finds.
- [ ] **Step 4: Run** `bun run test`, `bunx tsc --noEmit`, `bun run portal-qa` (quote page, taps, My job) — expect green; gaps NOT_RUN, never PASS.
- [ ] **Step 5: Phone pictures for Jo** — render every changed email/text/page at ~430px wide, paste the wording as text, one question at a time in boxes. Flags stay false until she says yes; then one commit per flag flip, and set `QUOTE_30_DAY_FROM_ISO` in that commit.
- [ ] **Step 6: Commit** `test(owner-flow): part 3 in-flight jobs get exactly one version of each message`; push branch `new-job-flow-part-3`; open PR (body ends with the session attribution); do not merge.

---

## Self-review notes

- Spec coverage (steps 1–6, Part 3 row): enquiry touchpoint specifics (T15), It's your turn (T4), 3-month re-ask (T5), contact consent record + website consent line (T3) + Add a job snapshot consumed by Part 5, documents by link (T11 tick + T12 record), Do not contact (T1–T2, STOP reply T17, legal copies to unsubscribed owners T1), will call / Rapid (T6), Ready Check You're booked + day before (T7–T8), Nearly there (T14), quote email (T10), reminders/expiry (T9), quote page (T11), acceptance + counter-signature (T12), Owner accepted (T13), removals (T16), moving installers onto the new flow (T18), rentals in the quick taps (T19), in-flight (T20). "You're in!" is Part 2's ("You're in!" next steps, complaint line); Xero lines untouched.
- Types: `TradeContact`, `BookedKind`, `BookedFacts`, `ownerBookedNotice` are shared with Part 4 under these exact names.

## Open questions for Jo

1. Before old pick-a-time screens are removed (Task 16) and before an installer is moved onto the new flow (Task 18): if any real job is still at that step (the count script will show it), do you want those few finished the old way, or moved to "installer will call"? (Asked only if the count isn't zero.)

## Decided (Jo, 2 Nov evening, and overview cross-part decisions)

- **Rentals (answer 22, supersedes where 7 put the questions):** asked of the owner in the quick taps after "It's your turn" (Task 19), never in the Mitti Ready Check.
- **Own customers' rentals (answer 24):** the owner gets the same rental quick taps by text after the installer adds the job (Task 19; wording draft, flag off) — not on Add a job.

- **Unsubscribed owners** still get the legal copies (consent, PIESA, rebate form, completion documents), like Do not contact — Task 1.
- **Do not contact (answer 8):** the office button on the job page (Task 2) AND an owner replying STOP to any text (Task 17) turn it on; legal copies still go.
- **Website consent line (answer 15):** "I agree to Home Insulation Victoria and the EEC-certified installer it picks for me contacting me about my ceiling insulation." Tom changes the website form — a Part 11 checklist item, not a code task (Task 3 Step 5).
- **"her" in the Owner accepted email:** a wording choice shown to Jo with the build-time pictures (Task 13), not a question that blocks the plan.
- **Moving installers onto the new flow** is this part's (Task 18); trade-side legacy messages are Part 7's; `P2.tick2Sub` is deleted here (Task 11), Part 2 skips it.

## Assumptions

- Part 1 provides `customerAgreementPdf(version: "1.2" | "1.3"): Promise<EmailAttachment>`, `paymentTermsPdf(): Promise<EmailAttachment>`, `statementOfRightsPdf(): Promise<EmailAttachment>` and a signed acceptance PDF builder that reads `acceptance_countersigned` (Task 12) for both typed names and the time.
- Part 2 provides `TradeContact` and `contactBlockLine(c: TradeContact): string` (= `"{name} · {office phone} · {email}"`) and the AP line constant; if not landed when Task 6 starts, Task 6 exports them from `owner-will-call.core.ts` and Part 2 re-points to them. Part 2 owns the price label, "Thousands…", PIESA naming, VEU box, "You're in!", removed estimate/calculator/My job home pages and payment-terms text.
- Part 5 provides `whoBooksPiesa(businessId)` (My business who-books setting, default "office") and the Add a job consent tick (which calls Task 3's `contactConsentSnapshot`). Until Part 5 lands, Task 13 treats every business as "office".
- `businesses.phone` is the installer's office phone and `businesses.email` the business email. Missing → held, never a worker's number.
- "New flow" = the existing in-house path (`businesses.in_house`). Task 18 moves one installer at a time through the existing `save_in_house_partner` RPC, refusing while that installer has real jobs at an old step; the guards above keep in-flight jobs to one version either way.
- A STOP reply turns on Do not contact for every open job with that owner mobile; START never turns it off (only the office does).
- Quote reminder TEXTS keep their approved wording ("held until"), since #32 approved them as is; only emails/page say "valid for 30 days, until".
- The O77 email + text become the single release message sent by the area-batch send (the old one-at-a-time Release is already retired for website owners).
- Consent to receive documents by email is recorded from tick 1 (its wording includes it); no separate tick.
