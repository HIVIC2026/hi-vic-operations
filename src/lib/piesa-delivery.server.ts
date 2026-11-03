// Jo 24 Oct 2026 (decision 111): automatic delivery of the signed PIESA copy to the owner and the installer once the
// install day is booked. Rules + wording: piesa-delivery.core.ts. Runs from the 15-minute allocation tick.
// Sending: TEST jobs / TEST partners go through sendTestEmail (allowlist); real jobs need PIESA_COPY_EMAIL_APPROVED
// (on since decision 131) plus customer_comms_enabled for the owner, else log one "not sent" event per recipient and copy. A delivery row
// (piesa_deliveries + official_form_deliveries, which readyToInstall and PIISA Part 8(a) read) is written ONLY after
// a provider accepted the email — never on a hold. recordPiesaCopyDelivery (job-records.server.ts) stays for hand
// deliveries. Nothing here changes stage.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import {
  PIESA_COPY_DELIVERED_EVENT, PIESA_COPY_EMAIL_APPROVED, PIESA_COPY_EMAIL_VERSION, PIESA_COPY_MAX_PER_TICK, PIESA_COPY_NOT_SENT_EVENT,
  piesaCopyKey, piesaDeliveryPlan, renderPiesaCopyEmail, type PiesaCopyRecipient,
} from "./piesa-delivery.core";
import { OWNER_STANDALONE_GRACE_MS, ownerStandaloneDue, piesaResultRoute, type PiesaResultRoute } from "./piesa-result-route.core";

/** Part 4 Task 2: what the owner's PIESA message is for this job (piesa-result-route.core). Reads fail closed to the standalone legal copy. */
export async function ownerPiesaRoute(jobId: string): Promise<PiesaResultRoute[]> {
  try {
    const [{ readInHouseDispatchState }, { readDoNotContact }, { fixesFormNeededFor }, { clearanceFacts }] = await Promise.all([
      import("./in-house-suppression.server"), import("./do-not-contact.server"), import("./fixes-day.server"), import("./allocation.server"),
    ]);
    const [dispatch, dnc, c, fixes] = await Promise.all([readInHouseDispatchState([jobId]), readDoNotContact(jobId), clearanceFacts(jobId), fixesFormNeededFor(jobId)]);
    if (dispatch.failed || !c.piesaOutcome) return ["standalone_copy"];
    // Upgrades done on the PIESA visit: the PIESA form's "fixed on the same visit" answer is Yes.
    const { shortAnswersFromEntries } = await import("./official-short.core");
    const upgradesDoneSameDay = c.piesaOutcome === "fail" && /^\s*yes\b/i.test(String(shortAnswersFromEntries("piesa", fixes.snapshot)["rectificationComplete"] ?? ""));
    return piesaResultRoute({ outcome: c.piesaOutcome === "pass" ? "all_clear" : "upgrades_needed", upgradesDoneSameDay, doNotContact: dnc.on, newFlow: dispatch.held.has(jobId) });
  } catch (e) {
    console.error("PIESA result route unavailable; sending the standalone copy", jobId, (e as Error).message);
    return ["standalone_copy"];
  }
}

/** When the current PIESA result was recorded (null when unreadable: the standalone copy then goes). */
export async function piesaResultAt(jobId: string): Promise<string | null> {
  try {
    const { data } = await admin.from("piesa_records").select("created_at").eq("job_id", jobId).eq("is_current", true).maybeSingle();
    return data?.created_at ?? null;
  } catch { return null; }
}

export type PiesaDeliveryDeps = { route: (jobId: string) => Promise<PiesaResultRoute[]>; resultAt?: (jobId: string) => Promise<string | null> };

/** Should the owner get the standalone signed copy now? Follows the route, with the 24h safety net (piesa-result-route.core). */
export async function resolveOwnerStandalone(jobId: string, now: Date, ownerDelivered: boolean, deps: PiesaDeliveryDeps): Promise<boolean> {
  const route = await deps.route(jobId);
  const resultAt = route.includes("standalone_copy") || ownerDelivered ? null : await (deps.resultAt ?? piesaResultAt)(jobId);
  return ownerStandaloneDue({ route, resultAt, now, ownerDelivered });
}

export type PiesaDeliveryResult = { jobId: string; hold: string | null; late: boolean; sent: PiesaCopyRecipient[]; held: Record<string, string> };

async function alreadyLogged(jobId: string, eventType: string, details: Record<string, unknown>) {
  const { count } = await admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("event_type", eventType).contains("details", details);
  return !!count;
}

