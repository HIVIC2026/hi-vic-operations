# New job flow Part 1 — Documents and PDFs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every owner/trade PDF in the new flow is built in the approved website look and matches its approved sample, the lawyer-approved Customer Agreement v1.3 is a real approved compliance template, and the filled DEECA PIESA/PIISA forms go out as PDFs with every tick showing.

**Architecture:** The app runs on a worker that cannot run a browser or LibreOffice (`src/lib/AGENTS.md`: "Never import Playwright under `src/`"), so the approved HTML samples (made with Chromium) are rebuilt with **pdf-lib** through one shared layout kit: pure layout/pagination in `pdf-look.core.ts`, drawing in `pdf-look.server.ts`, Open Sans embedded via `@pdf-lib/fontkit`. Each document is a pure model (`*.core.ts`) plus a thin builder (`*-pdf.server.ts`). The DEECA forms stay DEECA's own: a build-time script converts each untouched official Word form (fields renamed uniquely) to a blank PDF with form widgets; at run time pdf-lib fills those widgets from the same placement rule the Word filler uses, then flattens. Every swap of a PDF that an approved message already attaches sits behind its own flag in `pdf-approvals.core.ts`, default `false`.

**Tech Stack:** TypeScript, pdf-lib + `@pdf-lib/fontkit` (new), fflate, pdfjs-dist (tests read text back), bun:test, PGlite for SQL, LibreOffice (`soffice`) in one build-time script only.

