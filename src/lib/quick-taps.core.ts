// A48 batch 2 (spec part 1 + Jo's 30 Oct amendment): the owner's quick taps on My job `?screen=taps`. PURE: no I/O.
// One question per screen, in this order: full name, address, hatch, any website answer the owner left blank (never
// "over 5 years"), then "Yes, let's go" / "No thanks". Jo 3 Nov 2026: the roof and 5-year questions are no longer asked
// (the installer checks both at the Ready Check); old answers keep their roof / five_years values. A decline tap ends the questions. "Not sure" always passes (the installer
// checks on the day). Wording is Jo's, verbatim (29–30 Oct 2026); the website questions reuse the portal's existing owner
// question wording (owner-eligibility.core OWNER_QUESTIONS).
import { OWNER_QUESTIONS } from "./owner-eligibility.core";

export const QUICK_TAPS_ANSWERED_EVENT = "quick_taps_answered";

export type Hatch = "yes" | "no" | "not_sure";
export type Roof = "sloped" | "flat" | "some" | "not_sure";
export type FiveYears = "no" | "yes" | "not_sure";
export type GoAhead = "yes" | "no_thanks";
export const WEBSITE_KEYS = ["property_type", "top_floor", "over_five_years", "insulation"] as const;
export type WebsiteKey = (typeof WEBSITE_KEYS)[number];
export type WebsiteFacts = Record<WebsiteKey, string | null>;
export type WebsiteAnswers = { [K in WebsiteKey]?: string | undefined };

/** Who will be at the home to let the installer in. A tenant's details are for the installer only; the tenant is never contacted by us. */
export type Access = { who: "owner" } | { who: "tenant"; name: string; mobile: string };

export type QuickTapAnswers = {
  /** The full name the owner confirmed (or typed). */
  name?: string | null | undefined;
  /** The full address the owner confirmed (or picked). */
  address?: string | null | undefined;
  hatch?: Hatch | undefined;
  roof?: Roof | undefined;
  five_years?: FiveYears | undefined;
  access?: Access | undefined;
  go?: GoAhead | undefined;
  website?: WebsiteAnswers | undefined;
};
export type TapOutcome = "pass" | "decline_access" | "decline_5yr" | "no_thanks" | "incomplete";
export type FinalOutcome = Exclude<TapOutcome, "incomplete">;
export type TapStep = "name" | "address" | "hatch" | "access" | "go" | WebsiteKey;

type Opt<V extends string> = { value: V; label: string };
const opts = <V extends string>(pairs: readonly (readonly [V, string])[]): Opt<V>[] => pairs.map(([value, label]) => ({ value, label }));
const q = <K extends keyof typeof OWNER_QUESTIONS>(k: K) => OWNER_QUESTIONS[k];

