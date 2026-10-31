// Decision 278 (Jo 25 Oct 2026): on the installer's own jobs (A1) the price stays with the BOSS, out of Mitti. Staff may
// do the Ready Check and never see or set the price. The business owner enters the price and what is included on the job
// page in the portal; it is kept as the append-only `installer_price_set` workflow event (latest wins).
// Decision 289 (Jo 25 Oct 2026): the card asks price + what is included ONLY — the electrician is chosen once at Add a job
// (`electrician-choice.core.ts`) and never asked again. Records saved before 25 Oct still carry an electrician and are read.
// Decision 290 (corrected): the card shows the Ready Check's access rating (and any issue notes) as a flag; no fee question.
// PURE: validation, the event shape, and the bridge that lets every existing form reader (quotedPriceFromEntries,
// contactAnswersFromEntries, ready-check-basics, the chase rules) read the portal price FIRST and fall back to the Mitti
// answers only on old forms that still carry them. No I/O.
import { ELECTRICIAN_OPTIONS, INCLUDED_OPTIONS, LEAN_Q } from "./ready-check-lean.core";
import { insulationProduct } from "./insulation-product.core";
import type { ElectricianChoice } from "./electrician-choice.core";

export const INSTALLER_PRICE_EVENT = "installer_price_set";
/** The auto quote holds with exactly this reason while neither the portal nor an old form carries a price. */
export const PRICE_NOT_ENTERED = "Price not entered by the business owner";
/** Jobs whose price must come from the business owner (A1 only). */
export const priceFromPortal = (channel: string | null | undefined): boolean => channel === "installer_sourced";

/** The same options the Mitti question used (decision 222 wording), so old-form answers and portal answers read alike. */
export const PRICE_INCLUDED_OPTIONS = INCLUDED_OPTIONS;
/** Legacy (records before decision 289): the three choices the card used to ask. */
export type PriceElectricianChoice = "hivic" | "usual" | "different";
export const ELECTRICIAN_CHOICE_LABEL: Record<PriceElectricianChoice, string> = { hivic: ELECTRICIAN_OPTIONS[0], usual: ELECTRICIAN_OPTIONS[1], different: ELECTRICIAN_OPTIONS[2] };

export type InstallerPriceInput = {
  priceIncGst: number | string | null | undefined;
  included: string[];
  includedOther?: string | null | undefined;
  /** Jo 27 Oct 2026: does the current Ready Check say removal is needed? false = it positively says none, so the
   *  "Removal of existing insulation" tick is refused. true/null/undefined = allowed (nothing changes). */
  removalRequired?: boolean | null;
  /** Jo 31 Oct 2026: the boss's product (an APPROVED_PRODUCTS label) and office-only notes. Both optional. */
  productOption?: string | null | undefined;
  notes?: string | null | undefined;
};
/** Legacy electrician block on records saved before 25 Oct 2026 (decision 289); new records store null. */
export type LegacyPriceElectrician = { choice: PriceElectricianChoice; name: string | null; licence: string | null; price_inc_gst: number | null };
/** What is stored on the event (and read back): canonical option labels, numbers rounded to cents. */
export type InstallerPriceRecord = {
  price_inc_gst: number;
  included: string[];
  included_other: string | null;
  electrician: LegacyPriceElectrician | null;
  /** Canonical approved product label, or null (records before 31 Oct 2026 read null, never guessed). */
  product_option: string | null;
  /** Office-only notes (trimmed, max 1,000 chars), never sent into the form snapshot. */
  notes: string | null;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const money = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const nrm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9&]+/g, " ").trim();
const INCLUDED_BASE = INCLUDED_OPTIONS[0]; // "Ceiling insulation - supply & install"
const INCLUDED_REMOVAL = INCLUDED_OPTIONS[1]; // "Removal of existing insulation"

