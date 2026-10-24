// Decision 278 (Jo 25 Oct 2026): on the installer's own jobs (A1) the price stays with the BOSS, out of Mitti. Staff may
// do the Ready Check and never see or set the price. The business owner enters the price, what is included and who does
// the electrical safety check on the job page in the portal; it is kept as the append-only `installer_price_set` workflow
// event (latest wins). PURE: validation, the event shape, and the bridge that lets every existing form reader
// (quotedPriceFromEntries, contactAnswersFromEntries, ready-check-basics, the chase rules) read the portal price FIRST and
// fall back to the Mitti answers only on old forms that still carry them. No I/O.
import { ELECTRICIAN_OPTIONS, INCLUDED_OPTIONS, LEAN_Q } from "./ready-check-lean.core";
import { MISSING_USUAL_ELECTRICIAN, type UsualElectrician } from "./usual-electrician.core";

export const INSTALLER_PRICE_EVENT = "installer_price_set";
/** The auto quote holds with exactly this reason while neither the portal nor an old form carries a price. */
export const PRICE_NOT_ENTERED = "Price not entered by the business owner";
/** Jobs whose price must come from the business owner (A1 only). */
export const priceFromPortal = (channel: string | null | undefined): boolean => channel === "installer_sourced";

/** The same options the Mitti question used (decision 222 wording), so old-form answers and portal answers read alike. */
export const PRICE_INCLUDED_OPTIONS = INCLUDED_OPTIONS;
export const PRICE_ELECTRICIAN_OPTIONS = ELECTRICIAN_OPTIONS;
export type PriceElectricianChoice = "hivic" | "usual" | "different";
export const ELECTRICIAN_CHOICE_LABEL: Record<PriceElectricianChoice, string> = { hivic: ELECTRICIAN_OPTIONS[0], usual: ELECTRICIAN_OPTIONS[1], different: ELECTRICIAN_OPTIONS[2] };

export type InstallerPriceInput = {
  priceIncGst: number | string | null | undefined;
  included: string[];
  includedOther?: string | null | undefined;
  electrician: PriceElectricianChoice | null | undefined;
  different?: { name?: string | null | undefined; licence?: string | null | undefined; priceIncGst?: number | string | null | undefined } | null | undefined;
};
/** What is stored on the event (and read back): canonical option labels, numbers rounded to cents. */
export type InstallerPriceRecord = {
  price_inc_gst: number;
  included: string[];
  included_other: string | null;
  electrician: { choice: PriceElectricianChoice; name: string | null; licence: string | null; price_inc_gst: number | null };
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const money = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const nrm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9&]+/g, " ").trim();
const INCLUDED_BASE = INCLUDED_OPTIONS[0]; // "Ceiling insulation - supply & install"

export const PRICE_ISSUES = {
  price: "Enter your price inc GST (more than $0).",
  included: "Tick what the price includes.",
  base: `"${INCLUDED_BASE}" must be ticked.`,
  other: "Say what else is included.",
  electrician: "Choose who does the electrical safety check.",
  usual: `${MISSING_USUAL_ELECTRICIAN} — add them under My business first.`,
  different: "A different electrician needs their name, licence number and price (inc GST).",
} as const;

/** Fails closed: any issue = nothing saved. `usualElectrician` is the business's saved nomination (My business). */
export function validateInstallerPrice(i: InstallerPriceInput, ctx: { usualElectrician: UsualElectrician | null }): { ok: boolean; issues: string[]; record: InstallerPriceRecord | null } {
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
  let electrician: InstallerPriceRecord["electrician"] | null = null;
  if (i.electrician === "hivic") electrician = { choice: "hivic", name: null, licence: null, price_inc_gst: null };
  else if (i.electrician === "usual") {
    const u = ctx.usualElectrician;
    if (!u) issues.push(PRICE_ISSUES.usual);
    else electrician = { choice: "usual", name: u.name, licence: u.licence, price_inc_gst: r2(u.priceIncGst) };
  } else if (i.electrician === "different") {
    const name = String(i.different?.name ?? "").trim(), licence = String(i.different?.licence ?? "").trim(), p = money(i.different?.priceIncGst);
    if (!name || !licence || p == null || p < 0 || p > 1_000_000) issues.push(PRICE_ISSUES.different);
    else electrician = { choice: "different", name, licence, price_inc_gst: r2(p) };
  } else issues.push(PRICE_ISSUES.electrician);
  if (issues.length || !electrician || price == null) return { ok: false, issues, record: null };
  return { ok: true, issues: [], record: { price_inc_gst: r2(price), included, included_other: included.includes("Other") ? other : null, electrician } };
}

