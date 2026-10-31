// Owner ESC information-sharing consent – PURE rules (no I/O).
// A separate pre-install event: generated only once an exact installation date exists, signed by the
// owner/authorised representative AND confirmed by the AP representative, at least 24h before work.
const LEAD_MS = 24 * 3600_000; // same 24h lead as esc.core (kept local to avoid a circular import)

export const ESC_AP_LEGAL_NAME = "DC Construction Solutions Pty Ltd t/a Home Insulation Victoria";
/** Section 3 Part A "Accredited person name" and the ESC template's <insert name of accredited person> (decision 123). */
export const ESC_AP_FULL_NAME = "DC Construction Solutions Pty Ltd trading as Home Insulation Victoria (VEU Accredited Person A003654)";
/** compliance_templates.version of the ESC Owner's Consent Form Template v1 (14 Apr 2026), staged in 0226. */
export const ESC_CONSENT_TEMPLATE_VERSION = "ESC-Owners-Consent-Template-v1-20260414";
/** True for the ESC template wording (filled Sections 1–3); false for older approved wording with {dates}. */
export const isEscTemplateVersion = (version: string | null | undefined) => (version ?? "").startsWith("ESC-Owners-Consent-Template-");

/** Section 2 "I declare that:" lines, verbatim from the ESC template. The owner must tick every one. */
export type OwnerDeclarationKey = "owner_or_authorised" | "details_accurate" | "consent_ap_sends" | "consent_commission_shares";
export const OWNER_DECLARATIONS: { key: OwnerDeclarationKey; text: string }[] = [
  { key: "owner_or_authorised", text: "I am the owner of the property listed above, or I am authorised to provide consent on behalf of the owner." },
  { key: "details_accurate", text: "the details listed above are complete and accurate." },
  { key: "consent_ap_sends", text: `I consent to ${ESC_AP_FULL_NAME} sending the information set out in section 1 of this form to the Essential Services Commission (commission)` },
  { key: "consent_commission_shares", text: "I consent to the commission sharing the information set out in section 1 of this form with the Victorian WorkCover Authority (WorkSafe) and/or Energy Safe Victoria (ESV)" },
];
export type OwnerDeclarations = Partial<Record<OwnerDeclarationKey, boolean>>;
export const allDeclarationsTicked = (d: OwnerDeclarations | null | undefined) => OWNER_DECLARATIONS.every((x) => d?.[x.key] === true);
/** One blocker per unticked Section 2 line (empty when all four are ticked). */
export function ownerDeclarationBlockers(d: OwnerDeclarations | null | undefined): string[] {
  return OWNER_DECLARATIONS.filter((x) => d?.[x.key] !== true).map((x) => `Please tick: "${x.text}"`);
}

/** Section 3 Part B, verbatim, with <insert name> filled by the signing office user. */
export const apDeclarationText = (apName: string) =>
  `I ${apName.trim() || "<insert name>"}, am the authorised representative of ${ESC_AP_FULL_NAME} and declare that I have explained to the property owner the purpose for which this written consent is being obtained.`;

/** Section 3 Part A representative details – prefilled from the signing office user's profile, editable before signing. */
export type ApRep = { first_name: string; last_name: string; role: string; phone: string | null; email: string | null };
export const apRepFullName = (r: Pick<ApRep, "first_name" | "last_name">) => `${r.first_name.trim()} ${r.last_name.trim()}`.trim();

/** "Jo Anne Lowe" -> first "Jo Anne", last "Lowe"; a single word is the first name (Section 1 First Name / Last name). */
export function splitFullName(full: string | null | undefined): { first: string; last: string } {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0]!, last: "" };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1]! };
}

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

/** `accept` = the single tick of older wording; `declarations` = the four Section 2 ticks of the ESC template (all required). */
export type ConsentSignInput = { signatoryName: string; authorityType: "owner" | "authorised_representative"; accept: boolean; signatureName: string; declarations?: OwnerDeclarations | undefined };

export function ownerConsentBlockers(i: { status: string | null; templateApproved: boolean; templateVersion?: string | null; scheduledStart: string | null; nowIso: string; input: ConsentSignInput }): string[] {
  const b: string[] = [];
  if (!i.scheduledStart) b.push("Owner consent can only be signed once an exact installation date is booked.");
  if (!i.templateApproved) b.push("ESC owner consent is not ready: the consent form wording has not been approved.");
  if (i.status && i.status !== "awaiting_owner") b.push(i.status === "stale" ? "This consent is out of date – a new one is required." : "This consent is not awaiting the owner's signature.");
  if (i.scheduledStart && new Date(i.nowIso).getTime() > new Date(latestConsentAt(i.scheduledStart)).getTime()) b.push("Consent must be signed at least 24 hours before the installation starts – reschedule the installation.");
  if (isEscTemplateVersion(i.templateVersion)) b.push(...ownerDeclarationBlockers(i.input.declarations));
  else if (!i.input.accept) b.push("Please confirm you consent to the information sharing.");
  if (i.input.signatoryName.trim().length < 2) b.push("Signatory name is required.");
  if (i.input.signatureName.trim().length < 2) b.push("Type your full name to sign.");
  return b;
}

