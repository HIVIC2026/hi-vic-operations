# New job flow Part 2 — Owner wording + payment timing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every owner message, page and stored text says the balance is due on install day, uses the global owner wording rules, and carries the approved shared pieces (contact block, VEU box, complaint line, "You're in!" next steps, automatic replies); the removed owner pages are gone.

**Architecture:** Shared owner wording lives in one new pure module, `src/lib/owner-wording.core.ts` (exact approved strings + small builders), and existing message cores import from it. Wording changes are edits to existing pure `*.core.ts` builders with bun tests on their rendered output. A final task adds every retired phrase to `scripts/scan-retired-terms.ts` as strict terms, so the global rules can't come back. No DB change. No new sends: every change is to a message that already sends behind its existing approval flag and `customer_comms_enabled`.

**Tech Stack:** TypeScript, MJML email kit (`email-kit.core.ts`, `mail-mjml.core.ts`), TanStack routes, bun:test.

**Spec:** `docs/superpowers/specs/2026-11-02-new-job-flow-design.md` § "Owner emails, texts and pages", § "What gets removed" (owner pages), § "Build fixes found in the live portal" (payment timing, payment-terms text, "You're in!"); `docs/hiv-touchpoint-decisions.md` (Global; touchpoints 34, 54–58; VEU Fixes 1, 4, 5; "BALANCE DUE ON INSTALL DAY"). Depends on Part 1 (`customer-agreement.core.ts` `paymentTermsPart`, `receipt-pdf.server.ts`, `PDF_LOOK_APPROVED`).

## Global Constraints

- Balance: `$349 at acceptance, 10% deposit after the PIESA is clear, the rest on install day.` The deposit is 10% of the price after the $349 (Jo 2 Nov, answer 1 — the existing `paymentPlan` maths: $183.90 on $2,188, leaving $1,655.10); it is paid on the confirm-and-pay page that opens straight after the PIESA result (even with upgrades still to come), and the install day is booked only after it is paid (answer 21, which supersedes 3 and 5). Owner wording: "the rest on install day" / "The rest of your payment is due on install day."
- "Home Insulation Victoria" in full, never "HIV". Owners see "electrical safety check (PIESA)", "rebate" (never "VEU discount"), "electrical upgrades" (never "fixes").
- Price label: `Your estimated quote based on what you've told us`.
- Removed everywhere: "Thousands of Victorians have registered" (keep "Spots are released in the order they were saved."), "lower power bills" claims, install duration, "Wrong time?" / change links, My job home page and "See where you're up to" links.
- Phone numbers shown to owners: the installer's or electrician's business OFFICE phone only (`businesses.phone`), never a worker's mobile.
- Wording comes verbatim from the decisions file; nothing new is invented. Where a sentence must change but has no approved wording, this plan only deletes or reuses an approved sentence (listed in Assumptions).
- `docs/HIV_WORKFLOW_SOURCE_OF_TRUTH.md` and `src/config/workflow-decisions.ts` change in the same commit as any rule they state.
- Run `bun scripts/scan-retired-terms.ts` before starting. No force pushes.

## Review Focus

1. **Installer with no office phone on file.** A message that must show the office phone is held (existing held event), never sent with a blank or a worker's mobile. Tasks 4 and 6 tests.
2. **Owner with no first name / installer not yet allocated.** Greetings fall back to "there"; "You're in!" says "Your installer". Task 3 test.
3. **AI reply answers rewriting correct wording back to the old rule** (`ai-answers.core.ts:54` turns "the rest on install day" into "7 days after…"). Task 1 test.
4. **Old links to removed pages** (`/estimate/{token}`, `/estimate/{token}/calculator`) still open something useful: the Save my spot page. Task 7 test.
5. **The overdue clock is not moved by the wording change.** Office "Balance overdue", interest and Xero still count from day 8 after install day (payment terms: "After 7 days, your balance is overdue"). Task 1 test pins `BALANCE_DUE_DAYS === 7` and the owner-facing due date = install day.

---

### Task 1: "The rest on install day" everywhere

