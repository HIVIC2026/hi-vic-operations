// ESC pre-install notification persistence + READY TO INSTALL evaluation. Fails closed.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { logEvent, piesaStatus, WorkflowError } from "./workflow.server";
import { buildEscPayload, escDueBy, escEarliest, escWithdrawalNeeded, ESC_WITHDRAW_REQUIRED_EVENT, ESC_WITHDRAWN_EVENT, openEscWithdrawals, readyToInstall, registryChange, registryConditions, registryFacts, registryUpdatePatch, staleReasons, submissionBlockers, submissionPatch, withdrawalPatch, type EscConfig, type EscField, type EscFacts, type EscWithdrawReason, type OpenEscWithdrawal, melbDateTime, derivedEscWithdrawals } from "./esc.core";
import { consentValidityBlockers } from "./consent.core";
import { formatPropertyAddress } from "./address";
import { assertNotNoEsc, noEscJobIds } from "./no-esc.server";

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
  const { data: p } = a.user_id ? await admin.from("profiles").select("full_name, licence_number, business_id").eq("id", a.user_id).maybeSingle() : { data: null };
  const bid = a.business_id ?? p?.business_id ?? null;
  const { data: b } = bid ? await admin.from("businesses").select("name, legal_name, abn, acn, licence_number, rec_number").eq("id", bid).maybeSingle() : { data: null };
  return { name: p?.full_name ?? null, licence: p?.licence_number ?? b?.licence_number ?? null, business: b?.legal_name ?? b?.name ?? null, abnAcn: b?.abn ?? b?.acn ?? null, recNumber: b?.rec_number ?? null };
}

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Notification facts for the Activity Guide v1.2 Appendix A Table 5 field list, read from job records (never guessed):
 *  booking start/end, address, owner name/phone/email, lead installer (verified CII number + mobile), installer business
 *  legal name + ABN/ACN, the signed PIESA (B1 answer, Part C CoES + REC numbers), and the valid owner consent. */
async function notificationFacts(jobId: string, extra: Record<string, string>, ctx: { address: string; owner: { name: string | null; email: string | null; phone: string | null }; start: string; end: string | null; consentValid: boolean }) {
  const inst = await person(jobId, "installer");
  const elec = await person(jobId, "electrician");
  const piesa = await piesaStatus(jobId);
  const lead = await import("./prestart.server").then((m) => m.leadInstallerCert(jobId)).catch(() => null);
  const { currentCopy } = await import("./official-forms.server");
  const { answersFromDocument, B1_OPTIONS } = await import("./official-forms.core");
  const pe = (await currentCopy(jobId, "piesa").catch(() => ({ copy: null }))).copy;
  const answers = pe ? (answersFromDocument(pe.snapshot.document) as Record<string, unknown>) : {};
  const b1Raw = answers["b1"];
  const b1 = b1Raw === B1_OPTIONS[0] ? "not_required" as const : b1Raw === B1_OPTIONS[1] ? "required" as const : b1Raw === B1_OPTIONS[2] ? "not_possible" as const : null;
  const facts: EscFacts = {
    ...registryFacts({
      premisesAddress: ctx.address, ownerName: ctx.owner.name, ownerPhone: ctx.owner.phone, ownerEmail: ctx.owner.email,
      scheduledStart: ctx.start, scheduledEnd: ctx.end,
      leadInstaller: lead?.name ?? inst?.name ?? null, leadInstallerPhone: lead?.mobile ?? null,
      // Table 5 requires the number "as it appears on the EEC certificate": only an office-verified certificate counts.
      leadInstallerCii: lead?.status === "verified" ? lead.certificateNumber : null,
      installerCompany: inst?.business ?? null, installerAbnAcn: inst?.abnAcn ?? null,
      piesa: { signed: !!pe, b1, outcome: piesa?.piesa_outcome ?? null },
      coesNumber: text(extra["coes_number"]) ?? text(answers["c.coes"]),
      recNumber: text(extra["rec_number"]) ?? text(answers["c.recNo"]) ?? elec?.recNumber ?? null,
      consentValid: ctx.consentValid,
    }),
    piesa_outcome: piesa?.piesa_outcome ?? null,
  };
  return { facts, conditions: registryConditions(facts) };
}

