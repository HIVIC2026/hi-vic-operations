// Jo 28 Oct 2026: crew reminder sweep (15-minute tick). Rules + wording in crew-reminder.core.ts.
// One email per job + install date to the installing business's own email, recorded as a workflow event BEFORE sending.
// TEST businesses/jobs use the existing test-send path; real sends wait for CREW_REMINDER_EMAIL_APPROVED (draft wording).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import { formatPropertyAddress } from "./address";
import { CREW_REMINDER_EMAIL_APPROVED, CREW_REMINDER_EVENT, crewReminderDue, crewReminderEmail, crewReminderKey, installDateOf } from "./crew-reminder.core";

const PORTAL = "https://portal.homeinsulationvictoria.com.au";

export async function sweepCrewReminders(now = new Date()) {
  const out = { checked: 0, sent: 0, test: 0, held: 0, skipped: 0 };
  const until = new Date(now.getTime() + 36 * 3600_000).toISOString();
  const { data: books, error } = await admin.from("bookings").select("job_id, scheduled_start, status").eq("kind", "installation").neq("status", "cancelled").gt("scheduled_start", now.toISOString()).lte("scheduled_start", until);
  if (error) throw new Error(`Install bookings could not be read: ${error.message}`);
  for (const b of books ?? []) {
    if (!b.scheduled_start || !crewReminderDue(b.scheduled_start, now)) continue;
    out.checked++;
    try { out[await remindOne(b.job_id, b.scheduled_start)]++; }
    catch (e) { console.error("crew reminder failed", b.job_id, (e as Error).message); out.skipped++; }
  }
  return out;
}

async function remindOne(jobId: string, start: string): Promise<"sent" | "test" | "held" | "skipped"> {
  const installDate = installDateOf(start);
  const key = crewReminderKey(jobId, installDate);
  const [{ data: crew }, { data: done }] = await Promise.all([
    admin.from("workflow_events").select("id").eq("job_id", jobId).eq("event_type", "piisa_crew_selected").limit(1),
    admin.from("workflow_events").select("id").eq("job_id", jobId).eq("event_type", CREW_REMINDER_EVENT).contains("details", { key }).limit(1),
  ]);
  if ((crew ?? []).length || (done ?? []).length) return "skipped";
  const { data: job } = await admin.from("jobs").select("source, property_id").eq("id", jobId).maybeSingle();
  const { data: asg } = await admin.from("job_assignments").select("business_id").eq("job_id", jobId).eq("role", "installer").eq("active", true).maybeSingle();
  if (!job || !asg?.business_id) return "skipped";
  const [{ data: biz }, { data: prop }] = await Promise.all([
    admin.from("businesses").select("name, email, onboarding_notes").eq("id", asg.business_id).maybeSingle(),
    job.property_id ? admin.from("properties").select("address_line, suburb, state, postcode").eq("id", job.property_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const to = biz?.email?.trim();
  if (!to) return "skipped";
  const { isTestPartner } = await import("./test-send.core");
  const test = job.source === "qa_test" || isTestPartner(biz ?? {});
  if (!test && !CREW_REMINDER_EMAIL_APPROVED) return "held"; // nothing recorded, so it can still go once Jo approves
  const address = formatPropertyAddress(prop as never);
  const shortAddress = prop?.address_line?.trim() || address;
  const copy = crewReminderEmail({ shortAddress, address, jobLink: `${PORTAL}/field/${jobId}` });
  // Recorded BEFORE sending: a second tick (or a retry) finds it and never sends again.
  await logEvent(jobId, null, CREW_REMINDER_EVENT, `Crew reminder email to ${biz?.name ?? "the installer"} for the ${installDate} install`, { key, install_date: installDate, to, test }, { internal: true });
  const { partnerEmailLayout } = await import("./partner-email.core");
  const mail = partnerEmailLayout({ subject: copy.subject, blocks: [{ kind: "p", text: copy.body }], test });
  if (test) {
    const { sendTestEmail } = await import("./test-send.server");
    await sendTestEmail({ jobId, jobSource: job.source ?? null, partnerIsTest: true, label: "crew_reminder", actorId: null }, to, copy.subject, mail.html, mail.text);
    return "test";
  }
  const { sendOfficeEmail } = await import("./office-email.server");
  await sendOfficeEmail({ actorId: null, recipient: "partner", to, contactName: biz?.name ?? null, subject: copy.subject, message: copy.body, label: key, record: { businessId: asg.business_id }, html: mail.html, text: mail.text });
  return "sent";
}