**Files:**
- Modify: `src/lib/acceptance-email.core.ts:28`, `src/lib/deposit-request-email.core.ts:16,22`, `src/lib/install-booked-email.core.ts:51,60`, `src/lib/install-days-email.core.ts:42`, `src/lib/completion-emails.core.ts:130`, `src/lib/final-invoice-email.core.ts:61`, `src/lib/payments.core.ts:36,483`, `src/lib/ai-answers.core.ts:34,54`, `src/lib/invoice-dates.server.ts:35`, `src/lib/balance-q21.core.ts` (add helper only), `src/components/portal/office-job.tsx:221`, `src/components/portal/panels.tsx:389,475,476`, `src/config/workflow-decisions.ts:43`, `docs/HIV_WORKFLOW_SOURCE_OF_TRUTH.md`
- Create: `src/lib/owner-wording.core.ts`
- Test: `tests/balance-on-install-day.test.ts`; update pinned strings in `tests/final-invoice-email.test.ts`, `tests/retired-payment-wording.test.ts`
- Skip: `P2.tick2Sub` (`owner-pages.core.ts:68`) — Part 3 Task 11 deletes it (overview cross-part decision); don't edit it here.

**Interfaces:**
- Produces (in `owner-wording.core.ts`): `REST_ON_INSTALL_DAY = "the rest on install day"`, `REST_DUE_SENTENCE = "The rest of your payment is due on install day."`, `restDueWithAmount(amount: string) => \`The rest of your payment, ${amount}, is due on install day.\``; in `balance-q21.core.ts`: `balanceDueDay(completedAt: string | null | undefined): string | null` (Melbourne date of install day). `BALANCE_DUE_DAYS` (7) keeps its meaning: the overdue clock.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderYoureInEmail } from "../src/lib/acceptance-email.core";
import { PAYMENT_STEP_LABEL, paymentPlan } from "../src/lib/payments.core";
import { BALANCE_DUE_DAYS, balanceDueAt, balanceDueDay } from "../src/lib/balance-q21.core";
import { REST_DUE_SENTENCE } from "../src/lib/owner-wording.core";
const OLD = /7 days after (?:your |the )?install(?:ation)? (?:is )?recorded complete|7 days after recorded install completion|due 7 days after install(?:ation)? completion/;
const FILES = ["src/lib/acceptance-email.core.ts", "src/lib/deposit-request-email.core.ts", "src/lib/install-booked-email.core.ts", "src/lib/install-days-email.core.ts", "src/lib/completion-emails.core.ts", "src/lib/payments.core.ts", "src/lib/ai-answers.core.ts", "src/lib/invoice-dates.server.ts", "src/components/portal/office-job.tsx", "src/components/portal/panels.tsx", "src/config/workflow-decisions.ts"];

