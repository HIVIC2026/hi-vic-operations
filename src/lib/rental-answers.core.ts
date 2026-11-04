// Task 19 (Jo 2 Nov 2026, answers 7, 22 and 24): who do we arrange access with? The OWNER tells us in the quick taps,
// straight after the "It's your turn" text (not in the Mitti Ready Check). Jo 4 Nov 2026 21:40 (pack 2, replaces the
// 20:40 four screens): TWO screens — (1) "Who should we arrange access with?" Me / My tenant / My property manager;
// (2) if tenant or manager: "Their details" — name, mobile, email (optional) → Next. The old "Do you live there, or is it
// rented out?" question is gone. The tenant notice and the access-person texts go to the person the owner picked.
// Installers' own customers get the same questions by text after the installer adds the job. PURE: no I/O.
// Answers are stored in the existing `quick_taps_answered` event details (`answers.rental`) in the same shape the
// notices read (rented / tenant / manager / access); an office correction is a new `rental_answers_corrected` event with
// the same shape (latest wins). No SQL.
import { toAuE164 } from "./sms.core";

/** Jo 4 Nov 2026 21:40 (pack 2): the two rental screens replace the old "Who lets us in: Me / My tenant" tap — ON. */
export const RENTAL_TAPS_APPROVED = true as boolean;
export const RENTAL_ANSWERS_CORRECTED_EVENT = "rental_answers_corrected";

export type AccessWho = "owner" | "tenant" | "property_manager";
export type AccessPerson = { who: AccessWho; name: string; mobile: string };
/** `email` may be "" (Jo 4 Nov 2026: the email is optional). */
export type TenantContact = { name: string; mobile: string; email: string };
/** The property manager; agency and email may be "" (the two-screen flow never asks the agency). */
export type ManagerContact = { name: string; agency: string; mobile: string; email: string };
/** Stored shape. "Me" → rented false (nobody else to arrange access with or tell); tenant → rented true + tenant;
 *  property manager → rented true + manager (tenant null unless an older answer recorded one). */
export type RentalAnswers = { rented: boolean; tenant: TenantContact | null; manager?: ManagerContact | null; access: AccessPerson | null };

/** What the owner has tapped or typed so far (the quick taps keep this while the questions are answered). */
export type RentalAnswersInput = {
  who?: AccessWho | undefined;
  name?: string | undefined;
  mobile?: string | undefined;
  email?: string | undefined;
};
/** The two screens (Jo 4 Nov 2026 21:40): who we arrange access with → their details (tenant or manager only). */
export type RentalStep = "who" | "details";

/** Jo's words, verbatim (4 Nov 2026 21:40). */
export const RENTAL_TAPS = {
  whoTitle: "Who should we arrange access with?",
  whoOptions: ["Me", "My tenant", "My property manager"],
  detailsTitle: "Their details",
  name: "Name",
  mobile: "Mobile",
  email: "Email (optional)",
  next: "Next", // existing button word
} as const;
export const RENTAL_WHO_VALUES = ["owner", "tenant", "property_manager"] as const satisfies readonly AccessWho[];

/** DRAFT: the line an own customer sees after the last rental answer. */
export const RENTAL_DONE_LINE = "Thanks! That's everything we need for now.";
// DRAFT problem lines (owner-facing when a typed answer is not usable).
export const RENTAL_PROBLEMS = {
  who: "Please tell us who to arrange access with.",
  name: "Please add their name.",
  mobile: "Please add their mobile (it starts with 04).",
  email: "That email doesn't look right — check it, or leave it blank.",
} as const;

const clean = (v: string | null | undefined) => (v ?? "").trim().replace(/\s+/g, " ");
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const validEmail = (v: string | null | undefined) => EMAIL.test(clean(v));
/** Optional email: blank is fine; anything typed must look like an email. */
const optionalEmailOk = (v: string | null | undefined) => !clean(v) || validEmail(v);
/** An Australian mobile only (a landline or a made-up number is refused). */
const mobile = (v: string | null | undefined) => toAuE164(clean(v));
const validWho = (w: unknown): w is AccessWho => (RENTAL_WHO_VALUES as readonly unknown[]).includes(w);

/** The details screen's problems (all three boxes at once). */
export function rentalDetailsProblems(a: Partial<RentalAnswersInput> | null | undefined): string[] {
  const x = a ?? {};
  const out: string[] = [];
  if (!clean(x.name)) out.push(RENTAL_PROBLEMS.name);
  if (!mobile(x.mobile)) out.push(RENTAL_PROBLEMS.mobile);
  if (!optionalEmailOk(x.email)) out.push(RENTAL_PROBLEMS.email);
  return out;
}

/** What is still wrong with the answers; empty = complete. */
export function rentalAnswersProblems(a: Partial<RentalAnswersInput> | null | undefined): string[] {
  const x = a ?? {};
  if (!validWho(x.who)) return [RENTAL_PROBLEMS.who];
  if (x.who === "owner") return [];
  return rentalDetailsProblems(x);
}

/** The next rental screen to show, or null when complete. */
export function nextRentalStep(a: Partial<RentalAnswersInput> | null | undefined): RentalStep | null {
  const x = a ?? {};
  if (!validWho(x.who)) return "who";
  if (x.who === "owner") return null;
  return rentalDetailsProblems(x).length ? "details" : null;
}