export const QUICK_TAPS_COPY = {
  nameConfirm: "Is this your full name for your quote?",
  nameAsk: "What's your full name for your quote?",
  addressConfirm: "Is this the right address for your quote?",
  addressAsk: "What's the full address of the home for your quote?",
  yes: "Yes",
  change: "Change it",
  hatch: { question: "Is there a manhole or hatch into your roof space?", options: opts<Hatch>([["yes", "Yes"], ["no", "No"], ["not_sure", "Not sure"]]) },
  roof: { question: "Is your roof sloped, flat, or some of each?", options: opts<Roof>([["sloped", "Sloped"], ["flat", "Flat"], ["some", "Some of each"], ["not_sure", "Not sure"]]) },
  five_years: { question: "Was your home built, or its ceiling replaced, in the last 5 years?", options: opts<FiveYears>([["no", "No"], ["yes", "Yes"], ["not_sure", "Not sure"]]) },
  access: {
    question: "Who will be at the home to let the installer in?",
    options: opts<"owner" | "tenant">([["owner", "Me"], ["tenant", "My tenant"]]),
    tenantName: "Tenant's name",
    tenantMobile: "Tenant's mobile",
    needBoth: "Add your tenant's name and mobile so the installer can call them",
    back: "Back",
  },
  go: { options: opts<GoAhead>([["yes", "Yes, let's go — you can share my name and number with the installer to book it"], ["no_thanks", "No thanks"]]) },
  /** Website answers left blank. Values are what the website stores (`apartment`, not the eligibility link's `unit`). */
  website: {
    property_type: { label: q("property_type").label, options: q("property_type").options.map(([v, label]) => ({ value: v === "unit" ? "apartment" : v, label })) },
    top_floor: { label: q("top_floor").label, options: q("top_floor").options.map(([value, label]) => ({ value, label })) },
    over_five_years: { label: q("over_five_years").label, options: q("over_five_years").options.map(([value, label]) => ({ value, label })) },
    insulation: { label: q("insulation").label, options: q("insulation").options.map(([value, label]) => ({ value, label })) },
  } as Record<WebsiteKey, { label: string; options: { value: string; label: string }[] }>,
  outcome: {
    pass: "Thanks! Your installer will call you soon to book your free Ready Check.",
    decline_access: "Unfortunately we can't help with this one, as we need access into the roof space. Please contact another installer, they may be able to assist.",
    decline_5yr: "Thanks for letting us know. Unfortunately homes built, or with a ceiling replaced, in the last 5 years don't qualify for the Victorian Energy Upgrades program, so we can't help with this one.",
    no_thanks: "No worries, thanks for letting us know. If you change your mind, just get in touch.",
  } satisfies Record<FinalOutcome, string>,
} as const;

/** Jo 2 Nov 2026: the installer rings the owner to book, so the pass screen names the installer the batch was sent
 *  for; no name → the general line (QUICK_TAPS_COPY.outcome.pass). */
export function quickTapsPassLine(installer: string | null | undefined): string {
  const name = (installer ?? "").trim();
  return name ? `Thanks! ${name} will call you soon to book your free Ready Check.` : QUICK_TAPS_COPY.outcome.pass;
}

/** cancelJobFully reasons (plan Task 3). */
export const QUICK_TAPS_DECLINE_REASON: Record<Exclude<FinalOutcome, "pass">, string> = {
  decline_access: "Quick taps: no roof access",
  decline_5yr: "Quick taps: built or ceiling replaced in last 5 years",
  no_thanks: "Quick taps: owner not going ahead",
};

const blank = (v: string | null | undefined) => !(v ?? "").trim();
const isUnit = (v: string | null | undefined) => ["apartment", "unit"].includes((v ?? "").trim().toLowerCase());

/** Website answers still to ask, in order: the on-file ones left blank (top floor only for a unit/apartment, including
 *  one the owner has just said is a unit). */
export function websiteQuestions(onFile: WebsiteFacts, given: WebsiteAnswers = {}): WebsiteKey[] {
  const type = blank(onFile.property_type) ? given.property_type : onFile.property_type;
  // Jo 3 Nov 2026: "over 5 years" is never asked here (checked at the Ready Check).
  return WEBSITE_KEYS.filter((k) => k !== "over_five_years" && blank(onFile[k]) && (k !== "top_floor" || isUnit(type)));
}

/** An Australian mobile as `+614XXXXXXXX`, or null if it isn't one (landlines and short numbers are refused). */
export function normaliseAuMobile(v: string): string | null {
  if (typeof v !== "string") return null; // the page's answers arrive from the network
  const d = v.replace(/[\s\-().]/g, "");
  const m = /^(?:\+?61|0)(4\d{8})$/.exec(d);
  return m ? `+61${m[1]}` : null;
}
export function validAccess(a: Access | undefined): boolean {
  if (!a || typeof a !== "object") return false;
  if (a.who === "owner") return true;
  return a.who === "tenant" && typeof a.name === "string" && !blank(a.name) && normaliseAuMobile(a.mobile) !== null;
}
/** The access answer as saved: `{who:"owner"}`, or the tenant with the name trimmed and the mobile as `+614XXXXXXXX`.
 *  Null when it isn't a valid answer. */
