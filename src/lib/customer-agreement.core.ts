// Customer Agreement v1.3 (approved 2 Nov 2026): the approved wording, copied from
// docs/approved-samples/2026-11-02/agreement-web.html. Sample values are placeholders.
// Markup, one line each: "# EYEBROW | Title" page title (the paragraph after it is the sub line), "## N Title" section,
// "- " bullet, "> Label | value" facts row, "$ Label | value" money row, plain line = paragraph, "---" new page.
// A literal \n inside a facts value or money label means a line break.
import type { PdfBlock } from "./pdf-look.core";
import { keptInsulationNotice } from "./kept-insulation.core";
import { UPGRADES_LINE_B } from "./quote-wording.core";

export const CUSTOMER_AGREEMENT_KEY = "customer_agreement";
export const CUSTOMER_AGREEMENT_VERSION = "1.3";

export type AgreementFacts = Record<
  | "owner_name" | "address" | "job_number" | "installer_name" | "installer_phone" | "installer_email" | "product"
  | "area_m2" | "price_before_rebate" | "rebate" | "your_price" | "valid_until" | "safety_check" | "deposit" | "rest",
  string
>;

export const CUSTOMER_AGREEMENT_V1_3 = `# CUSTOMER AGREEMENT | Your ceiling insulation upgrade
This is our agreement with you for job {job_number}. Please read it. Take your time and ask us anything.
> You | {owner_name}\\n{address}
> Us | Home Insulation Victoria\\ninfo@homeinsulationvictoria.com.au
> Your installer | {installer_name}\\n{installer_phone}\\n{installer_email}\\nDoes the work for us
## 1 What we'll do
- Install {product} across {area_m2} m² of your ceiling, as in your quote.
- Remove your old insulation, if your quote says so.
- Take away all removed insulation and rubbish.
- Arrange an electrical safety check (PIESA) by a licensed electrician before the install.
- Create the rebate certificates for your job and take the rebate off your price.
## 2 What's not included
Electrical upgrades, only if the electrical safety check (PIESA) finds any. Your electrician quotes these directly, and nothing is done without your OK. You pay the electrician, not us.
## 3 When things happen
- Electrical safety check (PIESA): your installer calls you to book it within 2 business days of you accepting.
- Electrical upgrades (only if needed): booked directly with your electrician.
- Install: booked once your deposit is paid, and done within 30 days of the electrical safety check (PIESA). Your installer will confirm the day with you. Most installs are finished on the day they start.
We confirm every visit by email and text. If a visit can't go ahead as booked, we'll tell you as soon as we can.
The 30-day rule: the rebate rules say your insulation must be installed within 30 days of the electrical safety check (PIESA). If it isn't, the check has to be done again. Whoever caused the delay pays for the new check: you, if the delay was yours, or your installer, if it was theirs. If it was both, or nobody's fault, we'll decide fairly and tell you why.
## 4 Your price
$ Price before rebate | {price_before_rebate}
$ Rebate | – {rebate}
$ Your price (incl. GST) | {your_price}
How and when you pay is in your payment terms (attached). In short: $349 now for the electrical safety check (PIESA), 10% to book your install day, and the rest on install day. There are no other fees.
Once your install is done, the rebate rules say you must have paid at least $200 (incl. GST). None of that $200 can be given back to you in any way.
Your quote is valid for 30 days, until {valid_until}.
Cooling-off: no cooling-off period applies. You asked for a quote and accepted it online in your own time.
## 5 What we need from you
- Clear access to your switchboard and ceiling hatch.
- Someone 18 or over at home for each visit.
- Pets kept away, and the power off while they work in the ceiling.
- Sign your rebate form on install day. This hands the rebate certificates to us so we can take the rebate off your price.
If your home isn't eligible: if we find your home can't get the rebate (for example, downlights that can't be covered), we'll cancel your job and you won't owe anything more. If your electrical safety check (PIESA) has already been done, the $349 isn't refunded.
## 6 Warranties
- The insulation: covered by the manufacturer's warranty for at least 5 years. We send you a copy after your install.
- The workmanship: your installer fixes any fault in their work for 1 year from your install day.
- Your rights under the Australian Consumer Law always apply.
## 7 If something's not right
Reply to any of our emails or write to info@homeinsulationvictoria.com.au. We'll reply within 5 business days and aim to sort it within 20 business days. If it's still not sorted, you can contact the Essential Services Commission (esc.vic.gov.au) or Consumer Affairs Victoria.
If we find out later that something about your install doesn't meet the rebate rules, we'll tell you straight away and fix it.
## 8 Changing or cancelling
To change a visit time, call your installer on their office number. To cancel, reply to any of our emails or write to info@homeinsulationvictoria.com.au.
- $349 electrical safety check: refunded if you cancel before the check is done. Not refunded once it's done.
- 10% deposit: refunded if you cancel at least 2 business days before your install day. Not refunded after that.
## 9 Your information
To run the rebate program, we share your details and job information with the Essential Services Commission, which may share them with WorkSafe and Energy Safe Victoria. You'll sign a separate consent form for this before your install.
## 10 Your documents
- Now: this agreement, your payment terms and your Statement of rights under the Victorian Energy Upgrades program.
- Before your install: a copy of your electrical safety check, the consent form and the Victorian Energy Upgrades consumer factsheet.
- After your install: your tax invoice, rebate form, product warranty and the manufacturer's instructions.
We send everything by email.
Version {version}
---
# PAYMENT TERMS | How you pay
Job {job_number} · {owner_name} · {address}
$ 1. When you accept your quote\\nElectrical safety check (PIESA) | {safety_check}
$ 2. Once you're clear to install\\n10% deposit to book your install day | {deposit}
$ 3. On install day\\nThe rest | {rest}
$ Your price (incl. GST) | {your_price}
## ✓ How to pay
By card or bank transfer. No fees. Each payment has its own link in our email, and we email you a receipt each time.
## ! If your balance isn't paid
We'll remind you 1, 3 and 7 days after install day. After 7 days, your balance is overdue and we may pass it to a debt collector.
If your balance is overdue, we charge interest at the Victorian penalty interest rate (currently 10% a year), worked out daily from the day it becomes overdue until it's paid. We don't charge collection costs. If we have to take you to court or VCAT to recover an overdue balance, you may have to pay the legal costs the court or VCAT orders.
## ⚡ Electrical upgrades
If you need electrical upgrades, you pay your electrician directly. They're not part of our price.
## ↩ Refunds
- $349: refunded if you cancel before your electrical safety check is done.
- Deposit: refunded if you cancel at least 2 business days before your install day.
`;

