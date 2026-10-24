// ESC pre-install notification + READY TO INSTALL rules – PURE (no I/O).
// Fail closed: nothing is "sent" unless an actual submission (adapter or audited manual record) set it.
import { consentCompletedAt, consentValidityBlockers, type ConsentRecord } from "./consent.core";

export const HOUR = 3600_000;
export const LEAD_MS = 24 * HOUR;
/** Activity Guide window: notification no earlier than 5 days before work, no later than 24h before commencement. */
export const EARLIEST_MS = 5 * 24 * HOUR;

export const escDueBy = (startIso: string) => new Date(new Date(startIso).getTime() - LEAD_MS).toISOString();
export const escEarliest = (startIso: string) => new Date(new Date(startIso).getTime() - EARLIEST_MS).toISOString();

/** Timing of an (actual or proposed) ESC submission relative to the planned start. */
export function sendTimingBlocker(sentAtIso: string, startIso: string): string | null {
  const t = new Date(sentAtIso).getTime(), s = new Date(startIso).getTime();
  if (t < s - EARLIEST_MS) return `ESC notification is too early – it may be sent no earlier than 5 days before work (${new Date(escEarliest(startIso)).toLocaleString("en-AU", { timeZone: "Australia/Melbourne" })}).`;
  if (t > s - LEAD_MS) return "ESC notification was sent less than 24h before start – reschedule.";
  return null;
}

/** Bookings with less than 24h lead time are rejected outright. */
export function bookingLeadBlocker(startIso: string, nowIso: string): string | null {
  const lead = new Date(startIso).getTime() - new Date(nowIso).getTime();
  return lead < LEAD_MS ? "Installation must be booked at least 24 hours ahead (ESC notice, owner consent and PIESA delivery must all be in place 24h before start)." : null;
}

/** Condition under which a configured field is mandatory. Conditional fields are NEVER universally required. */
export type FieldWhen = "always" | "rectification" | "rec_required";
/** `optional`: shown on the copy block but a blank never stops the notice being prepared or recorded.
 *  `updatable`: the Registry lets this field change on the SAME notification ID (Activity Guide v1.2 Table 5 column 3).
 *  `source`: where the portal reads the value — shown with a missing value so the office knows what to fix. */
export type EscField = { key: string; label: string; when?: FieldWhen; optional?: boolean; updatable?: boolean; section?: string; source?: string };
export type EscConfig = { version: string; required_fields: EscField[]; approved: boolean; is_active: boolean } | null;

// ---- VEU Registry install notification (Jo 24 Oct 2026, decisions 118/121/195/197) ----
// Submitted in the VEU Registry ("Activities – Submit a new install notification"); there is no ESC API. The portal
// prepares the details, reminds the office inside the 5-day/24h window and records the notification ID afterwards.
// Decision 195: a robot will fill the Registry form later; until then (and as its backup) the office copies this block.
export const VEU_REGISTRY_URL = "https://veu.esc.vic.gov.au";
export const AP_ACCREDITATION_NUMBER = "A003654";
export const AP_TRADING_NAME = "Home Insulation Victoria (DC Construction Solutions Pty Ltd)";
/** Checklist B5 / decision 197: the field list is the Activity Guide v1.2 (1 Oct 2026) Appendix A Table 5. */
export const REGISTRY_FIELDS_VERSION = "registry-table5-guide-v1.2";
export const REGISTRY_FIELDS_SOURCE = "ESC Ceiling Insulation Activity Guide v1.2, Appendix A Table 5";

/** The four answers the Registry offers for "Has the pre-installation electrical safety assessment … been completed?" (verbatim). */
export const PIESA_REGISTRY_STATUS = {
  notCompleted: "Not completed",
  noIssues: "Completed: no electrical issues identified",
  allRectified: "Completed: electrical issues identified and all rectified",
  electricianAtInstall: "Completed: electrical issues identified, rectification not possible, electrician will be required at installation.",
} as const;
export type PiesaRegistryStatus = (typeof PIESA_REGISTRY_STATUS)[keyof typeof PIESA_REGISTRY_STATUS];

