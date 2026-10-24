// Daily Mitti links text: runs on the 15-minute allocation tick. Sends nothing unless the
// "Daily Mitti links text" switch is ON and the Mitti form IDs are set. Never retries a text.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { dailySendDue, dailyText, diffDay, melbourneDate, mittiFormSource, skipReason, snap, updateText, type DayJob, type Snap, type Trade } from "./daily-mitti-text.core";
import { melbourneMidnight } from "./daily-brief.core";
import { addYmd } from "./melbourne-time.core";
import { isTestPartner, normaliseAuMobile } from "./test-send.core";
import { SET_PASSWORD_BASE } from "./set-password-link.core";
import { mittiFormUrl } from "./mitti-link.core";
import { TWILIO_FETCH_TIMEOUT_MS, timeoutSignal } from "./network-timeout.core";

const db = admin as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
const myWork = (d: string) => `${SET_PASSWORD_BASE}/field?day=${d}`;

export async function dailyTextSettings() {
  const { data } = await db.from("workflow_settings").select("daily_mitti_text_enabled, daily_mitti_text_time, mitti_piesa_template_id, mitti_piisa_template_id").eq("id", 1).maybeSingle();
  const missing: string[] = [];
  if (!data?.mitti_piesa_template_id) missing.push("PIESA form ID");
  if (!data?.mitti_piisa_template_id) missing.push("PIISA / install form ID");
  return { enabled: data?.daily_mitti_text_enabled === true, time: String(data?.daily_mitti_text_time ?? "06:30"), missing };
}

type Group = { trade: Trade & { name: string; isTest: boolean }; jobs: DayJob[]; qaOnly: boolean };

