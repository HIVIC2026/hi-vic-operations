// ESC pre-install notification + READY TO INSTALL rules – PURE (no I/O).
// Fail closed: nothing is "sent" unless an actual submission (adapter or audited manual record) set it.
export const HOUR = 3600_000;
export const LEAD_MS = 24 * HOUR;

export const escDueBy = (startIso: string) => new Date(new Date(startIso).getTime() - LEAD_MS).toISOString();

/** Bookings with less than 24h lead time are rejected outright. */
export function bookingLeadBlocker(startIso: string, nowIso: string): string | null {
  const lead = new Date(startIso).getTime() - new Date(nowIso).getTime();
  return lead < LEAD_MS ? "Installation must be booked at least 24 hours ahead (ESC notice, owner consent and PIESA delivery must all be in place 24h before start)." : null;
}

export type EscConfig = { version: string; required_fields: { key: string; label: string }[]; approved: boolean; is_active: boolean } | null;
export type PayloadInput = {
  jobNumber: string; installationDays: string[]; scheduledStart: string; scheduledEnd: string | null; premisesAddress: string;
  owner: { name: string | null; email: string | null; phone: string | null }; extra: Record<string, unknown>;
};
export const PAYLOAD_VERSION = "esc-a48-v1";

/** Builds the notification payload. Missing/unapproved config or missing required values => configuration_required. */
export function buildEscPayload(cfg: EscConfig, i: PayloadInput): { status: "ready" | "configuration_required"; payload: Record<string, unknown>; missing: string[] } {
  const base = { payload_version: PAYLOAD_VERSION, job_reference: i.jobNumber, installation_days: i.installationDays, scheduled_start: i.scheduledStart, scheduled_end: i.scheduledEnd, premises_address: i.premisesAddress, owner_contact: i.owner };
  const missing: string[] = [];
  if (!cfg || !cfg.approved || !cfg.is_active) missing.push("Admin-approved ESC notification field configuration (current Ceiling Insulation Activity Guide)");
  if (!i.owner.name) missing.push("Owner name");
  if (!i.owner.email && !i.owner.phone) missing.push("Owner contact (email or phone)");
  const extra: Record<string, unknown> = {};
  for (const f of cfg?.required_fields ?? []) {
    const val = i.extra[f.key];
    if (val == null || val === "") missing.push(f.label); else extra[f.key] = val;
  }
  return { status: missing.length ? "configuration_required" : "ready", payload: { ...base, config_version: cfg?.version ?? null, additional: extra }, missing };
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
  consentSignedAt: string | null;
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
  if (at(i.consentSignedAt) > dueT) b.push(`Owner ESC information-sharing consent must be signed by ${fmt} (24h before start)`);
  const n = i.notification;
  if (!n) b.push(`ESC notification not prepared – must be sent by ${fmt}`);
  else if (new Date(n.scheduled_start).getTime() !== new Date(i.scheduledStart).getTime() || n.status === "stale") b.push("ESC notification is stale for the current booking – re-notify");
  else if (!(n.status === "sent" || n.status === "accepted") || !n.sent_at || !n.submission_reference) b.push(`ESC notification not sent – must be sent by ${fmt}${n.status === "configuration_required" ? " (configuration required)" : ""}`);
  else if (at(n.sent_at) > dueT) b.push("ESC notification was sent less than 24h before start – reschedule");
  if (at(i.deliveries.owner) > dueT) b.push(`Signed PIESA copy delivery to owner must be recorded by ${fmt}`);
  if (at(i.deliveries.installer) > dueT) b.push(`Signed PIESA copy delivery to installer must be recorded by ${fmt}`);
  if (!i.piesa?.date || i.piesa.outcome !== "pass") b.push("A current passing PIESA is required");
  else if (i.piesa.deadline && i.scheduledStart.slice(0, 10) > i.piesa.deadline) b.push(`Installation start is after the PIESA 30-day deadline (${i.piesa.deadline})`);
  return { ready: b.length === 0, blockers: b, dueBy: due };
}

/** Manual/adapter submission must carry a reference and explicit confirmation – otherwise never "sent". */
export function submissionPatch(p: { reference: string; sentAt: string; method: "adapter" | "manual_portal" | "manual_email"; confirmed: boolean; actorId: string }, nowIso: string) {
  if (!p.confirmed) throw new Error("Confirm the notification was actually submitted to ESC.");
  if (p.reference.trim().length < 3) throw new Error("An ESC submission reference is required.");
  if (new Date(p.sentAt).getTime() > new Date(nowIso).getTime() + 60_000) throw new Error("Submission time cannot be in the future.");
  return { status: "sent" as const, sent_at: p.sentAt, submission_reference: p.reference.trim(), submission_method: p.method, submitted_by: p.actorId };
}