export function apConsentBlockers(i: { status: string | null; scheduledStart: string; nowIso: string; apRepName: string; purposeExplained: boolean; templateVersion?: string | null; apRep?: ApRep | null }): string[] {
  const b: string[] = [];
  if (i.status !== "awaiting_ap") b.push(i.status === "awaiting_owner" ? "The owner must sign first." : "This consent is not awaiting AP confirmation.");
  if (new Date(i.nowIso).getTime() > new Date(latestConsentAt(i.scheduledStart)).getTime()) b.push("Consent must be complete at least 24 hours before the installation starts.");
  if (!i.purposeExplained) b.push(isEscTemplateVersion(i.templateVersion) ? "Tick the Part B declaration: you have explained to the property owner the purpose for which this written consent is being obtained." : "Confirm the purpose of the information sharing was explained to the owner.");
  if (i.apRepName.trim().length < 2) b.push("AP representative name is required.");
  if (isEscTemplateVersion(i.templateVersion)) {
    if (!i.apRep || i.apRep.first_name.trim().length < 1) b.push("AP representative first name is required (Section 3 Part A).");
    if (!i.apRep || i.apRep.last_name.trim().length < 1) b.push("AP representative last name is required (Section 3 Part A).");
    if (!i.apRep || i.apRep.role.trim().length < 2) b.push("AP representative role is required (Section 3 Part A).");
  }
  return b;
}

// ---------- Rendering the consent form (pure) ----------
export type Section1 = { first_name: string; last_name: string; installation_address: string; phone: string; email: string };
/** Section 1 values prefilled from the owner + property on the consent snapshot (never typed again by the owner). */
export function section1FromFacts(f: Pick<ConsentFacts, "owner" | "premises_address">): Section1 {
  const n = splitFullName(f.owner.name);
  return { first_name: n.first, last_name: n.last, installation_address: f.premises_address, phone: f.owner.phone ?? "", email: f.owner.email ?? "" };
}
export const SECTION1_LABELS: [keyof Section1, string][] = [["first_name", "First Name"], ["last_name", "Last name"], ["installation_address", "Installation address"], ["phone", "Phone number"], ["email", "Email address"]];

export type ConsentRender = {
  version: string | null; body: string; facts: Pick<ConsentFacts, "owner" | "premises_address" | "installation_days">;
  owner?: { signatureName: string; signedAt: string; declarations: OwnerDeclarations | null } | null;
  ap?: { rep: ApRep; signedAt: string } | null;
};
const dash = (v: string | null | undefined) => (v ?? "").trim() || "—";
const line = (label: string, v: string | null | undefined) => `${label}: ${dash(v)}`;

/**
 * Fills the stored wording. ESC template versions: Section 1 values, the four Section 2 ticks, owner signature + date,
 * Part A details and the Part B declaration with the representative's name, AP signature + date. Older versions keep
 * the body as stored, with {dates} (the older wording's only placeholder) replaced by the installation day(s).
 */
export function renderConsentBody(r: ConsentRender): string {
  if (!isEscTemplateVersion(r.version)) return r.body.replace(/\{dates\}/g, r.facts.installation_days.join(", ") || "—");
  const s1 = section1FromFacts(r.facts);
  const tick = (k: OwnerDeclarationKey) => (r.owner?.declarations?.[k] === true ? "[x]" : "[ ]");
  const ownerDay = r.owner ? melbourneDay(r.owner.signedAt) : "";
  const apDay = r.ap ? melbourneDay(r.ap.signedAt) : "";
  const apName = r.ap ? apRepFullName(r.ap.rep) : "";
  return [
    "Section 1: Information to be shared", "Owner details",
    ...SECTION1_LABELS.map(([k, label]) => line(label, s1[k])),
    "Section 2: Declaration by owner", "I declare that:",
    ...OWNER_DECLARATIONS.map((d) => `${tick(d.key)} ${d.text}`),
    `Owner signature: ${dash(r.owner?.signatureName)}  Date: ${dash(ownerDay)}`,
    "Section 3 – Accredited person details and declaration", "Part A: Accredited person details", "Accredited person details",
    line("Accredited person name", ESC_AP_FULL_NAME),
    line("First name", r.ap?.rep.first_name), line("Last name", r.ap?.rep.last_name), line("Role", r.ap?.rep.role), line("Phone number", r.ap?.rep.phone), line("Email address", r.ap?.rep.email),
    "Part B: Declaration by accredited person",
    apDeclarationText(apName),
    `Accredited person signature: ${dash(apName)}  Date: ${dash(apDay)}`,
  ].join("\n");
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
