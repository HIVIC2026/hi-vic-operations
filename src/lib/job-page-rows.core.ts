// Installer Job page rows: progress pills, and the text of the folded rows. Pure: no database, no network.
// A row with no fact is left out — never guessed.
import { fmtDay } from "./next-step-dates.core";
import { melbourneYmd } from "./piesa-windows.core";
import type { SwmsHouseFacts } from "./swms-house.core";
import type { AccessPerson } from "./rental-answers.core";

// Wording. Lines from the plan / decisions are marked approved; anything else is a DRAFT Jo has not seen.
export const JOB_PAGE_WORDS = {
  hivicPayRule: "paid 7 days after we approve the paperwork", // approved (plan Task 5 test)
  ownPayRule: (first: string) => `paid once ${first} has paid in full`, // approved (Money line, Global Constraints)
  paidTick: "paid ✓", // approved (plan Task 5 test)
  noRate: "—", // approved (plan Task 5: missing rate shows a dash)
  letsYouIn: "Lets you in", // DRAFT (plan)
  nextForOwner: "Next for owner", // approved (plan Task 5)
  notThereYet: "Ready once the install is booked", // approved (plan Task 5)
  notInYet: "Not in yet", // DRAFT
  foilNone: "no foil", // approved (plan Task 5 test)
  foilYes: "foil-backed insulation", // DRAFT
  lifeSupport: "life support at the property", // DRAFT
} as const;
const W = JOB_PAGE_WORDS;

export type ProgressLabel = "Ready Check" | "PIESA" | "Deposit" | "Install";
export function progressSteps(f: { readyCheckDone: boolean; piesaDone: boolean; depositPaid: boolean; installDone: boolean }): { label: ProgressLabel; state: "done" | "now" | "later" }[] {
  const steps: [ProgressLabel, boolean][] = [["Ready Check", f.readyCheckDone], ["PIESA", f.piesaDone], ["Deposit", f.depositPaid], ["Install", f.installDone]];
  let nowTaken = false;
  return steps.map(([label, done]) => {
    if (done) return { label, state: "done" as const };
    if (!nowTaken) { nowTaken = true; return { label, state: "now" as const }; }
    return { label, state: "later" as const };
  });
}

export function siteNotesRows(h: SwmsHouseFacts, readyCheckNote: string | null): [label: string, value: string, warn: boolean][] {
  const rows: [string, string, boolean][] = [];
  if (h.roofType) rows.push(["Roof", h.roofType, false]);
  const hazards: string[] = [];
  const lights = h.areas.reduce((t, a) => t + (a.downlights ?? 0), 0);
  if (lights > 0) hazards.push(`${lights} recessed downlight${lights === 1 ? "" : "s"}`);
  const foilKnown = h.areas.filter((a) => a.conductive != null);
  if (h.areas.some((a) => a.conductive === true)) hazards.push(W.foilYes);
  else if (foilKnown.length) hazards.push(W.foilNone);
  if (h.lifeSupport) hazards.push(W.lifeSupport);
  if (h.piesa.hazards) hazards.push(h.piesa.hazards);
  const warn = lights > 0 || h.areas.some((a) => a.conductive === true) || h.lifeSupport === true || !!h.piesa.hazards;
  if (hazards.length) rows.push(["Hazards", hazards.join(", "), warn]);
  const note = readyCheckNote?.trim();
  if (note) rows.push(["Ready Check notes", note, false]);
  return rows;
}

export function ownerRows(f: { name: string | null; phone: string | null; email: string | null; access: AccessPerson | null }): [string, string][] {
  const rows: [string, string][] = [];
  if (f.name) rows.push(["Name", f.name]);
  if (f.phone) rows.push(["Phone", f.phone]);
  if (f.email) rows.push(["Email", f.email]);
  if (f.access && f.access.who !== "owner") {
    rows.push([W.letsYouIn, `${f.access.name} · ${f.access.who === "tenant" ? "tenant" : "property manager"} · ${f.access.mobile}`]);
  }
  return rows;
}