const S_INSTALL = "Installation details", S_OWNER = "Owner of premises", S_PARTICIPANT = "Scheme participant details", S_ADDITIONAL = "Additional information";
/** Default Registry field list = Activity Guide v1.2 Appendix A Table 5, in form order. Used whenever no admin-approved
 *  `esc_notification_config` exists (decision 121: preparing the notice needs no approval). */
export const DEFAULT_REGISTRY_FIELDS: EscField[] = [
  { key: "installation_start", label: "Installation start date and time", section: S_INSTALL, updatable: true, source: "Installation booking start (Melbourne time)" },
  { key: "installation_end", label: "Installation end date and time", section: S_INSTALL, updatable: true, source: "Installation booking end (Melbourne time) — add an end time to the booking" },
  { key: "premises_address", label: "Installation address", section: S_INSTALL, updatable: false, source: "Job property address" },
  { key: "owner_first_name", label: "Owner first name", section: S_OWNER, updatable: false, source: "Owner full name (all but the last word)" },
  { key: "owner_last_name", label: "Owner last name", section: S_OWNER, updatable: false, source: "Owner full name (last word) — record the owner's full name" },
  { key: "owner_phone", label: "Owner phone number", section: S_OWNER, updatable: false, source: "Owner phone" },
  { key: "owner_email", label: "Owner email", section: S_OWNER, updatable: false, source: "Owner email" },
  { key: "owner_entity_name", label: "Entity name", section: S_OWNER, optional: true, updatable: false, source: "Not held by the portal — enter in the Registry only if the owner is an entity" },
  { key: "lead_installer", label: "Scheme participant (lead installer)", section: S_PARTICIPANT, updatable: true, source: "Assigned installer's staff record (legal name); must be a VEU-verified scheme participant" },
  { key: "lead_installer_phone", label: "Lead installer phone number", section: S_PARTICIPANT, updatable: true, source: "Lead installer's mobile on My business" },
  { key: "lead_installer_cii_number", label: "EEC Certification number", section: S_PARTICIPANT, updatable: true, source: "Office-verified CII/EEC certificate number (Staff approvals)" },
  { key: "installer_company", label: "Installer company name", section: S_PARTICIPANT, optional: true, updatable: true, source: "Installer business legal name" },
  { key: "installer_abn_acn", label: "ABN/ACN", section: S_PARTICIPANT, updatable: true, source: "Installer business ABN (else ACN)" },
  { key: "piesa_status", label: "Pre-installation electrical safety assessment completed?", section: S_ADDITIONAL, updatable: false, source: "Signed PIESA B1 answer + PIESA outcome + CoES" },
  { key: "coes_number", label: "Certificate of Electrical Safety Number", section: S_ADDITIONAL, when: "rectification", updatable: false, source: "Signed PIESA Part C CoES number (or entered on Refresh details)" },
  { key: "rec_number", label: "REC Registration Number", section: S_ADDITIONAL, when: "rec_required", updatable: false, source: "Signed PIESA Part C REC registration no. (or entered on Refresh details)" },
  { key: "owner_consent_to_share", label: "Written owner consent to provide information to the ESC and share it with other regulators?", section: S_ADDITIONAL, updatable: false, source: "Signed ESC owner's consent (owner + AP), valid for this booking" },
];

/** Facts the portal fills automatically when the field list names the key. */
export const STANDARD_FACTS = [
  "installation_start", "installation_end", "premises_address", "owner_first_name", "owner_last_name", "owner_phone", "owner_email", "owner_entity_name",
  "lead_installer", "lead_installer_phone", "lead_installer_cii_number", "installer_company", "installer_abn_acn",
  "piesa_status", "coes_number", "rec_number", "owner_consent_to_share", "owner_consent_reference", "piesa_outcome",
] as const;
export type EscFacts = Partial<Record<(typeof STANDARD_FACTS)[number], string | null>>;

