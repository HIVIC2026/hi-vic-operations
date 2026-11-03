// Task 19 (Jo 2 Nov 2026, answers 7, 22 and 24): is the home rented? The OWNER tells us in the quick taps, straight after
// the "It's your turn" text (not in the Mitti Ready Check). If rented: the tenant's name, mobile and email, and who lets
// us in (the owner, the tenant or the property manager; a property manager needs a name and mobile). Installers' own
// customers get the same questions by text after the installer adds the job. PURE: no I/O.
// Answers are stored in the existing `quick_taps_answered` event details (`answers.rental`); an office correction is a
// new `rental_answers_corrected` event with the same shape (latest wins). No SQL.
import { toAuE164 } from "./sms.core";

/** The rental questions are only asked while this is true. Every label below except `livesThere` is a DRAFT wording
 *  (Jo approves them at build time), so the quick taps stay exactly as they were until she does. */
export const RENTAL_TAPS_APPROVED = false as boolean;
export const RENTAL_ANSWERS_CORRECTED_EVENT = "rental_answers_corrected";

export type AccessWho = "owner" | "tenant" | "property_manager";
export type AccessPerson = { who: AccessWho; name: string; mobile: string };
export type TenantContact = { name: string; mobile: string; email: string };
export type RentalAnswers = { rented: boolean; tenant: TenantContact | null; access: AccessPerson | null };

/** What the owner has typed or tapped so far (the quick taps keep this while the questions are answered). */
export type RentalAnswersInput = {
  lives?: "live" | "rented" | undefined;
  tenantName?: string | undefined;
  tenantMobile?: string | undefined;
  tenantEmail?: string | undefined;
  who?: AccessWho | undefined;
  accessName?: string | undefined;
  accessMobile?: string | undefined;
};
export type RentalStep = "lives" | "tenant_name" | "tenant_mobile" | "tenant_email" | "who" | "access_name" | "access_mobile";

export const RENTAL_TAPS = {
  /** Jo, verbatim. */
  livesThere: "Do you live there or is it rented?",
  livesOptions: ["I live there", "It's rented"],
  // DRAFT wording from here (Jo approves at build time).
  tenantName: "Tenant's name",
  tenantMobile: "Tenant's mobile",
  tenantEmail: "Tenant's email",
  whoLetsIn: "Who'll let us in?",
  whoOptions: ["Me (the owner)", "The tenant", "The property manager"],
  accessName: "Their name",
  accessMobile: "Their mobile",
} as const;
export const RENTAL_LIVES_VALUES = ["live", "rented"] as const;
export const RENTAL_WHO_VALUES = ["owner", "tenant", "property_manager"] as const satisfies readonly AccessWho[];

/** DRAFT: the line an own customer sees after the last rental answer. */
export const RENTAL_DONE_LINE = "Thanks! That's everything we need for now.";
// DRAFT problem lines (owner-facing when a typed answer is not usable).
export const RENTAL_PROBLEMS = {
  lives: "Please tell us if you live there or if it's rented.",
  tenantName: "Please add the tenant's name.",
  tenantMobile: "Please add the tenant's mobile (it starts with 04).",
  tenantEmail: "Please add the tenant's email.",
  who: "Please tell us who will let us in.",
  accessName: "Please add their name.",
  accessMobile: "Please add their mobile (it starts with 04).",
} as const;

const clean = (v: string | null | undefined) => (v ?? "").trim().replace(/\s+/g, " ");
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const validEmail = (v: string | null | undefined) => EMAIL.test(clean(v));
/** An Australian mobile only (a landline or a made-up number is refused). */
const mobile = (v: string | null | undefined) => toAuE164(clean(v));

