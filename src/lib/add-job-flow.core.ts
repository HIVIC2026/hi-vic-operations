// Installer Add a job (Jo, 8 Oct 2026; basics only since decision 34, 24 Oct 2026; ONE screen per the approved new-job-flow
// mock-up, installer screens Task 7). Pure presentation/state rules only. Validation comes from the existing validators.
import { LEAD_ORIGIN_BLOCKED, LEAD_ORIGIN_MISSING, PICK_ADDRESS, addJobConsentLine, onsiteProblems, type OnsiteInput } from "./onsite-ready-check.core";
import { contactConsentSnapshot, type ContactConsentSnapshot } from "./contact-consent-record.core";
export { addJobConsentLine, consentProblem } from "./onsite-ready-check.core";

/** Approved screen wording (plan Global Constraints / Task 7). */
export const ADD_JOB_WORDS = {
  title: "Add a job", sub: "Your own customer. Takes a minute.",
  name: "Owner's full name", mobile: "Mobile", email: "Email", address: "Address",
  how: "How did you get this customer?", howNote: "Door-knocked or cold-called customers can't be added.",
  electrician: "Electrician for the PIESA", button: "Add the job",
} as const;
/** Approved: shown once the job is added (the page moves on to the job). */
export const nextLine = (_first: string): string => "Added";
/** DRAFT: the electrician picker's "nothing chosen" problem; the Team list's own reason wins for a listed person. */
export const ELECTRICIAN_MISSING = "Choose the electrician for the PIESA."; // DRAFT
export type TeamElectricianChoice = { id: string; name: string; allowed: boolean; reason: string | null };
export function electricianProblem(workerId: string | null | undefined, list: TeamElectricianChoice[]): string | null {
  const w = workerId ? list.find((x) => x.id === workerId) : null;
  if (!w) return ELECTRICIAN_MISSING;
  return w.allowed ? null : (w.reason ?? ELECTRICIAN_MISSING);
}
/** DRAFT lines on the screen (not from the plan or decisions; listed for Jo). */
export const ADD_JOB_DRAFT_WORDS = {
  noTeamElectrician: "Add a verified electrician to your Team (My business) before adding a job.", // DRAFT
  chooseElectrician: "Choose the electrician", // DRAFT (dropdown placeholder)
  loading: "Loading…", // existing
  teamFailed: "Your Team couldn't load. Check your signal and try again.", // DRAFT
  loadingBusiness: "Loading your business details…", // DRAFT (shown in place of the consent tick until the exact line is known)
  electricianNotAllocated: "The electrician couldn't be put on the job — choose them again on the job page.", // DRAFT (Jo 3 Nov ruling: never blocks the job)
  goToJob: "Go to the job", // DRAFT (button after that line)
} as const;
export const NO_TEAM_ELECTRICIAN = ADD_JOB_DRAFT_WORDS.noTeamElectrician;

/** The consent as recorded: Part 3's snapshot shape (who / purpose / methods / expiresAt / wording) for the consent row, and the
 *  plan's event details for the existing contact-permission event. Both from the one approved line. */
export function addJobConsentRecord(businessName: string, givenAt: string): {
  wording: string; snapshot: ContactConsentSnapshot;
  event: { wording: string; who: string[]; for: "this job"; how: ["phone", "visit"]; given_at: string; recorded_by: "installer" };
} {
  const wording = addJobConsentLine(businessName);
  const who = ["Home Insulation Victoria", businessName];
  return { wording, snapshot: contactConsentSnapshot({ who, givenAt, wording }), event: { wording, who, for: "this job", how: ["phone", "visit"], given_at: givenAt, recorded_by: "installer" } };
}

/** A5 (Jo 28 Oct): what staff (not the business owner) are told at the start, instead of the form. */
export const ADD_JOB_STAFF_ONLY = "Only your business owner can add jobs. Ask them to add this customer for you.";
/** Who may add: the boss of any business → that business; since Task 7 an Office person (`prices`, Task 1 roles) too; other staff → staff. */
export function addJobStartState(m: Map<string, "business_admin" | "member">, ctx?: { businessId: string; prices: boolean } | null): { kind: "owner"; businessId: string } | { kind: "staff" } | { kind: "none" } {
  for (const [businessId, role] of m) if (role === "business_admin") return { kind: "owner", businessId };
  if (ctx?.prices && m.has(ctx.businessId)) return { kind: "owner", businessId: ctx.businessId };
  return m.size > 0 ? { kind: "staff" } : { kind: "none" };
}

export const blankCustomer = (): OnsiteInput => ({ full_name: "", address_line: "", suburb: "", postcode: "", phone: "", email: "", contact_permission: false, consent_by: null });

