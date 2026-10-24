// ESC pre-install notification persistence + READY TO INSTALL evaluation. Fails closed.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { logEvent, piesaStatus, WorkflowError } from "./workflow.server";
import { buildEscPayload, escDueBy, escEarliest, readyToInstall, registryFacts, staleReasons, submissionBlockers, submissionPatch, withdrawalPatch, type EscConfig, type EscField, type EscFacts } from "./esc.core";
import { consentCompletedAt, consentValidityBlockers, type ConsentRecord } from "./consent.core";
import { formatPropertyAddress } from "./address";

/** Submission adapter slot. No ESC endpoint is configured – adapter always reports not configured. */
export interface EscAdapter { submit(payload: Record<string, unknown>): Promise<{ reference: string; response: unknown }> }
export function configuredEscAdapter(): EscAdapter | null { return null; }

export async function activeEscConfig(): Promise<EscConfig> {
  const { data } = await admin.from("esc_notification_config").select("version, required_fields, approved, is_active").eq("is_active", true).eq("approved", true).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data ? { version: data.version, required_fields: (data.required_fields as EscField[]) ?? [], approved: data.approved, is_active: data.is_active } : null;
}

async function snapshot(jobId: string) {
  const { data: j } = await admin.from("jobs").select("job_number, owners(full_name, email, phone), properties(address_line, suburb, state, postcode)").eq("id", jobId).single();
  const o = j?.owners as { full_name: string | null; email: string | null; phone: string | null } | null;
  const p = j?.properties as { address_line: string; suburb: string | null; state: string; postcode: string | null } | null;
  return { jobNumber: j?.job_number ?? "", address: formatPropertyAddress(p), owner: { name: o?.full_name ?? null, email: o?.email ?? null, phone: o?.phone ?? null } };
}

async function person(jobId: string, role: "installer" | "electrician") {
  const { data: a } = await admin.from("job_assignments").select("user_id, business_id").eq("job_id", jobId).eq("role", role).eq("active", true).maybeSingle();
  if (!a) return null;
  const { data: p } = await admin.from("profiles").select("full_name, licence_number, business_id").eq("id", a.user_id).maybeSingle();
  const bid = a.business_id ?? p?.business_id ?? null;
  const { data: b } = bid ? await admin.from("businesses").select("name, abn, licence_number").eq("id", bid).maybeSingle() : { data: null };
  return { name: p?.full_name ?? null, licence: p?.licence_number ?? b?.licence_number ?? null, business: b?.name ?? null, abn: b?.abn ?? null };
}

/** Known notification facts – filled automatically from job records (never guessed); conditional ones only matter when
 *  their condition applies. Registry facts (decision 121): AP, premises, owner, date/time, installer + CII number,
 *  electrician + licence, PIESA date, PIISA done, consent date, job number. */
async function notificationFacts(jobId: string, extra: Record<string, string>, ctx: { jobNumber: string; address: string; ownerName: string | null; start: string; end: string | null; consent: ConsentRecord }) {
  const inst = await person(jobId, "installer");
  const elec = await person(jobId, "electrician");
  const piesa = await piesaStatus(jobId);
  const { count } = await admin.from("rectification_items").select("id", { count: "exact", head: true }).eq("job_id", jobId).neq("status", "cancelled");
  const rectification = (count ?? 0) > 0;
  const lead = await import("./prestart.server").then((m) => m.leadInstallerCert(jobId)).catch(() => null);
  const piesaDone = await import("./allocation.server").then((m) => m.clearanceFacts(jobId)).then((c) => c.piesaCompletedAt).catch(() => null);
  const piisa = await import("./official-forms.server").then((m) => m.currentCopy(jobId, "piisa")).then((r) => r.copy?.signatureDate ?? null).catch(() => null);
  const registry = registryFacts({
    jobNumber: ctx.jobNumber, premisesAddress: ctx.address, ownerName: ctx.ownerName, scheduledStart: ctx.start, scheduledEnd: ctx.end,
    installerBusiness: inst?.business ?? null, leadInstaller: lead?.name ?? inst?.name ?? null, leadInstallerCii: lead?.certificateNumber ?? null,
    electricianName: elec?.name ?? null, electricianLicence: extra["rec_number"] ?? elec?.licence ?? null,
    piesaCompletedOn: piesaDone ?? piesa?.piesa_date ?? null, piisaSignedOn: piisa, consentCompletedAt: ctx.consent ? consentCompletedAt(ctx.consent) : null,
  });
  const facts: EscFacts = {
    ...registry,
    installer_abn_acn: inst?.abn ?? null,
    piesa_outcome: piesa?.piesa_outcome ?? null, coes_number: extra["coes_number"] ?? null, rec_number: extra["rec_number"] ?? elec?.licence ?? null,
  };
  return { facts, conditions: { rectification, recRequired: rectification } };
}