const melb = (iso: string, o: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleString("en-AU", { timeZone: "Australia/Melbourne", ...o });
export const melbDate = (iso: string) => melb(iso, { weekday: "short", day: "numeric", month: "short", year: "numeric" }).replace(/,/g, "");
export const melbTime = (iso: string) => melb(iso, { hour: "numeric", minute: "2-digit" });
export const melbDateTime = (iso: string) => `${melbDate(iso)} ${melbTime(iso)}`;

/** Owner full name → Registry first/last name. The last word is the last name; a one-word name leaves the last name blank (never guessed). */
export function splitOwnerName(full: string | null | undefined): { first: string | null; last: string | null } {
  const parts = String(full ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first: null, last: null };
  if (parts.length === 1) return { first: parts[0]!, last: null };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1]! };
}

/** Signed PIESA B1 answer as a code: not_required / required / not_possible (official B1 options 1–3). */
export type PiesaB1Code = "not_required" | "required" | "not_possible";
/** The Registry's four PIESA answers from the signed PIESA. Unsigned/missing PIESA = "Not completed"; rectification required
 *  counts as "all rectified" only once the PIESA passed AND a CoES number is on file; a pass without a readable B1 answer is
 *  null (the office must check the signed form — never guessed). */
export function piesaRegistryStatus(i: { signed: boolean; b1: PiesaB1Code | null; outcome: string | null; coesNumber: string | null }): PiesaRegistryStatus | null {
  if (!i.signed && i.outcome !== "pass") return PIESA_REGISTRY_STATUS.notCompleted;
  if (i.b1 === "not_required") return PIESA_REGISTRY_STATUS.noIssues;
  if (i.b1 === "not_possible") return PIESA_REGISTRY_STATUS.electricianAtInstall;
  if (i.b1 === "required") return i.outcome === "pass" && !!i.coesNumber?.trim() ? PIESA_REGISTRY_STATUS.allRectified : PIESA_REGISTRY_STATUS.notCompleted;
  return i.outcome === "pass" ? null : PIESA_REGISTRY_STATUS.notCompleted;
}

export type RegistryFactsInput = {
  premisesAddress: string; ownerName: string | null; ownerPhone: string | null; ownerEmail: string | null;
  scheduledStart: string; scheduledEnd: string | null;
  leadInstaller: string | null; leadInstallerPhone: string | null; leadInstallerCii: string | null; installerCompany: string | null; installerAbnAcn: string | null;
  piesa: { signed: boolean; b1: PiesaB1Code | null; outcome: string | null }; coesNumber: string | null; recNumber: string | null;
  /** True only for a VALID separate owner ESC consent for this booking. */
  consentValid: boolean;
};
const blank = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);

/** Table 5 facts from job records. Blanks stay blank (never guessed); CoES/REC only when the PIESA answer needs them. */
export function registryFacts(i: RegistryFactsInput): EscFacts {
  const name = splitOwnerName(i.ownerName);
  const coes = blank(i.coesNumber);
  const piesa = piesaRegistryStatus({ ...i.piesa, coesNumber: coes });
  const rect = piesa === PIESA_REGISTRY_STATUS.allRectified;
  return {
    installation_start: melbDateTime(i.scheduledStart),
    installation_end: i.scheduledEnd ? melbDateTime(i.scheduledEnd) : null,
    premises_address: blank(i.premisesAddress), owner_first_name: name.first, owner_last_name: name.last,
    owner_phone: blank(i.ownerPhone), owner_email: blank(i.ownerEmail), owner_entity_name: null,
    lead_installer: blank(i.leadInstaller), lead_installer_phone: blank(i.leadInstallerPhone), lead_installer_cii_number: blank(i.leadInstallerCii),
    installer_company: blank(i.installerCompany), installer_abn_acn: blank(i.installerAbnAcn),
    piesa_status: piesa, coes_number: rect ? coes : null, rec_number: rect ? blank(i.recNumber) : null,
    owner_consent_to_share: i.consentValid ? "Yes" : null,
  };
}

/** Field conditions from the facts: CoES needed for "all rectified"; REC needed whenever a CoES is given (Table 5). */
export function registryConditions(f: EscFacts): { rectification: boolean; recRequired: boolean } {
  const rectification = f.piesa_status === PIESA_REGISTRY_STATUS.allRectified;
  return { rectification, recRequired: rectification || !!f.coes_number };
}

