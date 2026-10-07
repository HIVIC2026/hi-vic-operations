// "I'm at the property now – start a Ready Check" (Jo, 7 Oct 2026). Pure wording + rules only.
// Persistence: onsite-ready-check.server.ts. The Mitti form is created by the existing createAssignMittiAudit.

export const ONSITE_CHOICE = "I'm at the property now – start a Ready Check";
export const LATER_CHOICE = "Add a job for later";
export const START_BUTTON = "Start Ready Check";
export const PREPARING = "Getting your form ready…";

export type OnsiteInput = {
  full_name: string; address_line: string; suburb: string; postcode: string; phone: string; email: string;
  contact_permission: boolean;
  /** Who gave Gate A consent on site (Jo, 8 Oct): the owner ticked on this phone, or the installer confirms the owner agreed. */
  consent_by?: "owner" | "installer" | null | undefined;
};

/** Jo 8 Oct: on-site Gate A clears when the owner ticks here OR the installer confirms consent. */
export const ONSITE_CONSENT_SOURCE = "onsite_ready_check";
/** TEST jobs only: the Ready Check form goes to Jo's own Mitti account (Jo, 8 Oct). */
export const TEST_MITTI_ASSIGNEE = "jo@actpropertyinspections.com.au";

const digits = (s: string) => s.replace(/\D/g, "");

/** Australian mobile, written any common way (0412 345 678, +61 412 345 678). */
export function isAuMobile(s: string): boolean {
  const d = digits(s);
  return /^04\d{8}$/.test(d) || /^614\d{8}$/.test(d);
}
export const isVicPostcode = (p: string) => /^(3\d{3}|8\d{3})$/.test(p.trim());
const isEmail = (s: string) => /^[^\s@;,]+@[^\s@;,]+\.[^\s@;,]+$/.test(s.trim());

/** One plain problem per field, in screen order. Empty = ready to start. */
export function onsiteProblems(i: OnsiteInput): string[] {
  const out: string[] = [];
  if (i.full_name.trim().length < 2) out.push("Add the owner's name");
  if (i.address_line.trim().length < 3) out.push("Add the street address");
  if (i.suburb.trim().length < 2) out.push("Add the suburb");
  if (!i.postcode.trim()) out.push("Add the postcode");
  else if (!isVicPostcode(i.postcode)) out.push("We can only take Victorian jobs — this one can't be added");
  if (!i.phone.trim()) out.push("Add the owner's mobile");
  else if (!isAuMobile(i.phone)) out.push("Check the mobile — it should look like 0412 345 678");
  if (!i.email.trim()) out.push("Add the owner's email");
  else if (!isEmail(i.email)) out.push("Check the email address");
  if (!i.contact_permission || !i.consent_by) out.push("Get the owner's consent: the owner ticks it on your phone, or you tick to confirm they've agreed");
  return out;
}

/** Address suggestion from the phone's location (OpenStreetMap reverse lookup). Always editable, never trusted. */
export function addressFromReverse(r: unknown): { address_line: string; suburb: string; postcode: string; state: string } | null {
  const a = (r as { address?: Record<string, string> } | null)?.address;
  if (!a) return null;
  const street = [a["house_number"], a["road"]].filter(Boolean).join(" ").trim();
  const suburb = a["suburb"] || a["town"] || a["city_district"] || a["village"] || a["city"] || "";
  if (!street && !suburb) return null;
  return { address_line: street, suburb, postcode: (a["postcode"] ?? "").trim(), state: a["state"] ?? "" };
}

export const mittiFormUrl = (auditId: string) => `https://app.au.mitti.com/inspections/${auditId}`;

export type OnsiteFacts = {
  mittiInvited: boolean; templateSet: boolean; autoSend?: boolean; gateADone: boolean; booked: boolean;
  auditId: string | null; lastError: string | null;
};
export type OnsiteState =
  | { kind: "open"; url: string }
  | { kind: "preparing"; message: string }
  | { kind: "office"; message: string }
  | { kind: "owner_paperwork"; message: string }
  | { kind: "retry"; message: string };

export const OFFICE_SETUP = "Your onsite form isn't switched on yet. Home Insulation Victoria will finish setting it up — the job is saved and the office can see it.";
export const OWNER_PAPERWORK_FIRST = "The job is saved. Before the Ready Check can start, the owner needs to sign the first paperwork (contact, privacy and home details). Home Insulation Victoria has been told.";

/** What the installer sees after tapping Start. Never a dead screen: every state says what happens next. */
export function onsiteState(f: OnsiteFacts): OnsiteState {
  if (f.auditId && f.mittiInvited) return { kind: "open", url: mittiFormUrl(f.auditId) };
  if (!f.gateADone || !f.booked) return { kind: "owner_paperwork", message: OWNER_PAPERWORK_FIRST };
  if (!f.mittiInvited || !f.templateSet || f.autoSend === false) return { kind: "office", message: OFFICE_SETUP };
  if (f.lastError) return { kind: "retry", message: plainMittiError(f.lastError) };
  return { kind: "preparing", message: PREPARING };
}

/** Mitti's technical errors in installer words. */
export function plainMittiError(msg: string): string {
  if (/not found in Mitti|registered in your Mitti|400/i.test(msg)) return "Your Mitti login isn't linked yet. Home Insulation Victoria has been told — the job is saved.";
  if (/could not be reached|failed \(5|timeout/i.test(msg)) return "Mitti isn't answering — this is often poor signal. We'll keep trying.";
  if (/not configured|template/i.test(msg)) return OFFICE_SETUP;
  return "We couldn't open the form just now. We'll keep trying — the job is saved.";
}
/** Only network-type errors are worth retrying automatically. */
export const retryable = (msg: string) => /could not be reached|failed \(5|timeout/i.test(msg);
