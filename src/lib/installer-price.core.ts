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
};
/** Legacy electrician block on records saved before 25 Oct 2026 (decision 289); new records store null. */
export type LegacyPriceElectrician = { choice: PriceElectricianChoice; name: string | null; licence: string | null; price_inc_gst: number | null };
/** What is stored on the event (and read back): canonical option labels, numbers rounded to cents. */
export type InstallerPriceRecord = {
  price_inc_gst: number;
  included: string[];
  included_other: string | null;
  electrician: LegacyPriceElectrician | null;
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
} as const;

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
  if (issues.length || price == null) return { ok: false, issues, record: null };
  return { ok: true, issues: [], record: { price_inc_gst: r2(price), included, included_other: included.includes("Other") ? other : null, electrician: null } };
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
  return { price_inc_gst: r2(price), included: (d["included"] as unknown[]).map(String), included_other: d["included_other"] == null ? null : String(d["included_other"]), electrician };
}

/** The labels the old A1 quote page used; the portal price replaces exactly these on the form snapshot. */
export const PRICE_FORM_LABELS: readonly string[] = [LEAN_Q.included, "What's included in your quote?", "What's included in your price (tick all that apply)", LEAN_Q.includedOther, LEAN_Q.totalPrice, "Total quoted price $", LEAN_Q.electrician, LEAN_Q.electricianName, LEAN_Q.electricianLicence, LEAN_Q.electricianPrice];
const PRICE_ONLY_LABELS: readonly string[] = [LEAN_Q.included, "What's included in your quote?", "What's included in your price (tick all that apply)", LEAN_Q.includedOther, LEAN_Q.totalPrice, "Total quoted price $"];
const isPriceLabel = (label: unknown) => PRICE_FORM_LABELS.some((l) => nrm(l) === nrm(label));
const isPriceOnlyLabel = (label: unknown) => PRICE_ONLY_LABELS.some((l) => nrm(l) === nrm(label));

/** The portal price expressed as the Mitti-labelled answers every reader already understands. A record without an
 *  electrician (decision 289) emits no electrician answers: the job's recorded choice decides (electrician-choice.core). */
export function priceEntriesFromRecord(r: InstallerPriceRecord): { label: string; value: string | null }[] {
  const e = r.electrician;
  return [
    { label: LEAN_Q.included, value: r.included.join(", ") },
    { label: LEAN_Q.includedOther, value: r.included_other },
    { label: LEAN_Q.totalPrice, value: String(r.price_inc_gst) },
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
  return [...entries.filter((e) => !drop(e.label)), ...priceEntriesFromRecord(record)];
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
export function priceCardLines(r: InstallerPriceRecord): { price: string; included: string } {
  return {
    price: `${aud(r.price_inc_gst)} inc GST`,
    included: r.included.map((x) => (x === "Other" && r.included_other ? `Other: ${r.included_other}` : x)).join(" · "),
  };
}

/** Decision 290: "Ceiling access: Difficult · Issues: tight manhole" — the Ready Check's own flag, shown so the boss can
 *  price any difficult access themselves. Null while the form has no rating yet (nothing is guessed). */
export function accessFlagLine(f: { rating: string | null; issues: string[] }): string | null {
  if (!f.rating && !f.issues.length) return null;
  return [f.rating ? `Ceiling access: ${f.rating}` : null, f.issues.length ? `Issues: ${f.issues.join("; ")}` : null].filter(Boolean).join(" · ");
}