/** What is still wrong with the answers; empty = complete. */
export function rentalAnswersProblems(a: Partial<RentalAnswersInput> | null | undefined): string[] {
  const x = a ?? {};
  if (x.lives !== "live" && x.lives !== "rented") return [RENTAL_PROBLEMS.lives];
  if (x.lives === "live") return [];
  const out: string[] = [];
  if (!clean(x.tenantName)) out.push(RENTAL_PROBLEMS.tenantName);
  if (!mobile(x.tenantMobile)) out.push(RENTAL_PROBLEMS.tenantMobile);
  if (!validEmail(x.tenantEmail)) out.push(RENTAL_PROBLEMS.tenantEmail);
  if (!x.who || !(RENTAL_WHO_VALUES as readonly string[]).includes(x.who)) out.push(RENTAL_PROBLEMS.who);
  else if (x.who === "property_manager") {
    if (!clean(x.accessName)) out.push(RENTAL_PROBLEMS.accessName);
    if (!mobile(x.accessMobile)) out.push(RENTAL_PROBLEMS.accessMobile);
  }
  return out;
}

/** The next rental question to show, or null when complete. */
export function nextRentalStep(a: Partial<RentalAnswersInput> | null | undefined): RentalStep | null {
  const x = a ?? {};
  if (x.lives !== "live" && x.lives !== "rented") return "lives";
  if (x.lives === "live") return null;
  if (!clean(x.tenantName)) return "tenant_name";
  if (!mobile(x.tenantMobile)) return "tenant_mobile";
  if (!validEmail(x.tenantEmail)) return "tenant_email";
  if (!x.who) return "who";
  if (x.who === "property_manager") {
    if (!clean(x.accessName)) return "access_name";
    if (!mobile(x.accessMobile)) return "access_mobile";
  }
  return null;
}

/** The problem with ONE typed field (shown under the box), or null when it is fine. */
export function rentalFieldProblem(step: Extract<RentalStep, "tenant_name" | "tenant_mobile" | "tenant_email" | "access_name" | "access_mobile">, value: string): string | null {
  switch (step) {
    case "tenant_name": return clean(value) ? null : RENTAL_PROBLEMS.tenantName;
    case "tenant_mobile": return mobile(value) ? null : RENTAL_PROBLEMS.tenantMobile;
    case "tenant_email": return validEmail(value) ? null : RENTAL_PROBLEMS.tenantEmail;
    case "access_name": return clean(value) ? null : RENTAL_PROBLEMS.accessName;
    case "access_mobile": return mobile(value) ? null : RENTAL_PROBLEMS.accessMobile;
  }
}

/** The answers as stored. "The tenant" reuses the tenant's details; "me" is the owner on file (their mobile is "" when the
 *  number on file is not an Australian mobile). Throws when the answers are not complete (check rentalAnswersProblems first). */
export function buildRentalAnswers(a: RentalAnswersInput, owner: { name: string | null; phone: string | null }): RentalAnswers {
  const problems = rentalAnswersProblems(a);
  if (problems.length) throw new Error(problems.join(" "));
  if (a.lives === "live") return { rented: false, tenant: null, access: null };
  const tenant: TenantContact = { name: clean(a.tenantName), mobile: mobile(a.tenantMobile)!, email: clean(a.tenantEmail).toLowerCase() };
  const access: AccessPerson =
    a.who === "tenant" ? { who: "tenant", name: tenant.name, mobile: tenant.mobile }
    : a.who === "property_manager" ? { who: "property_manager", name: clean(a.accessName), mobile: mobile(a.accessMobile)! }
    : { who: "owner", name: clean(owner.name), mobile: mobile(owner.phone) ?? "" };
  return { rented: true, tenant, access };
}

const isStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
function parseRental(v: unknown): RentalAnswers | null {
  if (!v || typeof v !== "object") return null;
  const r = v as { rented?: unknown; tenant?: Record<string, unknown> | null; access?: Record<string, unknown> | null };
  if (r.rented === false) return { rented: false, tenant: null, access: null };
  if (r.rented !== true) return null;
  const t = r.tenant, a = r.access;
  if (!t || !isStr(t["name"]) || !isStr(t["mobile"]) || !isStr(t["email"])) return null;
  if (!a || !(RENTAL_WHO_VALUES as readonly unknown[]).includes(a["who"]) || !isStr(a["name"]) || typeof a["mobile"] !== "string") return null;
  return { rented: true, tenant: { name: t["name"], mobile: t["mobile"], email: t["email"] }, access: { who: a["who"] as AccessWho, name: a["name"], mobile: a["mobile"] } };
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