/** Section 1's removal bullet (v1.3 verbatim). Jo 4 Nov 2026 16:10: when the Ready Check says the old insulation is KEPT, this
 *  bullet is replaced by the approved "Your old insulation stays." paragraph (kept-insulation.core) at render time — the
 *  stored, approved template body is never changed. */
export const AGREEMENT_REMOVAL_LINE = "Remove your old insulation, if your quote says so.";
export function applyKeptInsulation(body: string): string {
  const line = `- ${AGREEMENT_REMOVAL_LINE}`;
  if (!body.includes(line)) throw new Error("Customer Agreement: the removal line is missing, so the kept-insulation notice can't replace it");
  return body.replace(line, `- ${keptInsulationNotice("{installer_name}")}`); // filled with the rest of the facts
}

/** Section 2's v1.3 line. Jo 4 Nov 2026 21:05 (pack 2 batch 8): wording B replaces it at render time on every agreement
 *  (Home Insulation Victoria leads and own customers) — the stored, approved body is never changed. */
export const AGREEMENT_UPGRADES_LINE_V1_3 = "Electrical upgrades, only if the electrical safety check (PIESA) finds any. Your electrician quotes these directly, and nothing is done without your OK. You pay the electrician, not us.";
export function applyUpgradesLineB(body: string): string {
  if (!body.includes(AGREEMENT_UPGRADES_LINE_V1_3)) throw new Error("Customer Agreement: section 2's upgrades line is missing, so the approved wording can't replace it");
  return body.replace(AGREEMENT_UPGRADES_LINE_V1_3, UPGRADES_LINE_B);
}

/** Jo 4 Nov 2026 21:25: every "$349" in the stored body means the electrical safety check (PIESA) — s.4 "In short: $349 now…",
 *  s.5 "the $349 isn't refunded", s.8 "$349 electrical safety check:", payment terms "$349: refunded…" — and is substituted
 *  at render time with the quote's own PIESA amount (`safety_check` fact: "$349" on a Home Insulation Victoria lead, so that
 *  output is byte-identical; the installer's rate, e.g. "$275", on their own customer). Any other count of "$349" in the
 *  body stops the document (fail closed) rather than guess which ones are the PIESA. */
