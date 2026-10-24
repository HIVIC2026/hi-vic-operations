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
/** `optional`: shown on the copy block but a blank never stops the notice being prepared or recorded. */
export type EscField = { key: string; label: string; when?: FieldWhen; optional?: boolean };
export type EscConfig = { version: string; required_fields: EscField[]; approved: boolean; is_active: boolean } | null;

// ---- VEU Registry install notification (Jo 24 Oct 2026, decisions 118/121) ----
// Submitted BY HAND in the VEU Registry (Activities → Install notification form); there is no API. The portal prepares
// the details, reminds the office inside the 5-day/24h window and records the Registry reference afterwards.
export const VEU_REGISTRY_URL = "https://veu.esc.vic.gov.au";
export const AP_ACCREDITATION_NUMBER = "A003654";
export const AP_TRADING_NAME = "Home Insulation Victoria (DC Construction Solutions Pty Ltd)";
export const REGISTRY_FIELDS_VERSION = "registry-default-v1";

/** Default Registry field list, used whenever no admin-approved `esc_notification_config` exists. Jo confirms the real
 *  Registry fields on first use (decision 121); an approved config then replaces this list without a code change. */
export const DEFAULT_REGISTRY_FIELDS: EscField[] = [
  { key: "ap_name", label: "Accredited Person" },
  { key: "ap_accreditation_number", label: "AP accreditation number" },
  { key: "premises_address", label: "Premises address (incl. postcode)" },
  { key: "owner_name", label: "Owner name" },
  { key: "installation_date", label: "Installation date" },
  { key: "installation_start_time", label: "Start time (Melbourne)" },
  { key: "expected_completion_date", label: "Expected completion date" },
  { key: "installer_business", label: "Installer business" },
  { key: "lead_installer", label: "Lead installer" },
  { key: "lead_installer_cii_number", label: "Lead installer EEC CII number", optional: true },
  { key: "electrician_name", label: "Electrician", optional: true },
  { key: "electrician_licence", label: "Electrician licence", optional: true },
  { key: "piesa_completed_on", label: "PIESA completion date" },
  { key: "piisa_completed", label: "PIISA completed" },
  { key: "owner_consent_obtained_on", label: "Owner consent obtained" },
  { key: "job_number", label: "Job number" },
];

/** Facts the portal already holds and fills automatically when the field list names the key. */
export const STANDARD_FACTS = [
  "lead_installer", "installer_business", "installer_abn_acn", "piesa_outcome", "coes_number", "rec_number", "owner_consent_reference",
  "ap_name", "ap_accreditation_number", "premises_address", "owner_name", "installation_date", "installation_start_time", "expected_completion_date",
  "lead_installer_cii_number", "electrician_name", "electrician_licence", "piesa_completed_on", "piisa_completed", "owner_consent_obtained_on", "job_number",
] as const;
export type EscFacts = Partial<Record<(typeof STANDARD_FACTS)[number], string | null>>;

const melb = (iso: string, o: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleString("en-AU", { timeZone: "Australia/Melbourne", ...o });
export const melbDate = (iso: string) => melb(iso, { weekday: "short", day: "numeric", month: "short", year: "numeric" }).replace(/,/g, "");
export const melbTime = (iso: string) => melb(iso, { hour: "numeric", minute: "2-digit" });
export const melbDateTime = (iso: string) => `${melbDate(iso)} ${melbTime(iso)}`;

/** Derives the Registry facts from job records. Blanks stay blank (never guessed); the completion date defaults to the start day. */
export function registryFacts(i: {
  jobNumber: string; premisesAddress: string; ownerName: string | null; scheduledStart: string; scheduledEnd: string | null;
  installerBusiness: string | null; leadInstaller: string | null; leadInstallerCii: string | null;
  electricianName: string | null; electricianLicence: string | null; piesaCompletedOn: string | null;
  piisaSignedOn: string | null; consentCompletedAt: string | null;
}): EscFacts {
  const sameDay = i.scheduledEnd && melbDate(i.scheduledEnd) === melbDate(i.scheduledStart);
  return {
    ap_name: AP_TRADING_NAME, ap_accreditation_number: AP_ACCREDITATION_NUMBER,
    premises_address: i.premisesAddress || null, owner_name: i.ownerName || null,
    installation_date: melbDate(i.scheduledStart), installation_start_time: melbTime(i.scheduledStart),
    expected_completion_date: i.scheduledEnd && !sameDay ? melbDate(i.scheduledEnd) : `${melbDate(i.scheduledStart)} (same day)`,
    installer_business: i.installerBusiness || null, lead_installer: i.leadInstaller || null, lead_installer_cii_number: i.leadInstallerCii || null,
    electrician_name: i.electricianName || null, electrician_licence: i.electricianLicence || null,
    piesa_completed_on: i.piesaCompletedOn ? melbDate(i.piesaCompletedOn.length === 10 ? `${i.piesaCompletedOn}T12:00:00+10:00` : i.piesaCompletedOn) : null,
    piisa_completed: i.piisaSignedOn ? `Yes (${melbDate(i.piisaSignedOn.length === 10 ? `${i.piisaSignedOn}T12:00:00+10:00` : i.piisaSignedOn)})` : "Not yet",
    owner_consent_obtained_on: i.consentCompletedAt ? melbDateTime(i.consentCompletedAt) : null,
    job_number: i.jobNumber || null,
  };
}

export type RegistryRow = { key: string; label: string; value: string | null; optional: boolean };
/** Copy-ready block for the Registry form, from a prepared payload. Missing values are listed, never invented. */
export function registryBlock(payload: Record<string, unknown>, fields: EscField[] = DEFAULT_REGISTRY_FIELDS): { rows: RegistryRow[]; text: string; missing: string[] } {
  const additional = (payload["additional"] ?? {}) as Record<string, unknown>;
  const rows: RegistryRow[] = fields.map((f) => {
    const raw = additional[f.key] ?? payload[f.key];
    const value = raw == null || raw === "" ? null : String(raw);
    return { key: f.key, label: f.label, value, optional: !!f.optional };
  });
  const text = ["VEU Registry – Install notification (Activity 48: ceiling insulation)", ...rows.map((r) => `${r.label}: ${r.value ?? "—"}`)].join("\n");
  return { rows, text, missing: rows.filter((r) => !r.value && !r.optional).map((r) => r.label) };
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
  const cond = i.conditions ?? { rectification: false, recRequired: false };
  const facts = i.facts ?? {};
  const base = { payload_version: PAYLOAD_VERSION, job_reference: i.jobNumber, installation_days: i.installationDays, scheduled_start: i.scheduledStart, scheduled_end: i.scheduledEnd, premises_address: i.premisesAddress, owner_contact: i.owner, owner_consent_reference: i.consentReference ?? null, ...facts };
  const missing: string[] = [];
  if (cfg && (!cfg.approved || !cfg.is_active)) missing.push("Admin-approved ESC notification field configuration (current Ceiling Insulation Activity Guide)");
  if (!i.owner.name) missing.push("Owner name");
  if (!i.owner.email && !i.owner.phone) missing.push("Owner contact (email or phone)");
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