/** Reads a stored `installer_price_set` event's details back; anything malformed → null (never a guessed price). */
export function installerPriceFromEvent(details: unknown): InstallerPriceRecord | null {
  if (!details || typeof details !== "object") return null;
  const d = details as Record<string, unknown>;
  const price = money(d["price_inc_gst"]);
  const e = (d["electrician"] ?? null) as Record<string, unknown> | null;
  const choice = e?.["choice"];
  if (price == null || price <= 0 || !Array.isArray(d["included"]) || (choice !== "hivic" && choice !== "usual" && choice !== "different")) return null;
  return {
    price_inc_gst: r2(price), included: (d["included"] as unknown[]).map(String), included_other: d["included_other"] == null ? null : String(d["included_other"]),
    electrician: { choice, name: e?.["name"] == null ? null : String(e["name"]), licence: e?.["licence"] == null ? null : String(e["licence"]), price_inc_gst: money(e?.["price_inc_gst"]) },
  };
}

/** The labels the old A1 quote page used; the portal price replaces exactly these on the form snapshot. */
export const PRICE_FORM_LABELS: readonly string[] = [LEAN_Q.included, "What's included in your quote?", "What's included in your price (tick all that apply)", LEAN_Q.includedOther, LEAN_Q.totalPrice, "Total quoted price $", LEAN_Q.electrician, LEAN_Q.electricianName, LEAN_Q.electricianLicence, LEAN_Q.electricianPrice];
const isPriceLabel = (label: unknown) => PRICE_FORM_LABELS.some((l) => nrm(l) === nrm(label));

/** The portal price expressed as the Mitti-labelled answers every reader already understands. */
export function priceEntriesFromRecord(r: InstallerPriceRecord): { label: string; value: string | null }[] {
  const e = r.electrician;
  return [
    { label: LEAN_Q.included, value: r.included.join(", ") },
    { label: LEAN_Q.includedOther, value: r.included_other },
    { label: LEAN_Q.totalPrice, value: String(r.price_inc_gst) },
    { label: LEAN_Q.electrician, value: ELECTRICIAN_CHOICE_LABEL[e.choice] },
    ...(e.choice === "different" ? [{ label: LEAN_Q.electricianName, value: e.name }, { label: LEAN_Q.electricianLicence, value: e.licence }, { label: LEAN_Q.electricianPrice, value: e.price_inc_gst == null ? null : String(e.price_inc_gst) }] : []),
  ];
}

/** Portal price FIRST: when a record exists, the form's own price/electrician answers are dropped and the portal's take their
 *  place; with no record the entries are returned untouched (old forms keep working from their own answers). */
export function withInstallerPrice<T extends { label: string; value: unknown }>(entries: T[], record: InstallerPriceRecord | null): (T | { label: string; value: string | null })[] {
  if (!record) return entries;
  return [...entries.filter((e) => !isPriceLabel(e.label)), ...priceEntriesFromRecord(record)];
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

/** Plain lines for the boss's "Your price" card (never shown to staff). */
export function priceCardLines(r: InstallerPriceRecord): { price: string; included: string; electrician: string } {
  const aud = (n: number) => `$${n.toLocaleString("en-AU", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
  const e = r.electrician;
  return {
    price: `${aud(r.price_inc_gst)} inc GST`,
    included: r.included.map((x) => (x === "Other" && r.included_other ? `Other: ${r.included_other}` : x)).join(" · "),
    electrician: e.choice === "hivic" ? ELECTRICIAN_CHOICE_LABEL.hivic : `${ELECTRICIAN_CHOICE_LABEL[e.choice]} · ${e.name ?? ""}${e.licence ? ` · ${e.licence}` : ""}${e.price_inc_gst != null ? ` · ${aud(e.price_inc_gst)} inc GST` : ""}`,
  };
}