export const PRICE_ISSUES = {
  price: "Enter your price inc GST (more than $0).",
  included: "Tick what the price includes.",
  base: `"${INCLUDED_BASE}" must be ticked.`,
  other: "Say what else is included.",
  // Jo 27 Oct 2026 (exact wording, shown under the tickbox and refused by the server check alike).
  noRemoval: "Your Ready Check in Mitti says there's no removal on this job. If there is, add the removal area to the Mitti form first, then you can include it here.",
  product: "Pick a product from the list.",
  notes: "Keep notes under 1,000 characters.",
} as const;
export const NOTES_MAX = 1000;

/** Fails closed: any issue = nothing saved. Price + what is included only (decision 289). */
export function validateInstallerPrice(i: InstallerPriceInput): { ok: boolean; issues: string[]; record: InstallerPriceRecord | null } {
  const issues: string[] = [];
  const price = money(i.priceIncGst);
  if (price == null || price <= 0 || price > 1_000_000) issues.push(PRICE_ISSUES.price);
  const included: string[] = [];
  for (const raw of i.included ?? []) {
    const m = INCLUDED_OPTIONS.find((o) => nrm(o) === nrm(raw));
    if (m && !included.includes(m)) included.push(m);
  }
  if (!included.length) issues.push(PRICE_ISSUES.included);
  else if (!included.includes(INCLUDED_BASE)) issues.push(PRICE_ISSUES.base);
  const other = String(i.includedOther ?? "").trim();
  if (included.includes("Other") && !other) issues.push(PRICE_ISSUES.other);
  // Jo 27 Oct 2026: the Ready Check positively says no removal → the removal tick is refused (server-side, not only the screen).
  if (i.removalRequired === false && included.includes(INCLUDED_REMOVAL)) issues.push(PRICE_ISSUES.noRemoval);
  const rawProduct = String(i.productOption ?? "").trim();
  const product = rawProduct ? insulationProduct(rawProduct) : null;
  if (rawProduct && !product) issues.push(PRICE_ISSUES.product);
  const notes = String(i.notes ?? "").trim();
  if (notes.length > NOTES_MAX) issues.push(PRICE_ISSUES.notes);
  if (issues.length || price == null) return { ok: false, issues, record: null };
  return { ok: true, issues: [], record: { price_inc_gst: r2(price), included, included_other: included.includes("Other") ? other : null, product_option: product?.option ?? null, notes: notes || null, electrician: null } };
}

/** Reads a stored `installer_price_set` event's details back; anything malformed → null (never a guessed price).
 *  A legacy electrician block (before decision 289) is kept when well-formed, otherwise dropped — never a guessed electrician. */
export function installerPriceFromEvent(details: unknown): InstallerPriceRecord | null {
  if (!details || typeof details !== "object") return null;
  const d = details as Record<string, unknown>;
  const price = money(d["price_inc_gst"]);
  if (price == null || price <= 0 || !Array.isArray(d["included"])) return null;
  const e = (d["electrician"] ?? null) as Record<string, unknown> | null;
  const choice = e?.["choice"];
  const electrician: LegacyPriceElectrician | null = choice === "hivic" || choice === "usual" || choice === "different"
    ? { choice, name: e?.["name"] == null ? null : String(e["name"]), licence: e?.["licence"] == null ? null : String(e["licence"]), price_inc_gst: money(e?.["price_inc_gst"]) }
    : null;
  const product = typeof d["product_option"] === "string" ? insulationProduct(d["product_option"]) : null;
  const notes = typeof d["notes"] === "string" ? d["notes"].trim() : "";
  return { price_inc_gst: r2(price), included: (d["included"] as unknown[]).map(String), included_other: d["included_other"] == null ? null : String(d["included_other"]), electrician, product_option: product?.option ?? null, notes: notes || null };
}