/** A restored phone draft never carries consent forward: it must be ticked again for this job. */
export const restoreCustomer = (raw: unknown): OnsiteInput => {
  const d = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof OnsiteInput, unknown>>;
  const s = (k: keyof OnsiteInput) => (typeof d[k] === "string" ? (d[k] as string) : "");
  return { full_name: s("full_name"), address_line: s("address_line"), suburb: s("suburb"), postcode: s("postcode"), phone: s("phone"), email: s("email"), contact_permission: false, consent_by: null, address_verified: d.address_verified === true, address_typed: d.address_typed === true };
};
/** A6: the draft also carries its `request_key` (one per draft), so "Try again" after a reload finishes the same job. */
export const restoreRequestKey = (raw: unknown): string | null => {
  const k = raw && typeof raw === "object" ? (raw as Record<string, unknown>)["request_key"] : null;
  return typeof k === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(k) ? k : null;
};

/** A8: wording of the two links under the address when Google cannot find it. */
export const ADDRESS_TYPE_IN = "Can't find the address? Type it in";
export const ADDRESS_PICK_AGAIN = "Pick from the list instead";

/** On the phone the address must also be picked from the Google list (Jo 24 Oct); sample screens type freely. */
export const customerProblems = (c: OnsiteInput, opts: { requirePicked?: boolean; businessName?: string | null } = {}) =>
  opts.requirePicked === false || c.address_verified === true || c.address_typed === true ? onsiteProblems(c, opts) : [PICK_ADDRESS, ...onsiteProblems(c, opts)];

/** Save button wording (approved "Add the job"): saving is not booking and not an open form. */
export const SAVE_LABEL = ADD_JOB_WORDS.button;
export const BUSY_LABEL = "Saving…";
export const TRY_AGAIN_LABEL = "Try again";

/** Jo 25 Oct: errors say why (decision 273 wording rule). Decision 282: an email is never a reason to refuse, so the
 *  only duplicate message is the server's own "This address already has an open job (HV-xxxx)…" line, shown as is;
 *  raw database collisions (unique-key text) still become one neutral line that names nobody. */
export const NEUTRAL_SAVE_ERROR = "Job not added. Please contact the office for help; your entered details are kept.";
export function saveErrorMessage(msg: string | null | undefined): string {
  const m = msg ?? "";
  if (/already on another customer record|owners_email_uq|duplicate key/i.test(m)) return NEUTRAL_SAVE_ERROR;
  if (/load failed|failed to fetch|network|timeout|fetch failed/i.test(m)) return "The save confirmation was interrupted. Your details are kept; tap Try again to finish the same job. Do not add it again.";
  if (!m) return "No signal — your details are kept. Tap again when you have signal.";
  return m;
}

/** Review-summary wording: positive only when the same rule final validation uses is satisfied (restored drafts reset these on purpose). */
export const contactPermissionSummary = (c: Pick<OnsiteInput, "contact_permission" | "consent_by">) =>
  c.contact_permission === true && c.consent_by === "installer" ? "Permission to contact given" : "Contact permission still needs to be ticked";
export const organiseSummary = (coord: "hivic_managed" | "self_managed" | string | null, selfAck: boolean) =>
  coord === "self_managed"
    ? selfAck ? "I’ll manage the job myself (responsibility acknowledged)" : "I’ll manage the job myself — responsibility still needs to be ticked"
    : coord ? "Home Insulation Victoria manages the process" : "Who organises the job still needs to be chosen";

// ---------- Error state (approved 24 Oct 2026, decision 237): one short red line per field + a summary banner. ----------
export type AddJobField = "full_name" | "address" | "phone" | "email" | "permission" | "visit" | "electrician" | "lead_origin";
/** One short red line per field from the existing validator messages (validation itself is unchanged). */
export function fieldErrors(problems: string[]): Partial<Record<AddJobField, string>> {
  const out: Partial<Record<AddJobField, string>> = {};
  for (const p of problems) {
    if (p === LEAD_ORIGIN_BLOCKED || p === LEAD_ORIGIN_MISSING) out.lead_origin ??= p;
    // The consent line names the business, so it is matched BEFORE the electrician words (a business called "… Electrician …").
    else if (/permission|agreed to/i.test(p)) out.permission ??= "Tick this once the owner has agreed.";
    else if (p === ELECTRICIAN_MISSING || /electrical safety check|usual electrician|electrician/i.test(p)) out.electrician ??= p;
    else if (/full name|first and last|owner's name/i.test(p)) out.full_name ??= "Enter the owner's first and last name.";
    else if (/mobile/i.test(p)) out.phone ??= /Check the mobile/i.test(p) ? "That doesn't look like a mobile number." : "Enter the owner's mobile.";
    else if (/email/i.test(p)) out.email ??= /Check the email/i.test(p) ? "That doesn't look like an email address." : "Enter the owner's email.";
    else if (p === PICK_ADDRESS || /address|street|suburb|postcode|Victorian/i.test(p)) out.address ??= /Victorian jobs|postcode list/i.test(p) ? p.replace(/ — .*$/, ".") : "Pick the address from the list.";
    else out.visit ??= p.replace(/\.?$/, ".");
  }
  return out;
}
/** "3 things to fix before the job can be added." */
export function errorSummary(n: number): string | null {
  return n <= 0 ? null : `${n} thing${n === 1 ? "" : "s"} to fix before the job can be added.`;
}
export const ADD_JOB_OFFLINE_NOTE = "Your typed details stay on your phone if the signal drops.";
export const OWNER_CARD_TITLE = "Owner";