export type RegistryRow = { key: string; label: string; value: string | null; optional: boolean; section: string | null; updatable: boolean; source: string | null };
/** Copy-ready block for the Registry form, from a prepared payload. Conditional fields appear only when they apply.
 *  Missing values are listed with where to fix them, never invented. */
export function registryBlock(payload: Record<string, unknown>, fields: EscField[] = DEFAULT_REGISTRY_FIELDS): { rows: RegistryRow[]; text: string; missing: string[]; missingFacts: { label: string; source: string | null }[] } {
  const additional = (payload["additional"] ?? {}) as Record<string, unknown>;
  const cond = (payload["conditions"] ?? { rectification: false, recRequired: false }) as { rectification: boolean; recRequired: boolean };
  const rows: RegistryRow[] = fields.filter((f) => fieldApplies(f, cond) || additional[f.key] != null).map((f) => {
    const raw = additional[f.key] ?? payload[f.key];
    const value = raw == null || raw === "" ? null : String(raw);
    return { key: f.key, label: f.label, value, optional: !!f.optional, section: f.section ?? null, updatable: !!f.updatable, source: f.source ?? null };
  });
  const text = ["VEU Registry – Activities – Submit a new install notification (Activity 48: ceiling insulation)", ...rows.map((r) => `${r.label}: ${r.value ?? "—"}`)].join("\n");
  const gaps = rows.filter((r) => !r.value && !r.optional);
  return { rows, text, missing: gaps.map((r) => r.label), missingFacts: gaps.map((r) => ({ label: r.label, source: r.source })) };
}

// ---- Update on the SAME notification ID vs withdraw + resubmit (Activity Guide v1.2 §3.3.3 + Table 5) ----
/** Keys the Registry lets change on the same notification ID. */
export const REGISTRY_UPDATABLE_KEYS = DEFAULT_REGISTRY_FIELDS.filter((f) => f.updatable).map((f) => f.key);
export type RegistryChange = { action: "none" | "update_same_id" | "withdraw_and_resubmit"; changed: string[]; reasons: string[] };
type SentNotice = { scheduled_start: string; sent_at: string | null; submission_reference: string | null; payload_json: unknown };

/** Timing for an update on the same notification ID: the original start must not have passed, and the new start must be
 *  within the next 5 days and at least 24h away (Activity Guide v1.2 §3.3.3 + Table 5). Empty = update allowed. */
export function registryUpdateTimingReasons(prevStartIso: string, newStartIso: string, nowIso: string): string[] {
  const now = Date.parse(nowIso), oldStart = Date.parse(prevStartIso), newStart = Date.parse(newStartIso);
  const r: string[] = [];
  if (now >= oldStart) r.push("The original installation date and time has passed.");
  if (newStart > now + EARLIEST_MS) r.push("The new start is more than 5 days away.");
  if (newStart < now + LEAD_MS) r.push("The new start is less than 24 hours away.");
  return r;
}

/** What the office must do in the Registry when a SENT notice no longer matches the current one. Update (same ID) only when
 *  every changed field is updatable, the original start has not passed, and the new start is within the next 5 days and
 *  at least 24h away; anything else = withdraw and resubmit (new ID). A notice prepared under an older field list can't be
 *  compared field by field, so it is always withdraw + resubmit. */
