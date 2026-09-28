// Owner ESC information-sharing consent – PURE rules (no I/O).
// A separate pre-install event: generated only once an exact installation date exists, signed by the
// owner/authorised representative AND confirmed by the AP representative, at least 24h before work.
const LEAD_MS = 24 * 3600_000; // same 24h lead as esc.core (kept local to avoid a circular import)

export const ESC_AP_LEGAL_NAME = "DC Construction Solutions Pty Ltd t/a Home Insulation Victoria";

export type ConsentFacts = {
  ap_legal_entity: string;
  owner: { name: string | null; email: string | null; phone: string | null };
  premises_address: string;
  installation_days: string[];
  scheduled_start: string;
  scheduled_end: string | null;
};

export function melbourneDay(iso: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne" }).format(new Date(iso));
}

/** Returns null when no exact installation date exists – consent cannot be generated yet. */
export function buildConsentFacts(i: { scheduledStart: string | null; scheduledEnd: string | null; premisesAddress: string; owner: ConsentFacts["owner"] }): ConsentFacts | null {
  if (!i.scheduledStart || Number.isNaN(Date.parse(i.scheduledStart))) return null;
  return { ap_legal_entity: ESC_AP_LEGAL_NAME, owner: i.owner, premises_address: i.premisesAddress, installation_days: [melbourneDay(i.scheduledStart)], scheduled_start: i.scheduledStart, scheduled_end: i.scheduledEnd };
}

/** Locked details whose change makes a prior consent stale. */
export function consentStaleReasons(prev: ConsentFacts, next: ConsentFacts): string[] {
  const r: string[] = [];
  if (new Date(prev.scheduled_start).getTime() !== new Date(next.scheduled_start).getTime()) r.push("installation date/time changed");
  if ((prev.scheduled_end ?? null) !== (next.scheduled_end ?? null)) r.push("installation end changed");
  if (prev.premises_address !== next.premises_address) r.push("premises address changed");
  if ((prev.owner.name ?? "") !== (next.owner.name ?? "")) r.push("owner identity changed");
  if ((prev.owner.email ?? "") !== (next.owner.email ?? "") || (prev.owner.phone ?? "") !== (next.owner.phone ?? "")) r.push("owner contact details changed");
  return r;
}

export const latestConsentAt = (startIso: string) => new Date(new Date(startIso).getTime() - LEAD_MS).toISOString();

export type ConsentSignInput = { signatoryName: string; authorityType: "owner" | "authorised_representative"; accept: boolean; signatureName: string };

export function ownerConsentBlockers(i: { status: string | null; templateApproved: boolean; scheduledStart: string | null; nowIso: string; input: ConsentSignInput }): string[] {
  const b: string[] = [];
  if (!i.scheduledStart) b.push("Owner consent can only be signed once an exact installation date is booked.");
  if (!i.templateApproved) b.push("ESC owner consent is not ready: the consent form wording has not been approved.");
  if (i.status && i.status !== "awaiting_owner") b.push(i.status === "stale" ? "This consent is out of date – a new one is required." : "This consent is not awaiting the owner's signature.");
  if (i.scheduledStart && new Date(i.nowIso).getTime() > new Date(latestConsentAt(i.scheduledStart)).getTime()) b.push("Consent must be signed at least 24 hours before the installation starts – reschedule the installation.");
  if (!i.input.accept) b.push("Please confirm you consent to the information sharing.");
  if (i.input.signatoryName.trim().length < 2) b.push("Signatory name is required.");
  if (i.input.signatureName.trim().length < 2) b.push("Type your full name to sign.");
  return b;
}

export function apConsentBlockers(i: { status: string | null; scheduledStart: string; nowIso: string; apRepName: string; purposeExplained: boolean }): string[] {
  const b: string[] = [];
  if (i.status !== "awaiting_ap") b.push(i.status === "awaiting_owner" ? "The owner must sign first." : "This consent is not awaiting AP confirmation.");
  if (new Date(i.nowIso).getTime() > new Date(latestConsentAt(i.scheduledStart)).getTime()) b.push("Consent must be complete at least 24 hours before the installation starts.");
  if (!i.purposeExplained) b.push("Confirm the purpose of the information sharing was explained to the owner.");
  if (i.apRepName.trim().length < 2) b.push("AP representative name is required.");
  return b;
}

export type ConsentRecord = { status: string; scheduled_start: string; owner_signed_at: string | null; ap_signed_at: string | null } | null;
/** Consent validity for a given planned start: valid status, same date, both signatures ≥24h before start. */
export function consentValidityBlockers(c: ConsentRecord, scheduledStart: string | null): string[] {
  if (!scheduledStart) return ["No installation booked"];
  const due = new Date(latestConsentAt(scheduledStart)).getTime();
  const fmt = new Date(due).toLocaleString("en-AU", { timeZone: "Australia/Melbourne" });
  if (!c) return [`Owner ESC consent not generated – must be signed by ${fmt} (24h before start)`];
  if (c.status === "stale" || new Date(c.scheduled_start).getTime() !== new Date(scheduledStart).getTime()) return ["Owner ESC consent is stale for the current booking – new consent required"];
  if (c.status !== "valid" || !c.owner_signed_at || !c.ap_signed_at) return [`Owner ESC consent not complete (owner + AP representative) – must be signed by ${fmt}`];
  const done = Math.max(new Date(c.owner_signed_at).getTime(), new Date(c.ap_signed_at).getTime());
  if (done > due) return ["Owner ESC consent was completed less than 24h before start – reschedule"];
  return [];
}

export const consentCompletedAt = (c: NonNullable<ConsentRecord>) => (c.owner_signed_at && c.ap_signed_at ? new Date(Math.max(Date.parse(c.owner_signed_at), Date.parse(c.ap_signed_at))).toISOString() : null);
