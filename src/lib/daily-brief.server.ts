// Visit reminders (queued only) and the stored 7am daily brief. Rules: daily-brief.core.ts.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import { briefDueFor, buildDailyBrief, prestartNotPassed, reminderDue, reminderKey, yesterdayBounds, type BriefRisk } from "./daily-brief.core";
import { VISIT_LABEL, type VisitKind } from "./visit-events.core";

async function sha256Hex(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** Timer: queue the 24h and 2h reminder to the owner and the trade for every booked visit. Never sends. */
export async function sweepVisitReminders(now = new Date()) {
  const n = now.getTime();
  const { data, error } = await admin.from("bookings").select("id, job_id, kind, scheduled_start, assignment_id, jobs!inner(deleted_at, source, stage)").is("jobs.deleted_at", null)
    .eq("status", "confirmed").gt("scheduled_start", now.toISOString()).lte("scheduled_start", new Date(n + 24 * 3_600_000).toISOString());
  if (error) throw new Error(error.message);
  let queued = 0;
  for (const b of data ?? []) {
    const job = b.jobs as { source: string | null; stage: string } | null;
    if (!job || job.source === "qa_test" || ["cancelled", "complete", "on_hold"].includes(job.stage)) continue;
    const slot = reminderDue(b.scheduled_start, n);
    if (!slot) continue;
    const startMs = Date.parse(b.scheduled_start);
    const { data: prior } = await admin.from("workflow_events").select("id").eq("job_id", b.job_id).eq("event_type", "visit_reminder_queued").contains("details", { booking_id: b.id, slot, start_ms: startMs }).limit(1).maybeSingle();
    if (prior) continue;
    const label = VISIT_LABEL[b.kind as VisitKind] ?? "Visit";
    await logEvent(b.job_id, null, "visit_reminder_queued", `${label}: ${slot} reminder prepared for the owner and the trade (delivery follows the sending switches)`, { booking_id: b.id, slot, start_ms: startMs, kind: b.kind }, { internal: true });
    const { data: ev } = await admin.from("workflow_events").select("id").eq("job_id", b.job_id).eq("event_type", "visit_reminder_queued").contains("details", { booking_id: b.id, slot, start_ms: startMs }).limit(1).maybeSingle();
    if (!ev) continue;
    const targets: Array<["owner" | "trade", string, string]> = [["owner", "customer_email", `job:${b.job_id}`]];
    if (b.assignment_id) targets.push(["trade", "partner_notifications", `job_assignment:${b.assignment_id}`]);
    for (const [who, action, target] of targets) {
      const key = reminderKey(b.id, slot, who, b.scheduled_start);
      const { error: e } = await admin.rpc("enqueue_external_action", {
        _job: b.job_id, _event: ev.id, _action: action, _target: target, _basis: "transactional_job_coordination",
        _version: "visit-reminder-v1", _payload: `visit_reminder:${b.kind}-${slot}-${who}`, _facts: await sha256Hex(key), _key: key,
      });
      if (e) console.error("visit reminder enqueue skipped", e.message); else queued++;
    }
  }
  return { queued };
}

/** Facts for one brief. Read-only. QA jobs are left out. */
export async function collectBrief(date: string, now = new Date()) {
  const n = now.getTime();
  const week = new Date(n + 7 * 86_400_000).toISOString();
  const y = yesterdayBounds(date);
  const { loadNeedsHivic } = await import("./needs.server");
  const needs = await loadNeedsHivic();
  const [jobs, clocks, esc, inst, checks, enq, bk, done, vs, vr] = await Promise.all([
    admin.from("jobs").select("id, job_number, stage, source"),
    admin.from("job_piesa_deadlines").select("job_id, install_deadline, days_remaining, piesa_expired").eq("piesa_expired", false).lte("days_remaining", 7),
    admin.from("esc_notifications").select("job_id, due_by").is("sent_at", null).not("status", "in", "(stale,cancelled)").not("due_by", "is", null).lte("due_by", week),
    admin.from("bookings").select("job_id, scheduled_start, jobs!inner(deleted_at)").is("jobs.deleted_at", null).eq("kind", "installation").eq("status", "confirmed").gt("scheduled_start", now.toISOString()).lte("scheduled_start", week),
    admin.from("pre_start_checks").select("job_id, scheduled_start, passed, checked_at").gte("scheduled_start", now.toISOString()),
    admin.from("jobs").select("id", { count: "exact", head: true }).neq("source", "qa_test").gte("created_at", y.from).lt("created_at", y.to),
    admin.from("bookings").select("job_id, jobs!inner(deleted_at, source)").is("jobs.deleted_at", null).in("status", ["confirmed", "completed"]).gte("created_at", y.from).lt("created_at", y.to),
    admin.from("jobs").select("id", { count: "exact", head: true }).neq("source", "qa_test").gte("installation_completed_at", y.from).lt("installation_completed_at", y.to),
    admin.from("veec_lodgements").select("job_id").eq("submitted_date", y.day),
    admin.from("veec_lodgements").select("job_id").eq("status", "approved").gte("updated_at", y.from).lt("updated_at", y.to),
  ]);
  for (const r of [jobs, clocks, esc, inst, checks, enq, bk, done, vs, vr]) if (r.error) throw new Error(`Could not load daily brief facts: ${r.error.message}`);
  const jobMap = new Map((jobs.data ?? []).map((j) => [j.id, j]));
  const live = (id: string | null) => !!id && jobMap.get(id)?.source !== "qa_test" && !["complete", "cancelled"].includes(jobMap.get(id)?.stage ?? "");
  const num = (id: string | null) => (id ? jobMap.get(id)?.job_number ?? null : null);
  const atRisk: BriefRisk[] = [
    ...(clocks.data ?? []).filter((c) => live(c.job_id)).map((c) => ({ kind: "clock_30_day" as const, jobNumber: num(c.job_id), when: String(c.install_deadline ?? ""), detail: `30-day installation clock ends (${c.days_remaining} days left)` })),
    ...(esc.data ?? []).filter((e) => live(e.job_id)).map((e) => ({ kind: "esc_deadline" as const, jobNumber: num(e.job_id), when: String(e.due_by), detail: "ESC notification must be submitted by" })),
    ...prestartNotPassed((inst.data ?? []).filter((b) => live(b.job_id)), (checks.data ?? []) as never).map((b) => ({ kind: "prestart_not_passed" as const, jobNumber: num(b.job_id), when: b.scheduled_start, detail: "Install booked without a passed pre-start check yet" })),
  ];
  const real = (rows: Array<{ job_id: string | null }> | null) => (rows ?? []).filter((r) => !!r.job_id && jobMap.get(r.job_id)?.source !== "qa_test").length;
  return buildDailyBrief({
    date,
    needs: needs.items.map((i) => ({ urgency: i.urgency, jobNumber: i.jobNumber, why: i.why })),
    apQueue: (jobs.data ?? []).filter((j) => j.stage === "ap_review" && j.source !== "qa_test").length,
    atRisk,
    yesterday: {
      day: y.day, enquiries: enq.count ?? 0,
      bookings: (bk.data ?? []).filter((b) => (b.jobs as { source: string | null } | null)?.source !== "qa_test").length,
      installs: done.count ?? 0, veecsSubmitted: real(vs.data), veecsRegistered: real(vr.data),
    },
  });
}

/** Timer: from 7am Melbourne, store today's brief once. Sending is off, so it is shown in the portal only. */
export async function sweepDailyBrief(now = new Date()) {
  const { melbourneYmd } = await import("./daily-brief.core");
  const today = melbourneYmd(now.getTime());
  const { data: existing } = await admin.from("daily_briefs").select("id").eq("brief_date", today).maybeSingle();
  const date = briefDueFor(now.getTime(), !!existing);
  if (!date) return { created: false };
  const content = await collectBrief(date, now);
  const { error } = await admin.from("daily_briefs").insert({ brief_date: date, content: content as never, delivery_status: "portal_only" });
  if (error && !/duplicate|unique/i.test(error.message)) throw new Error(error.message);
  return { created: !error };
}
