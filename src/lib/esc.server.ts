// ESC pre-install notification persistence + READY TO INSTALL evaluation. Fails closed.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { logEvent, piesaStatus, WorkflowError } from "./workflow.server";
import { buildEscPayload, escDueBy, readyToInstall, staleReasons, submissionPatch, type EscConfig } from "./esc.core";

/** Submission adapter slot. No ESC endpoint is configured – adapter always reports not configured. */
export interface EscAdapter { submit(payload: Record<string, unknown>): Promise<{ reference: string; response: unknown }> }
export function configuredEscAdapter(): EscAdapter | null { return null; }

export async function activeEscConfig(): Promise<EscConfig> {
  const { data } = await admin.from("esc_notification_config").select("version, required_fields, approved, is_active").eq("is_active", true).eq("approved", true).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data ? { version: data.version, required_fields: (data.required_fields as { key: string; label: string }[]) ?? [], approved: data.approved, is_active: data.is_active } : null;
}

async function snapshot(jobId: string) {
  const { data: j } = await admin.from("jobs").select("job_number, owners(full_name, email, phone), properties(address_line, suburb, state, postcode)").eq("id", jobId).single();
  const o = j?.owners as { full_name: string | null; email: string | null; phone: string | null } | null;
  const p = j?.properties as { address_line: string; suburb: string | null; state: string; postcode: string | null } | null;
  const { data: a } = await admin.from("customer_assignments").select("id, esc_consent_version, esc_consent_signed_at").eq("job_id", jobId).neq("status", "cancelled").maybeSingle();
  return {
    jobNumber: j?.job_number ?? "", address: [p?.address_line, p?.suburb, p?.state, p?.postcode].filter(Boolean).join(" "),
    owner: { name: o?.full_name ?? null, email: o?.email ?? null, phone: o?.phone ?? null }, consent: a,
  };
}

/** Create/regenerate the notification for the current installation booking. A changed booking stales the old notice. */
export async function regenerateEscNotification(jobId: string, actorId: string | null) {
  const { data: b } = await admin.from("bookings").select("id, scheduled_start, scheduled_end").eq("job_id", jobId).eq("kind", "installation").eq("status", "confirmed").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const { data: prev } = await admin.from("esc_notifications").select("*").eq("job_id", jobId).not("status", "in", "(stale,cancelled)").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!b) {
    if (prev) { await admin.from("esc_notifications").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", prev.id); await logEvent(jobId, actorId, "esc_notification_cancelled", "ESC notification cancelled – installation booking removed", { notification_id: prev.id }, { internal: true }); }
    return null;
  }
  const s = await snapshot(jobId);
  const next = { scheduled_start: b.scheduled_start, scheduled_end: b.scheduled_end, premises_address: s.address, owner_contact: s.owner };
  if (prev) {
    const why = staleReasons(prev as never, next);
    if (!why.length && prev.booking_id === b.id) return prev.id;
    await admin.from("esc_notifications").update({ status: "stale", last_error: `Stale: ${why.join(", ") || "booking replaced"}`, updated_at: new Date().toISOString() }).eq("id", prev.id);
    await logEvent(jobId, actorId, "esc_notification_stale", `Previous ESC notification is STALE (${why.join(", ") || "booking replaced"}) – re-notification required${prev.sent_at ? " (it had been sent)" : ""}`, { notification_id: prev.id, reasons: why }, { internal: true });
  }
  const cfg = await activeEscConfig();
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne" }).format(new Date(b.scheduled_start));
  const built = buildEscPayload(cfg, { jobNumber: s.jobNumber, installationDays: [day], scheduledStart: b.scheduled_start, scheduledEnd: b.scheduled_end, premisesAddress: s.address, owner: s.owner, extra: {} });
  const { data: ins } = await admin.from("esc_notifications").insert({
    job_id: jobId, booking_id: b.id, version: (prev?.version ?? 0) + 1, scheduled_start: b.scheduled_start, scheduled_end: b.scheduled_end, installation_days: [day] as Json,
    premises_address: s.address, owner_contact: s.owner as Json, consent_assignment_id: s.consent?.id ?? null, consent_template_version: s.consent?.esc_consent_version ?? null, consent_signed_at: s.consent?.esc_consent_signed_at ?? null,
    config_version: cfg?.version ?? null, payload_version: String(built.payload["payload_version"]), payload_json: built.payload as Json, status: built.status, due_by: escDueBy(b.scheduled_start),
    last_error: built.missing.length ? `Configuration required: ${built.missing.join(", ")}` : null,
  }).select("id").single();
  await logEvent(jobId, actorId, "esc_notification_prepared", `ESC notification v${(prev?.version ?? 0) + 1} prepared (${built.status.replace("_", " ")}) – due by ${new Date(escDueBy(b.scheduled_start)).toLocaleString("en-AU", { timeZone: "Australia/Melbourne" })}. NOT yet sent.`, { notification_id: ins?.id, missing: built.missing }, { internal: true });
  return ins?.id ?? null;
}

