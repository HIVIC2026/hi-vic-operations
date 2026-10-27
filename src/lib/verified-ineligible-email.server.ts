// Jo 27 Oct: one approved T7 per job after a final, current office Ready Check decision.
// Uses the existing email ledger/key and normal customer guards; held rows are definitely NOT sent.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { safeReason } from "./ineligible-email";
import { ineligibleKey, INELIGIBLE_PURPOSE, renderPreliminaryIneligibleMail } from "./followups.server";

export async function sendVerifiedIneligibleEmail(jobId: string): Promise<string> {
  const { currentVerification, gatherEvidence } = await import("./verified-eligibility.server");
  const { verificationStale } = await import("./verified-eligibility.core");
  const [v, evidence, { data: job, error: je }] = await Promise.all([
    currentVerification(jobId), gatherEvidence(jobId),
    admin.from("jobs").select("source, stage, deleted_at, qa_archived_at, external_enquiry_id, owners(email)").eq("id", jobId).maybeSingle(),
  ]);
  if (je || !job || job.deleted_at || job.qa_archived_at || ["cancelled", "complete"].includes(job.stage) || !v || v.outcome !== "not_eligible" || !evidence.readyCheck.final || verificationStale(v, { ref: evidence.readyCheck.ref, version: evidence.readyCheck.version })) return "not applicable";
  const key = ineligibleKey(jobId);
  const { data: prior, error: pe } = await admin.from("customer_email_sends").select("id, status").eq("idempotency_key", key).maybeSingle();
  if (pe) throw new Error(pe.message);
  if (prior && prior.status !== "failed") return "already attempted";
  const { MANUAL_SENT_EVENT, manualSendReference } = await import("./manual-communication.core");
  const { data: manual, error: me } = await admin.from("job_communications").select("id").eq("job_id", jobId).eq("source_event", MANUAL_SENT_EVENT).eq("source_reference", manualSendReference("ineligible_result")).limit(1).maybeSingle();
  if (me || manual) return "manual send recorded or unreadable";
  const owner = job.owners as { email: string | null } | null;
  const to = owner?.email ?? "";
  const { assertCustomerDeliveryAllowed } = await import("./comms.server");
  let held: string | null = null;
  try { await assertCustomerDeliveryAllowed(jobId, "Verified not-eligible email"); } catch (e) { held = e instanceof Error ? e.message : String(e); }
  if (!to) held ??= "No owner email";
  if (held) {
    // One durable held record; never overwrite an in-flight/sent reservation during a race.
    if (!prior) {
      const { error } = await admin.from("customer_email_sends").upsert({ job_id: jobId, purpose: INELIGIBLE_PURPOSE, idempotency_key: key, status: "failed", error: `held: ${held}` }, { onConflict: "idempotency_key", ignoreDuplicates: true });
      if (error) throw new Error(error.message);
    }
    return `held: ${held}`;
  }
  // Currency/price text must not leak through an office reason; fall back to approved T7 copy.
  const reason = /[$€£]|\b(?:AUD|GST|price|cost|dollars)\b/i.test(v.reason ?? "") ? null : safeReason(v.reason);
  const mail = await renderPreliminaryIneligibleMail(jobId, reason, job.external_enquiry_id);
  if (!mail) return "held: approved template unavailable";
  if (job.source === "qa_test") {
    const { testSendBlocker } = await import("./test-send.core");
    const { data: assignment, error: ae } = await admin.from("job_assignments").select("businesses(onboarding_notes)").eq("job_id", jobId).eq("role", "installer").eq("active", true).maybeSingle();
    const { isTestPartner } = await import("./test-send.core");
    const partnerIsTest = !ae && isTestPartner(assignment?.businesses as { onboarding_notes: string | null } | null);
    const blocked = testSendBlocker({ channel: "email", to, jobSource: job.source, partnerIsTest });
    if (blocked) return `blocked: ${blocked}`;
    const claim = prior
      ? await admin.from("customer_email_sends").update({ status: "sending", error: null }).eq("id", prior.id).eq("status", "failed").select("id").maybeSingle()
      : await admin.from("customer_email_sends").insert({ job_id: jobId, purpose: INELIGIBLE_PURPOSE, idempotency_key: key }).select("id").single();
    if (claim.error || !claim.data) return "already attempted";
    // Re-check the master and consent after claiming, before the TEST provider boundary.
    try { await assertCustomerDeliveryAllowed(jobId, "Verified not-eligible email"); }
    catch (e) { await admin.from("customer_email_sends").update({ status: "failed", error: `held: ${String(e)}` }).eq("id", claim.data.id); return "held"; }
    const r = await (await import("./test-send.server")).sendTestEmail({ jobId, jobSource: job.source, partnerIsTest, label: key, actorId: v.recorded_by }, to, mail.subject, mail.html, mail.plainText);
    const status = r.status === "sent" ? "sent" : r.detail.includes("sent_unknown") ? "delivered_unrecorded" : "failed";
    await admin.from("customer_email_sends").update({ status, error: r.status === "sent" ? null : r.detail, sent_at: r.status === "sent" ? new Date().toISOString() : null }).eq("id", claim.data.id);
    return r.status;
  }
  // The normal sender retains opt-outs, suppression, allowlist, unsubscribe and atomic once-only claims.
  return (await import("./owner-email-send.server")).sendGuardedOwnerEmail({ jobId, jobSource: job.source, to, purpose: INELIGIBLE_PURPOSE, key, retryAfterDefiniteFailure: true,
    build: () => ({ subject: mail.subject, html: mail.html, text: mail.plainText }),
  });
}

/** Retry only durable held records created by this path, not historical failures/backlog. */
export async function retryHeldVerifiedIneligibleEmails(limit = 20) {
  const { customerCommsEnabled } = await import("./comms.server");
  if (!(await customerCommsEnabled())) return;
  const { data, error } = await admin.from("customer_email_sends").select("job_id").eq("purpose", INELIGIBLE_PURPOSE).eq("status", "failed").like("error", "held:%").order("created_at", { ascending: true }).limit(limit);
  if (error) throw new Error(error.message);
  for (const row of data ?? []) await sendVerifiedIneligibleEmail(row.job_id).catch((e) => console.error("Verified ineligible email remains held", row.job_id, String(e)));
}