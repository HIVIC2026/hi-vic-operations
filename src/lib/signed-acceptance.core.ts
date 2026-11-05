// Signed acceptance (page 1): exact wording, the counter-signer and the page-1 blocks. PURE; drawing lives in pdf-look.server.ts.
// Part 3's quote page imports ACCEPTANCE_TICKS so the page and the PDF cannot drift.
import type { AgreementFacts } from "./customer-agreement.core";
import type { PdfBlock } from "./pdf-look.core";
import { paymentPlan } from "./payments.core";
import { thirtyDayTick } from "./quote-wording.core";

export const AP_COUNTERSIGNER = { name: "Chris Lowe", role: "Director, DC Construction Solutions Pty Ltd" } as const;

/** The two ticks as printed: tick 2 carries the quote's own PIESA amount (Jo 4 Nov 2026 21:20 / 21:25); `ACCEPTANCE_TICKS` = the $349 form. */
export const acceptanceTicks = (piesaAmount: string) => [
  "I accept this quote, the Customer Agreement and the payment terms, and I've been given my Statement of rights under the VEU program. I'm 18 or over, I own this home (or I'm allowed to sign for the owner), and I'm happy to get my documents by email.",
  thirtyDayTick(piesaAmount),
] as const;
export const ACCEPTANCE_TICKS = acceptanceTicks("$349");

export type SignedAcceptanceInput = {
  jobNumber: string; installerName: string; ownerName: string; ownerTypedName: string; address: string;
  signedAt: string; validUntil: string; quoteLine: string; priceBeforeRebate: number; rebate: number; yourPrice: number;
  removalM2: number | null;
  /** `keptInsulation` (Jo 4 Nov 2026 16:10): the Ready Check says the old insulation stays → section 1's approved notice. */
  agreement: { version: string; approvedOn: string; body: string; facts: AgreementFacts; keptInsulation?: boolean };
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const TZ = "Australia/Melbourne";
/** "Sat 8 Nov 2026, 7:42pm" and "8 Nov 2026, 7:42pm", in Melbourne time. */
export function formatSignedAt(iso: string): { long: string; short: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error("Signed time is not a valid date");
  const part = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-AU", { timeZone: TZ, ...o }).formatToParts(d);
  const get = (ps: Intl.DateTimeFormatPart[], t: string) => ps.find((p) => p.type === t)?.value ?? "";
  const dm = part({ weekday: "short", day: "numeric", month: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
  const short = `${Number(get(dm, "day"))} ${MONTHS[Number(get(dm, "month")) - 1]} ${get(dm, "year")}, ${get(dm, "hour")}:${get(dm, "minute")}${get(dm, "dayPeriod").toLowerCase().replace(/\./g, "")}`;
  return { long: `${get(dm, "weekday")} ${short}`, short };
}

export const aud = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const ACCEPTANCE_BLOCK_PREFIX = "a-";
const firstName = (full: string) => full.trim().split(/\s+/)[0] || full;

/** Page 1 of the signed acceptance, in the order of the approved sample (accept-full.html). */
export function acceptancePage1(i: SignedAcceptanceInput): PdfBlock[] {
  const at = formatSignedAt(i.signedAt);
  // The job's own safety check amount (the same figure the agreement's payment terms print), never a fixed $349.
  const safety = (i.agreement.facts.safety_check ?? "").trim();
  if (!safety) throw new Error("Signed acceptance is missing the safety check amount");
  const c = true;
  return [
    { id: "a-head", kind: "header", eyebrow: `SIGNED ACCEPTANCE · JOB ${i.jobNumber}`, compact: c },
    { id: "a-title", kind: "title", text: "Signed acceptance of your quote", sub: `Signed online on ${at.long} (Melbourne time)`, compact: c },
    { id: "a-who", kind: "facts", compact: c, rows: [["Owner", i.ownerName], ["Job", `${i.jobNumber} · Installer: ${i.installerName}`], ["Property", i.address], ["Quote valid until", i.validUntil]] },
    { id: "a-h-quote", kind: "heading", text: "The quote" },
    { id: "a-money", kind: "money", compact: c, rows: [
      { label: i.quoteLine, amount: "" },
      { label: "Price before rebate", amount: aud(i.priceBeforeRebate) },
      { label: "Rebate", amount: `– ${aud(i.rebate)}` },
      { label: "Your price (incl. GST)", amount: aud(i.yourPrice), strong: true },
    ] },
    { id: "a-scope", kind: "facts", compact: c, rows: [
      ["Old insulation removal", i.removalM2 == null ? "No" : `Yes, ${i.removalM2} m²`],
      ["Electrical upgrades", "Not included. Your electrician quotes these if the safety check finds any."],
    ] },
    { id: "a-pay", kind: "para", compact: c, lead: "How you pay:", text: `${safety} now for the electrical safety check (PIESA). Your deposit to book your install day. The rest on install day.` },
    { id: "a-h-agreed", kind: "heading", text: `What ${firstName(i.ownerName)} agreed to` },
    { id: "a-ticks", kind: "ticks", compact: c, items: [...acceptanceTicks(safety)] },
    { id: "a-sigs", kind: "signatures", cells: [
      { label: "Owner signature (typed online)", name: i.ownerTypedName, line: at.short },
      { label: "Signed for Home Insulation Victoria", name: AP_COUNTERSIGNER.name, line: `${at.short} · ${AP_COUNTERSIGNER.role}` },
    ] },
    { id: "a-h-docs", kind: "heading", text: "Documents accepted" },
    { id: "a-docs", kind: "facts", compact: c, full: true, rows: [
      ["Customer Agreement and payment terms", `Version ${i.agreement.version}, ${i.agreement.approvedOn} (full text on the next pages)`],
      ["Statement of rights", "Essential Services Commission, Victorian Energy Upgrades program (attached to the quote email)"],
    ] },
  ];
}

/** The agreement's "Signed" box text (printed after section 10 of the agreement). */
export function agreementSignedLine(i: Pick<SignedAcceptanceInput, "ownerName" | "ownerTypedName" | "signedAt">): string {
  return `Signed by ${i.ownerName} (typed name: ${i.ownerTypedName}) on the quote page on ${formatSignedAt(i.signedAt).short}.`;
}

/** The three payments printed in the agreement's payment terms: safety check, 50% of the rest to book, then the remainder. Cents in, cents out. */
export function paymentSplitCents(totalCents: number, safetyCents: number): { safety: number; deposit: number; rest: number } {
  // One rule: the payments plan (payments.core) decides the split, so the agreement and the money cards can't drift.
  const p = paymentPlan({ quoteTotalCents: totalCents, safetyCheckCents: safetyCents });
  return { safety: p.safetyCheckCents, deposit: p.installDepositCents, rest: p.balanceCents };
}

/** "Mon 8 Dec 2026" in Melbourne time (the agreement's valid-until wording). */
export function formatValidUntil(d: Date): string {
  const ps = new Intl.DateTimeFormat("en-AU", { timeZone: TZ, weekday: "short", day: "numeric", month: "numeric", year: "numeric" }).formatToParts(d);
  const g = (t: string) => ps.find((p) => p.type === t)?.value ?? "";
  return `${g("weekday")} ${Number(g("day"))} ${MONTHS[Number(g("month")) - 1]} ${g("year")}`;
}
