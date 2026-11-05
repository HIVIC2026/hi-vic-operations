// Stage 7 (Jo 22 Oct 2026): incomplete Ready Check form → record what's missing (once per distinct gap list)
// and try the dormant installer text. After 24h the office list shows "Chase installer" (needs.server).
// The text is fail-closed: default-OFF Mitti switch, test jobs refused, unapproved wording never sends.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import { readyCheckFactsFromEntries } from "./ready-check-complete.core";
import { READY_CHECK_CHASE_EMAIL_APPROVED, chaseEmailKey, chaseEmailPlan, incompleteDecision, missingSignature, readyCheckIncompleteText, readyCheckNearlyThereEmail } from "./ready-check-chase.core";
import { mittiFormUrl } from "./mitti-link.core";

export async function recordReadyCheckProgress(p: {
  jobId: string; actorId: string | null; auditId: string; entries: { label: string; value: unknown }[];
  completed: boolean; modifiedAt: string | null; priced: boolean; now?: Date;
}): Promise<{ status: "clean" | "waiting" | "recorded" | "unchanged"; missing: string[] }> {
  // Decision 278: the A1 price/electrician come from the business owner's portal entry first (old forms as fallback).
  const entries = p.priced ? await (await import("./installer-price.server")).entriesWithInstallerPrice(p.jobId, p.entries) : p.entries;
  // Decision 289: the electrician is chosen at Add a job (recorded choice, else the usual electrician, else Home Insulation
  // Victoria's) — never a missing form answer any more, so it is never chased.
  const price = entries.find((e) => /^total quoted price/i.test(String(e.label ?? "").trim()))?.value;
  const facts = readyCheckFactsFromEntries(entries, {
    formComplete: p.completed,
    electricianDecided: true,
    priceKnown: p.priced ? price != null && String(price).trim() !== "" : true,
  });
  const { data: visit } = await admin.from("bookings").select("scheduled_start").eq("job_id", p.jobId).eq("kind", "ready_check").in("status", ["confirmed", "completed"]).order("scheduled_start", { ascending: false }).limit(1).maybeSingle();
  const d = incompleteDecision({ completed: p.completed, modifiedAt: p.modifiedAt, visitAt: visit?.scheduled_start ?? null, now: p.now ?? new Date(), facts });
  const { data: last } = await admin.from("workflow_events").select("event_type, details").eq("job_id", p.jobId).in("event_type", ["ready_check_incomplete", "ready_check_incomplete_cleared"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!d.missing.length) {
    if (last?.event_type === "ready_check_incomplete") await logEvent(p.jobId, p.actorId, "ready_check_incomplete_cleared", "Ready Check form now has everything the installer needed to add", { audit_id: p.auditId }, { internal: true });
    return { status: "clean", missing: [] };
  }
  if (!d.notify) return { status: "waiting", missing: d.missing };
  const sig = missingSignature(d.missing);
  if (last?.event_type === "ready_check_incomplete" && (last.details as { signature?: string } | null)?.signature === sig) return { status: "unchanged", missing: d.missing };
  await logEvent(p.jobId, p.actorId, "ready_check_incomplete", `Ready Check form is missing: ${d.missing.join("; ")}`, { audit_id: p.auditId, missing: d.missing, signature: sig }, { internal: true });
  // Decision #27: with the flag on the chase is an office EMAIL and no text; off keeps the earlier text (one version per chase).
  const foundAt = (p.now ?? new Date()).toISOString();
  await (READY_CHECK_CHASE_EMAIL_APPROVED ? emailInstallerOffice(p.jobId, p.actorId, p.auditId, d.missing, sig) : textInstaller(p.jobId, p.auditId, d.missing, sig, foundAt)).catch(() => undefined);
  return { status: "recorded", missing: d.missing };
}

/** Decision 165: `foundAt` is when this gap list was recorded; the sender holds the text as "too late" after 24h, and a
 *  held attempt no longer uses up the audit's key (a new gap list gets a new signature and key anyway). */
async function textInstaller(jobId: string, auditId: string, missing: string[], sig: string, foundAt: string) {
  // A revision already emailed (flag was on) is never texted as well.
  const { data: emailed } = await admin.from("customer_email_sends").select("id").eq("job_id", jobId).eq("idempotency_key", chaseEmailKey(jobId, auditId, sig)).maybeSingle();
  if (emailed) return { status: "already_emailed" };
  const { data: settings } = await admin.from("workflow_settings").select("mitti_auto_quote_enabled").eq("id", 1).maybeSingle();
  if ((settings as { mitti_auto_quote_enabled?: boolean } | null)?.mitti_auto_quote_enabled !== true) return { status: "off" };
  const { data: j } = await admin.from("jobs").select("source, job_number, properties(address_line, suburb)").eq("id", jobId).maybeSingle();
  if (!j || j.source === "qa_test") return { status: "test_or_missing" };
  const { data: asg } = await admin.from("job_assignments").select("business_id").eq("job_id", jobId).eq("role", "installer").eq("active", true).limit(1).maybeSingle();
  if (!asg?.business_id) return { status: "no_installer" };
  const { data: b } = await admin.from("businesses").select("signer_mobile, phone").eq("id", asg.business_id).maybeSingle();
  const prop = j.properties as { address_line: string | null; suburb: string | null } | null;
  return (await import("./sms.server")).sendRealSms({ type: "ready_check_incomplete", jobId, businessId: asg.business_id,
    idempotencyKey: `ready-check-incomplete:v1:${jobId}:${auditId}:${sig}`, to: b?.signer_mobile ?? b?.phone,
    body: readyCheckIncompleteText(j.job_number, [prop?.address_line, prop?.suburb].filter(Boolean).join(", ") || null, missing),
    event: { at: foundAt } });
}

/** Decision #27 (Jo 2 Nov 2026): the "Nearly there" chase goes to the installer's business OFFICE email (businesses.email), never a
 *  worker's address. No office email → nothing sent, one internal office note per revision. A revision already texted is not emailed. */
async function emailInstallerOffice(jobId: string, actorId: string | null, auditId: string, missing: string[], sig: string) {
  const { data: settings } = await admin.from("workflow_settings").select("mitti_auto_quote_enabled").eq("id", 1).maybeSingle();
  if ((settings as { mitti_auto_quote_enabled?: boolean } | null)?.mitti_auto_quote_enabled !== true) return { status: "off" };
  const { data: j } = await admin.from("jobs").select("source, job_number, properties(address_line, suburb), owners(full_name, phone)").eq("id", jobId).maybeSingle();
  if (!j) return { status: "missing" };
  const { data: asg } = await admin.from("job_assignments").select("business_id").eq("job_id", jobId).eq("role", "installer").eq("active", true).limit(1).maybeSingle();
  if (!asg?.business_id) return { status: "no_installer" };
  const { data: b } = await admin.from("businesses").select("email, name, trading_name").eq("id", asg.business_id).maybeSingle();
  const textKey = `ready-check-incomplete:v1:${jobId}:${auditId}:${sig}`;
  const { data: texted } = await admin.from("sms_messages").select("id").eq("idempotency_key", textKey).maybeSingle();
  const plan = chaseEmailPlan({ approved: READY_CHECK_CHASE_EMAIL_APPROVED, test: j.source === "qa_test", officeEmail: b?.email, textAlreadySent: !!texted });
  if (plan.action === "held") {
    await logEvent(jobId, actorId, "ready_check_chase_email_held", `"Nearly there" email not sent — ${plan.reason}. Add it on the business, or chase by phone.`, { audit_id: auditId, signature: sig, reason: plan.reason }, { internal: true });
    return { status: "held" };
  }
  if (plan.action !== "send" && plan.action !== "test_send") return { status: plan.action };
  const key = chaseEmailKey(jobId, auditId, sig);
  if (plan.action === "test_send" && await (await import("./qa-inbox.server")).qaDeliveryHeld(jobId)) return { status: "test_delivery_held" };
  const claim = await admin.from("customer_email_sends").insert({ job_id: jobId, purpose: "ready_check_nearly_there_office", idempotency_key: key }).select("id").maybeSingle();
  if (claim.error || !claim.data) return { status: "already_attempted" };
  const prop = j.properties as { address_line: string | null; suburb: string | null } | null;
  const owner = (Array.isArray(j.owners) ? j.owners[0] : j.owners) as { full_name: string | null; phone: string | null } | null;
  const m = readyCheckNearlyThereEmail({ jobNumber: j.job_number, address: [prop?.address_line, prop?.suburb].filter(Boolean).join(", "), missing, mittiFormUrl: mittiFormUrl(auditId), contactName: ((b as { trading_name?: string | null } | null)?.trading_name ?? "").trim() || b?.name || null, owner: owner?.full_name ?? null, mobile: owner?.phone ?? null, test: plan.action === "test_send" });
  const r = plan.action === "test_send"
    ? await (await import("./test-send.server")).sendTestEmail({ jobId, jobSource: j.source, partnerIsTest: true, label: key, actorId: null }, plan.to, m.subject, m.html, m.text)
    : await (await import("./office-email.server")).sendOfficeEmail({ actorId: null, recipient: "partner", to: plan.to, contactName: b?.name ?? null, subject: m.subject, message: m.text, label: "ready_check_nearly_there", record: { businessId: asg.business_id }, html: m.html, text: m.text, idempotencyKey: key });
  // The claim row stays either way (a revision is attempted once); only its status records the outcome.
  await admin.from("customer_email_sends").update({ status: r.status === "sent" ? "sent" : "failed", sent_at: r.status === "sent" ? new Date().toISOString() : null, error: r.status === "sent" ? null : r.detail ?? null }).eq("id", claim.data.id);
  return { status: r.status };
}
