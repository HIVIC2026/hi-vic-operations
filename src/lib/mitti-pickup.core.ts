import { sameMittiTemplateId } from "./mitti-identity.core";
// Jo 22 Oct 2026: Ready Checks started straight in Mitti (no portal job yet) must be visible to the
// office and linkable to a job — installer's own measure counts as the Ready Check. Pure rules only:
// parsing/classification lives here so tests can run without Mitti or the database.
import { flatten, norm, contactAnswersFromEntries } from "./mitti.core";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

export type PickupTemplateKind = "installer_form" | "hivic_form" | "unknown";

export type MittiPickupItem = {
  auditId: string;
  templateId: string;
  templateKind: PickupTemplateKind;
  modifiedAt: string | null;
  /** Raw "Portal Job Number" as typed in Mitti (installers may write their own Mitti reference). */
  mittiRef: string | null;
  siteAddress: string | null;
  homeownerName: string | null;
  assessorName: string | null;
  mittiOwnerUserId: string | null;
  mittiOwnerName: string | null;
  /** New A1 contact questions (Jo 23 Oct). Null when the label is absent — never invented. */
  ownerPhone: string | null;
  ownerEmail: string | null;
  contactPermission: boolean | null;
};

export type PickupDuplicate = {
  jobId: string;
  jobNumber: string;
  stage: string | null;
  owner: string | null;
  address: string | null;
};

export type ReadyCheckPickup = MittiPickupItem & {
  /** Installer business matched from the Mitti form owner's portal email; null when unknown. */
  business: { id: string; name: string } | null;
  duplicates: PickupDuplicate[];
};

const JOB_NUMBER_RE = /^HV-\d{1,6}$/i;
const PJN_LABELS = ["portal job number", "job reference id"];

/** Read one Ready Check audit's identity and header answers. Never trusts completion. */
export function parsePickupAudit(audit: Any): MittiPickupItem | null {
  const auditId = String(audit?.audit_id ?? "").trim();
  if (!auditId) return null;
  const entries = flatten(audit?.audit_data ? { header_items: audit.header_items, items: audit.items } : audit);
  const head = (label: string) => entries.find((e) => e.header && e.norm === norm(label))?.value ?? null;
  const authorship = audit?.audit_data?.authorship ?? {};
  const contact = contactAnswersFromEntries(entries.map((e) => ({ label: e.label, value: e.value })));
  return {
    auditId,
    templateId: String(audit?.template_id ?? ""),
    templateKind: "unknown",
    modifiedAt: audit?.modified_at ?? audit?.audit_data?.date_modified ?? null,
    mittiRef: head("Portal Job Number") ?? head("Job Reference ID"),
    siteAddress: head("Site address"),
    homeownerName: head("Homeowner name") ?? head("Owner name"),
    assessorName: head("Assessor"),
    mittiOwnerUserId: String(authorship.owner_id ?? "") || null,
    mittiOwnerName: String(authorship.owner ?? "") || null,
    ownerPhone: contact.phone,
    ownerEmail: contact.email,
    contactPermission: contact.contactPermission,
  };
}

/** Which header item carries the Portal Job Number, with its Mitti item id for the write-back. */
export function portalJobNumberItem(audit: Any): { itemId: string; type: string; current: string | null } | null {
  const items = (audit?.header_items ?? []) as { item_id?: string; label?: string; type?: string; responses?: { text?: string } }[];
  const it = items.find((i) => i.item_id && PJN_LABELS.includes(norm(i.label)));
  if (!it) return null;
  return { itemId: String(it.item_id), type: String(it.type || "textsingle"), current: it.responses?.text ?? null };
}

export function isPortalJobNumber(raw: string | null | undefined): boolean {
  return JOB_NUMBER_RE.test(String(raw ?? "").trim());
}

export function classifyPortalJobNumber(raw: string | null | undefined): "none" | "linked" | "installer_ref" {
  const v = String(raw ?? "").trim();
  if (!v) return "none";
  return JOB_NUMBER_RE.test(v) ? "linked" : "installer_ref";
}

/** Same Mitti template whatever the ID format (dashed UUID vs "template_…"); exact match kept for other IDs. */
export function pickupTemplateMatches(templateId: string, configured: string | null): boolean {
  if (!configured || !templateId) return false;
  return templateId === configured || sameMittiTemplateId(templateId, configured);
}

export function templateKindFor(templateId: string, ids: { readyCheck: string | null; readyCheckPriced: string | null }): PickupTemplateKind {
  if (ids.readyCheckPriced && pickupTemplateMatches(templateId, ids.readyCheckPriced)) return "installer_form";
  if (ids.readyCheck && pickupTemplateMatches(templateId, ids.readyCheck)) return "hivic_form";
  return "unknown";
}

/** Address key for non-blocking duplicate flags: street + suburb from Mitti's "street, suburb, state, postcode". */
const STREET_SUFFIXES: [RegExp, string][] = [[/\bstreet\b/g, "street"], [/\bst\b/g, "street"], [/\brd\b/g, "road"], [/\broad\b/g, "road"], [/\bcrt?\b/g, "court"], [/\bcourt\b/g, "court"], [/\bdr\b/g, "drive"], [/\bdrive\b/g, "drive"], [/\bhwy\b/g, "highway"], [/\bhighway\b/g, "highway"], [/\bav(e|\.)?\b/g, "avenue"], [/\bavenue\b/g, "avenue"]];