**Spec:** `docs/superpowers/specs/2026-11-02-new-job-flow-design.md` § "PDFs and official forms", § "Build fixes found in the live portal", § "VEU and ESC timing rules" (warranty + instructions); `docs/hiv-touchpoint-decisions.md`; approved samples in `docs/approved-samples/2026-11-02/` (copied by the overview's first commit).

## Global Constraints

- Coordinator update (2 Nov): the lawyer approved **Customer Agreement v1.3** (timing line). Load **v1.3 only** as the approved, active `customer_agreement` template; source = `docs/approved-samples/2026-11-02/agreement-web.html` / `customer-agreement-v1.3-final.pdf`. No v1.2 row and no v1.2→v1.3 switch. Later versions use the existing Settings path (add version → `approveComplianceTemplate`), no code change.
- Look: Open Sans (Regular, Bold, ExtraBold), blue `#3c51c4`, navy `#22376b`, green `#07bf61` (ticks, "Paid ✓"), light boxes `#eef0fc`, logo `public/email-preview/hi-vic-logo.png` (= `LOGO_PNG` in `src/lib/email-hero-assets.ts`), top bar on page 1 only.
- Page `450 × 636.96 pt` (the samples' `600px × 849px`), margins `22.5 / 30 / 34.5 pt` (= `30px 40px 46px`), page 1 top margin 0; footer `Home Insulation Victoria · Accredited Person A003654 under the Victorian Energy Upgrades program` left, `Page N of M` right.
- Never split a section across pages (move the whole section); every continued page has the same top margin; no stray bars.
- Business block: `DC Construction Solutions Pty Ltd` / `trading as Home Insulation Victoria` / `ABN 44 671 613 979 · Accredited Person A003654` / `info@homeinsulationvictoria.com.au`; the address line `1/33 Altree Court, Phillip ACT 2606` is added on the tax invoice and the VEEC form only (as in their approved samples). AP signer: Chris Lowe, Director, 0416 252 406.
- Official forms keep official wording exactly: ESC VEEC v1.1 (only fix: stray `”` after "assessment:"), DEECA PIESA/PIISA March 2026 (no restyle).
- "Home Insulation Victoria" in full; owners see "electrical safety check (PIESA)", "rebate", "electrical upgrades".
- Swaps of an attached PDF ship behind `PDF_LOOK_APPROVED.<doc>` (default `false`); nothing new is sent by this part.
- New SQL only in `docs/pending-migrations/`, proven on PGlite, never applied live without Jo's go-ahead. No force pushes.
- New dependencies go through `supermatt:dependency-vetting` before `bun add`.
- Read root `AGENTS.md`, `src/AGENTS.md`, `src/lib/AGENTS.md`, `scripts/AGENTS.md`; run `bun scripts/scan-retired-terms.ts` before starting.

## Review Focus

1. **A section taller than one page** (long site notes, many payments). It must still render: split at its child boundaries, never cut a line, and the layout report says so. Task 1 test `oversized section splits at child boundaries`.
2. **Missing facts on a document** (no Xero invoice number, product unconfirmed, no installer office phone). The builder returns `{ held: reason }` and never prints a blank or a guess. Tasks 5 and 6 tests.
3. **A DEECA follow-up answered although its condition is false** (life support "No" + a consent option). Nothing prints for it; it is listed as `skipped`. Task 10 test.
4. **Characters Open Sans can't draw** (emoji in an owner's name, `’` `–` `²` `✓`). Kept when the font has them, mapped by `pdfSafeText` otherwise; never throws. Task 1 test.
5. **Old jobs signed under the text PDFs.** Their stored copies are never re-rendered; flags off = byte-identical old path. Tasks 4, 8, 12 tests `flag off keeps the old builder`.

---

## File map

| File | Responsibility |
|---|---|
| `src/lib/pdf-look.core.ts` (create) | Tokens, block model, word wrap, keep-together pagination (pure) |
| `src/lib/pdf-look.server.ts` (create) | pdf-lib drawing of a laid-out document; fonts, logo, footer |
| `src/lib/pdf-fonts.data.ts` (generated) / `scripts/embed-pdf-fonts.ts` (create) | Open Sans bytes |
| `src/lib/pdf-approvals.core.ts` (create) | `PDF_LOOK_APPROVED` flags |
| `src/lib/customer-agreement.core.ts` / `.server.ts` / `-pdf.server.ts` (create) | v1.3 body, fill, read active row, PDF |
| `docs/pending-migrations/customer-agreement-v1-3.sql` + `.rollback.sql` (create) | Load v1.3 approved + active |
| `src/lib/signed-pdf.server.ts` (modify) | New-look signed acceptance |
| `src/lib/receipt-pdf.core.ts` / `.server.ts` (create) | Three receipts |
| `src/lib/tax-invoice-pdf.core.ts` / `.server.ts` (create) | Tax invoice |
| `src/lib/statement-of-rights.data.ts` (generated) / `scripts/embed-statement-of-rights.ts` (create) | ESC Statement of rights PDF |
| `src/lib/veec-form-pdf.server.ts` (create), `veec-assignment-form.core.ts` (modify) | VEEC form look + stray quote |
| `src/lib/official-docx.core.ts`, `official-forms.core.ts` (modify) | Unique field names, shared placement, condition check |
| `scripts/official-form-blank-pdf.ts`, `src/lib/official-pdf-{piesa,piisa}.data.ts` (create) | DEECA blank PDFs with widgets |
| `src/lib/official-form-pdf.server.ts` (create), `official-piesa-pdf.server.ts` (modify) | Filled DEECA PDF |
| `src/lib/product-warranty.core.ts` (modify), `product-instructions.core.ts` (create) | Warranty map, instructions map |

---

### Task 1: Website-look PDF kit

**Files:**
- Create: `src/lib/pdf-look.core.ts`, `src/lib/pdf-look.server.ts`, `scripts/embed-pdf-fonts.ts`, `src/lib/pdf-fonts.data.ts` (generated), `src/lib/pdf-approvals.core.ts`
- Modify: `package.json` (add `@pdf-lib/fontkit`, devDependency `@fontsource/open-sans`)
- Test: `tests/pdf-look.test.ts`

**Interfaces:**
- Produces (used by Tasks 3–8 and by Part 7's SWMS restyle):
  - `PDF_PAGE = { width: 450, height: 636.96, top: 22.5, side: 30, bottom: 34.5, firstTop: 0 } as const`
  - `PDF_COLOURS = { blue: "#3c51c4", navy: "#22376b", green: "#07bf61", box: "#eef0fc", muted: "#5d6785", ink: "#22376b" } as const`
  - `PDF_FOOTER_LEFT = "Home Insulation Victoria · Accredited Person A003654 under the Victorian Energy Upgrades program"`
  - `BUSINESS_LINES: readonly string[]` (4 lines above) and `BUSINESS_ADDRESS = "1/33 Altree Court, Phillip ACT 2606"`
  - `type PdfBlock = { id: string; keepTogether?: boolean } & ({ kind: "header"; eyebrow: string; withAddress?: boolean } | { kind: "title"; text: string; sub?: string } | { kind: "para"; text: string; muted?: boolean; small?: boolean } | { kind: "facts"; rows: [string, string][] } | { kind: "section"; number?: string; title: string; children: PdfBlock[] } | { kind: "bullets"; items: string[] } | { kind: "money"; rows: { label: string; amount: string; strong?: boolean; green?: boolean }[] } | { kind: "ticks"; items: string[] } | { kind: "signature"; label: string; name: string; at: string; sub?: string } | { kind: "box"; children: PdfBlock[] } | { kind: "image"; bytes: Uint8Array; width: number; height: number } | { kind: "pageBreak" })`
  - `type PdfDoc = { title: string; blocks: PdfBlock[] }`
  - `type PdfLayoutReport = { pages: number; blockPage: Record<string, number>; split: string[]; topBarPages: number[]; images: { block: string; page: number }[] }` (`images` lists every embedded picture except the logo — Task 8's Part B signature test reads it)
  - `paginate(heights: { id: string; height: number; keepTogether: boolean; childHeights?: number[] }[], firstPageSpace: number, pageSpace: number): { page: number; id: string; part?: number }[]` (pure)
  - `wrapText` — reuse the existing one from `src/lib/swms-pdf.server.ts` by moving it into `pdf-look.core.ts` and re-exporting it from `swms-pdf.server.ts` (no behaviour change).
  - `renderPdf(doc: PdfDoc): Promise<{ bytes: Uint8Array; layout: PdfLayoutReport }>` in `pdf-look.server.ts`
  - `PDF_LOOK_APPROVED: Record<"signedAcceptance" | "receipts" | "taxInvoice" | "veecForm" | "officialFormPdf" | "escConsent", boolean>` all `false`

- [ ] **Step 1: Vet the dependency.** Run `supermatt:dependency-vetting` on `@pdf-lib/fontkit` and `@fontsource/open-sans`, then `bun add @pdf-lib/fontkit && bun add -d @fontsource/open-sans`.

- [ ] **Step 2: Write the failing test** `tests/pdf-look.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { PDF_PAGE, PDF_FOOTER_LEFT, paginate } from "../src/lib/pdf-look.core";
import { renderPdf } from "../src/lib/pdf-look.server";
import { PDF_LOOK_APPROVED } from "../src/lib/pdf-approvals.core";
const text = async (b: Uint8Array) => { const d = await getDocument({ data: b }).promise; const out: string[] = []; for (let i = 1; i <= d.numPages; i++) out.push((await (await d.getPage(i)).getTextContent()).items.map((x: any) => x.str).join(" ")); return out; };

describe("pdf-look kit", () => {
  test("page size and footer", async () => {
    const { bytes, layout } = await renderPdf({ title: "T", blocks: [{ id: "h", kind: "header", eyebrow: "RECEIPT · JOB HV-1234" }, { id: "p", kind: "para", text: "Thanks, Sarah" }] });
    const { PDFDocument } = await import("pdf-lib");
    const p = (await PDFDocument.load(bytes)).getPage(0).getSize();
    expect([p.width, p.height]).toEqual([450, 636.96]);
    const [t1] = await text(bytes);
    expect(t1).toContain("DC Construction Solutions Pty Ltd");
    expect(t1).toContain(PDF_FOOTER_LEFT);
    expect(t1).toContain("Page 1 of 1");
    expect(layout.topBarPages).toEqual([1]);
  });
  test("a section that doesn't fit moves whole to the next page", () => {
    const space = PDF_PAGE.height - PDF_PAGE.top - PDF_PAGE.bottom;
    const r = paginate([{ id: "a", height: space - 50, keepTogether: true }, { id: "b", height: 120, keepTogether: true }], space, space);
    expect(r).toEqual([{ page: 1, id: "a" }, { page: 2, id: "b" }]);
  });
  test("oversized section splits at child boundaries", () => {
    const space = 500;
    const r = paginate([{ id: "big", height: 900, keepTogether: true, childHeights: [300, 300, 300] }], space, space);
    expect(r).toEqual([{ page: 1, id: "big", part: 0 }, { page: 2, id: "big", part: 1 }, { page: 3, id: "big", part: 2 }]);
  });
  test("characters outside the font never throw", async () => {
    const { bytes } = await renderPdf({ title: "T", blocks: [{ id: "p", kind: "para", text: "Sarah 🏠 O’Brien – 137 m² ✓" }] });
    expect((await text(bytes))[0]).toContain("O’Brien");
  });
  test("every swap flag starts off", () => {
    expect(Object.values(PDF_LOOK_APPROVED).every((v) => v === false)).toBe(true);
  });
});
```

- [ ] **Step 3: Run it, expect FAIL.** Run: `bun test tests/pdf-look.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 4: Implement.** `scripts/embed-pdf-fonts.ts` reads `node_modules/@fontsource/open-sans/files/open-sans-latin-{400,700,800}-normal.woff` and writes `src/lib/pdf-fonts.data.ts` exporting `OPEN_SANS_400`, `OPEN_SANS_700`, `OPEN_SANS_800` (base64, same pattern as `OUTFIT_800_WOFF` in `email-hero-assets.ts`); run it and commit the output. If fontkit can't embed WOFF (test fails on embed), switch the script to the Google Fonts TTFs fetched through the Lovable sandbox (precedent: warranties, 25 Oct) — same export names. `pdf-look.core.ts`: tokens, block types, `wrapText` (moved), `paginate` (keep-together first; a section taller than a full page splits only between children and is listed in `layout.split`). `pdf-look.server.ts`: `renderPdf` measures each block with the embedded fonts, paginates, draws (header with logo + business block and the blue top bar on page 1 only; same top margin on later pages), then a second pass writes `Page N of M`; every string through `pdfSafeText` with the Open Sans character set.

- [ ] **Step 5: Run it, expect PASS.** Run: `bun test tests/pdf-look.test.ts tests/swms-pdf.test.ts` — Expected: PASS (SWMS unchanged).

- [ ] **Step 6: Commit**

```bash
git add package.json bun.lock scripts/embed-pdf-fonts.ts src/lib/pdf-fonts.data.ts src/lib/pdf-look.core.ts src/lib/pdf-look.server.ts src/lib/pdf-approvals.core.ts src/lib/swms-pdf.server.ts tests/pdf-look.test.ts
git commit -m "feat(pdf): shared website-look PDF kit (Open Sans, page rules, footer)"
```

---

### Task 2: Customer Agreement v1.3 as the approved compliance template

**Files:**
- Create: `src/lib/customer-agreement.core.ts`, `src/lib/customer-agreement.server.ts`, `docs/pending-migrations/customer-agreement-v1-3.sql`, `docs/pending-migrations/customer-agreement-v1-3.rollback.sql`
- Test: `tests/customer-agreement.core.test.ts`, `tests/customer-agreement-template-db.test.ts`

**Interfaces:**
- Produces:
  - `CUSTOMER_AGREEMENT_KEY = "customer_agreement"`, `CUSTOMER_AGREEMENT_VERSION = "1.3"`, `CUSTOMER_AGREEMENT_V1_3: string` (body, verbatim from `agreement-web.html`, both pages: agreement + "PAYMENT TERMS")
  - Body markup (one line each): `# ` page title, `## N Title` numbered section, `- ` bullet, `> Label | value` facts row, `$ Label | {amount}` money row, plain line = paragraph, `---` new page. Placeholders `{owner_name} {address} {job_number} {installer_name} {installer_phone} {installer_email} {product} {area_m2} {price_before_rebate} {rebate} {your_price} {valid_until} {safety_check} {deposit} {rest} {version}`.
  - `type AgreementFacts = Record<"owner_name" | "address" | "job_number" | "installer_name" | "installer_phone" | "installer_email" | "product" | "area_m2" | "price_before_rebate" | "rebate" | "your_price" | "valid_until" | "safety_check" | "deposit" | "rest", string>`
  - `fillAgreement(body: string, facts: AgreementFacts, version: string): string` — throws `Missing agreement detail: {name}` for any empty or unknown placeholder
  - `parseAgreement(filled: string): PdfBlock[]` (Task 1 block types)
  - `paymentTermsPart(body: string): string` — the text after the `# PAYMENT TERMS` page marker (Part 2 uses it for the Gate B payment terms)
  - `activeCustomerAgreement(): Promise<{ version: string; body: string } | null>` in `.server.ts` (approved + active row only)

- [ ] **Step 1: Write the failing tests.** `tests/customer-agreement.core.test.ts`:

```ts
import { expect, test } from "bun:test";
import { CUSTOMER_AGREEMENT_V1_3 as B, fillAgreement, paymentTermsPart } from "../src/lib/customer-agreement.core";
test("v1.3 carries the lawyer-approved lines verbatim", () => {
  expect(B).toContain("Install: booked once your deposit is paid, and done within 30 days of the electrical safety check (PIESA). Your installer will confirm the day with you. Most installs are finished on the day they start.");
  expect(B).toContain("If your balance is overdue, we charge interest at the Victorian penalty interest rate (currently 10% a year), worked out daily from the day it becomes overdue until it's paid. We don't charge collection costs. If we have to take you to court or VCAT to recover an overdue balance, you may have to pay the legal costs the court or VCAT orders.");
  expect(B).toContain("Cooling-off: no cooling-off period applies. You asked for a quote and accepted it online in your own time.");
  expect(B).not.toMatch(/We don't charge interest/);
  expect(paymentTermsPart(B)).toContain("If you need electrical upgrades, you pay your electrician directly. They're not part of our price.");
});
test("a missing detail fails closed", () => {
  expect(() => fillAgreement(B, { owner_name: "Sarah Brown" } as never, "1.3")).toThrow(/Missing agreement detail/);
});
```

`tests/customer-agreement-template-db.test.ts`: copy the `BASE` schema + guard trigger from `tests/esc-consent-template-db.test.ts`, run the pending SQL, then:

```ts
test("v1.3 is the one approved, active customer_agreement", async () => {
  const r = await db.query("select version, approved, is_active, body from compliance_templates where template_key='customer_agreement'");
  expect(r.rows).toHaveLength(1);
  expect(r.rows[0]).toMatchObject({ version: "1.3", approved: true, is_active: true, body: CUSTOMER_AGREEMENT_V1_3 });
});
test("approved wording is immutable", async () => {
  await expect(db.query("update compliance_templates set body='x' where template_key='customer_agreement'")).rejects.toThrow(/immutable/);
});
test("a later version replaces it through the Settings approval path", async () => {
  await db.query("insert into compliance_templates (template_key, version, body) values ('customer_agreement','1.4','next body text long enough')");
  await db.query("update compliance_templates set is_active=false where template_key='customer_agreement' and is_active");
  await db.query("update compliance_templates set approved=true, is_active=true where template_key='customer_agreement' and version='1.4'");
  const r = await db.query("select version from compliance_templates where template_key='customer_agreement' and approved and is_active");
  expect(r.rows).toEqual([{ version: "1.4" }]);
});
test("rollback removes only the v1.3 row", async () => { /* run rollback, expect 0 customer_agreement rows */ });
```

- [ ] **Step 2: Run, expect FAIL.** Run: `bun test tests/customer-agreement.core.test.ts tests/customer-agreement-template-db.test.ts` — Expected: FAIL (module / SQL file not found).

- [ ] **Step 3: Implement.** Transcribe `CUSTOMER_AGREEMENT_V1_3` word for word from `agreement-web.html` (check against `pdftotext customer-agreement-v1.3-final.pdf`), replacing the sample values with the placeholders above. SQL: `INSERT … (template_key, version, body, approved, approved_by, approved_at, is_active, source_note) VALUES ('customer_agreement', '1.3', $body$…$body$, true, '<Jo's profile id, as 0226>', '2026-11-02', true, 'Lawyer approved 2 Nov 2026 (customer-agreement-v1.3-final.pdf)') ON CONFLICT (template_key, version) DO NOTHING;` — body pasted from the constant (the DB test proves they match). Rollback deletes that row with the guard trigger disabled inside the transaction (as 0226's rollback does). `activeCustomerAgreement` selects `version, body` where `template_key='customer_agreement' and approved and is_active`.

- [ ] **Step 4: Run, expect PASS.** Same command — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/customer-agreement.core.ts src/lib/customer-agreement.server.ts docs/pending-migrations/customer-agreement-v1-3*.sql tests/customer-agreement*.test.ts
git commit -m "feat(agreement): load lawyer-approved Customer Agreement v1.3 as compliance template (pending SQL)"
```

---

### Task 3: Customer Agreement + payment terms PDF

**Files:**
- Create: `src/lib/customer-agreement-pdf.server.ts`
- Test: `tests/customer-agreement-pdf.test.ts`

**Interfaces:**
- Consumes: `fillAgreement`, `parseAgreement` (Task 2); `renderPdf` (Task 1)
- Produces: `customerAgreementPdf(t: { version: string; body: string }, facts: AgreementFacts): Promise<{ bytes: Uint8Array; layout: PdfLayoutReport; fileName: string }>`; `fileName = "Customer-Agreement-and-payment-terms-v1.3.pdf"` pattern `Customer-Agreement-and-payment-terms-v{version}.pdf`. Used by Part 3 (quote email attachment, quote page link) and Task 4.

- [ ] **Step 1: Failing test** — with `SAMPLE_FACTS` (Sarah Brown, 12 Example St, Box Hill VIC 3128, HV-1234, Rapid Insulation, 03 9000 0000, office@rapidinsulation.com.au, "Bradford Gold R5.0 ceiling batts", "137", "$3,798.00", "$1,610.00", "$2,188.00", "Mon 8 Dec 2026", "$349", "$183.90", "$1,655.10"):  // deposit = 10% of the price after the $349 (Jo 2 Nov, answer 1)

```ts
test("4 pages like the approved sample, payment terms on its own page", async () => {
  const r = await customerAgreementPdf({ version: "1.3", body: CUSTOMER_AGREEMENT_V1_3 }, SAMPLE_FACTS);
  expect(r.layout.pages).toBe(4);
  expect(r.layout.split).toEqual([]);
  const pages = await pdfText(r.bytes);
  expect(pages.join(" ")).toContain("Install Bradford Gold R5.0 ceiling batts across 137 m² of your ceiling, as in your quote.");
  expect(pages.findIndex((p) => p.includes("PAYMENT TERMS"))).toBe(r.layout.blockPage["payment-terms"]! - 1);
  expect(pages.join(" ")).toContain("Version 1.3");
});
```

- [ ] **Step 2: Run, expect FAIL.** `bun test tests/customer-agreement-pdf.test.ts`
- [ ] **Step 3: Implement** `customerAgreementPdf` = `renderPdf({ title, blocks: parseAgreement(fillAgreement(...)) })`; the `---` marker becomes `pageBreak` and the payment-terms page gets block id `payment-terms`.
- [ ] **Step 4: Run, expect PASS.** Also write the sample to `docs/approved-samples/2026-11-02/built/customer-agreement.pdf` with `bun scripts/render-pdf-samples.ts agreement` (create the script here; later tasks add their document names) for Jo's side-by-side.
- [ ] **Step 5: Commit** `git commit -m "feat(agreement): Customer Agreement + payment terms PDF in website look"`

---

### Task 4: Signed acceptance PDF (page 1 + full agreement, Chris Lowe counter-signature)

**Files:**
- Modify: `src/lib/signed-pdf.server.ts` (add `signedAcceptancePdfV2`; keep `signedAcceptancePdf` for flag off), `src/lib/assignment.server.ts:317-340` (choose builder by flag)
- Create: `src/lib/signed-acceptance.core.ts`
- Test: `tests/signed-acceptance-pdf-v2.test.ts`; keep `tests/signed-acceptance-pdf-b4.test.ts` green

**Interfaces:**
- Produces:
  - `AP_COUNTERSIGNER = { name: "Chris Lowe", role: "Director, DC Construction Solutions Pty Ltd" } as const` (Part 3 records the counter-signature with these values at the owner's signing moment)
  - `ACCEPTANCE_TICKS = [tick1, tick2]` — exact strings below (Part 3's quote page imports them so page and PDF can't drift)
  - `type SignedAcceptanceInput = { jobNumber: string; installerName: string; ownerName: string; ownerTypedName: string; address: string; signedAt: string; validUntil: string; quoteLine: string; priceBeforeRebate: number; rebate: number; yourPrice: number; removalM2: number | null; agreement: { version: string; approvedOn: string; body: string; facts: AgreementFacts } }`
  - `signedAcceptancePdfV2(i: SignedAcceptanceInput): Promise<{ bytes: Uint8Array; layout: PdfLayoutReport }>`

- [ ] **Step 1: Failing test:**

```ts
import { ACCEPTANCE_TICKS, AP_COUNTERSIGNER } from "../src/lib/signed-acceptance.core";
test("exact tick wording", () => {
  expect(ACCEPTANCE_TICKS).toEqual([
    "I accept this quote, the Customer Agreement and the payment terms, and I've been given my Statement of rights under the VEU program. I'm 18 or over, I own this home (or I'm allowed to sign for the owner), and I'm happy to get my documents by email.",
    "I understand my install must be done within 30 days of my electrical safety check (PIESA), as the rebate rules require.",
  ]);
});
test("5 pages; page 1 has scope lines and both signatures", async () => {
  const r = await signedAcceptancePdfV2(SAMPLE); // Sat 8 Nov 2026 7:42pm Melbourne, removal 40 m²
  expect(r.layout.pages).toBe(5);
  const [p1] = await pdfText(r.bytes);
  for (const s of ["Signed acceptance of your quote", "Signed online on Sat 8 Nov 2026, 7:42pm (Melbourne time)", "Old insulation removal", "Yes, 40 m²", "Electrical upgrades", "Not included. Your electrician quotes these if the safety check finds any.", "How you pay: $349 now for the electrical safety check (PIESA). 10% to book your install day. The rest on install day.", "Owner signature (typed online)", "Signed for Home Insulation Victoria", AP_COUNTERSIGNER.name, AP_COUNTERSIGNER.role, "Customer Agreement and payment terms", "Version 1.3, 2 Nov 2026"]) expect(p1).toContain(s);
});
test("no removal prints No", async () => { expect((await pdfText((await signedAcceptancePdfV2({ ...SAMPLE, removalM2: null })).bytes))[0]).toMatch(/Old insulation removal\s*No/); });
test("flag off keeps the old builder", () => {
  const src = readFileSync("src/lib/assignment.server.ts", "utf8");
  expect(src).toMatch(/PDF_LOOK_APPROVED\.signedAcceptance\s*\?\s*.*signedAcceptancePdfV2[\s\S]*:\s*.*signedAcceptancePdf\(/);
});
```

- [ ] **Step 2: Run, expect FAIL.** `bun test tests/signed-acceptance-pdf-v2.test.ts`
- [ ] **Step 3: Implement.** Page 1 blocks per `accept-full.html`; pages 2–5 = Task 3's agreement blocks with the agreement's `Signed` line filled as `Signed by {owner} (typed name: {typed}) on the quote page on {date, time}.` In `assignment.server.ts`, when the flag is on, build `SignedAcceptanceInput` from `pkg` + `activeCustomerAgreement()`; if that returns null, keep the old builder and log `signed_acceptance_pdf_fallback` (internal) — never fail the signing.
- [ ] **Step 4: Run, expect PASS.** `bun test tests/signed-acceptance-pdf-v2.test.ts tests/signed-acceptance-pdf-b4.test.ts`
- [ ] **Step 5: Commit** `git commit -m "feat(acceptance): website-look signed acceptance with Chris Lowe counter-signature (flagged)"`

---

### Task 5: Receipt PDFs ($349, deposit, final)

**Files:**
- Create: `src/lib/receipt-pdf.core.ts`, `src/lib/receipt-pdf.server.ts`
- Test: `tests/receipt-pdf.test.ts`

**Interfaces:**
- Produces:
  - `type ReceiptStep = "safety_check" | "install_deposit" | "balance"`
  - `type ReceiptInput = { step: ReceiptStep; jobNumber: string; ownerName: string; firstName: string; address: string; paidOn: string; method: "card" | "bank"; amountCents: number; yourPriceCents: number; earlier: { label: string; paidOn: string; cents: number }[] }`
  - `receiptModel(i: ReceiptInput): { heading: string; paidLine: string; rows: { label: string; amount: string }[]; stillToPay: string; gstLine: string | null }` (pure)
  - `receiptPdf(i: ReceiptInput): Promise<Uint8Array>`; `fileReceiptPdf(jobId: string, step: ReceiptStep, receiptKey: string): Promise<{ path: string } | { held: string }>` (stores `documents` kind `receipt`, idempotent on `receiptKey` = the ledger `receipt_key`). Consumers attach it: Part 2 ("You're in!"), Part 4 ("Deposit received", final payment).

- [ ] **Step 1: Failing test** (layout and wording from `rec-dep.html`, `rec-bal.html`, `receipt.html`; amounts from Jo's 2 Nov answer 1 — the 10% deposit is 10% of the price after the $349, the portal's existing `paymentPlan` maths: $183.90 on $2,188, leaving $1,655.10. The approved samples still show $218.80 / $1,620.20 and are re-rendered in Step 4):

```ts
test("deposit = 10% of the price after the $349 (existing paymentPlan maths)", () => {
  const p = paymentPlan({ quoteTotalCents: 218800, safetyCheckCents: 34900 });
  expect(p.installDepositCents).toBe(18390);
  expect(p.balanceCents).toBe(165510);
});
test("deposit receipt running list", () => {
  const m = receiptModel({ step: "install_deposit", firstName: "Sarah", method: "card", amountCents: 18390, yourPriceCents: 218800, earlier: [{ label: "Electrical safety check (PIESA)", paidOn: "8 Nov", cents: 34900 }], paidOn: "Mon 10 Nov 2026" } as never);
  expect(m.heading).toBe("We've received your deposit.");
  expect(m.rows).toEqual([{ label: "Your price (incl. GST)", amount: "$2,188.00" }, { label: "Electrical safety check (PIESA), paid 8 Nov", amount: "– $349.00" }, { label: "10% deposit, paid today", amount: "– $183.90" }]);
  expect(m.stillToPay).toBe("$1,655.10 on install day");
});
test("final receipt ends Paid in full", () => {
  expect(receiptModel(FINAL).stillToPay).toBe("$0.00 · Paid in full ✓");
  expect(receiptModel(FINAL).heading).toBe("We've received your final payment.");
});
test("$349 receipt shows GST", () => { expect(receiptModel(SAFETY).gstLine).toBe("Includes GST $31.73"); });
test("each PDF is one page", async () => { for (const i of [SAFETY, DEPOSIT, FINAL]) expect((await PDFDocument.load(await receiptPdf(i))).getPageCount()).toBe(1); });
```

- [ ] **Step 2: Run, expect FAIL.** `bun test tests/receipt-pdf.test.ts`
- [ ] **Step 3: Implement.** Labels: `safety_check` → "Electrical safety check (PIESA)"; `install_deposit` → "10% deposit to book your install day"; `balance` → "The rest of your price, due on install day". Heading: "We've received your payment." / "…your deposit." / "…your final payment.". `fileReceiptPdf` reads the job, owner, ledger rows via the existing `payments.server.ts` readers (no new money logic — the deposit amount is always `paymentPlan(...).installDepositCents`, never recomputed here); missing owner name or price → `{ held: "Receipt not made: <what's missing>" }`.
- [ ] **Step 4: Run, expect PASS.** Then fix the approved samples so Jo's pictures match the maths (answer 1): in `docs/approved-samples/2026-11-02/` change `rec-dep.html` ($218.80 → $183.90; still to pay $1,620.20 → $1,655.10), `rec-bal.html` (deposit row – $183.90, final payment – $1,655.10), `inv-web.html` (payments – $183.90 and – $1,655.10) and `accept-full.html` (deposit $183.90, rest $1,655.10); re-render `receipt-deposit.pdf`, `receipt-balance.pdf`, `tax-invoice-sample.pdf` and `acceptance-sample.pdf` with `node /home/claude/guide/pdf1.js` (same renderer as the originals); grep the four HTML files for `218.80` and `1,620.20` → none left. The re-rendered deposit receipt goes in Jo's sign-off pictures (Finish) before `PDF_LOOK_APPROVED.receipts` turns on.
- [ ] **Step 5: Commit** `git commit -m "feat(receipts): receipt PDFs with running still-to-pay list; samples re-rendered with the 10%-after-\$349 deposit"`

---

### Task 6: Tax invoice PDF (every ESC field, GST on the full price)

**Files:**
- Create: `src/lib/tax-invoice-pdf.core.ts`, `src/lib/tax-invoice-pdf.server.ts`
- Test: `tests/tax-invoice-pdf.test.ts`

**Interfaces:**
- Consumes: `installedProductLine` / product facts from `src/lib/invoice-itemisation.core.ts`
- Produces:
  - `gstOnFullPriceCents(priceBeforeRebateCents: number): number` = `Math.round(c / 11)`
  - `type TaxInvoiceFacts = { invoiceNumber: string | null; invoiceDate: string; ownerName: string; installAddress: string; installerName: string; installedOn: string; productLine: string | null; productCents: number; piesaCents: number; extraLines?: { label: string; cents: number }[]; rebateCents: number; payments: { label: string; paidOn: string; cents: number }[] }`
  - `taxInvoiceModel(f: TaxInvoiceFacts): { held: string } | { rows; priceBeforeRebate: string; rebate: string; payable: string; gstLine: string; balance: string }`
  - `taxInvoicePdf(f): Promise<{ held: string } | { bytes: Uint8Array }>`; `fileTaxInvoicePdf(jobId: string): Promise<{ path: string } | { held: string }>` (documents kind `tax_invoice`). `extraLines` is how Part 10 adds the "Home Insulation Victoria fee $349" line for own customers.

- [ ] **Step 1: Failing test** (values from `inv-web.html` as re-rendered in Task 5 Step 4: `SAMPLE.payments` = $349.00, $183.90, $1,655.10):

```ts
test("GST on the full price before the rebate", () => { expect(gstOnFullPriceCents(379800)).toBe(34527); });
test("sample payments add up to the price", () => { expect(SAMPLE.payments.map((p) => p.cents)).toEqual([34900, 18390, 165510]); });
test("sample invoice", () => {
  const m = taxInvoiceModel(SAMPLE) as any;
  expect(m.priceBeforeRebate).toBe("$3,798.00");
  expect(m.rebate).toBe("– $1,610.00");
  expect(m.payable).toBe("$2,188.00");
  expect(m.gstLine).toBe("Includes GST of $345.27, worked out on the price before the rebate (ATO rule for certificate rebates)");
  expect(m.balance).toBe("$0.00 · Paid in full ✓");
});
test("every ESC field is printed", async () => {
  const t = (await pdfText((await taxInvoicePdf(SAMPLE) as any).bytes)).join(" ");
  for (const s of ["Tax invoice", "Invoice INV-1234", "Bill to", "Installation address", "Contracting business (Accredited Person)", "ABN 44 671 613 979", "1/33 Altree Court, Phillip ACT 2606", "VEU Accredited Person A003654", "Installed by", "Rapid Insulation, on Thu 13 Nov 2026", "Victorian Energy Upgrades rebate (price reduction)"]) expect(t).toContain(s);
});
test("missing invoice number or product holds", () => {
  expect(taxInvoiceModel({ ...SAMPLE, invoiceNumber: null })).toEqual({ held: "Tax invoice not made: no invoice number yet" });
  expect(taxInvoiceModel({ ...SAMPLE, productLine: null })).toEqual({ held: "Tax invoice not made: installed product not confirmed" });
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** `fileTaxInvoicePdf` reads the installation invoice (`invoices` kind install: `xero_invoice_number`), ledger payments, completion date and the confirmed product through the existing readers; Xero stays the book of record (no Xero writes).
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `git commit -m "feat(invoice): tax invoice PDF with every ESC field, GST on full price"`

---

### Task 7: Full ESC Statement of rights PDF on file

**Files:**
- Create: `docs/esc-forms/veu-statement-of-rights.pdf` (the ESC's own file), `scripts/embed-statement-of-rights.ts`, `src/lib/statement-of-rights.data.ts` (generated), `src/lib/statement-of-rights.core.ts`
- Test: `tests/statement-of-rights.test.ts`

**Interfaces:**
- Produces: `statementOfRightsPdf(): Uint8Array | null`; `STATEMENT_OF_RIGHTS_FILENAME = "VEU-Statement-of-rights.pdf"`. Part 3 attaches it to the quote email and links it on the quote page ("Statement of rights (PDF) ›"); if null, Part 3 holds the quote email.

- [ ] **Step 1: Get the file.** Fetch the ESC's current VEU Statement of rights PDF from esc.vic.gov.au (try WebFetch; if blocked, through the Lovable sandbox as for warranties; else ask Jo — see Open questions). Record URL + date in the commit message.
- [ ] **Step 2: Failing test:** `looksLikePdf(statementOfRightsPdf()!)` is true; its text (pdfjs) contains "Victorian Energy Upgrades" and "rights"; the embed script refuses a non-PDF (mirror `scripts/embed-veu-factsheet.ts`).
- [ ] **Step 3: Run, expect FAIL.** `bun test tests/statement-of-rights.test.ts`
- [ ] **Step 4: Implement** by copying the `embed-veu-factsheet.ts` / `veu-factsheet.data.ts` pattern; run the script.
- [ ] **Step 5: Run, expect PASS.**
- [ ] **Step 6: Commit** `git commit -m "feat(docs): bundle the ESC VEU Statement of rights PDF"`

---

### Task 8: VEEC (rebate) form in the website look

**Files:**
- Modify: `src/lib/veec-assignment-form.core.ts:52` (remove `”` after "assessment:"), `docs/pending-migrations/0225_veec_assignment_v1_1.sql` (same fix in the stored body), `src/lib/assignment.server.ts:1480` (final copy builder by flag)
- Create: `src/lib/veec-form-pdf.server.ts`
- Test: `tests/veec-form-pdf.test.ts`; keep `tests/veec-assignment-v1-1-db.test.ts` green

**Interfaces:**
- Consumes: `VEEC_FORM_BODY`, `VEEC_FORM_FIELDS`, `veecFormRows`, `AP_DETAILS` (existing)
- Produces: `type VeecSignatures = { installer?: { name: string; at: string; image?: Uint8Array }; ap?: { name: string; at: string }; consumer?: { name: string; at: string } }`; `veecFormPdf(values: Record<string, FieldValue>, sigs: VeecSignatures | null): Promise<{ bytes: Uint8Array; layout: PdfLayoutReport }>` (null sigs = the pre-filled unsigned copy Part 4 attaches to "All done" and links as "View the full form (PDF)"; Part 8 supplies `installer.image` from Mitti).

- [ ] **Step 1: Failing test:**

```ts
test("stray quote removed in code and pending SQL", () => {
  expect(VEEC_FORM_BODY.join("\n")).not.toContain("assessment:”");
  expect(readFileSync("docs/pending-migrations/0225_veec_assignment_v1_1.sql", "utf8")).not.toContain("assessment:”");
});
test("5 pages; Part C, Section 3 Part A, Part B and Section 4 each start a page", async () => {
  const r = await veecFormPdf(SAMPLE_VALUES, SAMPLE_SIGS);
  expect(r.layout.pages).toBe(5);
  const p = r.layout.blockPage;
  expect(new Set([p["s2-partC"], p["s3-partA"], p["s3-partB"], p["s4"]]).size).toBe(4);
  expect(r.layout.split).toEqual([]);
});
test("address on Part A", async () => { expect((await pdfText((await veecFormPdf(SAMPLE_VALUES, null)).bytes)).join(" ")).toContain("1/33 Altree Court, Phillip ACT 2606"); });
test("Part B carries the Lead Installer's drawn signature image with the name and date beside it (cross-part decision; Part 8 supplies the image)", async () => {
  const r = await veecFormPdf(SAMPLE_VALUES, { ...SAMPLE_SIGS, installer: { name: "John Smith", at: "2026-11-13T05:00:00Z", image: SIGNATURE_PNG } });
  const page = r.layout.blockPage["s3-partB"]!;
  expect(r.layout.images).toContainEqual({ block: "s3-partB", page });
  expect((await pdfText(r.bytes))[page - 1]).toMatch(/John Smith[\s\S]*13\/11\/2026/);
  expect((await veecFormPdf(SAMPLE_VALUES, { ...SAMPLE_SIGS, installer: { name: "John Smith", at: "2026-11-13T05:00:00Z" } })).layout.images).toEqual([]); // old portal signature: typed name only
});
test("flag off keeps the old text copy", () => { expect(readFileSync("src/lib/assignment.server.ts", "utf8")).toMatch(/PDF_LOOK_APPROVED\.veecForm/); });
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** Blocks follow `veec-web.html` headings in order; each signature stays inside its declaration's section (keep-together). In `assignment.server.ts`, when the flag is on pass `renderedPdf: (await veecFormPdf(values, sigs)).bytes` to the existing `storeCopy` call; text record and `final_facts_sha256` unchanged.
- [ ] **Step 4: Run, expect PASS.** `bun test tests/veec-form-pdf.test.ts tests/veec-assignment-v1-1-db.test.ts`
- [ ] **Step 5: Commit** `git commit -m "feat(veec): rebate form PDF in website look; remove stray quote mark"`

---

### Task 9: PIESA/PIISA fix — every DEECA field gets a unique name

**Files:**
- Modify: `src/lib/official-docx.core.ts` (`fillOfficialDocxParts`)
- Test: `tests/official-docx-unique-names.test.ts`

**Interfaces:**
- Produces: `uniqueFieldNames(xml: string): string` — renames every legacy form field's `<w:ffData><w:name w:val="…"/>` and the matching `<w:bookmarkStart w:name="…">` to `hiv{n}` (n = `docxFields` order). Pure. Applied inside `fillOfficialDocxParts` before filling. Task 11 uses the same names for the PDF widgets.

- [ ] **Step 1: Failing test:**

```ts
for (const key of ["piesa", "piisa"] as const) test(`${key}: field names unique and in order`, () => {
  const xml = documentXml(key); // unzip the bundled .data.ts docx
  const out = uniqueFieldNames(xml);
  const names = [...out.matchAll(/<w:ffData>[\s\S]*?<w:name w:val="([^"]+)"/g)].map((m) => m[1]);
  expect(names).toEqual(docxFields(xml).map((f) => `hiv${f.n}`));
  expect(out.match(/w:val="Check1"/g)).toBeNull();
});
test("the 4 PIISA ticks that vanished are set and uniquely named", () => {
  const r = renderOfficialDocx("piisa", { ...FULL_PIISA, "p5.recessed": "Yes", "p5.icConfirmed": "Yes", "p6.present": "Yes", "p6.suitable": "Yes" });
  const xml = new TextDecoder().decode(unzipSync(r.bytes)["word/document.xml"]!);
  for (const id of ["p5.recessed", "p5.icConfirmed", "p6.present", "p6.suitable"]) expect(checkedOptionFor(xml, "piisa", id)).toBe("Yes");
});
```

(`checkedOptionFor` = small test helper using `officialDocxLayout` + `docxFields` to read which option box is checked.)

- [ ] **Step 2: Run, expect FAIL.** `bun test tests/official-docx-unique-names.test.ts`
- [ ] **Step 3: Implement** `uniqueFieldNames` and call it first in `fillOfficialDocxParts`. The SHA check in `renderOfficialDocx` still runs on the untouched original.
- [ ] **Step 4: Run, expect PASS.** Plus `bun test tests/official-docx*.test.ts`.
- [ ] **Step 5: Commit** `git commit -m "fix(official forms): unique names for every DEECA field so no tick is dropped"`

---

### Task 10: PIESA/PIISA fix — follow-up answers print only when their condition applies

**Files:**
- Modify: `src/lib/official-forms.core.ts` (lift the two local `active` closures in `evaluatePiesa`/`evaluatePiisa` into one export), `src/lib/official-docx.core.ts` (`fillOfficialDocxXml`)
- Test: `tests/official-item-active.test.ts`

**Interfaces:**
- Produces:
  - `officialItemActive(key: OfficialKey, item: OfficialItem, a: OfficialAnswers): boolean` — every `when` string in `PIESA_ITEMS`/`PIISA_ITEMS` handled; an unknown `when` returns `false` (fail closed) and a test lists every `when` value so a new one can't slip through.
  - `officialFieldValues(key: OfficialKey, layout: DocxLayout, answers: OfficialAnswers): { boxes: Map<number, boolean>; texts: Map<number, string>; filled: string[]; missed: string[]; skipped: string[]; notOnForm: string[] }` — the placement rule now shared by the Word fill and Task 12's PDF fill. `fillOfficialDocxXml` becomes: values → edits (behaviour unchanged except skipping inactive items).

- [ ] **Step 1: Failing test:**

```ts
test("life support No never prints a consent option", () => {
  const r = officialFieldValues("piesa", layoutOf("piesa"), { ...FULL_PIESA, lifeSupport: "No", lifeSupportConsent: LS_OPTIONS[0] });
  expect(r.skipped).toContain("lifeSupportConsent");
  expect(r.filled).not.toContain("lifeSupportConsent");
});
test("every when-condition is known", () => {
  const whens = new Set([...PIESA_ITEMS, ...PIISA_ITEMS].map((i) => i.when).filter(Boolean));
  for (const w of whens) expect(KNOWN_WHENS).toContain(w!);
});
test("evaluators unchanged", () => { /* existing evaluatePiesa/evaluatePiisa fixtures still give the same blockers */ });
```

- [ ] **Step 2: Run, expect FAIL.** `bun test tests/official-item-active.test.ts`
- [ ] **Step 3: Implement**; export `KNOWN_WHENS`.
- [ ] **Step 4: Run, expect PASS.** Plus `bun test tests/official-*.test.ts`.
- [ ] **Step 5: Commit** `git commit -m "fix(official forms): skip follow-up answers whose condition is false"`

---

### Task 11: DEECA blank forms as PDFs with fillable widgets (build-time)

**Files:**
- Create: `scripts/official-form-blank-pdf.ts`, `src/lib/official-pdf-piesa.data.ts`, `src/lib/official-pdf-piisa.data.ts` (generated), `docs/official-forms/pdf/README.md`
- Test: `tests/official-pdf-blank.test.ts`

**Interfaces:**
- Produces: each data file exports `{ sourceSha256: string; fieldCount: number; pdfBase64: string }` as `OFFICIAL_BLANK_PDF`.

- [ ] **Step 1: Failing test:**

```ts
for (const [key, data] of [["piesa", piesa], ["piisa", piisa]] as const) test(`${key} blank PDF is DEECA's form with one widget per field`, async () => {
  expect(data.sourceSha256).toBe(OFFICIAL_TEMPLATES[key].sha256);
  const form = (await PDFDocument.load(Buffer.from(data.pdfBase64, "base64"))).getForm();
  const fields = docxFields(documentXml(key));
  expect(form.getFields().map((f) => f.getName()).sort()).toEqual(fields.map((f) => `hiv${f.n}`).sort());
  for (const f of fields) expect(f.kind === "check" ? form.getCheckBox(`hiv${f.n}`) : form.getTextField(`hiv${f.n}`)).toBeTruthy();
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement the script.** For each key: take the bundled original (SHA-checked), apply `uniqueFieldNames` only (no values), run `soffice --headless --convert-to 'pdf:writer_pdf_Export:{"ExportFormFields":{"type":"boolean","value":"true"}}'`, write the data file. **Stop condition:** if LibreOffice does not export the legacy fields as widgets (field count mismatch), stop and report to the main session — do not invent coordinates.
- [ ] **Step 4: Run the script and the test, expect PASS.** `bun scripts/official-form-blank-pdf.ts && bun test tests/official-pdf-blank.test.ts`
- [ ] **Step 5: Commit** `git commit -m "feat(official forms): DEECA blank PDFs with unique fillable widgets"`

---

### Task 12: Filled DEECA PIESA/PIISA PDF replaces the plain text copy

**Files:**
- Create: `src/lib/official-form-pdf.server.ts`
- Modify: `src/lib/official-piesa-pdf.server.ts` (`officialPiesaPdf` keeps its signature; builder by flag), `src/lib/official-docx.server.ts` (`storeOfficialDocx` also stores `<hash>.pdf` when the flag is on)
- Test: `tests/official-form-pdf.test.ts`

**Interfaces:**
- Consumes: `officialFieldValues` (Task 10), `OFFICIAL_BLANK_PDF` (Task 11), `officialSignatureImages` (existing)
- Produces: `officialFormPdf(key: OfficialKey, answers: OfficialAnswers, signatures?: Partial<Record<SignatureSlot, SignatureInput>>, opts?: { flatten?: boolean }): Promise<{ bytes: Uint8Array; filled: string[]; missed: string[]; skipped: string[] }>`. `officialPiesaPdf(jobId, jobNumber)` unchanged for its three callers (`piesa-delivery.server.ts` owner + installer copies, `electrician-piesa-copy.server.ts`, `trade-view.server.ts` download).

- [ ] **Step 1: Failing test:**

```ts
test("every box the placement rule sets shows in the PDF", async () => {
  for (const key of ["piesa", "piisa"] as const) {
    const v = officialFieldValues(key, layoutOf(key), FULL[key]);
    const r = await officialFormPdf(key, FULL[key], {}, { flatten: false });
    const form = (await PDFDocument.load(r.bytes)).getForm();
    for (const [n, on] of v.boxes) expect(form.getCheckBox(`hiv${n}`).isChecked()).toBe(on);
    for (const [n, t] of v.texts) expect(form.getTextField(`hiv${n}`).getText()).toBe(t);
  }
});
test("flattened copy keeps DEECA's page count and has no widgets left", async () => {
  const r = await officialFormPdf("piesa", FULL.piesa);
  const d = await PDFDocument.load(r.bytes);
  expect(d.getPageCount()).toBe((await PDFDocument.load(Buffer.from(piesa.pdfBase64, "base64"))).getPageCount());
  expect(d.getForm().getFields()).toHaveLength(0);
});
test("flag off keeps the text copy", () => { expect(readFileSync("src/lib/official-piesa-pdf.server.ts", "utf8")).toMatch(/PDF_LOOK_APPROVED\.officialFormPdf/); });
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** Fill widgets (multiline text fields auto-size), draw each signature image inside its signature widget rectangle (B3, which has no box: below the B3 declaration widget; if that would overlap another widget, print the existing caption only), `form.flatten()`. File name stays `officialPiesaPdfFilename`.
- [ ] **Step 4: Run, expect PASS.** Then render `FULL.piesa`/`FULL.piisa` with `bun scripts/render-pdf-samples.ts piesa piisa` and check every tick by eye (spec: "fill with a realistic job, convert to PDF, check every tick box shows").
- [ ] **Step 5: Commit** `git commit -m "feat(official forms): owners, installers and electricians get the filled DEECA PDF (flagged)"`

---

### Task 13: Warranties — Australian Bradford 70-year, ECOWOOL removed

**Files:**
- Replace: `docs/product-warranties/bradford-gold-70-year-warranty.pdf` (CSR Bradford Australia document), regenerate `src/lib/product-warranty.data.ts` (`bun scripts/embed-product-warranties.ts`)
- Modify: `src/lib/product-warranty.core.ts` (drop the `ecowool` family + entry; Bradford `sourceUrls` = the CSR Australia URL only), `docs/product-warranties/README.md`, `src/lib/insulation-product.core.ts`, `src/lib/esc-approved-products.core.ts`, `src/lib/invoice-itemisation.core.ts` (remove ECOWOOL options), `docs/HIV_WORKFLOW_SOURCE_OF_TRUTH.md` (one line: ECOWOOL excluded, Jo 2 Nov)
- Test: update `tests/product-warranty.core.test.ts`

**Interfaces:** `WarrantyFamily = "bradford_gold" | "pink_batts" | "earthwool"`; `warrantyFamilyForOption("ECOWOOL R5") === null` (so an old ECOWOOL answer holds with the existing `warrantyHoldReason`).

- [ ] **Step 1: Get the file** from https://www.csrbradford.com.au/products/ceiling-insulation/insulation/goldceilingbatts (Lovable sandbox if blocked; else Jo).
- [ ] **Step 2: Failing test:** `warrantyFamilyForOption("ECOWOOL R5")` is `null`; `PRODUCT_WARRANTIES.map(w => w.family)` equals `["bradford_gold","pink_batts","earthwool"]`; the bundled Bradford PDF text does not contain `eboss.co.nz` / "PRESS" and contains "70"; `grep -ri ecowool src/` (source test) finds nothing.
- [ ] **Step 3: Run, expect FAIL.** `bun test tests/product-warranty.core.test.ts`
- [ ] **Step 4: Implement** the edits; run the embed script.
- [ ] **Step 5: Run, expect PASS.** `bun test tests/product-warranty.core.test.ts tests/invoice-itemisation.test.ts tests/completion-pack-retry.test.ts`
- [ ] **Step 6: Commit** `git commit -m "fix(warranty): Australian Bradford 70-year warranty; remove ECOWOOL"`

---

### Task 14: Manufacturer's installation instructions on file

**Files:**
- Create: `docs/product-instructions/{pink-batts-IG06-rev5.pdf, earthwool-ceiling-batts.pdf, bradford-gold-ceiling.pdf, README.md}`, `scripts/embed-product-instructions.ts`, `src/lib/product-instructions.data.ts` (generated), `src/lib/product-instructions.core.ts`
- Test: `tests/product-instructions.core.test.ts`

**Interfaces:**
- Produces: `type ProductInstructions = { family: WarrantyFamily; title: string; pdfPath: string; attachmentName: string; sourceUrl: string }`; `PRODUCT_INSTRUCTIONS: readonly ProductInstructions[]`; `instructionsForOption(option: string | null | undefined): ProductInstructions | null`; `decideInstructionsAttachment(products: readonly string[], onFile: (p: string) => boolean): { attach: ProductInstructions[]; missing: string[] }`; `instructionsHoldReason(product: string) = \`Manufacturer's instructions for ${product} not on file\``. Part 4 attaches them with the warranty on the "All done" email.

- [ ] **Step 1: Get the files** (URLs in the decisions file: Fletcher IG06 Rev5 30/09/24; Knauf "Earthwool Ceiling batts" installation instructions; CSR Bradford current guide — not the 2019 reseller copy). Lovable sandbox if blocked.
- [ ] **Step 2: Failing test:** titles are exactly `"Installation Guide – Pink Batts – Wall and Ceiling (IG06 Rev5)"`, `"Knauf Insulation Installation Instructions – Earthwool Ceiling batts"`, `"Bradford Gold ceiling batts installation guide"`; `instructionsForOption("Bradford Gold R6")!.family === "bradford_gold"`; `decideInstructionsAttachment(["Mystery R4"], () => true).missing` equals `["Mystery R4"]`; each bundled file passes `looksLikePdf`.
- [ ] **Step 3: Run, expect FAIL.** `bun test tests/product-instructions.core.test.ts`
- [ ] **Step 4: Implement** (copy the warranty embed pattern; the script refuses non-PDFs and reseller hosts).
- [ ] **Step 5: Run, expect PASS.**
- [ ] **Step 6: Commit** `git commit -m "feat(docs): manufacturer's installation instructions per product"`

---

### Task 15: ESC owner consent PDF in the website look

**Files:**
- Create: `src/lib/consent-pdf.server.ts`
- Modify: `src/lib/consent.server.ts` (`storeCopy` caller at ~line 162: build the PDF by flag), `src/lib/pdf-approvals.core.ts` (add `escConsent: false`)
- Test: `tests/consent-pdf.test.ts`; keep `tests/esc-consent-template-db.test.ts` green

**Interfaces:**
- Consumes: `renderConsentBody`, `ConsentFacts` (existing `consent.core.ts`); layout kit `renderPdf(doc: PdfDoc)` (`pdf-look.server.ts`, Task 1).
- Produces: `escConsentPdf(facts: ConsentFacts, signed: { owner?: { name: string; at: string }; ap?: { name: string; role: string; at: string } } | null): Promise<{ bytes: Uint8Array; layout: PdfLayoutReport }>` (null = the pre-filled unsigned copy attached to "You're clear to install").

- [ ] **Step 1: Failing test** (values from `consent-web.html` / `esc-consent-final.pdf`):

```ts
test("ESC template V1 wording verbatim, four Section 2 ticks, AP signer", async () => {
  const r = await escConsentPdf(SAMPLE_FACTS, { owner: { name: "Sarah Brown", at: "2026-11-10T09:00:00+11:00" }, ap: { name: "Chris Lowe", role: "Director", at: "2026-11-10T09:00:00+11:00" } });
  const text = await pdfText(r.bytes);
  for (const line of renderConsentBody(SAMPLE_FACTS).split("\n").filter(Boolean)) expect(text).toContain(line.trim());
  expect(text).toContain("Chris Lowe");
  expect(text).toContain("0416 252 406");
  expect(r.layout.split).toEqual([]);
});
test("flag off keeps the text copy", () => { expect(readFileSync("src/lib/consent.server.ts", "utf8")).toMatch(/PDF_LOOK_APPROVED\.escConsent/); });
```

- [ ] **Step 2: Run** `bun test tests/consent-pdf.test.ts`, expect FAIL (module missing).
- [ ] **Step 3: Implement** `escConsentPdf` with the layout kit, same pattern as Task 8 (one section per ESC section, never split); `storeCopy` writes `.pdf` when `PDF_LOOK_APPROVED.escConsent`, else the existing text copy.
- [ ] **Step 4: Run, expect PASS.** Render with `bun scripts/render-pdf-samples.ts esc-consent` and compare to `esc-consent-final.pdf` page by page.
- [ ] **Step 5: Commit** `git commit -m "feat(consent): ESC owner consent PDF in the website look (flagged)"`

---

## Finish

- [ ] `bun run test` green; `bun scripts/scan-retired-terms.ts` clean.
- [ ] `bun scripts/render-pdf-samples.ts all` → `docs/approved-samples/2026-11-02/built/`; render each page to PNG at phone width next to its approved sample (the deposit, balance, invoice and acceptance samples as corrected in Task 5 Step 4); send Jo the pictures. Each `PDF_LOOK_APPROVED` flag turns on only after she approves that document.
- [ ] SQL `customer-agreement-v1-3.sql` waits for Jo's go-ahead to run live.

## Ownership notes (for the main session)

- **ESC owner consent PDF** in the website look: added as Task 15 (overview cross-part decision). Part 4 sends the signed copy on its own as soon as the owner signs (Jo 2 Nov, answer 10).
- **VEEC Part B signature**: Task 8's `VeecSignatures.installer.image` is the slot Part 8 Task 8 fills (overview cross-part decision); `PdfLayoutReport` gains `images: { block: string; page: number }[]` in Task 1 so tests can see where an image landed.
- **Receipt / invoice / instructions / Statement of rights attachments** are made here; attaching them to messages belongs to the message owners (Part 2 "You're in!", Part 3 quote email, Part 4 deposit/All done).
- **ECOWOOL**: portal product lists removed here; Mitti options are Part 8.

## Open questions for Jo

1. We can't download from the ESC and manufacturer websites in the build. If our other route fails, can you or Tom send: the ESC "Statement of rights" PDF, Bradford's Australian 70-year warranty, and Bradford's current install guide?

## Decided (Jo, 2 Nov evening)

- **Deposit amount (answer 1):** 10% of the price after the $349 — the portal's current maths ($183.90 on $2,188). Task 5 test values and Task 3/6 sample facts use it; `rec-dep.html`, `rec-bal.html`, `inv-web.html` and `accept-full.html` are corrected and re-rendered (Task 5 Step 4).
- **VEEC Part B signature (cross-part decision):** the drawn Mitti signature goes in Part B with the typed name beside it (Task 8 test).

## Assumptions

- The approved samples win on the business address: it is printed only on the tax invoice and the VEEC form, as in those samples.
- The $349 receipt uses the approved `receipt.html` wording in the website look, with the same running "still to pay" list as the deposit receipt; Jo sees it in the phone pictures before switch-on.
- pdf-lib is the only way to make PDFs in the worker; small differences from the Chromium samples (kerning, line breaks) are accepted if page count, section placement and wording match.
- The DEECA forms are converted once at build time with LibreOffice (form widgets kept), then filled by pdf-lib. This keeps DEECA's form exactly and fixes the dropped ticks.
- B3 (no signature box on DEECA's PIESA): the electrician's signature picture goes just below the B3 declaration; if there's no room, the caption prints and the picture stays on the Word copy.
- The VEEC stray-quote fix edits the pending (never applied) 0225 SQL in place.