/** Writes both delivery records for one accepted email. The PIISA panel reads official_form_deliveries; readyToInstall reads piesa_deliveries.
 *  Exported for the live full-journey runner only, which records a TEST copy the TEST sender could not deliver (TEST
 *  addresses are never on the send allowlist) as a simulated email on its own qa_test job. */
export async function recordDelivery(p: { jobId: string; recipient: PiesaCopyRecipient; piesaRecordId: string; signedCopyId: string; recipientUserId: string | null; to: string; detail: string }) {
  const at = new Date().toISOString();
  const { error: e1 } = await admin.from("piesa_deliveries").insert({ job_id: p.jobId, piesa_record_id: p.piesaRecordId, recipient: p.recipient, delivered_at: at, method: "email", document_id: null, notes: `Signed PIESA copy ${p.signedCopyId} emailed automatically to ${p.to} (${p.detail})`, recorded_by: null });
  if (e1) throw new Error(`PIESA delivery could not be recorded: ${e1.message}`);
  const { error: e2 } = await admin.from("official_form_deliveries").insert({ job_id: p.jobId, signed_copy_id: p.signedCopyId, recipient_role: p.recipient, recipient_user_id: p.recipientUserId, channel: "email", delivered_at: at, recorded_by: null });
  if (e2) throw new Error(`Official form delivery could not be recorded: ${e2.message}`);
  await logEvent(p.jobId, null, PIESA_COPY_DELIVERED_EVENT, `Signed PIESA copy delivered to ${p.recipient} (email, automatic) at ${at}`, { piesa_record_id: p.piesaRecordId, signed_copy_id: p.signedCopyId, recipient: p.recipient, to: p.to });
}