/** The "who should we arrange access with" choices, in Jo's order. */
export function rentalWhoChoices(): { value: AccessWho; label: string }[] {
  return RENTAL_WHO_VALUES.map((value, i) => ({ value, label: RENTAL_TAPS.whoOptions[i]! }));
}

/** The answers as stored. "Me" → nobody else to arrange with (rented false, nothing recorded about a tenant); "My tenant" →
 *  the tenant's details, access = the tenant; "My property manager" → the manager's details, access = the manager. Throws
 *  when the answers are not complete (check rentalAnswersProblems first). The owner on file is not needed any more (kept
 *  as an optional argument for callers that still pass it). */
export function buildRentalAnswers(a: RentalAnswersInput, _owner?: { name: string | null; phone: string | null }): RentalAnswers {
  const problems = rentalAnswersProblems(a);
  if (problems.length) throw new Error(problems.join(" "));
  if (a.who === "owner") return { rented: false, tenant: null, manager: null, access: null };
  const person: TenantContact = { name: clean(a.name), mobile: mobile(a.mobile)!, email: clean(a.email).toLowerCase() };
  if (a.who === "tenant") return { rented: true, tenant: person, manager: null, access: { who: "tenant", name: person.name, mobile: person.mobile } };
  return { rented: true, tenant: null, manager: { name: person.name, agency: "", mobile: person.mobile, email: person.email }, access: { who: "property_manager", name: person.name, mobile: person.mobile } };
}

const isStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
function parseRental(v: unknown): RentalAnswers | null {
  if (!v || typeof v !== "object") return null;
  const r = v as { rented?: unknown; tenant?: Record<string, unknown> | null; access?: Record<string, unknown> | null; manager?: Record<string, unknown> | null };
  if (r.rented === false) return { rented: false, tenant: null, manager: null, access: null };
  if (r.rented !== true) return null;
  const t = r.tenant, a = r.access, m = r.manager;
  // Jo 4 Nov 2026: the email may be "" (optional); older answers always carried one.
  const tenant: TenantContact | null = t && isStr(t["name"]) && isStr(t["mobile"]) && typeof t["email"] === "string" ? { name: t["name"], mobile: t["mobile"], email: t["email"] } : null;
  const manager: ManagerContact | null = m && isStr(m["name"]) && isStr(m["mobile"]) ? { name: m["name"], agency: typeof m["agency"] === "string" ? m["agency"] : "", mobile: m["mobile"], email: typeof m["email"] === "string" ? m["email"] : "" } : null;
  if (!a || !validWho(a["who"]) || !isStr(a["name"]) || typeof a["mobile"] !== "string") return null;
  // Rented needs the person we deal with: the tenant, or (two-screen flow) the property manager.
  if (!tenant && !manager) return null;
  return { rented: true, tenant, manager, access: { who: a["who"], name: a["name"], mobile: a["mobile"] } };
}

/** The rental answers inside a `quick_taps_answered` (or `rental_answers_corrected`) event's details. `null` = not asked
 *  (an old tap, or the questions were off). */
export function rentalAnswersFromTaps(details: unknown): RentalAnswers | null {
  const answers = (details as { answers?: { rental?: unknown } | null } | null)?.answers;
  return parseRental(answers?.rental);
}

/** Who lets us in, when it is not the owner (null: owner lives there, the owner lets us in, or not asked). */
export const accessPersonOf = (r: RentalAnswers | null): AccessPerson | null => (r?.rented && r.access && r.access.who !== "owner" ? r.access : null);
export const tenantOf = (r: RentalAnswers | null): TenantContact | null => (r?.rented ? r.tenant : null);
/** Jo 4 Nov 2026 21:40: the person the tenant notice (install day, power off) goes to — the one the owner picked: the
 *  tenant, or the property manager (name, mobile, email). Null when the owner deals with us themselves or nobody usable
 *  was recorded (the sender holds). */
export function noticePersonOf(r: RentalAnswers | null): TenantContact | null {
  if (!r?.rented) return null;
  if (r.access?.who === "property_manager" && r.manager) return { name: r.manager.name, mobile: r.manager.mobile, email: r.manager.email };
  return r.tenant;
}

// ---- Installers' own customers (Jo 2 Nov, answer 24) ----------------------------------------------------------
/** The text to an installer's own customer stays off until Jo approves the wording as a picture. */
export const OWN_CUSTOMER_RENTAL_TAPS_APPROVED = false as boolean;
export const OWN_CUSTOMER_RENTAL_SMS_TYPE = "own_customer_rental_taps" as const;
export const ownCustomerRentalTapsKey = (jobId: string) => `own-rental-taps:v1:${jobId}`;
/** DRAFT (Jo approves at build time). */
export function ownCustomerRentalTapsText(i: { firstName: string | null; installer: string; link: string }): string {
  const first = clean(i.firstName);
  return `Home Insulation Victoria: Hi ${first || "there"}, ${clean(i.installer)} has added your ceiling insulation job. A few quick questions about your home: ${i.link}`;
}
/** The quick-taps screen showing ONLY the rental questions. */
export const rentalOnlyLink = (quickTapsLink: string) => `${quickTapsLink}&only=rental`;