/** Create/refresh the notification for the current installation booking. A changed booking stales the old notice. */
export async function regenerateEscNotification(jobId: string, actorId: string | null, extra: Record<string, string> = {}) {
  // Part 9 Task 1: every notice change (prepared, refreshed, staled, cancelled) re-runs the GO check, whatever path returns.
  try { return await regenerate(); } finally {
    await import("./prestart.server").then((m) => m.runPrestart(jobId, "esc_regenerated")).catch((e) => console.error("pre-start re-run skipped", (e as Error).message));
  }
  async function regenerate() {
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
  const nf = await notificationFacts(jobId, extra, { address: s.address, owner: s.owner, start: b.scheduled_start, end: b.scheduled_end, consentValid: !!consentOk });
  const built = buildEscPayload(cfg, { jobNumber: s.jobNumber, installationDays: [day], scheduledStart: b.scheduled_start, scheduledEnd: b.scheduled_end, premisesAddress: s.address, owner: s.owner, extra, facts: { ...nf.facts, owner_consent_reference: consentReference }, conditions: nf.conditions, consentReference });
  const fields = {
    consent_id: consentOk ? consent.id : null, consent_template_version: consent?.template_version ?? null, consent_signed_at: consentOk ? consent.ap_signed_at : null,
    config_version: cfg?.version ?? null, payload_version: String(built.payload["payload_version"]), payload_json: built.payload as Json, status: built.status,
    due_by: escDueBy(b.scheduled_start), earliest_send_at: escEarliest(b.scheduled_start), last_error: built.missing.length ? `Not ready: ${built.missing.join(", ")}` : null,
  };
  if (prev) {
    const why = staleReasons(prev as never, next);
    if(['sent','accepted'].includes(prev.status)){
      const leadChange=registryChange(prev,{scheduled_start:b.scheduled_start,payload_json:built.payload},new Date().toISOString());
      if(leadChange.changed.some(k=>k.startsWith('lead_installer')))why.push('Lead Installer changed');
    }
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
}

/** Valid owner consent + inside the window — shared by the office record paths and the Registry robot (decision 272). */
export async function assertCanSubmit(n: { job_id: string; scheduled_start: string }, sentAt: string) {
  const { currentConsent } = await import("./consent.server");
  const b = submissionBlockers({ consent: await currentConsent(n.job_id), scheduledStart: n.scheduled_start, sentAt });
  if (b.length) throw new WorkflowError(b.join(" "));
}
export async function assertCanUpdate(n:{job_id:string;scheduled_start:string},prev:{scheduled_start:string},updatedAt:string){
 if(Date.parse(n.scheduled_start)!==Date.parse(prev.scheduled_start))return assertCanSubmit(n,updatedAt);
 const consent=await (await import('./consent.server')).currentConsent(n.job_id);
 const blockers=consentValidityBlockers(consent,n.scheduled_start);
 if(Date.parse(updatedAt)>=Date.parse(prev.scheduled_start))blockers.push('The original installation date and time has passed.');
 if(blockers.length)throw new WorkflowError(blockers.join(' '));
}

export async function submitEscViaAdapter(notificationId: string, actorId: string) {
  const adapter = configuredEscAdapter();
  const { data: n } = await admin.from("esc_notifications").select("*").eq("id", notificationId).single();
  if (n) await assertNotNoEsc(n.job_id); // Part 9 Task 14: a "no ESC" real-run job is refused before anything else
  if (!adapter) throw new WorkflowError("No ESC submission adapter is configured. Export the payload, submit it to ESC, then record the submission reference.");
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
  await assertNotNoEsc(n.job_id); // Part 9 Task 14
  if (n.status !== "ready" && n.status !== "pending_submission" && n.status !== "error") throw new WorkflowError(`Cannot record a submission for a ${n.status.replace("_", " ")} notification.`);
  if (!n.consent_id) throw new WorkflowError("Cannot notify ESC: no valid separate owner consent is linked to this notification.");
  await assertCanSubmit(n, p.sentAt);
  let patch;
  try { patch = submissionPatch({ ...p }, new Date().toISOString()); } catch (e) { throw new WorkflowError((e as Error).message); }
  await admin.from("esc_notifications").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", n.id);
  await import("./prestart.server").then((m) => m.runPrestart(n.job_id, "esc_submitted")).catch((e) => console.error("pre-start re-run skipped", (e as Error).message));
  await logEvent(n.job_id, p.actorId, "esc_notification_sent", `ESC notification recorded as submitted by admin (${p.method.replace("_", " ")}, ref ${patch.submission_reference}, at ${p.sentAt})`, { notification_id: n.id, ...patch });
}

/** Office records that it UPDATED the earlier notification in the Registry (same notification ID; Activity Guide v1.2
 *  §3.3.3: start/end date-time, lead installer and their phone / EEC number / company / ABN-ACN only). The current notice is
 *  recorded as sent under that same ID; anything else must be withdrawn and resubmitted. Valid consent + window required. */
export async function recordEscRegistryUpdate(p: { notificationId: string; reference: string; updatedAt: string; confirmed: boolean; actorId: string }) {
  const { data: n } = await admin.from("esc_notifications").select("*").eq("id", p.notificationId).single();
  if (!n) throw new WorkflowError("Notification not found");
  await assertNotNoEsc(n.job_id); // Part 9 Task 14
  if (n.status !== "ready" && n.status !== "pending_submission" && n.status !== "error") throw new WorkflowError(`Cannot record an update for a ${n.status.replace("_", " ")} notification.`);
  if (!n.consent_id) throw new WorkflowError("Cannot notify ESC: no valid separate owner consent is linked to this notification.");
  const { latestNotices } = await import("./prestart.server");
  const prevRef = (await latestNotices(n.job_id)).previousSent;
  if (!prevRef) throw new WorkflowError("There is no earlier recorded notification to update — record this as a new submission.");
  const { data: prev } = await admin.from("esc_notifications").select("scheduled_start, sent_at, submission_reference, payload_json").eq("id", prevRef.id).single();
  if (!prev) throw new WorkflowError("The earlier notification could not be read.");
  await assertCanUpdate(n,prev,p.updatedAt);
  const now = new Date().toISOString();
  let patch;
  // Same-start updates keep the original sent_at and ID: one rule inside registryUpdatePatch (Part 9 Task 3).
  try { patch = registryUpdatePatch({ prev, nextStart: n.scheduled_start, change: registryChange(prev, { scheduled_start: n.scheduled_start, payload_json: n.payload_json }, now), reference: p.reference, updatedAt: p.updatedAt, confirmed: p.confirmed, actorId: p.actorId }, now); } catch (e) { throw new WorkflowError((e as Error).message); }
  const { error } = await admin.from("esc_notifications").update({ ...patch, response: patch.response as unknown as Json, updated_at: now }).eq("id", n.id);
  if (error) throw new WorkflowError(error.message);
  await import("./prestart.server").then((m) => m.runPrestart(n.job_id, "esc_submitted")).catch((e) => console.error("pre-start re-run skipped", (e as Error).message));
  await logEvent(n.job_id, p.actorId, "esc_notification_updated", `ESC notification updated in the VEU Registry (same ID ${patch.submission_reference}, at ${p.updatedAt}): ${patch.response.registry_update.changed.join(", ")}`, { notification_id: n.id, previous_notification_id: prevRef.id, ...patch.response.registry_update }, { internal: true });
}

/** EVERY recorded delivery time (ascending) of the CURRENT signed PIESA copy to the owner and to the installer, plus the
 *  Part C signature time when the current record is a post-rectification one (Part 9 Task 5; the pure rule decides which
 *  copy counts). The one reader for Installation complete (installReadiness) and the day-before pre-start check (decision 395). */
export async function piesaCopyDeliveries(jobId: string): Promise<{ owner: string[]; installer: string[]; partCSignedAt: string | null }> {
  const { data: cur, error } = await admin.from("piesa_records").select("id, kind, section_c_signed_at").eq("job_id", jobId).eq("is_current", true).maybeSingle();
  if (error) throw new Error(`Could not read the PIESA record: ${error.message}`);
  const { data: dels, error: de } = cur ? await admin.from("piesa_deliveries").select("recipient, delivered_at").eq("piesa_record_id", cur.id) : { data: [] as { recipient: string; delivered_at: string }[], error: null };
  if (de) throw new Error(`Could not read the PIESA copy deliveries: ${de.message}`);
  const all = (r: string) => (dels ?? []).filter((d) => d.recipient === r && typeof d.delivered_at === "string").map((d) => d.delivered_at).sort();
  const c = cur as { kind?: string | null; section_c_signed_at?: string | null } | null;
  return { owner: all("owner"), installer: all("installer"), partCSignedAt: c && c.kind !== "initial" ? c.section_c_signed_at ?? null : null };
}

export async function installReadiness(jobId: string) {
  const { data: b } = await admin.from("bookings").select("scheduled_start").eq("job_id", jobId).eq("kind", "installation").in("status", ["confirmed", "completed"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const { data: c } = await admin.from("owner_esc_consents").select("status, scheduled_start, owner_signed_at, ap_signed_at").eq("job_id", jobId).not("status", "in", "(stale,cancelled)").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const { data: n } = await admin.from("esc_notifications").select("status, sent_at, submission_reference, scheduled_start").eq("job_id", jobId).neq("status", "cancelled").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const piesa = await piesaStatus(jobId);
  const dels = await piesaCopyDeliveries(jobId);
  return readyToInstall({
    scheduledStart: b?.scheduled_start ?? null, consent: c ?? null, notification: n ?? null,
    deliveries: dels, partCSignedAt: dels.partCSignedAt,
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
  await logEvent(n.job_id, p.actorId, ESC_WITHDRAWN_EVENT, `ESC notification (ref ${n.submission_reference}) withdrawn in the VEU Registry at ${p.withdrawnAt}: ${patch.response.withdrawal.reason}. A new notification must be submitted and recorded.`, { notification_id: n.id, ...patch.response.withdrawal }, { internal: true });
  const next = await regenerateEscNotification(n.job_id, p.actorId);
  await import("./prestart.server").then((m) => m.runPrestart(n.job_id, "esc_withdrawn")).catch((e) => console.error("pre-start re-run skipped", (e as Error).message));
  return { ok: true, nextNotificationId: next };
}

/** Part 9 Task 2: the install won't go ahead ("Owner cancelled", "Can't do this one", address changed) but a notice was
 *  SENT — ONE internal `esc_withdraw_required` per live notice (idempotent by notice id, Needs me until the office records
 *  the withdrawal). Returns how many notices still need withdrawing. Never withdraws, never sends. */
export async function requireEscWithdrawal(jobId: string, reason: EscWithdrawReason, actorId: string | null): Promise<number> {
  const { data, error } = await admin.from("esc_notifications").select("id, status, sent_at, submission_reference, response").eq("job_id", jobId);
  if (error) throw new WorkflowError(`Could not read the ESC notifications: ${error.message}`);
  const live = escWithdrawalNeeded(data ?? []);
  for (const n of live) {
    const { data: already, error: ae } = await admin.from("workflow_events").select("id").eq("job_id", jobId).eq("event_type", ESC_WITHDRAW_REQUIRED_EVENT).contains("details", { notification_id: n.id }).limit(1).maybeSingle();
    if (ae) throw new WorkflowError(`Could not read the ESC withdrawal asks: ${ae.message}`);
    if (already) continue;
    await logEvent(jobId, actorId, ESC_WITHDRAW_REQUIRED_EVENT, `ESC notification (ref ${n.reference}) is still live in the VEU Registry but the install won't go ahead (${reason.replace(/_/g, " ")}). Withdraw it in the Registry, then record the withdrawal on the job. Needs Home Insulation Victoria`, { notification_id: n.id, reference: n.reference, reason, needs_office: true }, { internal: true });
  }
  return live.length;
}

/** Office job page: this job's live notices with an open withdrawal ask (the card to record the withdrawal from). */
export async function escWithdrawalsFor(jobId: string): Promise<{ id: string; reference: string; sentLine: string | null; reason: string; at: string }[]> {
  const open = await openEscWithdrawalRows([jobId]);
  if (!open.length) return [];
  const { data, error } = await admin.from("esc_notifications").select("id, status, sent_at, submission_reference, response").in("id", open.map((o) => o.notificationId));
  if (error) throw new Error(`Could not read the ESC notifications: ${error.message}`);
  const live = new Map(escWithdrawalNeeded(data ?? []).map((n) => [n.id, n]));
  return open.filter((o) => live.has(o.notificationId)).map((o) => {
    const n = (data ?? []).find((r) => r.id === o.notificationId)!;
    return { id: o.notificationId, reference: o.reference, sentLine: n.sent_at && n.submission_reference ? `Sent to ESC on ${melbDateTime(n.sent_at)} · ref ${n.submission_reference}` : null, reason: o.reason, at: o.at };
  });
}

/** Open "withdraw the ESC notice" items for Needs me (closed jobs included — that is the point); optionally some jobs only.
 *  G6 S3: the recorded asks first, then every other sent, un-withdrawn notice on a job that won't go ahead (cancelled /
 *  deleted / no confirmed install booking) — derived from the notices, so a lost or never-written ask still surfaces.
 *  A read failure throws (fail closed: never an empty list). */
export async function openEscWithdrawalRows(onlyIds?: string[]): Promise<OpenEscWithdrawal[]> {
  let q = admin.from("workflow_events").select("job_id, created_at, details").eq("event_type", ESC_WITHDRAW_REQUIRED_EVENT).contains("details", { needs_office: true }).order("created_at", { ascending: true }).limit(500);
  if (onlyIds) q = q.in("job_id", onlyIds);
  const { data, error } = await q;
  if (error) throw new Error(`Could not load the ESC withdrawal asks: ${error.message}`);
  const required = (data ?? []).filter((e) => e.job_id).map((e) => ({ job_id: String(e.job_id), created_at: String(e.created_at), details: e.details }));
  let fromAsks: OpenEscWithdrawal[] = [];
  if (required.length) {
    const jobIds = [...new Set(required.map((r) => r.job_id))];
    const { data: w, error: we } = await admin.from("workflow_events").select("details").eq("event_type", ESC_WITHDRAWN_EVENT).in("job_id", jobIds);
    if (we) throw new Error(`Could not load the recorded ESC withdrawals: ${we.message}`);
    fromAsks = openEscWithdrawals(required, (w ?? []).map((e) => ({ details: e.details })));
  }
  // Derived from the notices (S3): sent + referenced, whatever the status; withdrawn ones drop out in the pure rule.
  let nq = admin.from("esc_notifications").select("id, job_id, status, sent_at, submission_reference, response").not("sent_at", "is", null).not("submission_reference", "is", null).limit(2000);
  if (onlyIds) nq = nq.in("job_id", onlyIds);
  const { data: notices, error: ne } = await nq;
  if (ne) throw new Error(`Could not read the ESC notifications: ${ne.message}`);
  const sent = (notices ?? []).map((n) => ({ id: String(n.id), job_id: String(n.job_id), status: String(n.status), sent_at: n.sent_at as string | null, submission_reference: n.submission_reference as string | null, response: n.response }));
  if (!sent.length) return fromAsks;
  const nJobIds = [...new Set(sent.map((n) => n.job_id))];
  const [{ data: jobs, error: je }, { data: bk, error: be }] = await Promise.all([
    admin.from("jobs").select("id, stage, deleted_at").in("id", nJobIds),
    admin.from("bookings").select("job_id, status").eq("kind", "installation").in("status", ["confirmed", "completed"]).in("job_id", nJobIds),
  ]);
  if (je) throw new Error(`Could not read the jobs with an ESC notice: ${je.message}`);
  if (be) throw new Error(`Could not read the install bookings: ${be.message}`);
  const derived = derivedEscWithdrawals(sent, (jobs ?? []).map((j) => ({ id: String(j.id), stage: (j.stage as string | null) ?? null, deleted_at: (j as { deleted_at?: string | null }).deleted_at ?? null })), (bk ?? []).map((b) => ({ job_id: String(b.job_id), status: String(b.status) })), new Set(fromAsks.map((r) => r.notificationId)));
  return [...fromAsks, ...derived];
}

/** Timer (15-min tick): raise each Office ESC reminder ONCE per booking start + stage — window open (5 days before),
 *  urgent (48h), blocked (24h, not recorded) and reopened (install moved after a recorded submission). Reminders are
 *  internal workflow events feeding the Needs me list and the job history; no customer or trade message is ever sent. */
export async function sweepEscReminders(now = new Date()) {
  const { escReminder, ESC_REMINDER_TITLES } = await import("./prestart.core");
  const { latestNotices, registryChangeFor } = await import("./prestart.server");
  const { data: bk } = await admin.from("bookings").select("job_id, scheduled_start").eq("kind", "installation").eq("status", "confirmed").gt("scheduled_start", now.toISOString()).lt("scheduled_start", new Date(now.getTime() + EARLIEST_MS_PLUS).toISOString());
  let checked = 0, raised = 0;
  // Part 9 Task 14: jobs marked "no ESC" (real runs) get no ESC reminder. A failed marker read throws: the sweep stops
  // rather than nag the office about a notice that must never be sent.
  const noEsc = await noEscJobIds([...new Set((bk ?? []).map((b) => b.job_id))]);
  for (const b of bk ?? []) {
    if (noEsc.has(b.job_id)) continue;
    checked++;
    const n = await latestNotices(b.job_id);
    const r = escReminder({ start: b.scheduled_start, current: n.current, previousSent: n.previousSent, change: registryChangeFor(b.scheduled_start, n, now), now });
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