/** Emails the signed PIESA copy to whoever hasn't got it yet, then records the deliveries. Safe to call every tick. */
export async function deliverPiesaCopies(jobId: string, now = new Date(), deps: PiesaDeliveryDeps = { route: ownerPiesaRoute, resultAt: piesaResultAt }): Promise<PiesaDeliveryResult> {
  const out: PiesaDeliveryResult = { jobId, hold: null, late: false, sent: [], held: {} };
  const { data: job } = await admin.from("jobs").select("id, job_number, source, stage, deleted_at, qa_archived_at, owners(full_name, email), properties(address_line, suburb)").eq("id", jobId).maybeSingle();
  if (!job) return { ...out, hold: "job not found" };
  const { isClosedOrArchivedJob } = await import("./mitti.core");
  const { currentCopy } = await import("./official-forms.server");
  const pe = await currentCopy(jobId, "piesa");
  if (pe.unavailable) return { ...out, hold: "signed-copy storage not set up" };
  const [{ data: rec }, { data: bk }, { data: asg }, { data: link }] = await Promise.all([
    admin.from("piesa_records").select("id").eq("job_id", jobId).eq("is_current", true).maybeSingle(),
    admin.from("bookings").select("scheduled_start").eq("job_id", jobId).eq("kind", "installation").eq("status", "confirmed").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("job_assignments").select("user_id, business_id, profiles:user_id(full_name, email), businesses(email, onboarding_notes)").eq("job_id", jobId).eq("role", "installer").eq("active", true).limit(1).maybeSingle(),
    admin.from("customer_estimate_links").select("token, status, expires_at").eq("job_id", jobId).eq("purpose", "step3_estimate").eq("status", "active").maybeSingle(),
  ]);
  const copyId = pe.copy?.id ?? null;
  const [{ data: pd }, { data: od }] = await Promise.all([
    rec ? admin.from("piesa_deliveries").select("recipient").eq("piesa_record_id", rec.id) : Promise.resolve({ data: [] as { recipient: string }[] }),
    copyId ? admin.from("official_form_deliveries").select("recipient_role").eq("signed_copy_id", copyId) : Promise.resolve({ data: [] as { recipient_role: string }[] }),
  ]);
  const has = (r: PiesaCopyRecipient) => (pd ?? []).some((d) => d.recipient === r) || (od ?? []).some((d) => d.recipient_role === r);
  const owner = job.owners as { full_name: string | null; email: string | null } | null;
  const prof = (asg?.profiles ?? null) as { full_name: string | null; email: string | null } | null;
  const biz = (asg?.businesses ?? null) as { email: string | null; onboarding_notes: string | null } | null;
  const installerEmail = prof?.email?.trim() || biz?.email?.trim() || null;
  // One owner message per result: a new-flow owner's PIESA rides on the clear-to-install / upgrades-needed email, so no standalone owner copy.
  // The 24h safety net: after a day with no owner copy recorded (clear email blocked or never sent), the standalone copy goes anyway.
  const ownerStandalone = await resolveOwnerStandalone(jobId, now, has("owner"), deps);
  const plan = piesaDeliveryPlan({
    ownerStandalone, signedCopyId: copyId, piesaRecordId: rec?.id ?? null, installStart: bk?.scheduled_start ?? null,
    delivered: { owner: has("owner"), installer: has("installer") }, email: { owner: owner?.email?.trim() || null, installer: installerEmail },
    closed: isClosedOrArchivedJob(job),
  }, now);
  out.late = plan.late;
  for (const r of plan.noAddress) out.held[r] = "no email address on file";
  if (plan.hold) return { ...out, hold: plan.hold };

  const { isTestPartner } = await import("./test-send.core");
  const { linkUsable } = await import("./estimatelink.core");
  const { CUSTOMER_BASE } = await import("./engagement.core");
  const { SET_PASSWORD_BASE } = await import("./set-password-link.core");
  const test = job.source === "qa_test" || isTestPartner(biz as never);
  const p = job.properties as { address_line: string | null; suburb: string | null } | null;
  const address = [p?.address_line, p?.suburb].filter(Boolean).join(", ") || null;
  const ownerLink = link && linkUsable(link) ? `${CUSTOMER_BASE}/my-job/${link.token}?screen=piesa` : null;
  if (plan.send.includes('owner') && !ownerLink) return {...out,hold:'owner confirmation link not ready'};
  // The signed PIESA itself goes as the attached PDF (link check, Jo 27 Oct 2026): neither My job nor the installer's job page shows it.
  if (!plan.send.length) return out;
  const officialPdf = await (await import("./official-piesa-pdf.server")).officialPiesaPdf(jobId, job.job_number);
  if (!officialPdf || officialPdf.copyId !== copyId) return { ...out, hold: "signed PIESA PDF not ready — next tick" };
  const attachments = [(await import("./official-piesa-pdf.server")).pdfAttachment(officialPdf)];
  for (const recipient of plan.send) {
    const to = recipient === "owner" ? owner!.email!.trim() : installerEmail!;
    const name = recipient === "owner" ? owner?.full_name : prof?.full_name;
    const mail = renderPiesaCopyEmail({ recipient, firstName: name?.trim().split(/\s+/)[0] ?? null, address, jobNumber: job.job_number, signatureDate: pe.copy?.signatureDate ?? null, installStart: bk?.scheduled_start ?? null, link: recipient === "owner" ? ownerLink : `${SET_PASSWORD_BASE}/field/${jobId}`, test });
    const key = piesaCopyKey(copyId!, recipient);
    if (test) {
      const r = await (await import("./test-send.server")).sendTestEmail({ jobId, jobSource: job.source, partnerIsTest: isTestPartner(biz as never), label: key, actorId: null }, to, mail.subject, mail.html, mail.text, { attachments });
      if (r.status === "sent") { await recordDelivery({ jobId, recipient, piesaRecordId: rec!.id, signedCopyId: copyId!, recipientUserId: recipient === "installer" ? asg?.user_id ?? null : null, to, detail: `TEST ${r.detail}` }); out.sent.push(recipient); }
      else out.held[recipient] = `TEST email ${r.status}: ${r.detail}`;
      continue;
    }
    if (!PIESA_COPY_EMAIL_APPROVED) {
      out.held[recipient] = "held: wording waiting for Jo's approval";
      if (!(await alreadyLogged(jobId, PIESA_COPY_NOT_SENT_EVENT, { signed_copy_id: copyId, recipient })))
        await logEvent(jobId, null, PIESA_COPY_NOT_SENT_EVENT, `Signed PIESA copy for the ${recipient} not sent: wording waiting for Jo's approval (${PIESA_COPY_EMAIL_VERSION})${plan.late ? " — under 24h to the install start" : ""}`, { signed_copy_id: copyId, recipient, version: PIESA_COPY_EMAIL_VERSION, late: plan.late }, { internal: true });
      continue;
    }
    // Approved path (not reachable until Jo approves): owner through the guarded customer email path, installer through the office partner sender.
    let status: string, detail: string;
    if (recipient === "owner") {
      const { assertCustomerDeliveryAllowed } = await import("./comms.server");
      try { await assertCustomerDeliveryAllowed(jobId, "Signed PIESA copy email", "piesa_copy"); } catch (e) { out.held[recipient] = `held: ${(e as Error).message}`; continue; }
      detail = await (await import("./owner-email-send.server")).sendGuardedOwnerEmail({ jobId, jobSource: job.source, to, purpose: "piesa_copy", key, build: () => ({ ...mail, attachments }) });
      status = detail === "sent" ? "sent" : "failed";
    } else {
      const r = await (await import("./office-email.server")).sendOfficeEmail({ actorId: null as unknown as string, recipient: "partner", to, contactName: prof?.full_name ?? null, subject: mail.subject, message: mail.text, label: "piesa_copy", record: { businessId: asg?.business_id ?? null }, html: mail.html, text: mail.text, attachments });
      status = r.status; detail = r.detail;
    }
    if (status === "sent") { await recordDelivery({ jobId, recipient, piesaRecordId: rec!.id, signedCopyId: copyId!, recipientUserId: recipient === "installer" ? asg?.user_id ?? null : null, to, detail }); out.sent.push(recipient); }
    else out.held[recipient] = `${status}: ${detail}`;
  }
  return out;
}

