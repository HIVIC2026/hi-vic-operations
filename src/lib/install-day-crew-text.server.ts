// Decision 411 (Jo 27 Oct 2026): on install day, from the daily text time (6:30am), the chosen Lead installer AND each
// chosen crew member get the approved install-day text on their OWN mobile, with their own safety documents link
// (/sp/<token>: SWMS + PIESA result + hazards). Pure rules/wording: worker-role.core.ts.
// Same shape as swms-sign-text.server: ONE `install_day_crew_texted` workflow event per person per install date is
// recorded BEFORE anything is sent (never sent twice); TEST job / TEST partner → test-send only; real → the ONE real SMS
// sender (`sendRealSms`: switch, wording approval, STOP and partner consent live there).
// No texts after 8pm: `installDayTextDue` only allows the install date between the send time and 20:00 Melbourne.
// Never changes a booking, the plan, a signature or a stage. Run from the 15-minute tick via `sweepInstallerTexts`.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import { INSTALL_DAY_CREW_EVENT, INSTALL_DAY_CREW_SMS_TYPE, installDayCrewKey, installDayCrewText, installDayRecipients, installDayTextDue, type CrewPerson } from "./worker-role.core";

type Pick = unknown;
const pickedWorkerId = (p: Pick): string | null =>
  typeof p === "string" ? p : p && typeof p === "object" && "workerId" in p ? String((p as { workerId: string }).workerId) : null;

/** Lead + crew with worker records from the job's saved install crew, with names and mobiles from the staff list. */
async function crewForJob(jobId: string, businessId: string): Promise<{ lead: CrewPerson | null; crew: CrewPerson[] }> {
  const { loadCrew } = await import("./piisa-a3.server");
  const { selection } = await loadCrew(jobId);
  if (!selection) return { lead: null, crew: [] };
  const leadId = pickedWorkerId(selection.lead);
  const crewIds = (selection.additional ?? []).map(pickedWorkerId).filter((x): x is string => !!x);
  const ids = [...new Set([leadId, ...crewIds].filter((x): x is string => !!x))];
  if (!ids.length) return { lead: null, crew: [] };
  const { data } = await admin.from("partner_workers").select("id, full_legal_name, mobile").eq("business_id", businessId).is("removed_at", null).in("id", ids);
  const by = new Map((data ?? []).map((w) => [w.id, w]));
  const person = (id: string | null, role: "lead" | "crew"): CrewPerson | null => {
    const w = id ? by.get(id) : null;
    return w ? { workerId: w.id, name: w.full_legal_name, mobile: w.mobile ?? null, role } : null;
  };
  return { lead: person(leadId, "lead"), crew: crewIds.map((id) => person(id, "crew")).filter((x): x is CrewPerson => !!x) };
}

export async function textInstallDayCrew(jobId: string, booking: { id: string; scheduled_start: string }, now = new Date(), sendTime = "06:30"): Promise<string[]> {
  if (!installDayTextDue(booking.scheduled_start, now.toISOString(), sendTime)) return ["not due"];
  const [{ data: job }, { data: asg }] = await Promise.all([
    admin.from("jobs").select("id, source, deleted_at, installation_completed_at, properties(address_line, suburb)").eq("id", jobId).maybeSingle(),
    admin.from("job_assignments").select("business_id").eq("job_id", jobId).eq("role", "installer").eq("active", true).limit(1).maybeSingle(),
  ]);
  if (!job || job.deleted_at || job.installation_completed_at || !asg?.business_id) return ["skipped"];
  const { data: biz } = await admin.from("businesses").select("id, onboarding_notes").eq("id", asg.business_id).maybeSingle();
  const { isTestPartner } = await import("./test-send.core");
  const partnerIsTest = isTestPartner(biz ?? {});
  const test = job.source === "qa_test" || partnerIsTest;
  const { lead, crew } = await crewForJob(jobId, asg.business_id);
  const people = installDayRecipients(lead, crew);
  if (!people.length) return ["no crew chosen"];
  const { data: ev } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", INSTALL_DAY_CREW_EVENT);
  const recorded = new Set((ev ?? []).map((r) => String((r.details as { key?: unknown } | null)?.key ?? "")).filter(Boolean));
  const { toAuE164 } = await import("./sms.core");
  const { installerTextAddress } = await import("./installer-texts.core");
  const { swmsSignLink } = await import("./swms-link.server");
  const props = job.properties as { address_line: string | null; suburb: string | null } | null;
  const address = installerTextAddress(props?.address_line, props?.suburb);
  const out: string[] = [];
  for (const p of people) {
    const key = installDayCrewKey(jobId, p.workerId, booking.scheduled_start);
    if (recorded.has(key)) continue;
    const to = toAuE164(p.mobile);
    if (!to) { out.push(`${p.name}: no mobile`); continue; }
    try {
      const body = installDayCrewText({ name: p.name, startIso: booking.scheduled_start, address, leadName: lead?.name ?? null, link: await swmsSignLink(jobId, `w:${p.workerId}`, now.getTime()) });
      // Recorded BEFORE the send so a retry or a second tick never texts the same person twice.
      await logEvent(jobId, null, INSTALL_DAY_CREW_EVENT, `Install day: ${p.name} (${p.role === "lead" ? "Lead installer" : "Crew"}) texted the install-day text — text prepared`,
        { key, worker_id: p.workerId, name: p.name, role: p.role, booking_id: booking.id, starts_at: booking.scheduled_start, business_id: asg.business_id, route: test ? "test" : "real" }, { internal: true });
      if (test) {
        const { sendTestSms } = await import("./test-send.server");
        const r = await sendTestSms({ jobId, jobSource: job.source, partnerIsTest, label: `install_day_crew:${key}`, actorId: null }, to, body);
        out.push(`${p.name}: test ${r.status}`);
      } else {
        const { sendRealSms } = await import("./sms.server");
        const r = await sendRealSms({ type: INSTALL_DAY_CREW_SMS_TYPE, idempotencyKey: key, to, body, jobId, businessId: asg.business_id });
        out.push(`${p.name}: ${r.status}`);
      }
    } catch (e) { out.push(`${p.name}: not sent — ${(e as Error).message}`); }
  }
  return out;
}

/** 15-minute tick: today's confirmed installs (Melbourne). Bounded. */
export async function sweepInstallDayCrewTexts(now = new Date()): Promise<number> {
  const { melbourneMidnight } = await import("./daily-brief.core");
  const { addYmd } = await import("./melbourne-time.core");
  const { melbourneYmd } = await import("./piesa-windows.core");
  const today = melbourneYmd(now);
  const { data: s } = await admin.from("workflow_settings").select("daily_mitti_text_time").eq("id", 1).maybeSingle();
  const sendTime = String(s?.daily_mitti_text_time ?? "06:30").slice(0, 5);
  const { data } = await admin.from("bookings").select("id, job_id, scheduled_start").eq("kind", "installation").eq("status", "confirmed")
    .gte("scheduled_start", new Date(melbourneMidnight(today)).toISOString()).lt("scheduled_start", new Date(melbourneMidnight(addYmd(today, 1))).toISOString())
    .order("scheduled_start").limit(100);
  let n = 0;
  const seen = new Set<string>();
  for (const b of data ?? []) {
    if (!b.job_id || seen.has(b.job_id)) continue;
    seen.add(b.job_id);
    try { if ((await textInstallDayCrew(b.job_id, b, now, sendTime)).some((r) => r.includes(": "))) n++; } catch (e) { console.error("install day crew texts failed", b.job_id, (e as Error).message); }
  }
  return n;
}
