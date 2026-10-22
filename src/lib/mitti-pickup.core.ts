// Jo 22 Oct 2026: Ready Checks started straight in Mitti (no portal job yet) must be visible to the
// office and linkable to a job — installer's own measure counts as the Ready Check. Pure rules only:
// parsing/classification lives here so tests can run without Mitti or the database.
import { flatten, norm } from "./mitti.core";

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

export function templateKindFor(templateId: string, ids: { readyCheck: string | null; readyCheckPriced: string | null }): PickupTemplateKind {
  if (ids.readyCheckPriced && templateId === ids.readyCheckPriced) return "installer_form";
  if (ids.readyCheck && templateId === ids.readyCheck) return "hivic_form";
  return "unknown";
}

/** Address key for non-blocking duplicate flags: street + suburb from Mitti's "street, suburb, state, postcode". */
export function pickupAddressKey(address: string | null | undefined): string | null {
  const parts = String(address ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const street = parts[0] ? norm(parts[0]) : "";
  const suburb = parts.length > 2 && parts[1] ? norm(parts[1]) : "";
  if (!street) return null;
  return suburb ? `${street}|${suburb}` : street;
}

export function propertyAddressKey(addressLine: string | null | undefined, suburb: string | null | undefined): string | null {
  const street = addressLine ? norm(addressLine) : "";
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
