// Task 19 (Jo 2 Nov 2026, answers 7, 22 and 24): is the home rented? The OWNER tells us in the quick taps, straight after
// the "It's your turn" text (not in the Mitti Ready Check). Jo 4 Nov 2026 20:40 (pack 2 batch 7, APPROVED): four screens —
// (1) live there or rented out; (2) the tenant's name, mobile and email (optional) on one screen; (3) is there a property
// manager (name, agency, mobile, email); (4) who we book the visits with: me / the tenant / the property manager — which
// REPLACES the old "Who lets us in: Me / My tenant" tap (retired in the same change). Installers' own customers get the
// same questions by text after the installer adds the job. PURE: no I/O.
// Answers are stored in the existing `quick_taps_answered` event details (`answers.rental`); an office correction is a
// new `rental_answers_corrected` event with the same shape (latest wins). No SQL.
import { toAuE164 } from "./sms.core";

/** Jo 4 Nov 2026 20:40 (pack 2 batch 7): the four rental screens were approved and replace the old "Who lets us in: Me /
 *  My tenant" tap — ON. */
export const RENTAL_TAPS_APPROVED = true as boolean;
export const RENTAL_ANSWERS_CORRECTED_EVENT = "rental_answers_corrected";

export type AccessWho = "owner" | "tenant" | "property_manager";
export type AccessPerson = { who: AccessWho; name: string; mobile: string };
/** `email` may be "" (Jo 4 Nov 2026: the tenant's email is optional). */
export type TenantContact = { name: string; mobile: string; email: string };
/** The property manager (Jo 4 Nov 2026, screen 3): name and mobile are needed; agency and email may be "". */
export type ManagerContact = { name: string; agency: string; mobile: string; email: string };
export type RentalAnswers = { rented: boolean; tenant: TenantContact | null; manager?: ManagerContact | null; access: AccessPerson | null };

/** What the owner has typed or tapped so far (the quick taps keep this while the questions are answered). */
export type RentalAnswersInput = {
  lives?: "live" | "rented" | undefined;
  tenantName?: string | undefined;
  tenantMobile?: string | undefined;
  tenantEmail?: string | undefined;
  manager?: "no" | "yes" | undefined;
  managerName?: string | undefined;
  managerAgency?: string | undefined;
  managerMobile?: string | undefined;
  managerEmail?: string | undefined;
  who?: AccessWho | undefined;
};
/** The four screens (Jo 4 Nov 2026 20:40): live or rented → the tenant (one screen) → the property manager → who we book with. */
export type RentalStep = "lives" | "tenant" | "manager" | "who";

/** Jo's words, verbatim (4 Nov 2026 20:40). */
export const RENTAL_TAPS = {
  livesThere: "Do you live there, or is it rented out?",
  livesOptions: ["I live there", "It's rented out"],
  tenantTitle: "Who's the tenant?",
  tenantSub: "We'll need to arrange access with them and let them know the install day. Nothing goes to them until you've accepted a quote.",
  tenantName: "Tenant's name",
  tenantMobile: "Tenant's mobile",
  tenantEmail: "Tenant's email (optional)",
  managerTitle: "Is there a property manager?",
  managerOptions: ["No, I deal with the tenant", "Yes"],
  managerName: "Manager's name",
  managerAgency: "Agency",
  managerMobile: "Mobile",
  managerEmail: "Email",
  whoTitle: "Who should we book the visits with?",
  whoOptions: ["Me", "The tenant", "The property manager"],
  next: "Next", // existing button word
} as const;
export const RENTAL_LIVES_VALUES = ["live", "rented"] as const;
export const RENTAL_MANAGER_VALUES = ["no", "yes"] as const;
export const RENTAL_WHO_VALUES = ["owner", "tenant", "property_manager"] as const satisfies readonly AccessWho[];

/** DRAFT: the line an own customer sees after the last rental answer. */
export const RENTAL_DONE_LINE = "Thanks! That's everything we need for now.";
// DRAFT problem lines (owner-facing when a typed answer is not usable).
export const RENTAL_PROBLEMS = {
  lives: "Please tell us if you live there or if it's rented out.",
  tenantName: "Please add the tenant's name.",
  tenantMobile: "Please add the tenant's mobile (it starts with 04).",
  tenantEmail: "That email doesn't look right — check it, or leave it blank.",
  manager: "Please tell us if there's a property manager.",
  managerName: "Please add the manager's name.",
  managerMobile: "Please add the manager's mobile (it starts with 04).",
  managerEmail: "That email doesn't look right — check it, or leave it blank.",
  who: "Please tell us who to book the visits with.",
  whoManager: "There's no property manager on the job — pick who to book the visits with.",
} as const;

const clean = (v: string | null | undefined) => (v ?? "").trim().replace(/\s+/g, " ");
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const validEmail = (v: string | null | undefined) => EMAIL.test(clean(v));
/** Optional email: blank is fine; anything typed must look like an email. */
const optionalEmailOk = (v: string | null | undefined) => !clean(v) || validEmail(v);
/** An Australian mobile only (a landline or a made-up number is refused). */
const mobile = (v: string | null | undefined) => toAuE164(clean(v));