export async function submitEscViaAdapter(notificationId: string, actorId: string) {
  const adapter = configuredEscAdapter();
  if (!adapter) throw new WorkflowError("No ESC submission adapter is configured. Export the payload, submit it to ESC, then record the submission reference.");
  const { data: n } = await admin.from("esc_notifications").select("*").eq("id", notificationId).single();
  if (!n || n.status !== "ready") throw new WorkflowError("Notification is not ready to submit.");
  const r = await adapter.submit(n.payload_json as Record<string, unknown>);
  const patch = submissionPatch({ reference: r.reference, sentAt: new Date().toISOString(), method: "adapter", confirmed: true, actorId }, new Date().toISOString());
  await admin.from("esc_notifications").update({ ...patch, response: r.response as Json, updated_at: new Date().toISOString() }).eq("id", n.id);
  await logEvent(n.job_id, actorId, "esc_notification_sent", `ESC notification sent via adapter (ref ${patch.submission_reference})`, { notification_id: n.id });
}

/** Admin records an external (manual) submission. Explicit confirmation + reference required; audited. */
export async function recordEscSubmission(p: { notificationId: string; reference: string; sentAt: string; method: "manual_portal" | "manual_email"; confirmed: boolean; actorId: string }) {
  const { data: n } = await admin.from("esc_notifications").select("*").eq("id", p.notificationId).single();
  if (!n) throw new WorkflowError("Notification not found");
  if (n.status !== "ready" && n.status !== "pending_submission" && n.status !== "error") throw new WorkflowError(`Cannot record a submission for a ${n.status.replace("_", " ")} notification.`);
  let patch;
  try { patch = submissionPatch({ ...p }, new Date().toISOString()); } catch (e) { throw new WorkflowError((e as Error).message); }
  await admin.from("esc_notifications").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", n.id);
  await logEvent(n.job_id, p.actorId, "esc_notification_sent", `ESC notification recorded as submitted by admin (${p.method.replace("_", " ")}, ref ${patch.submission_reference}, at ${p.sentAt})`, { notification_id: n.id, ...patch });
}

export async function installReadiness(jobId: string) {
  const { data: b } = await admin.from("bookings").select("scheduled_start").eq("job_id", jobId).eq("kind", "installation").eq("status", "confirmed").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const { data: a } = await admin.from("customer_assignments").select("esc_consent_signed_at").eq("job_id", jobId).neq("status", "cancelled").maybeSingle();
  const { data: n } = await admin.from("esc_notifications").select("status, sent_at, submission_reference, scheduled_start").eq("job_id", jobId).neq("status", "cancelled").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const piesa = await piesaStatus(jobId);
  const { data: cur } = await admin.from("piesa_records").select("id").eq("job_id", jobId).eq("is_current", true).maybeSingle();
  const { data: dels } = cur ? await admin.from("piesa_deliveries").select("recipient, delivered_at").eq("piesa_record_id", cur.id) : { data: [] as { recipient: string; delivered_at: string }[] };
  const first = (r: string) => (dels ?? []).filter((d) => d.recipient === r).map((d) => d.delivered_at).sort()[0] ?? null;
  return readyToInstall({
    scheduledStart: b?.scheduled_start ?? null, consentSignedAt: a?.esc_consent_signed_at ?? null, notification: n ?? null,
    deliveries: { owner: first("owner"), installer: first("installer") },
    piesa: piesa ? { date: piesa.piesa_date ?? null, deadline: piesa.install_deadline ?? null, outcome: piesa.piesa_outcome ?? null } : null,
  });
}