function streetKey(s: string): string {
  let k = norm(s);
  for (const [re, full] of STREET_SUFFIXES) if (re.test(k)) { k = k.replace(re, full).replace(/\s+/g, " ").trim(); break; }
  return k;
}

export function pickupAddressKey(address: string | null | undefined): string | null {
  const parts = String(address ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const street = parts[0] ? streetKey(parts[0]) : "";
  const suburb = parts.length > 2 && parts[1] ? norm(parts[1]) : "";
  if (!street) return null;
  return suburb ? `${street}|${suburb}` : street;
}

export function propertyAddressKey(addressLine: string | null | undefined, suburb: string | null | undefined): string | null {
  const street = addressLine ? streetKey(addressLine) : "";
  if (!street) return null;
  const sub = suburb ? norm(suburb) : "";
  return sub ? `${street}|${sub}` : street;
}

/** Pure duplicate flags (Jo 22 Oct): same owner/address already in the portal → FLAG, never block. */
export function pickupDuplicates(
  item: MittiPickupItem,
  jobs: { id: string; job_number: string; stage: string | null; owner: string | null; addressLine: string | null; suburb: string | null }[],
): PickupDuplicate[] {
  const key = pickupAddressKey(item.siteAddress);
  if (!key) return [];
  const nameKey = norm(item.homeownerName);
  return jobs
    .filter((j) => {
      const jk = propertyAddressKey(j.addressLine, j.suburb);
      if (jk && jk === key) return true;
      return !!nameKey && !!j.owner && norm(j.owner) === nameKey;
    })
    .map((j) => ({ jobId: j.id, jobNumber: j.job_number, stage: j.stage, owner: j.owner, address: [j.addressLine, j.suburb].filter(Boolean).join(", ") || null }));
}

/** Human wording for one pickup row — shared by the office panel so wording never drifts. */
export function pickupLabel(item: MittiPickupItem): string {
  const ref = item.mittiRef?.trim() ? item.mittiRef.trim() : "no reference";
  return `Mitti ${ref} · ${item.siteAddress ?? "address not entered"} · ${item.homeownerName ?? "owner name missing"}`;
}

/** Split Mitti's "street, suburb, state postcode" site address. Never guesses missing parts. */
export function pickupAddressParts(address: string | null): { addressLine: string; suburb: string | null; postcode: string | null } | null {
  const parts = String(address ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  const last = parts[parts.length - 1]!;
  const postcode = /(\d{4})\s*$/.test(last) ? last.match(/(\d{4})\s*$/)![1]! : null;
  return { addressLine: parts[0]!, suburb: parts.length > 2 ? parts[1]! : null, postcode };
}

/** Jo 22 Oct 22:57: forms missing ONLY owner contact details (phone/email/permission) still become the installer's job,
 *  marked "Needs finishing" with exactly what is missing. Any other problem still goes to office review. */
export type PickupAutoDecision = ({ action: "create_job" | "office_review"; reasons: string[] } | { action: "create_job_needs_finishing"; reasons: []; missing: string[] }) & { officeFlag?: string };

/** Jo 22 Oct 23:30: an A2 (HIV) form started in Mitti by an installer — not created by the portal (no HV number) —
 *  is that installer's own lead: installer-led job for their business, flagged for office review. */
export const INSTALLER_STARTED_A2_FLAG = "Installer started our A2 form in Mitti — treated as the installer's own lead; office to check";

/** Jo's Mitti-first rules (23 Oct): a clean installer-form Ready Check with a matched business and full
 *  owner details is adopted automatically. Anything off goes to office review — never blocks, never guesses.
 *  Our own (HIVIC) form, duplicates/leads and missing permission always go to review, never auto-create. */
export function pickupAutoDecision(input: {
  templateKind: PickupTemplateKind;
  businessMatched: boolean;
  homeownerName: string | null;
  siteAddress: string | null;
  ownerPhone: string | null;
  ownerEmail: string | null;
  contactPermission: boolean | null;
  duplicates: { jobNumber: string }[];
}): PickupAutoDecision {
  const reasons: string[] = [];
  const installerStartedA2 = input.templateKind === "hivic_form" && input.businessMatched;
  if (input.templateKind === "hivic_form" && !input.businessMatched) reasons.push("Home Insulation Victoria's own form — office decides which job it belongs to");
  else if (input.templateKind === "unknown") reasons.push("Unrecognised Ready Check form");
  if (!input.businessMatched) reasons.push("Mitti user not matched to an installer business");
  if (!input.homeownerName?.trim()) reasons.push("Owner name missing on the form");
  if (!input.siteAddress?.trim()) reasons.push("Address missing on the form");
  if (input.duplicates.length) reasons.push(`Same owner or address already in the portal: ${input.duplicates.map((d) => d.jobNumber).join(", ")}`);
  if (reasons.length) return { action: "office_review", reasons };
  const missing: string[] = [];
  if (!input.ownerPhone?.trim()) missing.push("owner phone");
  if (!input.ownerEmail?.trim()) missing.push("owner email");
  if (input.contactPermission !== true) missing.push(input.contactPermission === false ? "owner contact permission (owner said No)" : "owner contact permission");
  const flag = installerStartedA2 ? { officeFlag: INSTALLER_STARTED_A2_FLAG } : {};
  return missing.length ? { action: "create_job_needs_finishing", reasons: [], missing, ...flag } : { action: "create_job", reasons: [], ...flag };
}

/** Installer-app next step for a picked-up form missing owner details. */
export const needsFinishingText = (missing: string[]) => `Needs finishing: add ${missing.join(", ")} on the Mitti form`;