/** The tenant screen's problems (all three boxes at once). */
export function rentalTenantProblems(a: Partial<RentalAnswersInput> | null | undefined): string[] {
  const x = a ?? {};
  const out: string[] = [];
  if (!clean(x.tenantName)) out.push(RENTAL_PROBLEMS.tenantName);
  if (!mobile(x.tenantMobile)) out.push(RENTAL_PROBLEMS.tenantMobile);
  if (!optionalEmailOk(x.tenantEmail)) out.push(RENTAL_PROBLEMS.tenantEmail);
  return out;
}
/** The property manager screen's problems: the choice, and (yes) the name and mobile; agency and email are optional. */
export function rentalManagerProblems(a: Partial<RentalAnswersInput> | null | undefined): string[] {
  const x = a ?? {};
  if (x.manager !== "no" && x.manager !== "yes") return [RENTAL_PROBLEMS.manager];
  if (x.manager === "no") return [];
  const out: string[] = [];
  if (!clean(x.managerName)) out.push(RENTAL_PROBLEMS.managerName);
  if (!mobile(x.managerMobile)) out.push(RENTAL_PROBLEMS.managerMobile);
  if (!optionalEmailOk(x.managerEmail)) out.push(RENTAL_PROBLEMS.managerEmail);
  return out;
}

/** What is still wrong with the answers; empty = complete. */
export function rentalAnswersProblems(a: Partial<RentalAnswersInput> | null | undefined): string[] {
  const x = a ?? {};
  if (x.lives !== "live" && x.lives !== "rented") return [RENTAL_PROBLEMS.lives];
  if (x.lives === "live") return [];
  const out: string[] = [...rentalTenantProblems(x), ...rentalManagerProblems(x)];
  if (!x.who || !(RENTAL_WHO_VALUES as readonly string[]).includes(x.who)) out.push(RENTAL_PROBLEMS.who);
  else if (x.who === "property_manager" && x.manager !== "yes") out.push(RENTAL_PROBLEMS.whoManager);
  return out;
}

/** The next rental screen to show, or null when complete. */
export function nextRentalStep(a: Partial<RentalAnswersInput> | null | undefined): RentalStep | null {
  const x = a ?? {};
  if (x.lives !== "live" && x.lives !== "rented") return "lives";
  if (x.lives === "live") return null;
  if (rentalTenantProblems(x).length) return "tenant";
  if (rentalManagerProblems(x).length) return "manager";
  if (!x.who || (x.who === "property_manager" && x.manager !== "yes")) return "who";
  return null;
}

/** The "who should we book the visits with" choices: "The property manager" only when there is one. */
export function rentalWhoChoices(a: Partial<RentalAnswersInput> | null | undefined): { value: AccessWho; label: string }[] {
  const all = RENTAL_WHO_VALUES.map((value, i) => ({ value, label: RENTAL_TAPS.whoOptions[i]! }));
  return a?.manager === "yes" ? all : all.filter((c) => c.value !== "property_manager");
}

/** The answers as stored. "The tenant" reuses the tenant's details; "the property manager" the manager's; "me" is the owner
 *  on file (their mobile is "" when the number on file is not an Australian mobile). Throws when the answers are not
 *  complete (check rentalAnswersProblems first). */
export function buildRentalAnswers(a: RentalAnswersInput, owner: { name: string | null; phone: string | null }): RentalAnswers {
  const problems = rentalAnswersProblems(a);
  if (problems.length) throw new Error(problems.join(" "));
  if (a.lives === "live") return { rented: false, tenant: null, manager: null, access: null };
  const tenant: TenantContact = { name: clean(a.tenantName), mobile: mobile(a.tenantMobile)!, email: clean(a.tenantEmail).toLowerCase() };
  const manager: ManagerContact | null = a.manager === "yes" ? { name: clean(a.managerName), agency: clean(a.managerAgency), mobile: mobile(a.managerMobile)!, email: clean(a.managerEmail).toLowerCase() } : null;
  const access: AccessPerson =
    a.who === "tenant" ? { who: "tenant", name: tenant.name, mobile: tenant.mobile }
    : a.who === "property_manager" ? { who: "property_manager", name: manager!.name, mobile: manager!.mobile }
    : { who: "owner", name: clean(owner.name), mobile: mobile(owner.phone) ?? "" };
  return { rented: true, tenant, manager, access };
}

const isStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
function parseRental(v: unknown): RentalAnswers | null {
  if (!v || typeof v !== "object") return null;
  const r = v as { rented?: unknown; tenant?: Record<string, unknown> | null; access?: Record<string, unknown> | null };
  if (r.rented === false) return { rented: false, tenant: null, manager: null, access: null };
  if (r.rented !== true) return null;
  const t = r.tenant, a = r.access, m = (r as { manager?: Record<string, unknown> | null }).manager;
  // Jo 4 Nov 2026: the tenant's email may be "" (optional); older answers always carried one.
  if (!t || !isStr(t["name"]) || !isStr(t["mobile"]) || typeof t["email"] !== "string") return null;
  if (!a || !(RENTAL_WHO_VALUES as readonly unknown[]).includes(a["who"]) || !isStr(a["name"]) || typeof a["mobile"] !== "string") return null;
  const manager: ManagerContact | null = m && isStr(m["name"]) && isStr(m["mobile"]) ? { name: m["name"], agency: typeof m["agency"] === "string" ? m["agency"] : "", mobile: m["mobile"], email: typeof m["email"] === "string" ? m["email"] : "" } : null;
  return { rented: true, tenant: { name: t["name"], mobile: t["mobile"], email: t["email"] }, manager, access: { who: a["who"] as AccessWho, name: a["name"], mobile: a["mobile"] } };
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