export function registryChange(prev: SentNotice, next: { scheduled_start: string; payload_json: unknown }, nowIso: string): RegistryChange {
  const pp = (prev.payload_json ?? {}) as Record<string, unknown>, np = (next.payload_json ?? {}) as Record<string, unknown>;
  if (!prev.sent_at || !prev.submission_reference) return { action: "none", changed: [], reasons: ["The earlier notification was never recorded as sent."] };
  if (pp["fields_version"] !== REGISTRY_FIELDS_VERSION || np["fields_version"] !== REGISTRY_FIELDS_VERSION)
    return { action: "withdraw_and_resubmit", changed: [], reasons: ["The earlier notification was prepared with an older field list, so it cannot be checked field by field."] };
  const pa = (pp["additional"] ?? {}) as Record<string, unknown>, na = (np["additional"] ?? {}) as Record<string, unknown>;
  const keys = DEFAULT_REGISTRY_FIELDS.map((f) => f.key);
  const changed = keys.filter((k) => String(pa[k] ?? "") !== String(na[k] ?? ""));
  if (!changed.length) return { action: "none", changed, reasons: [] };
  const label = (k: string) => DEFAULT_REGISTRY_FIELDS.find((f) => f.key === k)?.label ?? k;
  const reasons: string[] = [];
  const fixed = changed.filter((k) => !REGISTRY_UPDATABLE_KEYS.includes(k));
  if (fixed.length) reasons.push(`These can't be updated in the Registry: ${fixed.map(label).join(", ")}.`);
  reasons.push(...registryUpdateTimingReasons(prev.scheduled_start, next.scheduled_start, nowIso));
  return { action: reasons.length ? "withdraw_and_resubmit" : "update_same_id", changed, reasons };
}

/** Office records that it UPDATED the earlier notification in the Registry (same notification ID). The current notice is
 *  then recorded as sent under the SAME reference, with the update kept on the row. */
export function registryUpdatePatch(p: { prev: SentNotice; change: RegistryChange; reference: string; updatedAt: string; confirmed: boolean; actorId: string }, nowIso: string) {
  if (p.change.action !== "update_same_id") throw new Error(p.change.reasons.join(" ") || "Nothing changed that needs a Registry update.");
  if (p.reference.trim() !== String(p.prev.submission_reference ?? "").trim()) throw new Error(`An update keeps the same notification ID (${p.prev.submission_reference}). A different ID means a new notification — record it as a new submission after withdrawing the old one.`);
  const base = submissionPatch({ reference: p.reference, sentAt: p.updatedAt, method: "manual_portal", confirmed: p.confirmed, actorId: p.actorId }, nowIso);
  return { ...base, response: { registry_update: { same_id: base.submission_reference, updated_at: p.updatedAt, changed: p.change.changed, updated_by: p.actorId } } };
}

/** "Sent to ESC on … ref …" — the one line every screen uses for a recorded submission. */
export function escSentLine(n: { status: string; sent_at: string | null; submission_reference: string | null } | null): string | null {
  if (!n || !(n.status === "sent" || n.status === "accepted") || !n.sent_at || !n.submission_reference) return null;
  return `Sent to ESC on ${melbDateTime(n.sent_at)} · ref ${n.submission_reference}`;
}

export type Withdrawal = { withdrawn_at: string; reason: string; withdrawn_by: string; registry_reference: string | null };
/** A notice the office withdrew in the Registry; it stays as history and never counts as a sent notification. */
export function isWithdrawn(n: { response?: unknown } | null | undefined): boolean {
  const r = n?.response as { withdrawal?: unknown } | null | undefined;
  return !!r && typeof r === "object" && !!r.withdrawal;
}

/** Office records that a submitted notification was withdrawn in the Registry (install slipped outside its window or
 *  key details changed). Only a notice that was actually sent can be withdrawn; the row is kept, never deleted. */
export function withdrawalPatch(p: { notice: { status: string; sent_at: string | null; submission_reference: string | null; response: unknown }; reason: string; withdrawnAt: string; actorId: string }, nowIso: string): { response: { withdrawal: Withdrawal }; status: "stale" } {
  if (!p.notice.sent_at || !p.notice.submission_reference) throw new Error("Only a notification that was recorded as sent can be withdrawn.");
  if (isWithdrawn(p.notice)) throw new Error("This notification was already withdrawn.");
  if (p.reason.trim().length < 3) throw new Error("Say why the notification was withdrawn (e.g. install moved outside the 5-day window).");
  if (new Date(p.withdrawnAt).getTime() > new Date(nowIso).getTime() + 60_000) throw new Error("Withdrawal time cannot be in the future.");
  const prev = (p.notice.response && typeof p.notice.response === "object" ? p.notice.response : {}) as Record<string, unknown>;
  return { response: { ...prev, withdrawal: { withdrawn_at: p.withdrawnAt, reason: p.reason.trim(), withdrawn_by: p.actorId, registry_reference: p.notice.submission_reference } }, status: "stale" };
}