/** The labels the old A1 quote page used; the portal price replaces exactly these on the form snapshot. */
export const PRICE_FORM_LABELS: readonly string[] = [LEAN_Q.included, "What's included in your quote?", "What's included in your price (tick all that apply)", LEAN_Q.includedOther, LEAN_Q.totalPrice, "Total quoted price $", LEAN_Q.electrician, LEAN_Q.electricianName, LEAN_Q.electricianLicence, LEAN_Q.electricianPrice];
const PRICE_ONLY_LABELS: readonly string[] = [LEAN_Q.included, "What's included in your quote?", "What's included in your price (tick all that apply)", LEAN_Q.includedOther, LEAN_Q.totalPrice, "Total quoted price $"];
const isPriceLabel = (label: unknown) => PRICE_FORM_LABELS.some((l) => nrm(l) === nrm(label));
const PRODUCT_LABELS: readonly string[] = [LEAN_Q.product, "Insulation product"];
const isProductLabel = (label: unknown) => PRODUCT_LABELS.some((l) => nrm(l) === nrm(label));
const isPriceOnlyLabel = (label: unknown) => PRICE_ONLY_LABELS.some((l) => nrm(l) === nrm(label));

/** The portal price expressed as the Mitti-labelled answers every reader already understands. A record without an
 *  electrician (decision 289) emits no electrician answers: the job's recorded choice decides (electrician-choice.core). */
export function priceEntriesFromRecord(r: InstallerPriceRecord): { label: string; value: string | null }[] {
  const e = r.electrician;
  return [
    { label: LEAN_Q.included, value: r.included.join(", ") },
    { label: LEAN_Q.includedOther, value: r.included_other },
    { label: LEAN_Q.totalPrice, value: String(r.price_inc_gst) },
    ...(r.product_option ? [{ label: LEAN_Q.product, value: r.product_option }] : []),
    ...(e ? [{ label: LEAN_Q.electrician, value: ELECTRICIAN_CHOICE_LABEL[e.choice] }] : []),
    ...(e?.choice === "different" ? [{ label: LEAN_Q.electricianName, value: e.name }, { label: LEAN_Q.electricianLicence, value: e.licence }, { label: LEAN_Q.electricianPrice, value: e.price_inc_gst == null ? null : String(e.price_inc_gst) }] : []),
  ];
}

/** Portal price FIRST: when a record exists, the form's own price answers are dropped and the portal's take their place
 *  (a legacy record with an electrician also replaces the form's electrician answers; a new record leaves them to the
 *  recorded job choice); with no record the entries are returned untouched (old forms keep working from their own answers). */
export function withInstallerPrice<T extends { label: string; value: unknown }>(entries: T[], record: InstallerPriceRecord | null): (T | { label: string; value: string | null })[] {
  if (!record) return entries;
  const drop = record.electrician ? isPriceLabel : isPriceOnlyLabel;
  return [...entries.filter((e) => !drop(e.label) && !(record.product_option && isProductLabel(e.label))), ...priceEntriesFromRecord(record)];
}

/** Batch 3a: the form snapshot without an old A1 form's own price answers (after an owner's new-quote request). */
export function withoutFormPrice<T extends { label: string; value: unknown }>(entries: T[]): T[] {
  return entries.filter((e) => !isPriceOnlyLabel(e.label));
}

/** An old A1 form that still carries a usable total. */
export function formHasPrice(entries: { label: string; value: unknown }[]): boolean {
  const v = entries.find((e) => nrm(e.label) === nrm(LEAN_Q.totalPrice) || nrm(e.label) === nrm("Total quoted price $"))?.value;
  const n = money(v);
  return n != null && n > 0;
}

/** Where the A1 price comes from: the portal (boss), an old form, or nowhere yet. A2 never needs one. */
export function installerPriceState(i: { channel: string | null | undefined; record: InstallerPriceRecord | null; entries: { label: string; value: unknown }[] }): { required: boolean; present: boolean; source: "portal" | "form" | null } {
  if (!priceFromPortal(i.channel)) return { required: false, present: true, source: null };
  if (i.record) return { required: true, present: true, source: "portal" };
  if (formHasPrice(i.entries)) return { required: true, present: true, source: "form" };
  return { required: true, present: false, source: null };
}

