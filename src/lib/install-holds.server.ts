// Expected install week (install hold): office planning note only. Reserves/blocks nothing. Never an appointment — no contact release, no booking, no owner view.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import { chooseHoldWeek, formatHoldWeek, holdShouldRelease, initialHoldWeek, piesaHoldWeek, rectificationHoldWeek } from "./install-holds.core";

export async function quotedAreaM2(jobId: string): Promise<number> {
  const { data: q } = await admin.from("quotes").select("id").eq("job_id", jobId).eq("kind", "installation").eq("status", "accepted").order("accepted_at", { ascending: false }).limit(1).maybeSingle();
  if (q) {
    const { data: items } = await admin.from("quote_items").select("quantity, unit").eq("quote_id", q.id);
    const m2 = (items ?? []).filter((i) => /m2|m²|sqm/i.test(i.unit ?? "")).map((i) => Number(i.quantity) || 0);
    if (m2.length) return Math.max(...m2);
  }
  const { data: m } = await admin.from("ceiling_measurements").select("measured_area_m2").eq("job_id", jobId).not("measured_area_m2", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (m?.measured_area_m2 != null) return Number(m.measured_area_m2);
  const { data: j } = await admin.from("jobs").select("estimated_area_m2").eq("id", jobId).maybeSingle();
  return Number(j?.estimated_area_m2 ?? 0) || 0;
}

export async function quotedInstaller(jobId: string): Promise<string | null> {
  const { data: a } = await admin.from("job_assignments").select("business_id").eq("job_id", jobId).eq("role", "installer").eq("active", true).maybeSingle();
  if (a?.business_id) return a.business_id;
  const { data: q } = await admin.from("quotes").select("partner_business_id").eq("job_id", jobId).eq("kind", "installation").eq("status", "accepted").limit(1).maybeSingle();
  return q?.partner_business_id ?? null;
}

async function place(jobId: string, earliest: string, _latest: string | undefined, reason: string, actorId: string | null, event: string) {
  const business = await quotedInstaller(jobId);
  const area = await quotedAreaM2(jobId);
  const { week } = chooseHoldWeek({ earliest });
  const { error } = await admin.rpc("place_install_hold", { _job: jobId, _business: business as string, _area: area, _week: week, _reason: reason, _over: false });
  if (error) throw new Error(error.message);
  await logEvent(jobId, actorId, event, `Expected install week ${event === "install_hold_created" ? "noted" : "moved"}: week of ${formatHoldWeek(week)}, ${area} m² (${reason}). Office planning note only — not a booking, reserves nothing.`,
    { week, area_m2: area, installer_business_id: business }, { internal: true });
  return { week };
}

/** Quote accepted + payment gate passed. Creates the hold if none is active (rerun-safe). */
export async function createInstallHold(jobId: string, actorId: string | null, now = new Date()) {
  const { data: h } = await admin.from("install_holds").select("id").eq("job_id", jobId).eq("status", "active").maybeSingle();
  if (h) return null;
  const w = initialHoldWeek(now);
  return place(jobId, w, undefined, "quote accepted and payment option cleared", actorId, "install_hold_created");
}

/** PIESA booked: move so install falls 7–21 days after the PIESA date. */
export async function moveHoldForPiesa(jobId: string, piesaStartIso: string, actorId: string | null) {
  const { data: h } = await admin.from("install_holds").select("id").eq("job_id", jobId).eq("status", "active").maybeSingle();
  if (!h) return null;
  const { earliest, latest } = piesaHoldWeek(piesaStartIso);
  return place(jobId, earliest, latest, "PIESA booked", actorId, "install_hold_moved");
}

/** Rectification needed: move to after the expected rectification date. */
export async function moveHoldForRectification(jobId: string, rectStartIso: string, actorId: string | null) {
  const { data: h } = await admin.from("install_holds").select("id").eq("job_id", jobId).eq("status", "active").maybeSingle();
  if (!h) return null;
  return place(jobId, rectificationHoldWeek(rectStartIso), undefined, "electrical fixes expected", actorId, "install_hold_moved");
}

/** 15-minute timer: release holds with no PIESA booked within 10 days. */
export async function sweepInstallHolds(now = new Date()) {
  const { data: holds } = await admin.from("install_holds").select("id, job_id, created_at").eq("status", "active").limit(500);
  let released = 0;
  for (const h of holds ?? []) {
    const { count } = await admin.from("bookings").select("id", { count: "exact", head: true }).eq("job_id", h.job_id).eq("kind", "assessment").in("status", ["confirmed", "completed"]);
    if (!holdShouldRelease(h.created_at, now, !!count)) continue;
    const { error } = await admin.from("install_holds").update({ status: "released", released_at: now.toISOString(), release_reason: "No PIESA booked within 10 days", updated_at: now.toISOString() }).eq("id", h.id).eq("status", "active");
    if (error) { console.error("install hold release failed", error.message); continue; }
    await logEvent(h.job_id, null, "install_hold_released", "Install hold released: no PIESA booked within 10 days. Not a booking change.", { hold_id: h.id }, { internal: true });
    released++;
  }
  return { released };
}

export async function getActiveHold(jobId: string) {
  const { data } = await admin.from("install_holds").select("target_week_start, area_m2, over_capacity, reason, status, created_at, released_at, release_reason, businesses(name, trading_name)").eq("job_id", jobId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data;
}