export function normaliseAccess(a: unknown): Access | null {
  const x = a as Access | undefined;
  if (!validAccess(x)) return null;
  return x!.who === "owner" ? { who: "owner" } : { who: "tenant", name: x!.name.trim(), mobile: normaliseAuMobile(x!.mobile)! };
}
/** The one line shown to the installer, or null when nothing valid was answered. */
export function accessLine(a: Access | undefined | null): string | null {
  if (!a) return null;
  if (a.who === "owner") return "At the home: owner";
  return a.who === "tenant" && validAccess(a) ? `At the home: tenant — ${a.name.trim()}, ${a.mobile.trim()}` : null;
}

const validWebsite = (k: WebsiteKey, v: string | undefined) => !!v && QUICK_TAPS_COPY.website[k].options.some((o) => o.value === v);

/** The outcome so far. Name and address are required; a decline tap decides at once; otherwise every tap, every blank
 *  website answer and the final "let's go" are needed. */
export function tapOutcome(a: QuickTapAnswers, blanks: readonly WebsiteKey[] = []): TapOutcome {
  if (blank(a.name) || blank(a.address)) return "incomplete";
  if (a.hatch === "no") return "decline_access";
  if (!a.hatch) return "incomplete";
  if (blanks.some((k) => !validWebsite(k, a.website?.[k]))) return "incomplete";
  if (a.go === "no_thanks") return "no_thanks";
  return a.go === "yes" && validAccess(a.access) ? "pass" : "incomplete";
}

/** The next question to show, or null when the answers are decided (a decline, or everything answered). */
export function nextTapStep(a: QuickTapAnswers, blanks: readonly WebsiteKey[] = []): TapStep | null {
  if (tapOutcome(a, blanks) !== "incomplete") return null;
  if (blank(a.name)) return "name";
  if (blank(a.address)) return "address";
  if (!a.hatch) return "hatch";
  const w = blanks.find((k) => !validWebsite(k, a.website?.[k]));
  if (w) return w;
  return validAccess(a.access) ? "go" : "access";
}

/** What My job `?screen=taps` shows. `none` = not in a batch asking for taps (the normal My job page shows instead). */
export type QuickTapsView =
  | { kind: "none" }
  | { kind: "ask"; name: string | null; address: string | null; website: WebsiteFacts }
  | { kind: "retry" }
  | { kind: "done"; outcome: FinalOutcome; installer?: string | null };

export type AddressParts = { address_line: string | null; suburb: string | null; postcode: string | null };
const addrNorm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
export const sameAddress = (a: AddressParts, b: AddressParts) =>
  addrNorm(a.address_line) === addrNorm(b.address_line) && addrNorm(a.suburb) === addrNorm(b.suburb) && addrNorm(a.postcode) === addrNorm(b.postcode);
/** The address a `coordinates` fact was found for (`raw_snapshot.address`, written by ensurePropertyCoordinates), or null
 *  for an older fact that doesn't say. */
export function locationAddress(rawSnapshot: unknown): AddressParts | null {
  const a = (rawSnapshot as { address?: Record<string, unknown> | null } | null)?.address;
  if (!a || typeof a !== "object") return null;
  const s = (v: unknown) => (typeof v === "string" ? v : null);
  return { address_line: s(a["address_line"]), suburb: s(a["suburb"]), postcode: s(a["postcode"]) };
}
/** Does the home need a fresh location after the owner confirmed `saved`? Decided from the address the CURRENT location
 *  was found for — not the address the page showed — so a retry after a half-finished move still re-locates the home.
 *  An older location that doesn't say its address (or no location yet) → only when the address changed, now or in an
 *  earlier quick-taps save. */
export function locationNeedsRefresh(f: { locationAddress: AddressParts | null; saved: AddressParts; changedNow: boolean; changedBefore: boolean }): boolean {
  if (f.locationAddress) return !sameAddress(f.locationAddress, f.saved);
  return f.changedNow || f.changedBefore;
}
