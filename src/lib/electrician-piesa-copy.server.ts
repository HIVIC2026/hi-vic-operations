// Decision 317 (Jo, 25 Oct 2026): email the assigned electrician the final official PIESA (PDF attached) — once when
// the official PIESA is first ready, once more when it is regenerated after the fixes (post_rectification / A4).
// Rules + wording: electrician-piesa-copy.core.ts. PDF: official-piesa-pdf.server.ts (the same document as the /field
// download). One key per PIESA record; the `electrician_piesa_copy_sent` event is recorded BEFORE anything is sent,
// so a second call or the sweep never sends twice. TEST jobs / TEST partners → test-send only; real electricians →
// the partner sender `sendOfficeEmail` (paused with the master switch: a paused real send is not claimed, so it goes
// once the switch is back on). Called from the A4 completion (fixes-day.server) and the 15-minute tick. Never throws
// to its caller; never changes a stage, a booking or a record. The owner/installer O28 path is separate.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import {
  ELECTRICIAN_PIESA_EMAIL_APPROVED, ELECTRICIAN_PIESA_EVENT, ELECTRICIAN_PIESA_LABEL, ELECTRICIAN_PIESA_MAX_PER_TICK, ELECTRICIAN_PIESA_NOT_SENT_EVENT,
  ELECTRICIAN_PIESA_SWEEP_DAYS, electricianPiesaKey, electricianPiesaPlan, renderElectricianPiesaEmail,
} from "./electrician-piesa-copy.core";

type Asg = { user_id: string | null; business_id: string | null; profiles: { full_name: string | null; email: string | null } | null; businesses: { email: string | null; onboarding_notes: string | null } | null };