describe("balance due on install day", () => {
  test("no source still states the 7-day rule", () => { for (const f of FILES) expect(readFileSync(f, "utf8")).not.toMatch(OLD); });
  test("deposit = 10% of the price after the $349 (Jo 2 Nov, answer 1)", () => {
    const p = paymentPlan({ quoteTotalCents: 218800, safetyCheckCents: 34900 });
    expect([p.installDepositCents, p.balanceCents]).toEqual([18390, 165510]);
  });
  test("You're in! still-to-pay line", () => {
    const e = renderYoureInEmail({ firstName: "Sarah", rebate: 1610, totalIncGst: 2188, payment: { amount: 349, paidOn: "8 Nov" }, installerName: "Rapid Insulation", myJobUrl: "x" });
    expect(e.text).toContain("Still to pay: $1,839.00 (10% to book your install day, the rest on install day)");
  });
  test("deposit emails", () => { expect(readFileSync("src/lib/deposit-request-email.core.ts", "utf8")).toContain("REST_DUE_SENTENCE"); expect(REST_DUE_SENTENCE).toBe("The rest of your payment is due on install day."); });
  test("staff label", () => { expect(PAYMENT_STEP_LABEL.balance).toBe("Balance (due on install day)"); });
  test("AI answers no longer rewrite the right wording", () => {
    const src = readFileSync("src/lib/ai-answers.core.ts", "utf8");
    expect(src).not.toMatch(/replace\(\/the rest on install day\/gi/);
    expect(src).toContain("The balance is due on install day");
  });
  test("owner due date = install day; overdue clock unchanged", () => {
    expect(BALANCE_DUE_DAYS).toBe(7);
    expect(balanceDueDay("2026-11-13T03:00:00Z")).toBe("2026-11-13");
    expect(balanceDueAt("2026-11-13T03:00:00Z")!.startsWith("2026-11-20")).toBe(true);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL.** Run: `bun test tests/balance-on-install-day.test.ts` — Expected: FAIL (old wording, module missing).

- [ ] **Step 3: Make the edits** (import the constants from `owner-wording.core.ts`):

| Where | New |
|---|---|
| acceptance `remainingLine` | `` `Still to pay: ${K.cents(remaining)} (10% to book your install day, the rest on install day)` `` |
| deposit-request request/reminder line (22) | `REST_DUE_SENTENCE` |
| deposit-request paid line (16) | `REST_DUE_SENTENCE` (Part 4 reworks this email to #44 with the amount) |
| install-booked (51/60) | label `Balance due on install day`; drop "Most homes take a few hours." from `happens` (duration rule) |
| install-days-email lock2 | `` `The rest${rest != null ? `, ${K.cents(rest)},` : ""} is due on install day. Or you can pay in full now.` `` |
| completion-emails fallback | `'due on install day'` |
| final-invoice-email `dueDate` | `longDate(i.completedAt)` (install day) |
| `PAYMENT_STEP_LABEL.balance` | `Balance (due on install day)`; line 483: `` `${aud(plan.balanceCents)} on install day, by card, bank transfer or PayID` `` |
| ai-answers 34 | `…The balance is due on install day and can be paid by card, bank transfer or PayID.`; delete the line-54 `.replace(/the rest on install day/gi, …)` |
| ai-answers 35 | `Someone 18 or over needs to be home for each visit.` (duration removed; sentence from the approved Customer Agreement) |
| invoice-dates log | `` `Balance due on install day; overdue after 7 days (${due})…` `` |
| office-job `STEP_HOW.balance`, panels 389/475/476 | "on install day" in place of "7 days after recorded install completion" |
| workflow-decisions `balanceNote` + SoT doc | "balance on install day (Jo 2 Nov 2026); overdue after 7 days" |

`assignment.server.ts:211` is Task 2.

- [ ] **Step 4: Run, expect PASS.** Run: `bun test tests/balance-on-install-day.test.ts tests/final-invoice-email.test.ts tests/retired-payment-wording.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src tests docs/HIV_WORKFLOW_SOURCE_OF_TRUTH.md
git commit -m "fix(payments): balance is due on install day in every owner and staff text"
```

---

### Task 2: Payment terms = the lawyer-approved payment terms page

**Files:**
- Modify: `src/lib/owner-gates.core.ts:46-54` (`PAYMENT_TERMS_VERSION`, `PAYMENT_TERMS_BODY`), `src/lib/assignment.server.ts:211` (stored `payment_terms`)
- Test: `tests/payment-terms-v1-3.test.ts`

**Interfaces:**
- Consumes: `CUSTOMER_AGREEMENT_V1_3`, `paymentTermsPart` (Part 1 Task 2)
- Produces: `PAYMENT_TERMS_VERSION = "customer-agreement-1.3"`; `PAYMENT_TERMS_BODY = paymentTermsPart(CUSTOMER_AGREEMENT_V1_3)` with the agreement placeholders mapped to the existing `{total} {fee} {deposit} {balance}` names; `paymentTermsText(m)` unchanged signature.

- [ ] **Step 1: Failing test:**

```ts
test("payment terms carry the approved text, not the old fixes line", () => {
  expect(PAYMENT_TERMS_BODY).not.toMatch(/Electrical fixes|on their own invoice/);
  expect(PAYMENT_TERMS_BODY).toContain("If you need electrical upgrades, you pay your electrician directly. They're not part of our price.");
  expect(PAYMENT_TERMS_BODY).toContain("We'll remind you 1, 3 and 7 days after install day. After 7 days, your balance is overdue and we may pass it to a debt collector.");
  expect(PAYMENT_TERMS_VERSION).toBe("customer-agreement-1.3");
});
test("stored terms on a new acceptance use the same text", () => {
  const src = readFileSync("src/lib/assignment.server.ts", "utf8");
  expect(src).toMatch(/payment_terms:\s*paymentTermsText\(/);
  expect(src).not.toMatch(/7 days after recorded install completion/);
});
```

- [ ] **Step 2: Run, expect FAIL.** `bun test tests/payment-terms-v1-3.test.ts`
- [ ] **Step 3: Implement.** New version = new owner_paperwork approval needed: it stays DRAFT (TEST jobs only) until Jo presses Approve in Settings › Owner paperwork (existing rule in the file's comment). `assignment.server.ts` builds `payment_terms: paymentTermsText({ total, fee, deposit, balance })` from the same `paymentPlan` numbers already computed there. Signed copies keep their stored text.
- [ ] **Step 4: Run, expect PASS.** Plus `bun test tests/owner-gates*.test.ts tests/payment-statement-own-invoices.test.ts`.
- [ ] **Step 5: Commit** `git commit -m "fix(payment terms): use the lawyer-approved payment terms (electrical upgrades paid to the electrician)"`

---

### Task 3: "You're in!" — next steps, complaint line, receipt PDF

**Files:**
- Modify: `src/lib/acceptance-email.core.ts`, `src/lib/owner-email-triggers.server.ts` (O22 sender, attachments around line 149–200)
- Test: `tests/youre-in-email.test.ts`

**Interfaces:**
- Consumes: `fileReceiptPdf`, `receiptPdf` (Part 1 Task 5), `PDF_LOOK_APPROVED.receipts`
- Produces: `COMPLAINT_LINE` in `owner-wording.core.ts` = `"Something not right? Reply to this email or write to info@homeinsulationvictoria.com.au and we'll look into it. If it's still not sorted, you can contact the Essential Services Commission (esc.vic.gov.au) or Consumer Affairs Victoria."` (Part 4 reuses it on "All done").

- [ ] **Step 1: Failing test:**

```ts
const e = renderYoureInEmail({ firstName: "Sarah", rebate: 1610, totalIncGst: 2188, payment: { amount: 349, paidOn: "8 Nov" }, installerName: "Rapid Insulation", myJobUrl: "x" });
test("approved next steps (touchpoint 34)", () => {
  expect(e.text).toContain("1. Electrical safety check (PIESA): Rapid Insulation's licensed electrician will call you to book it. They check your wiring, downlights and switchboard are safe to insulate over.");
  expect(e.text).toContain("2. Only if electrical upgrades are needed: Your electrician quotes and books them with you directly. Nothing is done without your OK.");
  expect(e.text).toContain("3. Book your install day: Rapid Insulation will call you to book it. Pay your 10% deposit to lock it in. Your install is done within 30 days of the electrical safety check (PIESA).");
  expect(e.text).toContain("Electrical safety check (PIESA): $349.00");
  expect(e.text).not.toMatch(/offer you times|offers you 3 days|separate quote/);
});
test("complaint line (VEU Fix 4)", () => { expect(e.text).toContain(COMPLAINT_LINE); expect(e.html).toContain("esc.vic.gov.au"); });
test("no installer yet", () => {
  const n = renderYoureInEmail({ firstName: null, rebate: null, totalIncGst: 2188, payment: null, installerName: null, myJobUrl: "x" });
  expect(n.text).toContain("Your installer's licensed electrician will call you to book it.");
  expect(n.text).toContain("Your installer will call you to book it.");
});
test("receipt PDF attached only when its flag is on", () => {
  expect(readFileSync("src/lib/owner-email-triggers.server.ts", "utf8")).toMatch(/PDF_LOOK_APPROVED\.receipts[\s\S]{0,400}receiptPdf|fileReceiptPdf/);
});
```

- [ ] **Step 2: Run, expect FAIL.** `bun test tests/youre-in-email.test.ts`
- [ ] **Step 3: Implement.** Steps exactly as decision 34; `payLabel` default `"Electrical safety check (PIESA)"`; complaint line as a small paragraph after the closing. In the O22 sender, when `PDF_LOOK_APPROVED.receipts` is on, attach the `safety_check` receipt PDF (`Receipt-HV-1234.pdf`) next to the signed acceptance; when off, nothing changes. The closing line keeps "Your signed acceptance and receipt are attached…" (approved).
- [ ] **Step 4: Run, expect PASS.** Plus `bun test tests/owner-quote-acceptance-b3.test.ts`.
- [ ] **Step 5: Commit** `git commit -m "feat(you're in): approved next steps, complaint line, receipt PDF (flagged)"`

---

### Task 4: Shared contact block (office phone only) + AP line

**Files:**
- Modify: `src/lib/owner-wording.core.ts`
- Create: `src/lib/owner-contact.server.ts`
- Test: `tests/owner-contact.test.ts`

**Interfaces:**
- Produces (Parts 3, 4, 6 put these on "will call", every "You're booked" and "All done"):
  - `type BusinessContact = { name: string; tradingName: string | null; officePhone: string | null; email: string | null }` (no person fields, by design)
  - `contactLine(b: BusinessContact): string | null` → `` `${tradingName || name} · ${officePhone} · ${email}` ``; `null` when office phone or email is missing (caller holds the message)
  - `AP_CERTIFICATES_LINE = "Rebate certificates created by Home Insulation Victoria (Accredited Person A003654)."`
  - `businessContactForJob(jobId: string, role: "installer" | "electrician"): Promise<BusinessContact | null>` — reads the active `job_assignments` row for that role → `businesses` (`name`, `trading_name`, `phone`, `email`); never `profiles` or workers.

- [ ] **Step 1: Failing test:**

```ts
test("contact line", () => {
  expect(contactLine({ name: "Rapid Insulation Pty Ltd", tradingName: "Rapid Insulation", officePhone: "03 9000 0000", email: "office@rapidinsulation.com.au" })).toBe("Rapid Insulation · 03 9000 0000 · office@rapidinsulation.com.au");
  expect(contactLine({ name: "X", tradingName: null, officePhone: null, email: "a@b.au" })).toBeNull();
  expect(AP_CERTIFICATES_LINE).toBe("Rebate certificates created by Home Insulation Victoria (Accredited Person A003654).");
});
test("server reader never touches people", () => {
  const src = readFileSync("src/lib/owner-contact.server.ts", "utf8");
  expect(src).toMatch(/from\("businesses"\)/);
  expect(src).not.toMatch(/from\("(profiles|partner_workers|business_workers)"\)/);
});
```

- [ ] **Step 2: Run, expect FAIL.** `bun test tests/owner-contact.test.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `git commit -m "feat(owner wording): shared office-phone contact block and AP certificates line"`

---

### Task 5: VEU box at the bottom of all four estimate emails

**Files:**
- Modify: `src/lib/owner-wording.core.ts`, `src/lib/jo-outcome-email.core.ts` (`renderSaveMySpot`, all four variants)
- Test: `tests/veu-box.test.ts`

**Interfaces:**
- Produces: `VEU_FACTSHEET_URL = "https://www.energy.vic.gov.au/__data/assets/pdf_file/0028/585154/Victorian-Energy-Efficiency-Target-scheme-consumer-factsheet.pdf"`; `VEU_BOX_TITLE = "About the Victorian Energy Upgrades program"`; `VEU_BOX_TEXT = "Home Insulation Victoria (DC Construction Solutions Pty Ltd, Accredited Person A003654) creates the rebate certificates for your job. We're not the Victorian Government or the Essential Services Commission. We follow the VEU code of conduct. Ask us for a copy any time."`; `VEU_BOX_LINK = "Read the Government's VEU consumer factsheet ›"`; `veuBoxMj(): string`, `veuBoxText(): string[]`. Part 10 puts the same box on own customers' first email.

- [ ] **Step 1: Failing test:** for each variant fixture (`none`, `some`, `questions`, `received` — build with `renderJoOutcomeEmail` the way `tests/jo-outcome-email*.test.ts` does), `text` ends with the box lines (`VEU_BOX_TITLE`, `VEU_BOX_TEXT`, `${VEU_BOX_LINK} ${VEU_FACTSHEET_URL}`) before the sign-off, and `html` contains `VEU_FACTSHEET_URL` once.
- [ ] **Step 2: Run, expect FAIL.** `bun test tests/veu-box.test.ts`
- [ ] **Step 3: Implement** — one `veuBoxMj()` section appended in `renderSaveMySpot` (the one renderer for the four variants).
- [ ] **Step 4: Run, expect PASS.** Plus `bun test tests/jo-outcome*.test.ts`.
- [ ] **Step 5: Commit** `git commit -m "feat(estimate emails): VEU program box with factsheet link (VEU Fix 1)"`

---

### Task 6: Automatic replies (O76) and the change/cancel reply

**Files:**
- Modify: `src/lib/owner-email-auto-reply.core.ts` (`LONG_LIST`, `answerDesign`, `AnswerFacts`, `AnswerDesign.button` nullable), its renderer and server caller (`owner-email-auto-reply.server.ts`: fill installer facts via `businessContactForJob`), `src/lib/email-change-reply.core.ts` (`ChangeReplyFacts`, `changeReplyParagraphs`, `changeReplyText`, `renderChangeReplyEmail`), `src/lib/email-change-reply.server.ts`
- Test: update `tests/owner-email-auto-reply.test.ts`; create `tests/email-change-reply-office-phone.test.ts`

**Interfaces:**
- Consumes: `businessContactForJob` (Task 4)
- Produces: `AnswerFacts` gains `installer?: { name: string; officePhone: string } | null`; `AnswerDesign.button: string | null`; `ChangeReplyFacts = { firstName: string | null; visit: ChangeVisit; business: string; officePhone: string }` (link and cancelNote removed).

- [ ] **Step 1: Failing tests:**

```ts
test("spot saved answer (54-58 item 1)", () => {
  const d = answerDesign("spot_saved", { firstName: "Sarah", link: "L" });
  expect(d.body.join(" ")).not.toContain("Thousands");
  expect(d.body.at(-1)).toBe("Spots are released in the order they were saved. When an EEC-certified installer is available, they'll call you to book your free Ready Check.");
  expect(d.button).toBeNull();
});
test("pick-a-time answers now say who calls (item 2)", () => {
  const d = answerDesign("pick_times", { firstName: "Sarah", link: "L", installer: { name: "Rapid Insulation", officePhone: "03 9000 0000" } });
  expect(d.body).toContain("Rapid Insulation will call you from 03 9000 0000 to book it.");
  expect(d.button).toBeNull();
});
test("pick-a-time without an office phone is held", () => { expect(() => answerDesign("pick_times", { firstName: null, link: "L", installer: null })).toThrow(/office phone/); });
test("no See where you're up to anywhere (item 4)", () => { expect(readFileSync("src/lib/owner-email-auto-reply.core.ts", "utf8")).not.toContain("See where you're up to"); });
test("quote and pay answers keep their one page link", () => { expect(answerDesign("quote_ready", { firstName: null, link: "https://x/my-job/t" }).href).toContain("screen=quote"); });
test("change/cancel reply (item 3)", () => {
  const t = changeReplyText({ firstName: "Sarah", visit: "piesa", business: "Sparky Co", officePhone: "03 9111 1111" });
  expect(t).toContain("Call Sparky Co on 03 9111 1111 to change it. To cancel, just reply to this email.");
  expect(t).not.toMatch(/job page|my-job/);
});
```

- [ ] **Step 2: Run, expect FAIL.** `bun test tests/owner-email-auto-reply.test.ts tests/email-change-reply-office-phone.test.ts`
- [ ] **Step 3: Implement.** `LONG_LIST = "Spots are released in the order they were saved."`; `waitingNext` = LONG_LIST + `" When an EEC-certified installer is available, they'll call you to book your free Ready Check."` (decision 19/54 wording; note this answer goes out before release, which decision 19 allows — open `PRE_RELEASE_FORBIDDEN` for it the same way Part 3 does for the Spot saved email). `pick_times` and `quote_after_ready_check` without a booked time → `` `${installer.name} will call you from ${installer.officePhone} to book it.` ``, no button; missing installer → throw → the server's existing `EMAIL_AUTO_REPLY_HELD_EVENT` path. `spot_saved`, `answers_received`, `quote_preparing`, `quote_after_ready_check` → `button: null`; `how_to_pay` → `?screen=pay`; `visit_booked` → no button. Renderer skips the button and the link line when null. Change reply: greeting, "No problem", the one sentence above, sign-off; the server picks `business`/`officePhone` from `businessContactForJob(jobId, visit === "piesa" ? "electrician" : "installer")`; missing → existing `EMAIL_CHANGE_REPLY_HELD_EVENT`. Job-cancelled replies (O69/I70) and the signing code are untouched.
- [ ] **Step 4: Run, expect PASS.** Plus `bun test tests/owner-email-auto-reply-events-practice-db.test.ts tests/enquiry-auto-reply.core.test.ts`.
- [ ] **Step 5: Commit** `git commit -m "fix(auto replies): installer office phone, no My job links, no long-list line (O76)"`

---

### Task 7: Remove the owner estimate page, owner calculator, photos box and My job home links

**Files:**
- Modify: `src/routes/estimate.$token.tsx` and `src/routes/estimate_.$token.calculator.tsx` (component replaced by a `beforeLoad` redirect), `src/routes/estimate_.$token.video.tsx:120-127` (remove the `P1.photosTitle` box and its upload state), `src/lib/owner-pages.core.ts` (`P1.photosTitle`/`photosSub` removed), `src/lib/veec-emails.core.ts:44`, `src/lib/visit-new-times.core.ts:76`, `src/lib/deposit-release-notice.core.ts`, `src/lib/install-no-access-notice.core.ts`, `src/lib/thirty-day-rule.core.ts`, `src/lib/spot-saved-messages.core.ts`, `src/lib/ready-check-booked-email.core.ts`, `src/lib/safety-check-emails.core.ts` (drop "See my job" buttons/lines)
- Test: `tests/owner-pages-removed.test.ts`

**Interfaces:** none new. `resolveOwnerScreen` (`owner-myjob.core.ts`) already never returns `home`; the test pins it.

- [ ] **Step 1: Failing test:**

```ts
const code = (p: string) => readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
test("old estimate and calculator links open Save my spot", () => {
  for (const f of ["src/routes/estimate.$token.tsx", "src/routes/estimate_.$token.calculator.tsx"]) {
    expect(code(f)).toMatch(/throw redirect\(\{\s*to:\s*"\/estimate\/\$token\/campaign"/);
    expect(code(f)).not.toMatch(/CustomerEstimate|PublicCalculator/);
  }
});
test("3-questions page has no photos box", () => { expect(code("src/routes/estimate_.$token.video.tsx")).not.toContain("photosTitle"); });
test("My job home never shows", () => { expect(resolveOwnerScreen("home", {})).toBe("all_set"); });
test("no owner message links to My job home", () => {
  for (const f of ["veec-emails", "visit-new-times", "deposit-release-notice", "install-no-access-notice", "thirty-day-rule", "spot-saved-messages", "ready-check-booked-email", "safety-check-emails"]) expect(code(`src/lib/${f}.core.ts`)).not.toMatch(/See my job|See where you're up to/);
});
```

- [ ] **Step 2: Run, expect FAIL.** `bun test tests/owner-pages-removed.test.ts`
- [ ] **Step 3: Implement.** Redirects keep the token (`params: { token }`). Where a message has another action button, only the "See my job" button goes; where it was the only button, the message has no button (decision 54-58 item 4: "or no button"). No new wording. Photo/video asks in the "3 quick questions" email and on the Spot saved screen stay (touchpoint 14).
- [ ] **Step 4: Run, expect PASS.** Plus `bun test tests/owner-pages.core.test.ts tests/veec*.test.ts tests/spot-saved*.test.ts`.
- [ ] **Step 5: Commit** `git commit -m "feat(owner pages): remove estimate page, owner calculator, photos box and My job home links"`

---

### Task 8: Global owner wording sweep + guard

**Files:**
- Modify: `scripts/scan-retired-terms.ts` (new strict `TERMS`), and every file it then reports, at least: `src/components/portal/register-interest.tsx`, `src/lib/followup-email.ts`, `src/lib/save-spot-reminder-blast.core.ts`, `src/lib/spot-only-copy.core.ts`, `src/lib/jo-outcome-email.core.ts`, `src/lib/estimate-followup.core.ts`, `src/lib/save-spot-offer.core.ts`, `src/lib/owner-quote-email.core.ts`, `src/routes/estimate_.$token.campaign.tsx`, `src/routes/my-estimate.$token.tsx`, `src/lib/jo-email-templates.core.ts`, `src/components/portal/public-calculator.tsx`, `src/lib/owner-pages.core.ts:60`, `src/lib/email-kit.core.ts:35`, `src/lib/ready-check-times-email.core.ts:40`, `src/lib/owner-myjob.core.ts:99`, `src/lib/customer-quote-system.ts:130,156`, the "VEU discount" files (`installer-intake-flow.tsx`, `intake-quote-fields.tsx`, `intake-details-editor.tsx`, `public-calculator-head.ts`, `estimate.tsx`, `quotes.server.ts`, `installer-led.core.ts`, `installer-quote-commercial.core.ts`, `ready-check-template.core.ts`)
- Test: `tests/owner-wording-guard.test.ts`

**Interfaces:** Produces `OWNER_WORDING_TERMS` (exported from the scan script) — the strict terms below.

- [ ] **Step 1: Failing test:**

```ts
import { scan } from "../scripts/scan-retired-terms";
const OWNER_TERMS = ["Thousands of Victorians", "lower power bills", "VEU discount", "old price label", "fixes wording to owners", "mandatory PIESA", "install duration", "Wrong time link", "See where you're up to", "7-day balance"];
test("no retired owner wording left in src", () => {
  const hits = scan().filter((h) => OWNER_TERMS.includes(h.term) && h.file.startsWith("src/"));
  expect(hits).toEqual([]);
});
```

- [ ] **Step 2: Run, expect FAIL.** `bun test tests/owner-wording-guard.test.ts`
- [ ] **Step 3: Add the strict terms:**

| term | re | replace with (approved) |
|---|---|---|
| Thousands of Victorians | `/Thousands of Victorians/g` | delete the sentence; keep "Spots are released in the order they were saved." |
| lower power bills | `/lower (?:power )?bills/gi` | delete the claim (touchpoint 12: cut "and enjoy lower power bills for years to come") |
| VEU discount | `/VEU discount/g` | "rebate" ("Rebate" as a label) |
| old price label | `/Your cost if eligible\|Your estimated cost after rebate/g` | `Your estimated quote based on what you've told us` |
| fixes wording to owners | `/Electrical fixes, if the safety check finds any\|electrical fixes, only if the safety check finds any\|finds something to fix\|Only if something needs fixing\|Licensed electrician safety check/g` | "Electrical upgrades, if the electrical safety check (PIESA) finds any"; quote "Not included" line → "Not included: electrical upgrades, only if the electrical safety check (PIESA) finds any. Your electrician quotes these directly, and nothing is done without your OK." (#29); small print → "or the electrical safety check (PIESA) finds electrical upgrades are needed" (#12); "Electrical safety check (PIESA) by a licensed electrician" (#5) |
| mandatory PIESA | `/mandatory PIESA/g` | "electrical safety check (PIESA)" |
| install duration | `/About 4 hours\|takes? (?:about )?a few hours\|takes about 4 hours\|How long:/g` | delete (owner-myjob step sub becomes empty) |
| Wrong time link | `/Wrong time\?/g` | delete |
| See where you're up to | `/See where you're up to/g` | delete the button |
| 7-day balance | the `OLD` regex from Task 1 | Task 1 wording |

Then run `bun scripts/scan-retired-terms.ts` and fix every reported line with the replacement in the table (comments too — strict). Touchpoint-specific rewrites beyond these phrases stay with Parts 3/4.

- [ ] **Step 4: Run, expect PASS.** `bun test tests/owner-wording-guard.test.ts && bun scripts/scan-retired-terms.ts` (exit 0), then `bun run test`.
- [ ] **Step 5: Commit** `git commit -m "fix(owner wording): global wording rules applied everywhere, guarded by the retired-terms scan"`

---

## Finish

- [ ] `bun run test` green; `bun scripts/scan-retired-terms.ts` exit 0; `bun run portal-qa` for the estimate/video/my-job routes touched.
- [ ] Phone-width pictures of: "You're in!", an estimate email with the VEU box, the two auto replies, the change reply, the 3-questions page — with the wording pasted as text — to Jo. Payment terms new version: Jo approves it in Settings › Owner paperwork.

## Ownership notes (for the main session)

- Part 2 applies the **global phrase rules** everywhere; Parts 3/4 own touchpoint-specific rewrites of the same messages (e.g. O1 "look after the rebate for you", Spot saved "What happens next", dropping "See your full estimate" from estimate emails). Whichever lands second must keep the other's text.
- The contact block and AP line are built here (Task 4); putting them on "will call" / "You're booked" / "All done" is Parts 3/4/6.
- The "Deposit received" email's timing sentence is changed here; its full #44 rework is Part 4.

## Open questions for Jo

None left for this part.

## Decided (Jo, 2 Nov evening, and overview cross-part decisions)

- **Deposit amount (answer 1):** 10% of the price after the $349 — the portal's existing maths ($183.90 on $2,188). Pinned in Task 1's test; no code change to `paymentPlan`.
- **Deposit timing (answer 21):** paid on the confirm-and-pay page straight after the PIESA result; the install is booked only after it (Parts 4 and 9 own it; this part only states it in Global Constraints).
- **Overdue clock:** stays 7 days after install day (lawyer-approved agreement), reminders days 1, 3 and 7 (overview "Decided from earlier approvals").
- **`P2.tick2Sub`:** Part 3 deletes it; this part skips it.

## Assumptions

- "Due on install day" changes the words owners see and the due date shown to them; the overdue clock (office "Balance overdue", interest, Xero due date) stays at 7 days after install day, matching the approved payment terms.
- Where a sentence had to go and no approved replacement exists (install duration, "See my job", "Wrong time?"), it is deleted, not reworded.
- The AI help answer "No one needs to be home on install day…" is replaced with the approved agreement line "Someone 18 or over needs to be home for each visit." because the spec requires an adult present.
- The new payment terms text is the lawyer-approved payment terms page of Customer Agreement v1.3, so no new lawyer review is needed; Jo still presses Approve in Settings.
- "VEU discount" → "rebate" applies to trade screens too (decision: "Everywhere").