export type PayloadInput = {
  jobNumber: string; installationDays: string[]; scheduledStart: string; scheduledEnd: string | null; premisesAddress: string;
  owner: { name: string | null; email: string | null; phone: string | null }; extra: Record<string, unknown>;
  facts?: EscFacts; conditions?: { rectification: boolean; recRequired: boolean };
  /** Reference of a VALID separate owner consent; null => not ready. Omitted only by legacy callers/tests. */
  consentReference?: string | null;
};
export const PAYLOAD_VERSION = "esc-a48-v2";

export function fieldApplies(f: EscField, c: { rectification: boolean; recRequired: boolean }) {
  return !f.when || f.when === "always" || (f.when === "rectification" && c.rectification) || (f.when === "rec_required" && c.recRequired);
}

/** Builds the notification payload. Consent or applicable required values missing => not ready. With no approved config
 *  the DEFAULT_REGISTRY_FIELDS list applies (decision 121: no admin approval is needed to PREPARE the notice); a config
 *  row that exists but is unapproved/inactive still reports configuration_required. */
export function buildEscPayload(cfg: EscConfig, i: PayloadInput): { status: "ready" | "configuration_required" | "not_ready"; payload: Record<string, unknown>; missing: string[] } {
  const facts = i.facts ?? {};
  const cond = i.conditions ?? registryConditions(facts);
  const base = { payload_version: PAYLOAD_VERSION, job_reference: i.jobNumber, installation_days: i.installationDays, scheduled_start: i.scheduledStart, scheduled_end: i.scheduledEnd, premises_address: i.premisesAddress, owner_contact: i.owner, owner_consent_reference: i.consentReference ?? null, ...facts };
  const missing: string[] = [];
  if (cfg && (!cfg.approved || !cfg.is_active)) missing.push("Admin-approved ESC notification field configuration (current Ceiling Insulation Activity Guide)");
  // An approved custom list may not name the owner fields; the Table 5 default list carries them field by field.
  if (cfg && !i.owner.name) missing.push("Owner name");
  if (cfg && !i.owner.email && !i.owner.phone) missing.push("Owner contact (email or phone)");
  const fields = cfg ? cfg.required_fields : DEFAULT_REGISTRY_FIELDS;
  const extra: Record<string, unknown> = {};
  for (const f of fields) {
    const val = i.extra[f.key] ?? (facts as Record<string, unknown>)[f.key] ?? (f.key === "owner_consent_reference" ? i.consentReference : undefined);
    if (val == null || val === "") { if (fieldApplies(f, cond) && !f.optional && !missing.includes(f.label)) missing.push(f.label); }
    else extra[f.key] = val;
  }
  const consentMissing = i.consentReference === null;
  const status = missing.length ? "configuration_required" : consentMissing ? "not_ready" : "ready";
  if (consentMissing) missing.push("Valid separate owner ESC consent (owner + AP representative, ≥24h before start)");
  return { status, payload: { ...base, config_version: cfg?.version ?? REGISTRY_FIELDS_VERSION, fields_version: cfg ? cfg.version : REGISTRY_FIELDS_VERSION, conditions: cond, additional: extra }, missing };
}

/** Fields whose change makes a previous notice stale and requires re-notification. */
export function staleReasons(prev: { scheduled_start: string; scheduled_end: string | null; premises_address: string; owner_contact: unknown }, next: { scheduled_start: string; scheduled_end: string | null; premises_address: string; owner_contact: unknown }): string[] {
  const r: string[] = [];
  if (new Date(prev.scheduled_start).getTime() !== new Date(next.scheduled_start).getTime()) r.push("installation date/time changed");
  if ((prev.scheduled_end ?? null) !== (next.scheduled_end ?? null)) r.push("installation end changed");
  if (prev.premises_address !== next.premises_address) r.push("premises address changed");
  if (JSON.stringify(prev.owner_contact) !== JSON.stringify(next.owner_contact)) r.push("owner contact details changed");
  return r;
}