export async function sendElectricianPiesaCopy(jobId: string): Promise<string> {
  try {
    const { data: job } = await admin.from("jobs").select("id, job_number, source, stage, deleted_at, qa_archived_at, properties(address_line, suburb)").eq("id", jobId).maybeSingle();
    if (!job) return "skipped: job not found";
    const { isClosedOrArchivedJob } = await import("./mitti.core");
    const { currentCopy } = await import("./official-forms.server");
    const [pe, { data: rec }, { data: asgRow }] = await Promise.all([
      currentCopy(jobId, "piesa").catch(() => ({ copy: null, unavailable: true })),
      admin.from("piesa_records").select("id, kind, created_at").eq("job_id", jobId).eq("is_current", true).maybeSingle(),
      admin.from("job_assignments").select("user_id, business_id, profiles:user_id(full_name, email), businesses(email, onboarding_notes)").eq("job_id", jobId).eq("role", "electrician").eq("active", true).limit(1).maybeSingle(),
    ]);
    const asg = (asgRow ?? null) as unknown as Asg | null;
    const key = rec ? electricianPiesaKey(rec.id) : null;
    const { count: sent } = key ? await admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("event_type", ELECTRICIAN_PIESA_EVENT).contains("details", { key }) : { count: 0 };
    const to = asg ? asg.profiles?.email?.trim() || asg.businesses?.email?.trim() || null : null;
    const plan = electricianPiesaPlan({
      closed: isClosedOrArchivedJob(job),
      copy: pe.copy ? { id: pe.copy.id, signedAt: pe.copy.snapshot?.serverTimestamp ?? null } : null,
      record: rec ? { id: rec.id, kind: rec.kind, createdAt: rec.created_at } : null,
      electrician: asg ? { email: to } : null,
      alreadySent: !!sent,
    });
    if (!plan.send) return `skipped: ${plan.reason}`;
    const { isTestPartner } = await import("./test-send.core");
    const partnerIsTest = isTestPartner(asg?.businesses ?? null);
    const test = job.source === "qa_test" || partnerIsTest;
    if (!test) {
      if (!ELECTRICIAN_PIESA_EMAIL_APPROVED) return "held: wording waiting for Jo's approval";
      // Paused with the partner-email master switch: not claimed, so the sweep sends it once the switch is on again.
      const { customerCommsEnabled } = await import("./comms.server");
      if (!(await customerCommsEnabled())) return "held: partner emails paused (master switch off)";
    }
    const pdf = await (await import("./official-piesa-pdf.server")).officialPiesaPdf(jobId, job.job_number);
    if (!pdf || pdf.copyId !== plan.copyId) return "skipped: official PIESA changed while preparing — next tick";
    const p = job.properties as { address_line: string | null; suburb: string | null } | null;
    const address = [p?.address_line, p?.suburb].filter(Boolean).join(", ") || null;
    const mail = renderElectricianPiesaEmail({ address, jobNumber: job.job_number, version: plan.version, test });
    // Claimed once, before any send.
    await logEvent(jobId, null, ELECTRICIAN_PIESA_EVENT, `Electrician emailed the official PIESA${plan.version === "after_fixes" ? " (after the fixes)" : ""} (decision 317)${test ? " — TEST" : ""}`,
      { key: plan.key, piesa_record_id: plan.recordId, signed_copy_id: plan.copyId, version: plan.version, to, business_id: asg?.business_id ?? null, test }, { internal: true });
    const { pdfAttachment } = await import("./official-piesa-pdf.server");
    const attachments = [pdfAttachment(pdf)];
    let status: string, detail: string;
    if (test) {
      const r = await (await import("./test-send.server")).sendTestEmail({ jobId, jobSource: job.source, partnerIsTest, label: plan.key, actorId: null }, to!, mail.subject, mail.html, mail.text, { attachments });
      status = r.status; detail = r.detail;
    } else {
      const r = await (await import("./office-email.server")).sendOfficeEmail({ actorId: null, recipient: "partner", to: to!, contactName: asg?.profiles?.full_name ?? null, subject: mail.subject, message: mail.text, label: ELECTRICIAN_PIESA_LABEL, record: { businessId: asg?.business_id ?? null }, html: mail.html, text: mail.text, attachments });
      status = r.status; detail = r.detail;
    }
    if (status !== "sent") await logEvent(jobId, null, ELECTRICIAN_PIESA_NOT_SENT_EVENT, `Official PIESA email to the electrician not sent (${status}): ${detail}`.slice(0, 500), { key: plan.key, status, detail }, { internal: true });
    return `electrician PIESA ${test ? "(test) " : ""}${status}: ${detail}`;
  } catch (e) { return `electrician PIESA not sent — ${(e as Error).message}`; }
}

/** 15-minute tick: every job whose current official PIESA was signed in the last ELECTRICIAN_PIESA_SWEEP_DAYS days. */
export async function sweepElectricianPiesaCopies(now = new Date()) {
  const since = new Date(now.getTime() - ELECTRICIAN_PIESA_SWEEP_DAYS * 86_400_000).toISOString();
  const db = admin as unknown as { from: (t: string) => any };
  const { data, error } = await db.from("official_form_signed_copies").select("job_id").eq("form_key", "piesa").eq("status", "current").gte("created_at", since).order("created_at", { ascending: false }).limit(ELECTRICIAN_PIESA_MAX_PER_TICK * 2);
  if (error) {
    if (["42P01", "PGRST205", "PGRST204"].includes(error.code ?? "")) return { checked: 0, sent: 0, skipped: 0, note: "signed-copy storage not set up" };
    throw new Error(`Electrician PIESA sweep could not read official copies: ${error.message}`);
  }
  const ids = [...new Set(((data ?? []) as { job_id: string }[]).map((r) => r.job_id))].slice(0, ELECTRICIAN_PIESA_MAX_PER_TICK);
  const out = { checked: ids.length, sent: 0, skipped: 0 };
  for (const jobId of ids) {
    const r = await sendElectricianPiesaCopy(jobId);
    if (/ sent: /.test(r)) out.sent++; else out.skipped++;
  }
  return out;
}