const OVERDUE_LOOKBACK_MS = 60 * 24 * 60 * 60 * 1000;
/** Open jobs whose current PIESA result is past the 24h grace and has no owner delivery row yet. */
async function overdueOwnerCopyJobs(now: Date): Promise<string[]> {
  const from = new Date(now.getTime() - OVERDUE_LOOKBACK_MS).toISOString(), to = new Date(now.getTime() - OWNER_STANDALONE_GRACE_MS).toISOString();
  const { data: recs, error } = await admin.from("piesa_records").select("id, job_id, jobs!inner(stage, deleted_at)").eq("is_current", true).gte("created_at", from).lte("created_at", to)
    .in("jobs.stage", ["piesa_complete", "electrical_variation_pending", "awaiting_deposit_payment", "rectification_scheduling", "rectification_booked", "installation_scheduling"]).is("jobs.deleted_at", null).order("created_at").limit(PIESA_COPY_MAX_PER_TICK * 4);
  if (error) throw new Error(`PIESA copy sweep could not read overdue safety checks: ${error.message}`);
  if (!recs?.length) return [];
  const { data: done, error: e2 } = await admin.from("piesa_deliveries").select("piesa_record_id").eq("recipient", "owner").in("piesa_record_id", recs.map((r) => r.id));
  if (e2) throw new Error(`PIESA copy sweep could not read deliveries: ${e2.message}`);
  const have = new Set((done ?? []).map((d) => d.piesa_record_id));
  return recs.filter((r) => !have.has(r.id)).map((r) => r.job_id);
}

/** 15-minute tick: every job with a confirmed future install booking whose signed PIESA copies aren't both recorded yet. */
export async function sweepPiesaCopyDeliveries(now = new Date()) {
  const { data: bks, error } = await admin.from("bookings").select("job_id, scheduled_start").eq("kind", "installation").eq("status", "confirmed").gt("scheduled_start", now.toISOString()).order("scheduled_start").limit(PIESA_COPY_MAX_PER_TICK * 2);
  if (error) throw new Error(`PIESA copy sweep could not read bookings: ${error.message}`);
  const {data:ready,error:readyError} = await admin.from('jobs').select('id').in('stage',['piesa_complete','electrical_variation_pending','awaiting_deposit_payment','rectification_scheduling','rectification_booked','installation_scheduling']).is('deleted_at',null).limit(PIESA_COPY_MAX_PER_TICK);
  if(readyError) throw new Error('Could not read completed safety checks');
  // Safety net: results older than the 24h grace with no owner copy recorded are always re-visited, so the sweep cannot starve them.
  const overdue = await overdueOwnerCopyJobs(now);
  const ids = [...new Set([...overdue, ...(ready ?? []).map(j=>j.id), ...(bks ?? []).map((b) => b.job_id)])].slice(0, PIESA_COPY_MAX_PER_TICK);
  const out = { checked: ids.length, sent: 0, held: 0, failed: 0 };
  for (const jobId of ids) {
    try {
      const r = await deliverPiesaCopies(jobId, now);
      out.sent += r.sent.length;
      if (Object.keys(r.held).length) out.held++;
    } catch (e) { out.failed++; console.error("piesa copy delivery failed", jobId, (e as Error).message); }
  }
  return out;
}