/** The Mitti audit a booking's link points at: Ready Check form, the installer's PIISA (install day) or the PIESA audit. */
async function bookingFormAuditId(jobId: string, kind: string): Promise<string | null> {
  const src = mittiFormSource(kind);
  if (src === "piisa_event") {
    const { data: ev } = await db.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", "mitti_piisa_audit_created").order("created_at", { ascending: false }).limit(1).maybeSingle();
    const id = (ev?.details as { audit_id?: unknown } | null)?.audit_id;
    return id ? String(id) : null; // no PIISA yet → "form not ready yet"
  }
  const { data: f } = await db.from(src).select("external_mitti_id").eq("job_id", jobId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return f?.external_mitti_id ? String(f.external_mitti_id) : null;
}

/** Every trade's bookings for one Melbourne day, with their Mitti links. */
export async function collectDay(date: string): Promise<Group[]> {
  const from = new Date(melbourneMidnight(date)).toISOString();
  const to = new Date(melbourneMidnight(addYmd(date, 1))).toISOString();
  const { data: bks, error } = await db.from("bookings")
    .select("id, job_id, kind, status, scheduled_start, scheduled_end, business_id, assignment_id, jobs!inner(source, properties(address_line, suburb))")
    .gte("scheduled_start", from).lt("scheduled_start", to).in("status", ["confirmed", "cancelled"]);
  if (error) throw new Error(error.message);
  const groups = new Map<string, Group>();
  for (const b of bks ?? []) {
    let biz: string | null = b.business_id;
    let linked = false;
    if (b.assignment_id) {
      const { data: a } = await db.from("job_assignments").select("business_id, active, job_id").eq("id", b.assignment_id).maybeSingle();
      biz = biz ?? a?.business_id ?? null;
      linked = !!a && a.active === true && a.job_id === b.job_id;
    }
    if (!biz) continue;
    if (!b.assignment_id) {
      const { data: a } = await db.from("job_assignments").select("id").eq("job_id", b.job_id).eq("business_id", biz).eq("active", true).limit(1).maybeSingle();
      linked = !!a;
    }
    let g = groups.get(biz);
    if (!g) {
      const { data: bz } = await db.from("businesses").select("id, name, is_active, approved_at, mitti_account_invited, signer_mobile, phone, onboarding_notes").eq("id", biz).maybeSingle();
      g = { trade: { businessId: biz, name: bz?.name ?? "Trade", approved: !!bz?.approved_at && bz?.is_active !== false, linked: true, mittiInvited: bz?.mitti_account_invited === true,
        phone: normaliseAuMobile(bz?.signer_mobile ?? "") ?? normaliseAuMobile(bz?.phone ?? ""), isTest: isTestPartner(bz ?? {}) }, jobs: [], qaOnly: true };
      groups.set(biz, g);
    }
    g.trade.linked = g.trade.linked && linked;
    const job = b.jobs as { source: string | null; properties: { address_line: string | null; suburb: string | null } | null };
    if (job.source !== "qa_test") g.qaOnly = false;
    const auditId = await bookingFormAuditId(b.job_id, b.kind);
    const street = job.properties?.address_line?.split(",")[0] ?? null;
    g.jobs.push({ jobId: b.job_id, bookingId: b.id, start: b.scheduled_start, end: b.scheduled_end, street, suburb: job.properties?.suburb ?? null, status: b.status, link: auditId ? mittiFormUrl(auditId) : null });
  }
  return [...groups.values()];
}

async function sendSms(g: Group, to: string, body: string, kind: "daily" | "update" = "daily", key = ""): Promise<{ status: "sent" | "failed" | "blocked"; detail: string; sid: string | null }> {
  if (g.qaOnly || g.trade.isTest) {
    const { sendTestSms } = await import("./test-send.server");
    const r = await sendTestSms({ jobId: g.jobs[0]?.jobId ?? null, jobSource: g.qaOnly ? "qa_test" : null, partnerIsTest: g.trade.isTest, label: "daily_mitti_text", actorId: null }, to, body);
    return { status: r.status, detail: r.detail, sid: null };
  }
  // Real trades: the ONE real sender (customer_comms_enabled + this message's switch, STOP list, send-once key).
  const { sendRealSms } = await import("./sms.server");
  const r = await sendRealSms({ type: kind === "update" ? "daily_mitti_update" : "daily_mitti", idempotencyKey: `daily-mitti:${key}`, to, body, businessId: g.trade.businessId, jobId: g.jobs[0]?.jobId ?? null });
  return { status: r.status === "sent" ? "sent" : r.status === "blocked" || r.status === "already" ? "blocked" : "failed", detail: r.detail, sid: r.sid };
}

/** Claim the send_key first (unique), then send once. A claim that already exists means it was handled. */
async function sendOnce(g: Group, date: string, kind: "daily" | "update", key: string, body: string, snapshot: Snap[]) {
  const to = g.trade.phone!;
  const { data: row, error } = await db.from("trade_text_log").insert({ business_id: g.trade.businessId, job_ids: [...new Set(g.jobs.map((j) => j.jobId))], melbourne_date: date, kind, send_key: key, to_number: to, body, status: "sending", snapshot }).select("id").maybeSingle();
  if (error || !row) return "already";
  const r = await sendSms(g, to, body, kind, key);
  await db.from("trade_text_log").update({ status: r.status, detail: r.detail, provider_sid: r.sid, updated_at: new Date().toISOString() }).eq("id", row.id);
  return r.status;
}

export async function sweepDailyMittiTexts(now = new Date()) {
  const s = await dailyTextSettings();
  if (!s.enabled) return { skipped: "switch_off" };
  if (s.missing.length) return { skipped: "form_ids_missing" };
  if (!dailySendDue(now, s.time)) return { skipped: "before_send_time" };
  const date = melbourneDate(now);
  const out = { daily: 0, updates: 0, skippedTrades: 0 };
  for (const g of await collectDay(date)) {
    const why = skipReason(g.trade);
    if (why) {
      await db.from("trade_text_log").upsert({ business_id: g.trade.businessId, job_ids: [...new Set(g.jobs.map((j) => j.jobId))], melbourne_date: date, kind: "skipped", send_key: `skip:${g.trade.businessId}:${date}`, status: "skipped", detail: why }, { onConflict: "send_key" });
      out.skippedTrades++;
      continue;
    }
    const { data: prior } = await db.from("trade_text_log").select("snapshot, created_at").eq("business_id", g.trade.businessId).eq("melbourne_date", date).in("kind", ["daily", "update"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
    const snaps = g.jobs.map(snap);
    if (!prior) {
      if (!g.jobs.some((j) => j.status !== "cancelled")) continue;
      if ((await sendOnce(g, date, "daily", `daily:${g.trade.businessId}:${date}`, dailyText(g.jobs, myWork(date)), snaps)) !== "already") out.daily++;
      continue;
    }
    const changes = diffDay(prior.snapshot as Snap[], g.jobs);
    if (!changes.length) continue;
    const sig = changes.map((c) => `${c.kind}:${c.job.bookingId}:${c.job.start}`).join("|");
    if ((await sendOnce(g, date, "update", `update:${g.trade.businessId}:${date}:${sig}`, updateText(changes, myWork(date)), snaps)) !== "already") out.updates++;
  }
  await refreshDelivery(date);
  return out;
}

/** Stage 5 (Jo 23 Oct): one-off text to the booked installer when a Ready Check is confirmed — the booked
 *  time and the form link, so they open the right form. Same switch, TEST-only sending and send-once-per-
 *  booking rule as the morning text; never retries. Wording is new copy awaiting Jo's sign-off before the
 *  switch goes on. */
export async function sweepReadyCheckBookedTexts(now = new Date()) {
  const s = await dailyTextSettings();
  if (!s.enabled) return { skipped: "switch_off" };
  if (s.missing.length) return { skipped: "form_ids_missing" };
  const since = new Date(now.getTime() - 36 * 3_600_000).toISOString();
  const { data: bks } = await db.from("bookings")
    .select("id, job_id, scheduled_start, business_id, assignment_id, jobs!inner(source, properties(address_line, suburb))")
    .eq("kind", "ready_check").eq("status", "confirmed").gte("scheduled_start", since).order("scheduled_start");
  const date = melbourneDate(now);
  const out = { sent: 0, skipped: 0 };
  for (const b of bks ?? []) {
    const job = b.jobs as { source: string | null; properties: { address_line: string | null; suburb: string | null } | null };
    let biz: string | null = b.business_id;
    if (!biz && b.assignment_id) {
      const { data: a } = await db.from("job_assignments").select("business_id").eq("id", b.assignment_id).maybeSingle();
      biz = a?.business_id ?? null;
    }
    if (!biz) { out.skipped++; continue; }
    const { data: bz } = await db.from("businesses").select("id, name, is_active, approved_at, mitti_account_invited, signer_mobile, phone, onboarding_notes").eq("id", biz).maybeSingle();
    const g: Group = { trade: { businessId: biz, name: bz?.name ?? "Trade", approved: !!bz?.approved_at && bz?.is_active !== false, linked: true, mittiInvited: bz?.mitti_account_invited === true,
      phone: normaliseAuMobile(bz?.signer_mobile ?? "") ?? normaliseAuMobile(bz?.phone ?? ""), isTest: isTestPartner(bz ?? {}) }, jobs: [], qaOnly: job.source === "qa_test" };
    if (skipReason(g.trade)) { out.skipped++; continue; }
    const { data: f } = await db.from("ready_checks").select("external_mitti_id").eq("job_id", b.job_id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    const when = new Date(b.scheduled_start).toLocaleString("en-AU", { timeZone: "Australia/Melbourne", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
    const street = job.properties?.address_line?.split(",")[0] ?? null;
    const where = [street, job.properties?.suburb].filter(Boolean).join(", ") || "see your portal";
    // Jo-approved wording (23 Oct): "Ready Check booked: [day, time], [address]. Open the form: [link]".
    const body = `Ready Check booked: ${when}, ${where}.${f?.external_mitti_id ? ` Open the form: ${mittiFormUrl(f.external_mitti_id)}` : " The form link will appear in your portal."}`;
    g.jobs.push({ jobId: b.job_id, bookingId: b.id, start: b.scheduled_start, end: null, street, suburb: job.properties?.suburb ?? null, status: "confirmed", link: f?.external_mitti_id ? mittiFormUrl(f.external_mitti_id) : null });
    if ((await sendOnce(g, date, "update", `rc-booked:${b.id}`, body, g.jobs.map(snap))) !== "already") out.sent++;
  }
  await refreshDelivery(date);
  return out;
}

/** Update sent → delivered/failed from Twilio for today's real texts. */
async function refreshDelivery(date: string) {
  const { data } = await db.from("trade_text_log").select("id, provider_sid").eq("melbourne_date", date).eq("status", "sent").not("provider_sid", "is", null);
  for (const r of data ?? []) {
    try {
      const res = await fetch(`https://connector-gateway.lovable.dev/twilio/Messages/${r.provider_sid}.json`, { headers: { Authorization: `Bearer ${process.env["LOVABLE_API_KEY"]}`, "X-Connection-Api-Key": process.env["TWILIO_API_KEY"] ?? "" }, signal: timeoutSignal(TWILIO_FETCH_TIMEOUT_MS) });
      if (!res.ok) continue;
      const st = ((await res.json()) as { status?: string }).status;
      if (st === "delivered") await db.from("trade_text_log").update({ status: "delivered", updated_at: new Date().toISOString() }).eq("id", r.id);
      else if (st === "failed" || st === "undelivered") await db.from("trade_text_log").update({ status: "failed", detail: `Twilio: ${st}`, updated_at: new Date().toISOString() }).eq("id", r.id);
    } catch { /* next tick */ }
  }
}

/** ONE test of the morning text for a TEST trade, to Jo's mobile only (allowlisted test path). */
export async function sendDailyTextTest(businessId: string, date: string) {
  const g = (await collectDay(date)).find((x) => x.trade.businessId === businessId);
  if (!g) throw new Error("That trade has no bookings on that day.");
  if (!g.trade.isTest || !g.qaOnly) throw new Error("Test only: TEST trade with TEST jobs.");
  const body = dailyText(g.jobs, myWork(date));
  const { sendTestSms } = await import("./test-send.server");
  const r = await sendTestSms({ jobId: g.jobs[0]!.jobId, jobSource: "qa_test", partnerIsTest: true, label: "daily_mitti_text_test", actorId: null }, "+61477511901", body);
  await db.from("trade_text_log").insert({ business_id: businessId, job_ids: g.jobs.map((j) => j.jobId), melbourne_date: date, kind: "test", send_key: `test:${businessId}:${Date.now()}`, to_number: "+61477511901", body, status: r.status, detail: r.detail });
  return { body, ...r };
}

/** Office view: texts for a job or a partner. */
export async function listTradeTexts(f: { jobId?: string | undefined; businessId?: string | undefined }) {
  let q = db.from("trade_text_log").select("id, kind, melbourne_date, status, detail, body, to_number, created_at, businesses(name)").order("created_at", { ascending: false }).limit(50);
  if (f.jobId) q = q.contains("job_ids", [f.jobId]);
  if (f.businessId) q = q.eq("business_id", f.businessId);
  const { data } = await q;
  return (data ?? []) as Array<{ id: string; kind: string; melbourne_date: string; status: string; detail: string | null; body: string | null; to_number: string | null; created_at: string; businesses: { name: string } | null }>;
}