/** Create/refresh the notification for the current installation booking. A changed booking stales the old notice. */
export async function regenerateEscNotification(jobId: string, actorId: string | null, extra: Record<string, string> = {}) {
  const { syncOwnerConsent, currentConsent } = await import("./consent.server");
  await syncOwnerConsent(jobId, actorId);
  const { data: b } = await admin.from("bookings").select("id, scheduled_start, scheduled_end").eq("job_id", jobId).eq("kind", "installation").in("status", ["confirmed", "completed"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const { data: prev } = await admin.from("esc_notifications").select("*").eq("job_id", jobId).not("status", "in", "(stale,cancelled)").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!b) {
    if (prev) { await admin.from("esc_notifications").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", prev.id); await logEvent(jobId, actorId, "esc_notification_cancelled", "ESC notification cancelled – installation booking removed", { notification_id: prev.id }, { internal: true }); }
    return null;
  }
  const s = await snapshot(jobId);
  const next = { scheduled_start: b.scheduled_start, scheduled_end: b.scheduled_end, premises_address: s.address, owner_contact: s.owner };
  const consent = await currentConsent(jobId);
  const consentOk = consent && consentValidityBlockers(consent, b.scheduled_start).length === 0;
  const consentReference = consentOk ? `${consent.id}:${consent.signed_sha256}` : null;
  const cfg = await activeEscConfig();
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne" }).format(new Date(b.scheduled_start));
  const nf = await notificationFacts(jobId, extra, { jobNumber: s.jobNumber, address: s.address, ownerName: s.owner.name, start: b.scheduled_start, end: b.scheduled_end, consent: consentOk ? consent : null });
  const built = buildEscPayload(cfg, { jobNumber: s.jobNumber, installationDays: [day], scheduledStart: b.scheduled_start, scheduledEnd: b.scheduled_end, premisesAddress: s.address, owner: s.owner, extra, facts: { ...nf.facts, owner_consent_reference: consentReference }, conditions: nf.conditions, consentReference });
  const fields = {
    consent_id: consentOk ? consent.id : null, consent_template_version: consent?.template_version ?? null, consent_signed_at: consentOk ? consent.ap_signed_at : null,
    config_version: cfg?.version ?? null, payload_version: String(built.payload["payload_version"]), payload_json: built.payload as Json, status: built.status,
    due_by: escDueBy(b.scheduled_start), earliest_send_at: escEarliest(b.scheduled_start), last_error: built.missing.length ? `Not ready: ${built.missing.join(", ")}` : null,
  };
  if (prev) {
    const why = staleReasons(prev as never, next);
    if (!why.length && prev.booking_id === b.id) {
      if (!["sent", "accepted"].includes(prev.status)) await admin.from("esc_notifications").update({ ...fields, updated_at: new Date().toISOString() }).eq("id", prev.id);
      return prev.id;
    }
    await admin.from("esc_notifications").update({ status: "stale", last_error: `Stale: ${why.join(", ") || "booking replaced"}`, updated_at: new Date().toISOString() }).eq("id", prev.id);
    await logEvent(jobId, actorId, "esc_notification_stale", `Previous ESC notification is STALE (${why.join(", ") || "booking replaced"}) – re-notification required${prev.sent_at ? " (it had been sent)" : ""}`, { notification_id: prev.id, reasons: why }, { internal: true });
  }
  // Version numbers never repeat for a job: stale/cancelled/withdrawn notices stay as history and still count.
  const { data: top } = await admin.from("esc_notifications").select("version").eq("job_id", jobId).order("version", { ascending: false }).limit(1).maybeSingle();
  const nextVersion = Math.max(prev?.version ?? 0, top?.version ?? 0) + 1;
  const { data: ins } = await admin.from("esc_notifications").insert({
    job_id: jobId, booking_id: b.id, version: nextVersion, scheduled_start: b.scheduled_start, scheduled_end: b.scheduled_end, installation_days: [day] as Json,
    premises_address: s.address, owner_contact: s.owner as Json, ...fields,
  }).select("id").single();
  await logEvent(jobId, actorId, "esc_notification_prepared", `ESC notification v${nextVersion} prepared (${built.status.replace("_", " ")}) – send window ${new Date(escEarliest(b.scheduled_start)).toLocaleString("en-AU", { timeZone: "Australia/Melbourne" })} to ${new Date(escDueBy(b.scheduled_start)).toLocaleString("en-AU", { timeZone: "Australia/Melbourne" })}. NOT yet sent.`, { notification_id: ins?.id, missing: built.missing }, { internal: true });
  return ins?.id ?? null;
}

async function assertCanSubmit(n: { job_id: string; scheduled_start: string }, sentAt: string) {
  const { currentConsent } = await import("./consent.server");
  const b = submissionBlockers({ consent: await currentConsent(n.job_id), scheduledStart: n.scheduled_start, sentAt });
  if (b.length) throw new WorkflowError(b.join(" "));
}

export async function submitEscViaAdapter(notificationId: string, actorId: string) {
  const adapter = configuredEscAdapter();
  if (!adapter) throw new WorkflowError("No ESC submission adapter is configured. Export the payload, submit it to ESC, then record the submission reference.");
  const { data: n } = await admin.from("esc_notifications").select("*").eq("id", notificationId).single();
  if (!n || n.status !== "ready") throw new WorkflowError("Notification is not ready to submit.");
  await assertCanSubmit(n, new Date().toISOString());
  const r = await adapter.submit(n.payload_json as Record<string, unknown>);
  const patch = submissionPatch({ reference: r.reference, sentAt: new Date().toISOString(), method: "adapter", confirmed: true, actorId }, new Date().toISOString());
  await admin.from("esc_notifications").update({ ...patch, response: r.response as Json, updated_at: new Date().toISOString() }).eq("id", n.id);
  await logEvent(n.job_id, actorId, "esc_notification_sent", `ESC notification sent via adapter (ref ${patch.submission_reference})`, { notification_id: n.id });
}

/** Admin records an external (manual) submission. Valid consent, timing window, confirmation + reference required; audited. */
export async function recordEscSubmission(p: { notificationId: string; reference: string; sentAt: string; method: "manual_portal" | "manual_email"; confirmed: boolean; actorId: string }) {
  const { data: n } = await admin.from("esc_notifications").select("*").eq("id", p.notificationId).single();
  if (!n) throw new WorkflowError("Notification not found");
  if (n.status !== "ready" && n.status !== "pending_submission" && n.status !== "error") throw new WorkflowError(`Cannot record a submission for a ${n.status.replace("_", " ")} notification.`);
  if (!n.consent_id) throw new WorkflowError("Cannot notify ESC: no valid separate owner consent is linked to this notification.");
  await assertCanSubmit(n, p.sentAt);
  let patch;
  try { patch = submissionPatch({ ...p }, new Date().toISOString()); } catch (e) { throw new WorkflowError((e as Error).message); }
  await admin.from("esc_notifications").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", n.id);
  await import("./prestart.server").then((m) => m.runPrestart(n.job_id, "esc_submitted")).catch((e) => console.error("pre-start re-run skipped", (e as Error).message));
  await logEvent(n.job_id, p.actorId, "esc_notification_sent", `ESC notification recorded as submitted by admin (${p.method.replace("_", " ")}, ref ${patch.submission_reference}, at ${p.sentAt})`, { notification_id: n.id, ...patch });
}

export async function installReadiness(jobId: string) {
  const { data: b } = await admin.from("bookings").select("scheduled_start").eq("job_id", jobId).eq("kind", "installation").in("status", ["confirmed", "completed"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const { data: c } = await admin.from("owner_esc_consents").select("status, scheduled_start, owner_signed_at, ap_signed_at").eq("job_id", jobId).not("status", "in", "(stale,cancelled)").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const { data: n } = await admin.from("esc_notifications").select("status, sent_at, submission_reference, scheduled_start").eq("job_id", jobId).neq("status", "cancelled").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const piesa = await piesaStatus(jobId);
  const { data: cur } = await admin.from("piesa_records").select("id").eq("job_id", jobId).eq("is_current", true).maybeSingle();
  const { data: dels } = cur ? await admin.from("piesa_deliveries").select("recipient, delivered_at").eq("piesa_record_id", cur.id) : { data: [] as { recipient: string; delivered_at: string }[] };
  const first = (r: string) => (dels ?? []).filter((d) => d.recipient === r).map((d) => d.delivered_at).sort()[0] ?? null;
  return readyToInstall({
    scheduledStart: b?.scheduled_start ?? null, consent: c ?? null, notification: n ?? null,
    deliveries: { owner: first("owner"), installer: first("installer") },
    piesa: piesa ? { date: piesa.piesa_date ?? null, deadline: piesa.install_deadline ?? null, outcome: piesa.piesa_outcome ?? null } : null,
  });
}

/** Office records that a SUBMITTED notification was withdrawn in the Registry (install slipped outside its window or key
 *  details changed). The row is kept as history (status stale + withdrawal record); the current booking's notice is then
 *  re-prepared so the office can submit a fresh one. Never deletes, never sends. */
export async function withdrawEscNotification(p: { notificationId: string; reason: string; withdrawnAt: string; actorId: string }) {
  const { data: n } = await admin.from("esc_notifications").select("id, job_id, status, sent_at, submission_reference, response, scheduled_start").eq("id", p.notificationId).single();
  if (!n) throw new WorkflowError("Notification not found");
  let patch;
  try { patch = withdrawalPatch({ notice: n, reason: p.reason, withdrawnAt: p.withdrawnAt, actorId: p.actorId }, new Date().toISOString()); } catch (e) { throw new WorkflowError((e as Error).message); }
  const { error } = await admin.from("esc_notifications").update({ response: patch.response as unknown as Json, status: patch.status, last_error: `Withdrawn in the Registry: ${patch.response.withdrawal.reason}`, updated_at: new Date().toISOString() }).eq("id", n.id);
  if (error) throw new WorkflowError(error.message);
  await logEvent(n.job_id, p.actorId, "esc_notification_withdrawn", `ESC notification (ref ${n.submission_reference}) withdrawn in the VEU Registry at ${p.withdrawnAt}: ${patch.response.withdrawal.reason}. A new notification must be submitted and recorded.`, { notification_id: n.id, ...patch.response.withdrawal }, { internal: true });
  const next = await regenerateEscNotification(n.job_id, p.actorId);
  await import("./prestart.server").then((m) => m.runPrestart(n.job_id, "esc_withdrawn")).catch((e) => console.error("pre-start re-run skipped", (e as Error).message));
  return { ok: true, nextNotificationId: next };
}

/** Timer (15-min tick): raise each Office ESC reminder ONCE per booking start + stage — window open (5 days before),
 *  urgent (48h), blocked (24h, not recorded) and reopened (install moved after a recorded submission). Reminders are
 *  internal workflow events feeding the Needs me list and the job history; no customer or trade message is ever sent. */
export async function sweepEscReminders(now = new Date()) {
  const { escReminder, ESC_REMINDER_TITLES } = await import("./prestart.core");
  const { latestNotices } = await import("./prestart.server");
  const { data: bk } = await admin.from("bookings").select("job_id, scheduled_start").eq("kind", "installation").eq("status", "confirmed").gt("scheduled_start", now.toISOString()).lt("scheduled_start", new Date(now.getTime() + EARLIEST_MS_PLUS).toISOString());
  let checked = 0, raised = 0;
  for (const b of bk ?? []) {
    checked++;
    const n = await latestNotices(b.job_id);
    const r = escReminder({ start: b.scheduled_start, current: n.current, previousSent: n.previousSent, now });
    if (!r) continue;
    const { data: already } = await admin.from("workflow_events").select("id").eq("job_id", b.job_id).eq("event_type", "esc_reminder").contains("details", { key: r.key }).limit(1).maybeSingle();
    if (already) continue;
    await logEvent(b.job_id, null, "esc_reminder", `${ESC_REMINDER_TITLES[r.code]}. ${r.detail} Needs Home Insulation Victoria`, { key: r.key, code: r.code, scheduled_start: b.scheduled_start, notification_id: n.current?.id ?? null }, { internal: true });
    raised++;
  }
  return { checked, raised };
}
// Bookings further out than the 5-day window plus one day can have no reminder yet; keeps the sweep bounded.
const EARLIEST_MS_PLUS = 6 * 24 * 3600_000;
