# Part 10 — Installers' own customers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Installers' own customers (`jobs.channel = 'installer_sourced'`) get the approved own-customer path: no pre-quote owner messages, an "Enter your price" email and step, owner's price = installer's price + $349 Home Insulation Victoria fee + $349 PIESA − rebate shown as the approved lines, co-branded quote email, quote page and tax invoice (with the VEU box on the first email), the right labels, and the right pay rule.

**Architecture:** Most of the path already exists (decisions 278/288/289: boss "Your price" card `installer-price.*`, boss text `boss-price-link.*`, A1 quote `mitti-installer-quote.core.ts` → `installer-led.core.ts buildInstallerQuoteDraft`, labels `sourceLabel`, pay rule `trade-view.core.ts installerPayHeldReasons`). This part adds one pure module for the own-customer price lines, one pure co-brand helper, one pure "Enter your price" email, and wires them into the existing quote builder, quote email, owner quote page, tax invoice renderer (Part 1) and price card. Every new owner-facing look sits behind `OWN_CUSTOMER_COBRAND_APPROVED` (default false; the current approved quote email/page keeps going out until Jo approves); the new installer email sits behind `ENTER_PRICE_EMAIL_APPROVED` (default false; the current text keeps going until then — never both).

**Tech Stack:** TypeScript, TanStack Start, React, Supabase, MJML (`mail-mjml.core.ts`), bun:test.

**Spec:** Claude Doc "Spec: Home Insulation Victoria new job flow + installer portal", rev 31 (copied to `docs/superpowers/specs/2026-11-02-new-job-flow-design.md` by the overview's first commit) — section "Installers' own customers", plus "More VEU Code of Conduct rules" (cl 13, 14) and Review Focus 5 of the overview. Decisions: `docs/hiv-touchpoint-decisions.md` lines "FEES (Jo 2 Nov, CORRECTION)", "OWN CUSTOMERS quote + invoice lines", "OWN CUSTOMERS … CO-BRANDED WITH BOTH LOGOS", "Own customers vs Home Insulation Victoria leads (grill Q16–19)", "'Enter your price' email — redesigned (price-email.png) … APPROVED", "Fix 1 APPROVED" (VEU box). Approved mock-up: `docs/approved-samples/2026-11-02/price-email.png` (copy of `/home/claude/handoff/price-email.png`). Installer agreement §27: `src/lib/installer-agreement.text.ts` (`"n": 27`).

## Global Constraints

- Applies only to `channel === "installer_sourced"` (`priceFromPortal(channel)` in `installer-price.core.ts`). Home Insulation Victoria leads (`hivic_sourced`) must render byte-identical to before; every task has a test proving it.
- Fees (Jo 2 Nov): every job has two separate fees — `$349` Home Insulation Victoria (AP) fee and `$349` PIESA. Own customers: owner's price = installer's price + $349 + $349 − rebate. The PIESA line is $349 whatever the electrician's rate (supersedes decision 302/303 for the owner's price only). The electrician is still paid their own rate (e.g. $275) and Home Insulation Victoria keeps the difference (Jo 2 Nov, answer 2) — Task 10 pins it.
- Own-customer quote and invoice lines, in this order and with these exact labels: `Insulation` · `Home Insulation Victoria fee` · `Electrical safety check (PIESA)` · `Rebate` · `Your price`.
- Co-branded = installer's logo (uploaded on My business, Part 5 Task 9, stored at `businesses.branding.logo_url` and read through Part 5's `businessLogoUrl(businessId)`) beside the Home Insulation Victoria logo, on the quote email, the quote page and the tax invoice only. No logo, or a logo URL that isn't `https://`, = our logo only.
- VEU box (Fix 1, verbatim): "About the Victorian Energy Upgrades program — Home Insulation Victoria (DC Construction Solutions Pty Ltd, Accredited Person A003654) creates the rebate certificates for your job. We're not the Victorian Government or the Essential Services Commission. We follow the VEU code of conduct. Ask us for a copy any time." + link "Read the Government's VEU consumer factsheet ›" → `https://www.energy.vic.gov.au/__data/assets/pdf_file/0028/585154/Victorian-Energy-Efficiency-Target-scheme-consumer-factsheet.pdf`. On own customers it goes on the quote email (their first email from us).
- Labels: "Your customer" / "Home Insulation Victoria lead" (existing `sourceLabel`). Always "Home Insulation Victoria" in full; owners see "rebate", never "VEU discount".
- Installer pay on own customers: once the owner has paid in full (existing rule `installerPayHeldReasons`: Final check + owner paid in full; no pay without the green light — Part 9).
- Price and pay are seen by Boss and Office only (Office role from Part 5); Lead Installers and crew never.
- New sends default OFF behind approval flags; TEST jobs (`source='qa_test'`) and TEST partners go to test-send. No new SQL in this part (`businesses.branding` jsonb and `workflow_events` already exist).
- `docs/HIV_WORKFLOW_SOURCE_OF_TRUTH.md` and `src/config/workflow-decisions.ts` are updated in the same commit as the fee rule (Task 2). Run `bun scripts/scan-retired-terms.ts` before starting.

## Review Focus