const money = (n: number) => `$${n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function jobDetailsRows(f: {
  measuredM2: number | null; areas: number | null; existing: string | null; removal: string | null; product: string | null; access: string | null;
  installPay: number | null; installPayRule: string; piesaPay: number | null; piesaPaidAt: string | null;
  /** The business pays its own electricians (otherwise there is no PIESA pay line). Default true. */
  piesaPayApplies?: boolean;
  /** Own-customer quote rows are added by Part 10; this part never shows an owner price. */
  ownCustomer: boolean;
}): [string, string][] {
  const rows: [string, string][] = [];
  if (f.measuredM2 != null) rows.push(["Area", `${f.measuredM2} m²`]);
  if (f.areas != null) rows.push(["Areas", String(f.areas)]);
  if (f.existing) rows.push(["Existing insulation", f.existing]);
  if (f.removal) rows.push(["Removal", f.removal]);
  if (f.product) rows.push(["Product", f.product]);
  if (f.access) rows.push(["Access", f.access]);
  if (f.installPay != null) rows.push(["Your install pay", `${money(f.installPay)} · ${f.installPayRule}`]);
  if (f.piesaPayApplies !== false) {
    rows.push([f.ownCustomer ? "Your PIESA price (owner pays you)" : "Your PIESA pay", f.piesaPay == null ? W.noRate : f.piesaPaidAt ? `${money(f.piesaPay)} · ${W.paidTick}` : money(f.piesaPay)]);
  }
  return rows;
}

const dayLabel = (iso: string): string => fmtDay(melbourneYmd(new Date(iso)));

export function ownerToldRows(events: { at: string; type: string; summary: string }[], payments: { at: string; label: string }[], next: string | null): [day: string, text: string][] {
  const items = [...events.map((e) => ({ at: e.at, text: e.summary })), ...payments.map((p) => ({ at: p.at, text: p.label }))]
    .filter((i) => i.text.trim()).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const rows: [string, string][] = [];
  for (const i of items) {
    const day = dayLabel(i.at);
    const last = rows[rows.length - 1];
    if (last && last[0] === day) last[1] = `${last[1]} · ${i.text}`;
    else rows.push([day, i.text]);
  }
  const out = rows.slice(-8);
  if (next) out.push([W.nextForOwner, next]);
  return out;
}

export type PaperworkRow = { label: string; ready: boolean; note: string | null; source?: 'portal' | 'mitti' };
export function paperworkRows(f: { readyCheckReport: boolean; readyCheckSource?: 'portal' | 'mitti'; readyCheckSubmittedAt?: string | null; signedPiesa: boolean; ownerConsent: boolean; safetyPlan: boolean; installForm: boolean; installBooked: boolean }): PaperworkRow[] {
  const row = (label: string, ready: boolean, waiting: string): PaperworkRow => ({ label, ready, note: ready ? null : waiting });
  const rcReady = !!f.readyCheckSubmittedAt || f.readyCheckReport;
  const rcNote = f.readyCheckSubmittedAt ? `Done in ${f.readyCheckSource === 'portal' ? 'the portal' : 'Mitti'} on ${dayLabel(f.readyCheckSubmittedAt)}` : rcReady ? 'Done in Mitti' : 'Not done yet';
  return [
    { label:'Ready Check', ready:rcReady, note:rcNote, source:f.readyCheckSource ?? 'mitti' },
    row("Signed PIESA", f.signedPiesa, 'Ready after the PIESA is done'),
    row("Owner's ESC consent", f.ownerConsent, 'Ready once the owner signs'),
    row("Safety plan (SWMS)", f.installBooked && f.safetyPlan, f.installBooked ? W.notInYet : W.notThereYet),
    row("Install form (Mitti)", f.installBooked && f.installForm, f.installBooked ? W.notInYet : W.notThereYet),
  ];
}

const hourOf = (iso: string): string => {
  const p = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(new Date(iso));
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${get("hour")}:${get("minute")}${get("dayPeriod").toLowerCase()}`;
};
const whenOf = (iso: string): string => `${dayLabel(iso)}, ${hourOf(iso)}`;

/** The Visits row: this business's own booked visits. */
export function visitsRows(f: { readyCheck: string | null; piesa: string | null; install: string | null }): [string, string][] {
  const row = (label: string, iso: string | null): [string, string] => [label, iso ? whenOf(iso) : "Not booked yet"];
  return [row("Ready Check", f.readyCheck), row("PIESA", f.piesa), row("Install", f.install)];
}

/** DRAFT lines for the messages the owner has had (anything not listed is not shown). */
const TOLD: Record<string, string> = {
  quote_ready: "Quote sent", quote_reminder: "Quote reminder sent", quote_accepted: "Accepted", safety_check_booked: "PIESA booked",
  safety_check_times: "PIESA times sent", install_booked: "Install booked", install_days: "Install days sent", install_day_changed: "Install day changed",
  install_complete: "Install done", piesa_copy: "Signed PIESA sent", esc_consent_copy: "ESC consent copy sent", final_invoice: "Final invoice sent",
  completion_pack: "Completion pack sent",
};
export const ownerToldSummary = (purpose: string): string | null => TOLD[purpose] ?? null;

/** DRAFT: the one line on what the owner hears next (only the step the plan words). */
export const nextForOwner = (boxKind: string): string | null => (boxKind === "book_install" ? "\"You're booked\" once you book the install" : null);
