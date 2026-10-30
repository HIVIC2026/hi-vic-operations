// Crew reminder email sweep (Jo 28 Oct 2026), run from the existing 15-minute allocation tick. Rules + wording in
// crew-reminder.core.ts. Once per job + install date: the `crew_reminder_email` workflow event (with the key) is recorded
// BEFORE anything is sent. TEST jobs / TEST businesses → the existing test-send path only. Real installers → nothing at
// all until CREW_REMINDER_EMAIL_APPROVED (Jo approves the rendered email); then the existing guarded partner sender.
// Never changes a stage, a booking or the crew; never throws to the tick per job.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import { savedCrewNeedsRepick, type CrewSelection } from "./piisa-a3.core";
import { CREW_REMINDER_EMAIL_APPROVED, CREW_REMINDER_EVENT, crewReminderBlocker, crewReminderEmail, crewReminderKey, installYmd } from "./crew-reminder.core";

type Booking = { id: string; job_id: string; kind: string; status: string; scheduled_start: string };

export async function sweepCrewReminders(now = new Date(), opts: { approved?: boolean; jobIds?: string[] } = {}) {
  const approved = opts.approved ?? CREW_REMINDER_EMAIL_APPROVED;
  const until = new Date(now.getTime() + 48 * 3600_000).toISOString();
  let q = admin.from("bookings").select("id, job_id, kind, status, scheduled_start").eq("kind", "installation").neq("status", "cancelled").gte("scheduled_start", now.toISOString()).lte("scheduled_start", until);
  if (opts.jobIds?.length) q = q.in("job_id", opts.jobIds);
  const { data, error } = await q;
  if (error) throw new Error(`Install bookings could not be read: ${error.message}`);
  const out: { jobId: string; outcome: string }[] = [];
  for (const b of (data ?? []) as Booking[]) {
    try { out.push({ jobId: b.job_id, outcome: await remindOne(b, now, approved) }); }
    catch (e) { out.push({ jobId: b.job_id, outcome: `failed: ${(e as Error).message}` }); }
  }
  return { checked: out.length, sent: out.filter((o) => o.outcome.startsWith("email")).length, results: out };
}

async function remindOne(b: Booking, now: Date, approved: boolean): Promise<string> {
  const day = installYmd(b.scheduled_start);
  const key = crewReminderKey(b.job_id, day);
  const [{ data: job }, { data: crew }, { data: prior }, { data: asg }] = await Promise.all([
    admin.from("jobs").select("id, job_number, source, deleted_at, properties(address_line, suburb, postcode)").eq("id", b.job_id).maybeSingle(),
    admin.from("workflow_events").select("details").eq("job_id", b.job_id).eq("event_type", "piisa_crew_selected").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("workflow_events").select("id").eq("job_id", b.job_id).eq("event_type", CREW_REMINDER_EVENT).contains("details", { key }).limit(1),
    admin.from("job_assignments").select("business_id").eq("job_id", b.job_id).eq("role", "installer").eq("active", true).limit(1).maybeSingle(),
  ]);
  const j = job as { id: string; job_number: string; source: string | null; deleted_at: string | null; properties: { address_line: string | null; suburb: string | null; postcode: string | null } | null } | null;
  if (!j) return "skipped: job not found";
  const bizId = (asg as { business_id: string | null } | null)?.business_id ?? null;
  const { data: biz } = bizId ? await admin.from("businesses").select("id, name, email, onboarding_notes").eq("id", bizId).maybeSingle() : { data: null };
  const bz = biz as { id: string; name: string | null; email: string | null; onboarding_notes: string | null } | null;
  // Jo 29 Oct 2026: an old saved crew (typed-in Lead, or more than Lead + 2) has to be picked again, so it still gets the reminder.
  const selection = ((crew as { details: { selection?: CrewSelection } | null } | null)?.details?.selection) ?? null;
  const crewSelected = !!selection && !savedCrewNeedsRepick(selection);
  const blocker = crewReminderBlocker({ bookingKind: b.kind, bookingStatus: b.status, scheduledStart: b.scheduled_start, crewSelected, alreadySent: (prior ?? []).length > 0, jobDeleted: !!j.deleted_at, businessEmail: bz?.email ?? null }, now);
  if (blocker) return `skipped: ${blocker}`;
  const { isTestPartner } = await import("./test-send.core");
  const partnerIsTest = isTestPartner(bz ?? {});
  const test = j.source === "qa_test" || partnerIsTest;
  // Real installers only once Jo approves the rendered email; until then nothing is recorded or sent for them.
  if (!test && !approved) return "skipped: wording not approved yet";
  // Jo 30 Oct 2026: "Pause all trade messages" — held before the claim below, so a later tick can still send it.
  if (!test) { const tradePaused = await (await import("./trade-pause.server")).tradeMessagesPausedNow(); if (tradePaused) return `held: ${tradePaused}`; }
  const { installerTextAddress } = await import("./installer-texts.core");
  const p = j.properties;
  const short = installerTextAddress(p?.address_line, p?.suburb) ?? j.job_number;
  const full = [p?.address_line?.trim(), [p?.suburb?.trim(), p?.postcode?.trim()].filter(Boolean).join(" ")].filter(Boolean).join(", ") || short;
  const { TEST_APP_BASE } = await import("./test-send.server");
  const { SET_PASSWORD_BASE } = await import("./set-password-link.core");
  const mail = crewReminderEmail({ shortAddress: short, address: full, jobLink: `${test ? TEST_APP_BASE : SET_PASSWORD_BASE}/field/${j.id}` });
  const to = bz!.email!.trim().toLowerCase();
  // Claimed once, before any send: the next tick finds this event and stops.
  await logEvent(j.id, null, CREW_REMINDER_EVENT, `Crew reminder email to the installing business for the ${day} install`, { key, install_date: day, booking_id: b.id, business_id: bz!.id, to, test }, { internal: true });
  const { partnerEmailLayout } = await import("./partner-email.core");
  const rendered = partnerEmailLayout({ subject: mail.subject, blocks: [{ kind: "p", text: mail.body }], test });
  if (test) {
    const { sendTestEmail } = await import("./test-send.server");
    const r = await sendTestEmail({ jobId: j.id, jobSource: j.source, partnerIsTest, label: `crew_reminder:${day}`, actorId: null }, to, mail.subject, rendered.html, rendered.text);
    return `email (test) ${r.status}: ${r.detail}`;
  }
  const { sendOfficeEmail } = await import("./office-email.server");
  const r = await sendOfficeEmail({ actorId: null, recipient: "partner", to, contactName: bz!.name, subject: mail.subject, message: mail.body, html: rendered.html, text: rendered.text, label: key, record: { businessId: bz!.id } });
  return `email ${r.status}: ${r.detail}`;
}