export const AGREEMENT_PIESA_AMOUNT_COUNT = 4;
export function applyPiesaAmount(body: string, piesaAmount: string): string {
  const amount = piesaAmount.trim();
  if (!/^\$[\d,]+(?:\.\d{2})?$/.test(amount)) throw new Error(`Customer Agreement: the safety check amount "${piesaAmount}" is not a dollar amount`);
  const hits = (body.match(/\$349\b/g) ?? []).length;
  if (hits !== AGREEMENT_PIESA_AMOUNT_COUNT) throw new Error(`Customer Agreement: expected ${AGREEMENT_PIESA_AMOUNT_COUNT} "$349" safety check amounts in the body, found ${hits}`);
  return amount === "$349" ? body : body.replace(/\$349\b/g, () => amount); // function replacer: "$2…" in the amount is never a group reference
}

const FACT_KEYS = [
  "owner_name", "address", "job_number", "installer_name", "installer_phone", "installer_email", "product", "area_m2",
  "price_before_rebate", "rebate", "your_price", "valid_until", "safety_check", "deposit", "rest",
] as const;

/** Fills every {placeholder}; any empty or unknown one stops the document (fails closed). */
export function fillAgreement(body: string, facts: AgreementFacts, version: string): string {
  const values: Record<string, string> = { version };
  for (const k of FACT_KEYS) values[k] = (facts as Partial<Record<string, string>>)[k] ?? "";
  return body.replace(/\{([A-Za-z0-9_]+)\}/g, (_m, name: string) => {
    const v = values[name];
    if (v === undefined || v.trim() === "") throw new Error(`Missing agreement detail: ${name}`);
    return v;
  });
}

/** The text after the "# PAYMENT TERMS" page marker line (Part 2's Gate B payment terms). */
export function paymentTermsPart(body: string): string {
  const lines = body.split("\n");
  const i = lines.findIndex((l) => l.startsWith("# PAYMENT TERMS"));
  return i < 0 ? "" : lines.slice(i + 1).join("\n").trim();
}

const nl = (s: string) => s.replace(/\\n/g, "\n");

export function parseAgreement(filled: string): PdfBlock[] {
  const out: PdfBlock[] = [];
  let n = 0;
  const id = (p: string) => `${p}${++n}`;
  let section: Extract<PdfBlock, { kind: "section" }> | null = null;
  let afterTitle = false;
  const push = (b: PdfBlock) => { (section ? section.children : out).push(b); };
  for (const raw of filled.split("\n")) {
    const line = raw.trimEnd();
    if (!line) continue;
    if (line === "---") { section = null; out.push({ id: id("pb"), kind: "pageBreak" }); continue; }
    if (line.startsWith("# ")) {
      section = null;
      const [eyebrow = "", title] = line.slice(2).split(" | ");
      out.push({ id: id("hd"), kind: "header", eyebrow: eyebrow.trim() });
      out.push({ id: id("title"), kind: "title", text: (title ?? eyebrow).trim() });
      afterTitle = true;
      continue;
    }
    if (line.startsWith("## ")) {
      const rest = line.slice(3);
      const sp = rest.indexOf(" ");
      section = { id: id("sec"), kind: "section", number: rest.slice(0, sp), title: rest.slice(sp + 1), keepTogether: true, children: [] };
      out.push(section);
      afterTitle = false;
      continue;
    }
    if (afterTitle && !/^[>$-] /.test(line)) {
      const t = out[out.length - 1];
      if (t?.kind === "title") t.sub = line;
      afterTitle = false;
      continue;
    }
    afterTitle = false;
    if (line.startsWith("> ")) {
      const [label = "", value] = line.slice(2).split(" | ");
      const last = (section ? section.children : out).at(-1);
      const row: [string, string] = [label, nl(value ?? "")];
      if (last && last.kind === "facts") last.rows.push(row);
      else push({ id: id("facts"), kind: "facts", rows: [row] });
    } else if (line.startsWith("$ ")) {
      const [label = "", amount] = line.slice(2).split(" | ");
      const strong = label.startsWith("Your price");
      const row = { label: nl(label), amount: amount ?? "", ...(strong ? { strong: true } : {}) };
      const last = (section ? section.children : out).at(-1);
      if (last && last.kind === "money") last.rows.push(row);
      else push({ id: id("money"), kind: "money", rows: [row] });
    } else if (line.startsWith("- ")) {
      const last = (section ? section.children : out).at(-1);
      if (last && last.kind === "bullets") last.items.push(line.slice(2));
      else push({ id: id("bul"), kind: "bullets", items: [line.slice(2)] });
    } else push({ id: id("p"), kind: "para", text: line });
  }
  return out;
}
