import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import { sha256Hex } from "./assignment.core";
import { heldWindowAction, rectQuoteTimerAction } from "./rectification.core";

/** Share rectification contacts with the active electrician (visit-scoped). Idempotent. */
export async function releaseRectContacts(jobId: string, actorId: string | null, why: string) {
  const { data: a } = await admin.from("job_assignments").select("id").eq("job_id", jobId).eq("role", "electrician").eq("active", true).maybeSingle();
  if (!a) return false;
  const { data: ex } = await admin.from("contact_releases").select("id").eq("job_id", jobId).eq("assignment_id", a.id).eq("visit_kind", "rectification").maybeSingle();
  if (ex) return false;
  const { OWNER_CONTACT_NOTICE, TRADE_CONTACT_NOTICE } = await import("./allocation.core");
  const { error } = await admin.from("contact_releases").upsert({ job_id: jobId, assignment_id: a.id, visit_kind: "rectification", released_by: actorId, owner_notice: OWNER_CONTACT_NOTICE, trade_notice: TRADE_CONTACT_NOTICE }, { onConflict: "assignment_id,visit_kind", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
  await logEvent(jobId, actorId, "contact_released", `Owner and electrician contact details released for the electrical fixes visit only: ${why}`, { assignment_id: a.id, visit_kind: "rectification" }, { internal: true });
  return true;
}

/** Timer: rectification quote nudges (24h, day 3) — queued only, never sent here. */
export async function sweepRectQuotes(now: Date = new Date()) {
  const { data: rows, error } = await admin.from("quotes").select("id, job_id, kind, status, sent_at, nudge_24h_at, nudge_day3_at")
    .eq("kind", "rectification").eq("status", "issued").not("sent_at", "is", null).limit(500);
  if (error) throw new Error(error.message);
  let nudges = 0;
  const iso = now.toISOString();
  for (const q of rows ?? []) {
    const act = rectQuoteTimerAction(q, now);
    if (!act) continue;
    const col = act === "nudge_24h" ? "nudge_24h_at" : "nudge_day3_at";
    const label = act === "nudge_24h" ? "24 hour" : "Day 3";
    const tag = act === "nudge_24h" ? "24h" : "day3";
    const { data: u } = await admin.from("quotes").update({ [col]: iso } as never).eq("id", q.id).eq("status", "issued").is(col, null).select("id").maybeSingle();
    if (!u) continue;
    await logEvent(q.job_id, null, "rect_quote_nudge", `${label} reminder to owner about their electrical fixes quote (prepared; delivery follows the sending switches)`, { quote_id: q.id, tag }, { internal: true });
    const { data: ev } = await admin.from("workflow_events").select("id").eq("job_id", q.job_id).eq("event_type", "rect_quote_nudge").contains("details", { quote_id: q.id, tag }).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (ev) {
      const { error: e } = await admin.rpc("enqueue_external_action", {
        _job: q.job_id, _event: ev.id, _action: "customer_email", _target: `quote:${q.id}`, _basis: "transactional_quote_reminder",
        _version: `rect-quote-nudge-${tag}-v1`, _payload: `quote:${q.id}`, _facts: await sha256Hex(`${q.id}-rect-${tag}`), _key: `rect-quote-nudge-${q.id}-${tag}`,
      });
      if (e) console.error("electrical fixes nudge outbox enqueue skipped", e.message);
    }
    nudges++;
  }
  return { nudges };
}

/** Timer: when a job reaches rectification scheduling, turn the owner's held pick into the confirmed booking.
 * Uses the normal booking guard (payment gate etc.). If the time has passed, falls back to contact release. */
export async function sweepHeldRectWindows(now: Date = new Date()) {
  const { data: jobs } = await admin.from("jobs").select("id").eq("stage", "rectification_scheduling").limit(200);
  let booked = 0, lapsed = 0;
  for (const j of jobs ?? []) {
    // Only jobs on the new path (electrician gave windows). Older jobs keep the old path untouched.
    const { data: ws } = await admin.from("appointment_proposals").select("id, starts_at, responded_by, status, responded_at")
      .eq("job_id", j.id).eq("kind", "rectification").eq("electrician_window", true);
    if (!ws?.length) continue;
    const { count } = await admin.from("bookings").select("id", { count: "exact", head: true }).eq("job_id", j.id).eq("kind", "rectification").eq("status", "confirmed");
    if (count) continue;
    const p = ws.filter((w) => w.status === "accepted").sort((a, b) => (b.responded_at ?? "").localeCompare(a.responded_at ?? ""))[0];
    if (!p) { // owner chose "None of these work" (or the pick lapsed): old propose/confirm path
      if (await releaseRectContacts(j.id, null, "the owner asked for another time")) lapsed++;
      continue;
    }
    if (heldWindowAction(p.starts_at, now) === "lapsed") {
      await admin.from("appointment_proposals").update({ status: "superseded" }).eq("id", p.id).eq("status", "accepted");
      if (await releaseRectContacts(j.id, null, "the time the owner picked passed before scheduling unlocked")) lapsed++;
      continue;
    }
    try {
      const { confirmBooking } = await import("./booking.server");
      await confirmBooking(j.id, "rectification", p.starts_at, p.responded_by!, "owner", "Owner's chosen electrical fixes time");
      booked++;
    } catch (e) {
      console.error("held electrical fixes booking not confirmed yet", (e as Error).message);
    }
  }
  return { booked, lapsed };
}