1. **Line classified by its description, not its code.** The quote email today picks a row's detail with regexes (`/insulation|batts|R\d/`), so "Home Insulation Victoria fee" would be shown as the insulation product. Own-customer rows must be built from `quote_items.code`. (Task 5 test: the fee row's detail is the AP detail, never "VEU-approved (AS/NZS 4859.1)".)
2. **Installer with no logo, or a bad logo URL.** Expect our logo alone, no broken image, no empty `<img>`. (Task 5 test for email, Task 6 test for the page, Task 7 test for the invoice.)
3. **Electrician's rate isn't $349** (HIV electrician $349, a REC at $275 or $420). The owner's PIESA line is still $349 and the release check must not hold it as "price does not match". (Task 2 test.)
4. **Draft prepared before this part ships, not yet sent.** A held draft still carrying the old electrician-rate PIESA line must hold with "prepare a new quote", never go out at the old amount; quotes already sent are never re-priced. (Task 2 test.)
5. **Lead Installer, crew or a staff login tries to see or set the price.** Refused on the server; nothing about price in their view. (Task 4 test.)

---

### Task 1: Own-customer price lines (pure)

**Files:**
- Create: `src/lib/own-customer-price.core.ts`
- Test: `tests/own-customer-price.test.ts`

**Interfaces:**
- Consumes: `MITTI_INSTALLER_FEE_INC_GST` (= 349) from `src/lib/usual-electrician.core.ts`.
- Produces:
  - `OWN_CUSTOMER_PIESA_INC_GST = 349`
  - `OWN_CUSTOMER_LABELS = { insulation: "Insulation", apFee: "Home Insulation Victoria fee", piesa: "Electrical safety check (PIESA)", rebate: "Rebate", total: "Your price" } as const`
  - `type OwnCustomerRow = { key: "insulation" | "extra" | "apFee" | "piesa" | "rebate" | "total"; label: string; detail: string | null; amountIncGst: number }`
  - `ownCustomerRows(items: { code: string | null; description: string; line_total_inc_gst: number }[], rebateIncGst: number, totalIncGst: number): OwnCustomerRow[]` — order: `INSTALLER_PRICE` → insulation (detail = the item's existing description, i.e. product/area/inclusions); `INSTALLER_REMOVAL`/`INSTALLER_EXTRA` → extra (label = their own description, detail null); `AP_FEE` → apFee; `PIESA` → piesa; then rebate (negative amount) and total. Unknown codes throw `Error("Unknown own-customer quote line: <code>")` (fail closed — never guess a label).

- [ ] **Step 1: Write the failing tests**

```ts
const items = [
  { code: "PIESA", description: "x", line_total_inc_gst: 349 },
  { code: "INSTALLER_PRICE", description: "Bradford Gold R5.0 · 120 m²", line_total_inc_gst: 2000 },
  { code: "AP_FEE", description: "y", line_total_inc_gst: 349 },
];
test("approved order and labels", () => {
  const r = ownCustomerRows(items, 600, 2098);
  expect(r.map((x) => [x.label, x.amountIncGst])).toEqual([
    ["Insulation", 2000], ["Home Insulation Victoria fee", 349], ["Electrical safety check (PIESA)", 349], ["Rebate", -600], ["Your price", 2098],
  ]);
  expect(r[0]!.detail).toBe("Bradford Gold R5.0 · 120 m²");
});
test("separately agreed extras sit under Insulation with their own words", () => { /* INSTALLER_REMOVAL "Removal of existing insulation – 40 m²" 300 → row 2, label = that description */ });
test("unknown code fails closed", () => expect(() => ownCustomerRows([{ code: "MYSTERY", description: "?", line_total_inc_gst: 1 }], 0, 1)).toThrow("Unknown own-customer quote line: MYSTERY"));
test("fees are 349 each", () => { expect(OWN_CUSTOMER_PIESA_INC_GST).toBe(349); expect(MITTI_INSTALLER_FEE_INC_GST).toBe(349); });
```

- [ ] **Step 2: Run** `bun test tests/own-customer-price.test.ts` — Expected: FAIL "Cannot find module ./own-customer-price.core".
- [ ] **Step 3: Implement** `ownCustomerRows` and the constants in `src/lib/own-customer-price.core.ts` (pure, no imports beyond the fee constant).
- [ ] **Step 4: Run** `bun test tests/own-customer-price.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** `git add src/lib/own-customer-price.core.ts tests/own-customer-price.test.ts && git commit -m "feat(own customers): approved quote lines and labels"`

---

### Task 2: Own-customer quote uses $349 PIESA + $349 fee, approved line names and order

**Files:**
- Modify: `src/lib/mitti-installer-quote.core.ts` (`buildMittiInstallerQuote`, `mittiQuoteElectricalBlocker`)
- Modify: `docs/HIV_WORKFLOW_SOURCE_OF_TRUTH.md`, `src/config/workflow-decisions.ts` (record the 2 Nov fee rule; mark decisions 302/303 as superseded for the own-customer owner price only)
- Test: `tests/own-customer-quote.test.ts`; update expectations in `tests/piesa-fee-onboarded-rec.test.ts`, `tests/mitti-electrician-options.test.ts`, `tests/mitti-e2e-repairs.test.ts` where they assert the owner's PIESA line equals the electrician's rate on A1.

**Interfaces:**
- Consumes: `OWN_CUSTOMER_PIESA_INC_GST`, `OWN_CUSTOMER_LABELS` (Task 1); `buildInstallerQuoteDraft` (`installer-led.core.ts`, unchanged).
- Produces: `buildMittiInstallerQuote(input, electrician)` — same signature; returns lines with `AP_FEE` description `"Home Insulation Victoria fee"` sort 1 and `PIESA` description `"Electrical safety check (PIESA)"` amount 349 sort 2, whatever `electrician.priceIncGst` is. `electrician.reasons` (not onboarded etc.) still become blockers. `mittiQuoteElectricalBlocker(lines, saved, current)` — the PIESA check now requires exactly one `PIESA` line of 349; a draft with a different PIESA amount returns `"Ready Check quote electrician price does not match the recorded choice"` (so an old held draft never goes out at the old amount).

- [ ] **Step 1: Write the failing tests**

```ts
for (const rate of [275, 349, 420]) test(`PIESA line is $349 when the electrician charges $${rate}`, () => {
  const d = buildMittiInstallerQuote(baseInput /* installer total 2000, 120 m², VEEC raw 600 */, { ...readyElectrician, priceIncGst: rate });
  const piesa = d.lines.filter((l) => l.code === "PIESA");
  expect(piesa.map((l) => [l.description, l.line_total_inc_gst])).toEqual([["Electrical safety check (PIESA)", 349]]);
  expect(d.lines.find((l) => l.code === "AP_FEE")).toMatchObject({ description: "Home Insulation Victoria fee", line_total_inc_gst: 349 });
  expect(d.subtotal).toBe(2698); expect(d.afterDiscount).toBe(2098);
});
test("fee before PIESA", () => expect(sortedCodes(d)).toEqual(["INSTALLER_PRICE", "AP_FEE", "PIESA"]));
test("old draft with the electrician's $275 PIESA holds", () =>
  expect(mittiQuoteElectricalBlocker([{ code: "AP_FEE", line_total_inc_gst: 349 }, { code: "PIESA", line_total_inc_gst: 275 }], saved, current)).toBe("Ready Check quote electrician price does not match the recorded choice"));
test("not-onboarded electrician still holds the quote", () => expect(buildMittiInstallerQuote(baseInput, notOnboarded).blockers).toContain(notOnboarded.reasons[0]));
test("$200 minimum co-payment still applies", () => { /* VEEC raw 2600 → afterDiscount === 200 */ });
```

- [ ] **Step 2: Run** `bun test tests/own-customer-quote.test.ts` — Expected: FAIL (PIESA equals the rate; descriptions are the old ones).
- [ ] **Step 3: Implement** in `buildMittiInstallerQuote`: pass `piesaIncGst: OWN_CUSTOMER_PIESA_INC_GST` to `buildInstallerQuoteDraft`, then set the `AP_FEE`/`PIESA` line descriptions and sorts from `OWN_CUSTOMER_LABELS`. In `mittiQuoteElectricalBlocker` compare the PIESA line to `OWN_CUSTOMER_PIESA_INC_GST` (the `current.priceIncGst === 0` branch is removed — every own-customer job has a PIESA line). Update the source-of-truth doc and `workflow-decisions.ts` with the fee rule text from the decisions file ("FEES (Jo 2 Nov, CORRECTION)").
- [ ] **Step 4: Run** `bun test tests/own-customer-quote.test.ts tests/piesa-fee-onboarded-rec.test.ts tests/mitti-electrician-options.test.ts tests/mitti-e2e-repairs.test.ts` — Expected: PASS (after updating the three existing files' A1 expectations to $349; their HIV-lead expectations unchanged).
- [ ] **Step 5: Commit** `git commit -m "feat(own customers): owner price = installer + \$349 fee + \$349 PIESA − rebate"`

---

### Task 3: "Enter your price" email replaces the office text

**Files:**
- Create: `src/lib/enter-price-email.core.ts`
- Modify: `src/lib/boss-price-link.server.ts` (`textBossPriceLink` → sends the email when approved, else the existing text; never both), `src/lib/template-hub.core.ts` (entry for the new email; text entry marked "replaced by the email once approved")
- Create: `docs/templates/mjml/installer_enter_price.mjml` (design sample from the renderer) and a sample render added to `scripts/render-decision-291-samples.ts`'s pattern — new script `scripts/render-enter-price-sample.ts`
- Test: `tests/enter-price-email.test.ts`, extend `tests/boss-price-link.test.ts`

**Interfaces:**
- Consumes: `bossPriceLink(base, jobId)`, `BOSS_PRICE_LINK_EVENT`, `bossPriceLinkKey`, `bossPriceLinkBlocker` (`boss-price-link.core.ts`, unchanged — one claim per job covers text OR email); `partnerEmailLayout` / `mjEmail` (`partner-email.core.ts`, `mail-mjml.core.ts`); `NOT_ON_READY_CHECK` (`installer-price.core.ts`); `sendOfficeEmail` (`office-email.server.ts`); the Ready Check document already saved as `documents.kind = 'mitti_report'` titled "Mitti Ready Check report" (`mitti.server.ts:368`).
- Produces:
  - `ENTER_PRICE_EMAIL_APPROVED = false as boolean`
  - `type EnterPriceFacts = { recipientFirst: string | null; checkerFirst: string | null; ownerFirst: string | null; ownerFull: string; jobNumber: string; address: string; readyCheckOn: string /* "Tue 4 Nov" */; measured: string; existing: string; removal: string; roof: string; access: string; product: string; downlights: string; builtLast5Years: "Yes" | "No" | null; lifeSupport: "Yes" | "No" | null; priceUrl: string; readyCheckPdfUrl: string | null; test?: boolean }`
  - `renderEnterPriceEmail(f: EnterPriceFacts): { subject: string; html: string; text: string }`
  - `enterPriceFactsFromReadyCheck(...)` lives in the server file (reads the same `currentReadyCheck(jobId)` the price card reads in `installer-price-set.server.ts`); any missing value = `NOT_ON_READY_CHECK`.

Approved body wording (price-email.png, verbatim): "Hi {recipientFirst}," · heading "Ready Check done. Time to price it." · "Here's what {checkerFirst} found at {ownerFirst}'s place. Enter your price and Home Insulation Victoria sends her the quote straight away." · card title "{HV} · {owner full name}", sub "{address} · Ready Check {Tue 4 Nov}", rows "Measured ceiling", "Existing insulation", "Removal needed", "Roof", "Access", "Product chosen", "Downlights", pills "Built in last 5 years: {Yes/No}" and "Life support: {Yes/No}" · button "Enter your price" · "Your price stays editable until the quote is sent." + link "See the full Ready Check ›" · footer "Home Insulation Victoria · VEU Accredited Person A003654" / "DC Construction Solutions Pty Ltd · ABN 44 671 613 979".

Not yet approved (draft → Jo approves before `ENTER_PRICE_EMAIL_APPROVED` turns on): the subject — draft `"{HV}: Ready Check done. Time to price it."`; the pronoun — the mock says "her"; the draft uses "them" ("…sends them the quote straight away") because the owner's gender isn't recorded.

- [ ] **Step 1: Write the failing tests**

```ts
test("approved wording", () => {
  const m = renderEnterPriceEmail(sample /* James, John, Sarah Brown, HV-1234, 12 Example St, Box Hill VIC 3128, Tue 4 Nov, 120 m² (2 areas), Thin batts, R1.0, None, Sloped, tiles, Standard, Bradford Gold R5.0, 4 LED, No, No */);
  for (const s of ["Hi James,", "Ready Check done. Time to price it.", "Here's what John found at Sarah's place. Enter your price and Home Insulation Victoria sends them the quote straight away.",
    "HV-1234 · Sarah Brown", "12 Example St, Box Hill VIC 3128 · Ready Check Tue 4 Nov", "Measured ceiling", "120 m² (2 areas)", "Product chosen", "Bradford Gold R5.0",
    "Built in last 5 years: No", "Life support: No", "Enter your price", "Your price stays editable until the quote is sent.", "See the full Ready Check ›",
    "Home Insulation Victoria · VEU Accredited Person A003654", "DC Construction Solutions Pty Ltd · ABN 44 671 613 979"]) expect(m.text).toContain(s);
  expect(m.subject).toBe("HV-1234: Ready Check done. Time to price it.");
  expect(m.html).toContain(sample.priceUrl);
  expect(m.text).not.toMatch(/\bHIV\b/);
});
test("no Ready Check PDF yet → no link, never an empty href", () => expect(renderEnterPriceEmail({ ...sample, readyCheckPdfUrl: null }).text).not.toContain("See the full Ready Check"));
test("missing answer reads 'Not on the Ready Check yet'", ...);
test("flag defaults off", () => expect(ENTER_PRICE_EMAIL_APPROVED).toBe(false));
// tests/boss-price-link.test.ts (module mocks as the file already does):
test("flag off → the existing text, no email", ...);
test("flag on → one email to the business office email, no text; claimed once under boss-price-link:v1:{job}", ...);
test("TEST job / TEST partner → test-send only", ...);
test("Home Insulation Victoria lead → nothing", ...);
```

- [ ] **Step 2: Run** `bun test tests/enter-price-email.test.ts tests/boss-price-link.test.ts` — Expected: FAIL (module missing; email branch missing).
- [ ] **Step 3: Implement** `renderEnterPriceEmail` with `partnerEmailLayout`-style MJML (light box `#eef0fc`, green button `#07bf61`); in `textBossPriceLink`, after the existing claim, branch on `ENTER_PRICE_EMAIL_APPROVED`: email to `businesses.email` via `sendOfficeEmail` (TEST → test-send), else the existing SMS. Recipient first name = the business signer's first name (assumption; see Assumptions). Render the sample to `docs/templates/mjml/installer_enter_price.mjml` with `bun scripts/render-enter-price-sample.ts`.
- [ ] **Step 4: Run** `bun test tests/enter-price-email.test.ts tests/boss-price-link.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(own customers): Enter your price email (held until Jo approves subject + pronoun)"`

---

### Task 4: "Enter your price" step — Boss or Office, "Send quote to owner"

**Files:**
- Modify: `src/lib/installer-price-set.server.ts` (`setInstallerPrice` permission + send-on-press), `src/lib/installer-price.functions.ts` (`setInstallerPriceFn` input gains `send: boolean`)
- Modify: `src/lib/auto-quote-send.core.ts` (new flag)
- Modify: `src/lib/installer-price.core.ts` (step copy)
- Test: `tests/installer-price.test.ts` (copy), `tests/installer-price-send.test.ts` (server, module mocks like `tests/boss-price-link.test.ts`)

**Interfaces:**
- Consumes: Part 5's Office role and its "can see prices" rule (use the exact name from Part 5's Interfaces block; Office and Boss = allowed, Lead Installer / Crew / Electrician = refused); `maybeAutoSendInstallerQuote(jobId, { formCompleted, formModifiedAt, enabled, entries })` (`auto-quote-send.server.ts`, existing `enabled` override); `priceCardLocked`, `PRICE_LOCKED` (existing).
- Produces:
  - `OWN_CUSTOMER_SEND_ON_PRESS_ENABLED = false` in `auto-quote-send.core.ts`
  - `ENTER_PRICE_STEP = { title: "Enter your price", send: "Send quote to owner", save: "Save", note: "Your price stays editable until the quote is sent." } as const`
  - `enterPriceButton(sendOnPress: boolean): string` → `"Send quote to owner"` when on, `"Save"` when off (a button that says "send" must send).
  - `setInstallerPrice(jobId, userId, input, opts?: { send?: boolean })` — unchanged writes; when `opts.send && OWN_CUSTOMER_SEND_ON_PRESS_ENABLED` it awaits `prepareQuoteFromPortal` then calls `maybeAutoSendInstallerQuote(..., { enabled: true, formCompleted: <Ready Check Complete> })`; every existing release check still applies; a hold returns its reasons to the screen (`{ stored, sent: false, reasons }`).
  - The Next step box (Part 5) renders `ENTER_PRICE_STEP` with the existing card fields (Product, Price, What's included, Notes) and `enterPriceButton(...)`.

- [ ] **Step 1: Write the failing tests**
  - `enterPriceButton(false) === "Save"`, `enterPriceButton(true) === "Send quote to owner"`; `ENTER_PRICE_STEP.note === "Your price stays editable until the quote is sent."`; `OWN_CUSTOMER_SEND_ON_PRESS_ENABLED === false`.
  - Server: Office member → saves (event `installer_price_set`, `set_by` = office user); Lead Installer / Crew → throws `"Only your business admin can do this."` replaced by Part 5's refusal text — assert it throws and writes nothing; Boss with `send: true`, flag on, Ready Check Complete, quote ready → `maybeAutoSendInstallerQuote` called once with `enabled: true`; flag off → not called and result `sent: false`; quote already sent → `PRICE_LOCKED` before any write; HIV lead → refused (`a1JobOrThrow`).
- [ ] **Step 2: Run** `bun test tests/installer-price.test.ts tests/installer-price-send.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the permission swap (`requireMember(userId, biz, true)` → Part 5's Boss-or-Office check), the `send` option and the copy constants.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(own customers): Office can enter the price; Send quote to owner behind a switch"`

---

### Task 5: Co-brand helper + own-customer quote email (lines, both logos, VEU box)

**Files:**
- Create: `src/lib/cobrand.core.ts`
- Modify: `src/lib/mail-mjml.core.ts` (`mjEmail` optional `partnerLogo`), `src/lib/owner-quote-email.core.ts` (`OwnerQuoteLine` gains `code?: string | null`; `OwnerQuoteEmailInput` gains `ownCustomer?: { installerName: string; installerLogoUrl: string | null } | null`), `src/lib/quote-ready-notify.server.ts` (passes `code` and, for `installer_sourced`, `ownCustomer` from `businesses.name` + Part 5's `businessLogoUrl(businessId)`)
- Test: `tests/cobrand.test.ts`, extend `tests/owner-quote-email.test.ts`

**Interfaces:**
- Consumes: `ownCustomerRows`, `OWN_CUSTOMER_LABELS` (Task 1); the VEU box renderer from Part 2 (use Part 2's exported name; the text is pinned below either way).
- Produces:
  - `OWN_CUSTOMER_COBRAND_APPROVED = false as boolean` (in `cobrand.core.ts`; one switch for email, page and invoice)
  - `cobrandLogos(i: { installerName: string | null; logoUrl: string | null }): { installer: { url: string; alt: string } | null }` — `null` unless `logoUrl` starts with `https://` and `installerName` is set; alt = installer name.
  - `mjEmail({ ..., partnerLogo?: { url: string; alt: string } | null })` — header shows our logo, then the installer's logo on the same row; absent = today's header byte-for-byte.
  - `renderOwnerQuoteEmail(i)` — builds on Part 3 Task 10's v4 quote email (`OWNER_QUOTE_EMAIL_V4_APPROVED`, 3 attached documents, 30-day validity line; Part 3 lands first). When `i.ownCustomer` is set AND `OWN_CUSTOMER_COBRAND_APPROVED`: rows from `ownCustomerRows` (by `code`), "Rebate" / "Your price" labels, both logos, VEU box at the bottom; everything else is Part 3's v4 email. Otherwise exactly what Part 3's email renders.

- [ ] **Step 1: Write the failing tests**

```ts
test("no logo / http logo / blank name → ours only", () => {
  expect(cobrandLogos({ installerName: "Rapid Insulation", logoUrl: null }).installer).toBeNull();
  expect(cobrandLogos({ installerName: "Rapid Insulation", logoUrl: "http://x/logo.png" }).installer).toBeNull();
  expect(cobrandLogos({ installerName: "Rapid Insulation", logoUrl: "https://x/logo.png" }).installer).toEqual({ url: "https://x/logo.png", alt: "Rapid Insulation" });
});
test("own-customer quote email (approved on)", () => {
  const m = render({ ...ownInput, cobrandApproved: true }); // lines with codes INSTALLER_PRICE 2000, AP_FEE 349, PIESA 349; rebate 600; total 2098
  expect(rowTitles(m.text)).toEqual(["Insulation", "Home Insulation Victoria fee", "Electrical safety check (PIESA)", "Rebate", "Your price"]);
  expect(m.text).toContain("Rebate: −$600.00"); expect(m.text).toContain("Your price: $2,098.00");
  expect(m.text).not.toMatch(/Home Insulation Victoria fee \(VEU-approved/);   // Review Focus 1
  expect(m.text).toContain("About the Victorian Energy Upgrades program — Home Insulation Victoria (DC Construction Solutions Pty Ltd, Accredited Person A003654) creates the rebate certificates for your job. We're not the Victorian Government or the Essential Services Commission. We follow the VEU code of conduct. Ask us for a copy any time.");
  expect(m.text).toContain("Read the Government's VEU consumer factsheet ›");
  expect(m.html).toContain("https://x/rapid-logo.png");
  expect(m.text).not.toContain("VEU discount");
});
test("own customer, no logo → one logo, no empty img", ...);
test("approval off → own customer gets Part 3's email unchanged", () => expect(render({ ...ownInput, cobrandApproved: false })).toEqual(renderOwnerQuoteEmail(withoutOwn(ownInput))));
test("Home Insulation Victoria lead unchanged", () => expect(renderOwnerQuoteEmail(hivInput)).toEqual(snapshotBefore));
```

  (`render` sets the flag through a test seam: `renderOwnerQuoteEmail(i, { cobrandApproved })` — second optional arg defaulting to `OWN_CUSTOMER_COBRAND_APPROVED`.)
- [ ] **Step 2: Run** `bun test tests/cobrand.test.ts tests/owner-quote-email.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `cobrandLogos`, the `partnerLogo` header row in `mjEmail`, and the own-customer branch in `renderOwnerQuoteEmail`; pass `code` + `ownCustomer` from `quote-ready-notify.server.ts` (reads `quote_items.code`; `businesses.name` and `businessLogoUrl(originating_installer_business_id)`).
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(own customers): co-branded quote email with approved lines and VEU box (held)"`

---

### Task 6: Co-branded quote page with the approved lines

**Files:**
- Modify: `src/components/owner/OwnerPageKit.tsx` (`OwnerPageHeader` optional `partnerLogo`), `src/lib/owner-myjob.server.ts` (`resolveOwnerJob` view adds `cobrand: { url: string; alt: string } | null` and `ownCustomerRows: OwnCustomerRow[] | null`, both null unless `installer_sourced` and `OWN_CUSTOMER_COBRAND_APPROVED`), `src/routes/my-job.$token.tsx` (header + `QuoteScreen` "What you're paying for" uses `ownCustomerRows` when present)
- Test: `tests/own-customer-quote-page.test.ts` (pure view builder), plus a 390px screen in Task 9's QA step

**Interfaces:**
- Consumes: `cobrandLogos`, `OWN_CUSTOMER_COBRAND_APPROVED` (Task 5); `ownCustomerRows` (Task 1). Part 3 owns the rest of the quote page (ticks, typed name, timing line, "What's changed from your estimate"); this task only changes the header and the price rows.
- Produces: pure `ownCustomerQuoteView(f: { channel: string | null; approved: boolean; installerName: string | null; logoUrl: string | null; items: {...}[]; rebateIncGst: number; totalIncGst: number }): { cobrand: { url: string; alt: string } | null; rows: OwnCustomerRow[] | null }` in `own-customer-price.core.ts`.

- [ ] **Step 1: Write the failing tests** — own customer + approved + https logo → `cobrand.alt === "Rapid Insulation"`, rows labels as Task 1; no logo → `cobrand === null`, rows still the approved lines; not approved → both null; `hivic_sourced` → both null.
- [ ] **Step 2: Run** `bun test tests/own-customer-quote-page.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `ownCustomerQuoteView`, call it in `resolveOwnerJob`, render `partnerLogo` beside our logo in `OwnerPageHeader` (both `h-9`, our logo first, no layout shift when absent) and the rows in `QuoteScreen`.
- [ ] **Step 4: Run** `bun test tests/own-customer-quote-page.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(own customers): co-branded quote page with approved lines (held)"`

---

### Task 7: Co-branded tax invoice with the approved lines

**Files:**
- Modify: the tax invoice renderer Part 1 creates (file and function names from Part 1's Interfaces block)
- Test: extend Part 1's tax invoice test file

**Interfaces:**
- Consumes: `cobrandLogos`, `OWN_CUSTOMER_COBRAND_APPROVED` (Task 5); `ownCustomerRows` (Task 1); Part 1's tax invoice input type (add `ownCustomer?: { installerName: string; installerLogoUrl: string | null } | null`).
- Produces: own-customer tax invoices (when approved) show both logos in the header and the line table `Insulation · Home Insulation Victoria fee · Electrical safety check (PIESA) · Rebate · Your price`; GST stays worked out on the full price before the rebate (Part 1's rule, unchanged); every ESC field Part 1 prints is still there.

- [ ] **Step 1: Write the failing tests** — own customer, approved, logo → rendered HTML contains the installer logo URL and the five labels in order; "Includes GST of $245.27, worked out on the price before the rebate" for a $2,698 full price ($2,698 ÷ 11 = $245.27); no logo → one logo; not approved or HIV lead → output equals Part 1's current snapshot.
- [ ] **Step 2: Run** `bun test <Part 1 tax invoice test>` — Expected: FAIL on the new cases.
- [ ] **Step 3: Implement** the `ownCustomer` branch in Part 1's renderer (header + rows only).
- [ ] **Step 4: Run** the same command — Expected: PASS; then render the sample PDF with `bun /home/claude/guide/pdf1.js`-equivalent repo script from Part 1 and check one page, no split sections.
- [ ] **Step 5: Commit** `git commit -m "feat(own customers): co-branded tax invoice (held)"`

---

### Task 8: Own customers never get pre-quote owner messages

**Files:**
- Test only (unless a test fails): `tests/own-customer-no-prequote.test.ts`
- Modify only if a test fails: the failing core's guard

**Interfaces:**
- Consumes: `estimateFollowupStop` (`estimate-followup.core.ts`), `spotSavedJobBlocker` (`spot-saved-send.core.ts`), `jobWaitingForInstaller` (`spot-release.core.ts`), `batchJobEligible` (`in-house-batch.core.ts` — note it already admits `installer_sourced` jobs into in-house batches), Part 3 Task 6's `sendInHousePartnerCall` / `ownerWillCallEmail` (`in-house-batch-email.server.ts`, `owner-will-call.core.ts`), Part 3 Task 5's re-ask (`phoneConsentCurrent`, `quickTapsGoLabel`; Part 3 already tests own customers are never re-asked), Part 3 Task 10's `quoteChangeRows`.
- Produces: pure `willCallAllowed(channel: string | null): boolean` in `owner-will-call.core.ts` (false for `installer_sourced`), called by `sendInHousePartnerCall` and `sweepInHousePartnerCalls` before any claim or send. Pins the spec rule "No estimate, Save my spot, It's your turn or 'will call' messages. The owner's first email from us is the quote." and Review Focus 5. One exception (Jo 2 Nov, answer 24): the rental quick-taps TEXT (Part 3 Task 19 `textOwnRentalTaps`, flag `OWN_CUSTOMER_RENTAL_TAPS_APPROVED` off) goes to the owner right after Add a job — a text, so the quote is still the first email; this task's test asserts it is the only pre-quote owner message.

- [ ] **Step 1: Write the tests** — an `installer_sourced` job at `ready_check_ready_to_schedule` with no estimate/spot facts: `estimateFollowupStop(...)` returns `"No estimate email has been sent"`; `spotSavedJobBlocker(...)` returns `"Spot not saved"`; `jobWaitingForInstaller({ channel: "installer_sourced", ... })` is `false`; `willCallAllowed("installer_sourced") === false`, `willCallAllowed("hivic_sourced") === true`; with module mocks, handing an own customer to an in-house partner batch records the hand-off but sends no will-call email or text (no `in-house-partner-call:v1:{job}` claim); `quoteChangeRows({ estimate: { areaM2: null, removal: null, price: null }, quote: {...} })` is `[]` so the own-customer quote email has no "What's changed from your estimate" heading.
- [ ] **Step 2: Run** `bun test tests/own-customer-no-prequote.test.ts` — Expected: FAIL on `willCallAllowed` (missing); the other cores PASS already.
- [ ] **Step 2b: Implement** `willCallAllowed` and call it at the top of `sendInHousePartnerCall` / in `sweepInHousePartnerCalls`' candidate filter. Re-run — Expected: PASS. Any other FAIL is a real gap: add the `channel === "installer_sourced"` guard in that core.
- [ ] **Step 3: Commit** `git commit -m "test(own customers): no pre-quote owner messages, no consent re-ask"`

---

### Task 9: Labels, Job details money rows and the pay rule

**Files:**
- Modify: `src/lib/own-customer-price.core.ts` (money rows), `src/lib/installer-home.core.ts` (`sourceLabel` re-exports the one in `installer-screens.core.ts` so the two can't drift)
- Test: `tests/own-customer-money.test.ts`

**Interfaces:**
- Consumes: `sourceLabel` (`installer-screens.core.ts`); `installerPayHeldReasons`, `INSTALLER_PAY_WAITING_OWNER` (`trade-view.core.ts`). Part 5 renders the rows inside its Job details fold and the label at the top of My work cards and the Job page.
- Produces: `jobMoneyRows(f: { channel: string | null; canSeePrices: boolean; ownerPriceIncGst: number | null; installerPriceIncGst: number | null; hivLeadPayIncGst: number | null }): [string, string][]` — own customer: `[["Owner's quote", "$2,098"], ["Your pay", "$2,000"]]`; Home Insulation Victoria lead: `[["Your pay", ...]]` only; `canSeePrices` false (Lead Installer / Crew) → `[]`. Pay line constant `OWN_CUSTOMER_PAY_RULE = "Your customers are paid once the office approves the paperwork and the owner has paid their balance."` (existing wording at `installer-screens.core.ts:1059`, moved here and imported back).

- [ ] **Step 1: Write the failing tests** — the three `jobMoneyRows` cases above; `sourceLabel("installer_sourced") === "Your customer"`, `sourceLabel("hivic_sourced") === "Home Insulation Victoria lead"`, and `installer-home.core`'s `sourceLabel` is the same function; `installerPayHeldReasons({ installerSupplied: true, apApprovedAt: "2026-11-10T00:00:00Z", ownerPaidInFullAt: null })` equals `[INSTALLER_PAY_WAITING_OWNER]`; with both set → `[]`.
- [ ] **Step 2: Run** `bun test tests/own-customer-money.test.ts` — Expected: FAIL (`jobMoneyRows` missing).
- [ ] **Step 3: Implement** `jobMoneyRows` and the label/pay-rule consolidation.
- [ ] **Step 4: Run** `bun test tests/own-customer-money.test.ts && bun run test` — Expected: PASS, whole suite green.
- [ ] **Step 5: QA + pictures for Jo** — `bun run installer-test --runs 1` (Add one job path, step C) and `bun run portal-qa --personas installer,owner`; capture at 390px: the "Enter your price" email, the Next step box, the own-customer quote email (with and without a logo), quote page, tax invoice page 1, My work card with "Your customer". Paste the wording as text. Each switch (`ENTER_PRICE_EMAIL_APPROVED`, `OWN_CUSTOMER_SEND_ON_PRESS_ENABLED`, `OWN_CUSTOMER_COBRAND_APPROVED`) stays false until Jo says yes to its picture.
- [ ] **Step 6: Commit** `git commit -m "feat(own customers): labels, Job details money rows, pay rule"`

---

### Task 10: Own customers — the electrician is paid their own rate; Home Insulation Victoria keeps the difference (Jo 2 Nov, answer 2)

The owner pays $349 for the PIESA on every own-customer job (Task 2). The electrician is paid their own rate through the installer's PIESA pay line (Part 5 Money: "PIESA pay $275"), never the owner's $349.

**Files:**
- Test: `tests/own-customer-piesa-pay.test.ts`
- Modify (only if the test finds a gap): `src/lib/job-margin.core.ts` (`piesaCostExFor`), the PIESA pay amount reader used by Money and payouts (`readInstallerPaidElectricians(businessId).piesaIncGst`, `installer-paid-electricians.server.ts`; `trade-view.server.ts` `tradeMoney`)

**Interfaces:**
- Consumes: Task 2 quote lines; `piesaCostExFor({ ownerDirect, paidOutInc, offerRateInc, rateCardInc })`, `jobMargin` (`job-margin.core.ts`); Part 5 Task 8 `moneyScreen` PIESA row.
- Produces: no new names; `docs/HIV_WORKFLOW_SOURCE_OF_TRUTH.md` + `workflow-decisions.ts` record "own customers: owner pays $349 PIESA; electrician paid own rate; Home Insulation Victoria keeps the difference (Jo 2 Nov)".

- [ ] **Step 1: Write the failing test** — own-customer job, owner PIESA line $349, rate card $275 → the PIESA pay amount is $275 (Money row `"PIESA pay $275"`), `piesaCostExFor(...)` = 250.00 ex GST, and `jobMargin` counts the $74 inc GST difference as Home Insulation Victoria's; rate card $420 → pay $420 (the difference is negative; still the electrician's own rate); no rate card line → pay row left out and logged, never $349; Home Insulation Victoria lead → unchanged.
- [ ] **Step 2: Run** `bun test tests/own-customer-piesa-pay.test.ts` — Expected: FAIL only where a gap exists (likely the doc/decision text); fix minimally.
- [ ] **Step 3: Run** `bun test tests/own-customer-piesa-pay.test.ts tests/job-margin*.test.ts tests/money-screen.test.ts` — Expected: PASS.
- [ ] **Step 4: Commit** `git commit -m "test(own customers): electrician paid own rate, Home Insulation Victoria keeps the PIESA difference"`

---

## Self-review notes

- Spec coverage: Add a job path (Part 5 owns the screen; Task 8 pins the no-pre-quote path) · VEU info on first email (Task 5) · Enter your price step (Task 4) + email (Task 3) · price lines (Tasks 1, 2) · co-branded quote email / page / invoice (Tasks 5, 6, 7) · labels (Task 9) · Job details owner's quote + pay (Task 9) · pay rule (Task 9) · no-logo fallback (Tasks 5–7) · consent re-ask website-only (Task 8).
- Removal: the office text #55 (`boss_price_link`) stops the day `ENTER_PRICE_EMAIL_APPROVED` turns on (Task 3); its code stays as the fallback until then, then is deleted in the switch-on commit (Part 11 checklist).

## Open questions for Jo

1. The VEU box says who makes the certificates, that we're not the Government and we follow the code. The code (cl 13, 14) also wants own customers told the scheme is voluntary and how complaints work, before the quote. Add a line for that to their quote email? (Needs your wording OK.)

## Decided (Jo, 2 Nov evening, and overview cross-part decisions)

- **Electrician pay (answer 2):** owner pays $349 PIESA; electrician paid their own rate (e.g. $275); Home Insulation Victoria keeps the difference (Task 10).
- **Installer pay on own customers:** once the owner has paid in full AND the paperwork gate passes (decided from earlier approvals; Task 9 as planned).
- **"Enter your price" subject and "them" instead of "her":** drafts approved from the Task 9 pictures at build time (Task 3), not separate questions.
- **Logo:** stored by Part 5 in `businesses.branding.logo_url`, read with `businessLogoUrl`.
- **Rentals (answer 24):** own customers get the rental quick taps by text after Add a job (Part 3 Task 19), not on the form; Part 4's tenant notice then works the same as for leads.

## Assumptions

- "Insulation (installer's price)" means the row label is "Insulation" and the amount is the installer's price; the product/area/inclusions text already on that line stays as the grey detail.
- Separately agreed removal/extras from older installer intakes show as their own rows under Insulation, in the installer's words.
- The signed acceptance PDF, receipts and other documents are not co-branded (spec names quote email, quote page and invoice only).
- "Enter your price" email goes to the installer business's office email (`businesses.email`), greeting the business signer's first name; the "found by" name is the person who completed the Mitti Ready Check.
- One switch (`OWN_CUSTOMER_COBRAND_APPROVED`) covers the new look on email, page and invoice, so Jo approves them together.
- While `OWN_CUSTOMER_SEND_ON_PRESS_ENABLED` is off the button says "Save" and the office still presses Send (today's behaviour), so no button promises a send that doesn't happen.