export type ReadinessInput = {
  scheduledStart: string | null;
  consent: ConsentRecord;
  notification: { status: string; sent_at: string | null; submission_reference: string | null; scheduled_start: string } | null;
  deliveries: { owner: string | null; installer: string | null };
  piesa: { date: string | null; deadline: string | null; outcome: string | null } | null;
};
export type Readiness = { ready: boolean; blockers: string[]; dueBy: string | null };

/** READY TO INSTALL: every 24h pre-condition met relative to the planned start, and PIESA still in its 30-day window. */
export function readyToInstall(i: ReadinessInput): Readiness {
  const b: string[] = [];
  if (!i.scheduledStart) return { ready: false, blockers: ["No installation booked"], dueBy: null };
  const due = escDueBy(i.scheduledStart); const dueT = new Date(due).getTime();
  const at = (s: string | null) => (s ? new Date(s).getTime() : Infinity);
  const fmt = new Date(due).toLocaleString("en-AU", { timeZone: "Australia/Melbourne" });
  b.push(...consentValidityBlockers(i.consent, i.scheduledStart));
  const n = i.notification;
  if (!n) b.push(`ESC notification not prepared – must be sent by ${fmt}`);
  else if (new Date(n.scheduled_start).getTime() !== new Date(i.scheduledStart).getTime() || n.status === "stale") b.push("ESC notification is stale for the current booking – re-notify");
  else if (!(n.status === "sent" || n.status === "accepted") || !n.sent_at || !n.submission_reference) b.push(`ESC notification not sent – must be sent by ${fmt}${n.status === "configuration_required" ? " (configuration required)" : ""}`);
  else {
    const t = sendTimingBlocker(n.sent_at, i.scheduledStart);
    if (t) b.push(t);
    const done = i.consent ? consentCompletedAt(i.consent) : null;
    if (!done || at(n.sent_at) < at(done)) b.push("ESC notification was sent before valid owner consent was obtained – re-notify");
  }
  if (at(i.deliveries.owner) > dueT) b.push(`Signed PIESA copy delivery to owner must be recorded by ${fmt}`);
  if (at(i.deliveries.installer) > dueT) b.push(`Signed PIESA copy delivery to installer must be recorded by ${fmt}`);
  if (!i.piesa?.date || i.piesa.outcome !== "pass") b.push("A current passing PIESA is required");
  else if (i.piesa.deadline && i.scheduledStart.slice(0, 10) > i.piesa.deadline) b.push(`Installation start is after the PIESA 30-day deadline (${i.piesa.deadline})`);
  return { ready: b.length === 0, blockers: b, dueBy: due };
}

/** Pre-conditions for recording/sending a submission: valid consent first, and inside the 5-day/24h window. */
export function submissionBlockers(p: { consent: ConsentRecord; scheduledStart: string; sentAt: string }): string[] {
  const b = consentValidityBlockers(p.consent, p.scheduledStart).map((x) => `Cannot notify ESC: ${x}`);
  const done = p.consent ? consentCompletedAt(p.consent) : null;
  if (done && new Date(p.sentAt).getTime() < new Date(done).getTime()) b.push("Cannot notify ESC before the owner consent was completed.");
  const t = sendTimingBlocker(p.sentAt, p.scheduledStart);
  if (t) b.push(t);
  return b;
}

/** Manual/adapter submission must carry a reference and explicit confirmation – otherwise never "sent". */
export function submissionPatch(p: { reference: string; sentAt: string; method: "adapter" | "manual_portal" | "manual_email"; confirmed: boolean; actorId: string }, nowIso: string) {
  if (!p.confirmed) throw new Error("Confirm the notification was actually submitted to ESC.");
  if (p.reference.trim().length < 3) throw new Error("An ESC submission reference is required.");
  if (new Date(p.sentAt).getTime() > new Date(nowIso).getTime() + 60_000) throw new Error("Submission time cannot be in the future.");
  return { status: "sent" as const, sent_at: p.sentAt, submission_reference: p.reference.trim(), submission_method: p.method, submitted_by: p.actorId };
}