const aud = (n: number) => `$${n.toLocaleString("en-AU", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
/** Plain lines for the boss's "Your price" card (never shown to staff). Price + what is included (decision 289). */
export function priceCardLines(r: InstallerPriceRecord): { price: string; included: string; product: string | null; notes: string | null } {
  return {
    price: `${aud(r.price_inc_gst)} inc GST`,
    included: r.included.map((x) => (x === "Other" && r.included_other ? `Other: ${r.included_other}` : x)).join(" · "),
    product: r.product_option,
    notes: r.notes,
  };
}

/** Decision 290: "Ceiling access: Difficult · Issues: tight manhole" — the Ready Check's own flag, shown so the boss can
 *  price any difficult access themselves. Null while the form has no rating yet (nothing is guessed). */
export function accessFlagLine(f: { rating: string | null; issues: string[] }): string | null {
  if (!f.rating && !f.issues.length) return null;
  return [f.rating ? `Ceiling access: ${f.rating}` : null, f.issues.length ? `Issues: ${f.issues.join("; ")}` : null].filter(Boolean).join(" · ");
}

/** Jo 27 Oct 2026 (redone): the Ready Check details the boss's price card shows above the price box, from the SAME
 *  source the quote uses — the current ceiling measurement (install m²) and the form's per-area removal m². Removal
 *  "None" when the Ready Check positively says there is no removal; anything missing reads "Not on the Ready Check yet". */
export const NOT_ON_READY_CHECK = "Not on the Ready Check yet";
export function readyCheckDetailLines(d: { hasReadyCheck: boolean; installAreaM2: number | null; removalRequired: boolean | null; removalM2: number | null }): { install: string; removal: string } {
  if (!d.hasReadyCheck) return { install: NOT_ON_READY_CHECK, removal: NOT_ON_READY_CHECK };
  return {
    install: d.installAreaM2 != null && d.installAreaM2 > 0 ? `${Math.round(d.installAreaM2)} m²` : NOT_ON_READY_CHECK,
    removal: d.removalRequired === false ? "None" : d.removalM2 != null && d.removalM2 > 0 ? `${Math.round(d.removalM2)} m²` : NOT_ON_READY_CHECK,
  };
}

/** Jo 28 Oct 2026: HIV can't swap an installer's electrician to HIV's without the installer's permission. On a job held
 *  for a not-onboarded electrician the installer gets their own ONE-WAY switch to HIV's electrician (never back). */
export function hivSwitchOffered(f: { quoteHeldNotOnboarded: boolean; choice: ElectricianChoice }): boolean {
  return f.quoteHeldNotOnboarded && f.choice !== "hivic";
}
export const HIV_SWITCH = {
  button: (priceIncGst: number) => `Use Home Insulation Victoria's electrician ($${priceIncGst})`,
  confirm: "Switch this job to Home Insulation Victoria's electrician? You can't switch back.",
  yes: "Yes, switch",
  refused: "This job can't be switched to Home Insulation Victoria's electrician.",
} as const;

/** Jo 31 Oct 2026: once the quote has gone to the owner the boss can't edit the card; the office reopens it with a new
 *  quote request. Locked = a quote was sent and there is no newer new-quote request. */
export const PRICE_LOCKED = "Quote sent — call the office to change this.";
export function priceCardLocked(f: { quoteSentAt: string | null; newQuoteRequestedAt: string | null }): boolean {
  if (!f.quoteSentAt) return false;
  if (!f.newQuoteRequestedAt) return true;
  // Only a request strictly after the send unlocks; anything unreadable stays locked (fail closed).
  return !(Date.parse(f.newQuoteRequestedAt) > Date.parse(f.quoteSentAt));
}

/** The office-only history line for a saved price. A product note appears only when the boss picked a product that
 *  differs from the one in force before (their previous pick, else Mitti's, else none). */
export function priceEventSummary(f: { record: InstallerPriceRecord; previousProduct: string | null }): string {
  const r = f.record;
  const parts = [`Price entered by the business owner: $${r.price_inc_gst.toLocaleString("en-AU")} inc GST`];
  if (r.product_option && r.product_option !== (f.previousProduct ?? "none")) parts.push(`Product changed from ${f.previousProduct ?? "none"} to ${r.product_option}`);
  if (r.notes) parts.push(`Notes: ${r.notes}`);
  return parts.join(" · ");
}
