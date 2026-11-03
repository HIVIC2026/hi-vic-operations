// New job flow, Part 6, Task 7: `sweepUpgradesWatch` on the 15-minute allocation tick. For every job with a confirmed upgrades
// day (booking kind "rectification") it does, one job at a time:
// - the nudge when the upgrades form isn't in (rules: upgrades-watch.core): a text to the electrician (DRAFT, UPGRADES_NUDGE_TEXT_APPROVED)
//   with a fresh job link, then an email to the installer office (DRAFT, UPGRADES_OFFICE_EMAIL_APPROVED);
// - the 30-day red flag when the upgrades day is after the install deadline: ONE internal `upgrades_past_30_days` event per job + day
//   (the office Needs me row, always on) + an installer office email with a copy to info@ (DRAFT, UPGRADES_RED_FLAG_EMAIL_APPROVED).
// Every send is recorded (its key) BEFORE it goes, once per key. TEST jobs / TEST partners → test-send. Real sends only through the
// guarded senders (`sendRealSms`, `sendOfficeEmail`). Reads page 200 at a time; a failed read logs and sends nothing. Never throws.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { RealSmsInput, RealSmsResult } from "./sms.server";
import type { SendResult } from "./test-send.server";
import {
  OFFICE_COPY_EMAIL, UPGRADES_NUDGE_EVENT, UPGRADES_NUDGE_SMS_TYPE, UPGRADES_NUDGE_TEXT_APPROVED, UPGRADES_OFFICE_EMAIL_APPROVED, UPGRADES_OFFICE_EMAIL_EVENT,
  UPGRADES_PAST_30_DAYS_EVENT, UPGRADES_RED_FLAG_EMAIL_APPROVED, UPGRADES_RED_FLAG_EMAIL_EVENT, maskUpgradesLink, upgradesNudgeDue, upgradesNudgeText, upgradesOfficeEmail, upgradesPastWindow, upgradesRedFlagEmail, upgradesWatchKeys, upgradesYmdOf,
} from "./upgrades-watch.core";

export type UpgradesWatchDeps = {
  nudgeApproved: boolean; officeApproved: boolean; redFlagApproved: boolean;
  sendSms: (input: RealSmsInput) => Promise<RealSmsResult>;
  sendTestSms: (ctx: TestCtx, to: string, body: string) => Promise<SendResult>;
  sendOfficeEmail: (p: { actorId: null; recipient: "partner"; to: string; contactName: string | null; subject: string; message: string; html: string; text: string; label: string; record: { businessId: string }; idempotencyKey: string }) => Promise<SendResult>;
  sendTestEmail: (ctx: TestCtx, to: string, subject: string, html: string, text: string) => Promise<SendResult>;
  /** A fresh job link for the nudge text (the one already in their phone can't be rebuilt from its hash). The older link is
   *  kept live until the text has gone: then retireOlderLinks; a send that did not go revokes the new one instead. */
  mintLink: (jobId: string, workerId: string) => Promise<{ id: string; url: string } | null>;
  retireOlderLinks: (jobId: string, workerId: string, keepLinkId: string) => Promise<void>;
  revokeLink: (linkId: string) => Promise<void>;
  record: (jobId: string, eventType: string, summary: string, details: Record<string, unknown>) => Promise<void>;
};
type TestCtx = { jobId: string; jobSource: string | null; partnerIsTest: boolean; label: string; actorId: null };
const defaultDeps = (): UpgradesWatchDeps => ({
  nudgeApproved: UPGRADES_NUDGE_TEXT_APPROVED, officeApproved: UPGRADES_OFFICE_EMAIL_APPROVED, redFlagApproved: UPGRADES_RED_FLAG_EMAIL_APPROVED,
  sendSms: async (input) => (await import("./sms.server")).sendRealSms(input),
  sendTestSms: async (ctx, to, body) => (await import("./test-send.server")).sendTestSms(ctx, to, body),
  sendOfficeEmail: async (p) => (await import("./office-email.server")).sendOfficeEmail(p),
  sendTestEmail: async (ctx, to, subject, html, text) => (await import("./test-send.server")).sendTestEmail(ctx, to, subject, html, text),
  mintLink: async (jobId, workerId) => (await import("./electrician-link.server")).mintElectricianLink(jobId, workerId, null, Date.now(), { keepOlder: true }).then((r) => ({ id: r.id, url: r.url })),
  retireOlderLinks: async (jobId, workerId, keepLinkId) => (await import("./electrician-link.server")).retireOlderElectricianLinks(jobId, workerId, keepLinkId),
  revokeLink: async (linkId) => (await import("./electrician-link.server")).revokeElectricianLink(linkId),
  record: async (jobId, eventType, summary, details) => (await import("./workflow.server")).logEvent(jobId, null, eventType, summary, details, { internal: true }),
});

const DAY = 86_400_000;
/** Upgrades days older than this are left alone (a nudge for a week-old day is noise). */
const NUDGE_LOOKBACK_DAYS = 7;
const CLOSED = new Set(["complete", "cancelled"]);
type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? null : String(v));

async function paged(what: string, page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 200) {
    const { data, error } = await page(from, from + 199);
    if (error) throw new Error(`Could not read ${what}: ${error.message}`);
    out.push(...((data ?? []) as Row[]));
    if ((data ?? []).length < 200) return out;
  }
}
const chunks = <T,>(xs: T[], n = 200): T[][] => { const o: T[][] = []; for (let i = 0; i < xs.length; i += n) o.push(xs.slice(i, i + n)); return o; };
async function byIds(what: string, ids: string[], page: (c: string[], from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<Row[]> {
  const out: Row[] = [];
  for (const c of chunks(ids)) out.push(...(await paged(what, (a, b) => page(c, a, b))));
  return out;
}

type Booking = { id: string; job_id: string; scheduled_start: string; business_id: string | null; contractor_id: string | null };
type Job = { id: string; job_number: string; source: string | null; stage: string; deleted_at: string | null };

export async function sweepUpgradesWatch(now = new Date(), over: Partial<UpgradesWatchDeps> = {}): Promise<{ nudges: number; officeEmails: number; redFlags: number }> {
  const d = { ...defaultDeps(), ...over };
  const out = { nudges: 0, officeEmails: 0, redFlags: 0 };
  let bookings: Booking[], jobs: Map<string, Job>, deadlines: Map<string, string>, events: Map<string, Row[]>;
  try {
    const from = new Date(now.getTime() - NUDGE_LOOKBACK_DAYS * DAY).toISOString();
    bookings = (await paged("upgrades bookings", (a, b) => admin.from("bookings").select("id, job_id, scheduled_start, business_id, contractor_id").eq("kind", "rectification").eq("status", "confirmed").gte("scheduled_start", from).order("scheduled_start", { ascending: true }).range(a, b))) as unknown as Booking[];
    const ids = [...new Set(bookings.map((b) => b.job_id))];
    if (!ids.length) return out;
    const [jobRows, dlRows, evRows] = await Promise.all([
      byIds("jobs", ids, (c, a, b) => admin.from("jobs").select("id, job_number, source, stage, deleted_at").in("id", c).range(a, b)),
      byIds("install deadlines", ids, (c, a, b) => admin.from("job_piesa_deadlines").select("job_id, install_deadline").in("job_id", c).range(a, b)),
      byIds("upgrades events", ids, (c, a, b) => admin.from("workflow_events").select("job_id, event_type, created_at, details").in("job_id", c).in("event_type", ["fixes_form_created", "fixes_form_completed", "fixes_form_not_done", "fixes_form_held", UPGRADES_NUDGE_EVENT, UPGRADES_OFFICE_EMAIL_EVENT, UPGRADES_PAST_30_DAYS_EVENT, UPGRADES_RED_FLAG_EMAIL_EVENT]).order("created_at", { ascending: false }).range(a, b)),
    ]);
    jobs = new Map((jobRows as unknown as Job[]).map((j) => [j.id, j]));
    deadlines = new Map(dlRows.flatMap((r) => (r["install_deadline"] ? [[String(r["job_id"]), String(r["install_deadline"]).slice(0, 10)] as [string, string]] : [])));
    events = new Map();
    for (const e of evRows) (events.get(String(e["job_id"])) ?? events.set(String(e["job_id"]), []).get(String(e["job_id"]))!).push(e);
  } catch (e) { console.error("upgrades watch: read failed, nothing sent", (e as Error).message); return out; }

  const { fixesFormOutcome } = await import("./fixes-day.core");
  // One job at a time; the newest confirmed upgrades booking per job is the one that counts.
  const seen = new Set<string>();
  for (const b of [...bookings].reverse()) {
    if (seen.has(b.job_id)) continue;
    seen.add(b.job_id);
    const job = jobs.get(b.job_id);
    if (!job || job.deleted_at || CLOSED.has(job.stage)) continue;
    const evs = events.get(b.job_id) ?? [];
    const ymd = upgradesYmdOf(b.scheduled_start);
    const keys = upgradesWatchKeys(b.job_id, ymd);
    const has = (type: string, key: string) => evs.some((e) => e["event_type"] === type && (e["details"] as { key?: string } | null)?.key === key);
    const ctx = { jobId: b.job_id, job, booking: b, ymd, keys, now };
    try {
      // The red flag: one per job + upgrades day, always recorded (Needs me reads it). The email is DRAFT: held while its flag
      // is off and tried again every tick until it is recorded sent (so flipping the flag later still sends it, once).
      const deadline = deadlines.get(b.job_id);
      if (deadline && upgradesPastWindow({ upgradesYmd: ymd, installDeadlineYmd: deadline })) {
        if (!has(UPGRADES_PAST_30_DAYS_EVENT, keys.redFlag)) {
          await d.record(b.job_id, UPGRADES_PAST_30_DAYS_EVENT, `Upgrades day ${ymd} is on or after the 30-day install deadline ${deadline}`, { key: keys.redFlag, upgrades_ymd: ymd, install_deadline: deadline, booking_id: b.id, needs_office: true });
          out.redFlags++;
        }
        if (!has(UPGRADES_RED_FLAG_EMAIL_EVENT, keys.redFlag)) await redFlagEmail(d, ctx, deadline).catch((e) => console.error("upgrades watch: red flag email skipped", b.job_id, (e as Error).message));
      }
      // The nudge.
      const formDone = fixesFormOutcome(evs as never).outcome === "done";
      // The electrician counts as nudged only once a text was reported sent (the record is written sent:false first).
      const nudged = evs.some((e) => e["event_type"] === UPGRADES_NUDGE_EVENT && (e["details"] as { key?: string; sent?: boolean } | null)?.key === keys.nudge && (e["details"] as { sent?: boolean } | null)?.sent === true);
      const due = upgradesNudgeDue({ upgradesYmd: ymd, formDone, now, nudgedElectrician: nudged, emailedOffice: has(UPGRADES_OFFICE_EMAIL_EVENT, keys.office) });
      if (due === "electrician" && (await nudgeElectrician(d, ctx)) === "sent") out.nudges++;
      if (due === "office" && (await emailOffice(d, ctx)) === "sent") out.officeEmails++;
    } catch (e) { console.error("upgrades watch: job skipped", b.job_id, (e as Error).message); }
  }
  return out;
}

type Ctx = { jobId: string; job: Job; booking: Booking; ymd: string; keys: ReturnType<typeof upgradesWatchKeys>; now: Date };
type Biz = { id: string; name: string | null; trading_name: string | null; email: string | null; onboarding_notes: string | null };
const bizName = (b: Biz | null) => ((b?.trading_name ?? "").trim() || (b?.name ?? "").trim()) || null;

async function installerOffice(jobId: string): Promise<Biz | null> {
  const { data: a, error } = await admin.from("job_assignments").select("business_id").eq("job_id", jobId).eq("role", "installer").eq("active", true).maybeSingle();
  if (error) throw new Error(`Could not read the installer: ${error.message}`);
  if (!a?.business_id) return null;
  const { data: b, error: be } = await admin.from("businesses").select("id, name, trading_name, email, onboarding_notes").eq("id", a.business_id).maybeSingle();
  if (be) throw new Error(`Could not read the installer business: ${be.message}`);
  return (b as Biz | null) ?? null;
}
async function electricianBiz(businessId: string | null): Promise<Biz | null> {
  if (!businessId) return null;
  const { data, error } = await admin.from("businesses").select("id, name, trading_name, email, onboarding_notes").eq("id", businessId).maybeSingle();
  if (error) throw new Error(`Could not read the electrician business: ${error.message}`);
  return (data as Biz | null) ?? null;
}
async function isTest(job: Job, ...bizzes: (Biz | null)[]): Promise<{ test: boolean; partnerIsTest: boolean }> {
  const { isTestPartner } = await import("./test-send.core");
  const partnerIsTest = bizzes.some((b) => isTestPartner(b));
  return { test: job.source === "qa_test" || partnerIsTest, partnerIsTest };
}

/** The electrician on the upgrades booking: the worker named by the latest Team allocation event (electricians never log
 *  in, so the booking usually has no contractor), else the booked person by profile, else the business's approved electrician. */
async function electricianWorker(b: Booking): Promise<{ id: string; mobile: string | null; business_id: string } | null> {
  const sel = "id, mobile, business_id";
  const { data: ev, error: ee } = await admin.from("workflow_events").select("details").eq("job_id", b.job_id).eq("event_type", "in_house_electrician_allocated").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (ee) throw new Error(`Could not read the electrician allocation: ${ee.message}`);
  const allocated = (ev?.details as { worker_id?: unknown } | null)?.worker_id;
  if (typeof allocated === "string" && allocated) {
    const { data, error } = await admin.from("partner_workers").select(sel).eq("id", allocated).is("removed_at", null).maybeSingle();
    if (error) throw new Error(`Could not read the electrician: ${error.message}`);
    if (data) return data as never;
  }
  if (b.contractor_id) {
    const { data, error } = await admin.from("partner_workers").select(sel).eq("profile_id", b.contractor_id).eq("trade_role", "electrician").is("removed_at", null).limit(1).maybeSingle();
    if (error) throw new Error(`Could not read the electrician: ${error.message}`);
    if (data) return data as never;
  }
  if (!b.business_id) return null;
  const { data, error } = await admin.from("partner_workers").select(sel).eq("business_id", b.business_id).eq("trade_role", "electrician").eq("approval_status", "approved").is("removed_at", null).order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (error) throw new Error(`Could not read the electrician: ${error.message}`);
  return (data as never) ?? null;
}

async function nudgeElectrician(d: UpgradesWatchDeps, c: Ctx): Promise<"sent" | "held"> {
  const w = await electricianWorker(c.booking);
  if (!w?.mobile?.trim()) return "held";
  const eb = await electricianBiz(w.business_id);
  const { test, partnerIsTest } = await isTest(c.job, eb);
  if (!test && !d.nudgeApproved) return "held";
  // A fresh link only when the text goes; the link already in their phone stays live until the send succeeded (I3).
  // The event (the once-per-day claim) is recorded before the send.
  const link = await d.mintLink(c.jobId, w.id);
  if (!link) return "held";
  const body = upgradesNudgeText({ jobNumber: c.job.job_number, url: link.url });
  // One record per key, written sent:false before the first try (a retry after a held/failed send reuses it).
  const { data: prior, error: pe } = await admin.from("workflow_events").select("id").eq("job_id", c.jobId).eq("event_type", UPGRADES_NUDGE_EVENT).contains("details", { key: c.keys.nudge }).limit(1).maybeSingle();
  if (pe) throw new Error(`Could not read the nudge record: ${pe.message}`);
  if (!prior) await d.record(c.jobId, UPGRADES_NUDGE_EVENT, "Electrician nudged: upgrades form not in", { key: c.keys.nudge, worker_id: w.id, booking_id: c.booking.id, upgrades_ymd: c.ymd, test, sent: false });
  let went: boolean;
  if (test) {
    const r = await d.sendTestSms({ jobId: c.jobId, jobSource: c.job.source, partnerIsTest, label: `${UPGRADES_NUDGE_SMS_TYPE}:${c.jobId}:${c.ymd}`, actorId: null }, w.mobile, body);
    went = r.status === "sent";
  } else {
    const r = await d.sendSms({ type: UPGRADES_NUDGE_SMS_TYPE, idempotencyKey: c.keys.nudge, to: w.mobile, body, storedBody: maskUpgradesLink(body), jobId: c.jobId, businessId: w.business_id });
    went = r.status === "sent" || r.status === "sent_unknown";
  }
  if (went) {
    await d.retireOlderLinks(c.jobId, w.id, link.id).catch((e) => console.error("upgrades watch: older link not retired", (e as Error).message));
    // The same record is marked sent (one row per key); until then the next tick tries the electrician again and the office is not due.
    const { error } = await admin.from("workflow_events").update({ details: { key: c.keys.nudge, worker_id: w.id, booking_id: c.booking.id, upgrades_ymd: c.ymd, test, sent: true } }).eq("job_id", c.jobId).eq("event_type", UPGRADES_NUDGE_EVENT).contains("details", { key: c.keys.nudge });
    if (error) console.error("upgrades watch: nudge not marked sent", error.message);
  } else await d.revokeLink(link.id).catch((e) => console.error("upgrades watch: unsent link not revoked", (e as Error).message));
  return went ? "sent" : "held";
}

async function emailOffice(d: UpgradesWatchDeps, c: Ctx): Promise<"sent" | "held"> {
  const [ib, eb] = await Promise.all([installerOffice(c.jobId), electricianBiz(c.booking.business_id)]);
  const to = (ib?.email ?? "").trim();
  if (!ib || !to) return "held";
  const { test, partnerIsTest } = await isTest(c.job, ib, eb);
  if (!test && !d.officeApproved) return "held";
  const mail = upgradesOfficeEmail({ jobNumber: c.job.job_number, electrician: bizName(eb) ?? "The electrician", upgradesStart: c.booking.scheduled_start, test });
  await d.record(c.jobId, UPGRADES_OFFICE_EMAIL_EVENT, "Installer office emailed: upgrades form not in", { key: c.keys.office, booking_id: c.booking.id, upgrades_ymd: c.ymd, test });
  if (test) {
    const r = await d.sendTestEmail({ jobId: c.jobId, jobSource: c.job.source, partnerIsTest, label: `upgrades_office:${c.jobId}:${c.ymd}`, actorId: null }, to, mail.subject, mail.html, mail.text);
    return r.status === "sent" ? "sent" : "held";
  }
  const r = await d.sendOfficeEmail({ actorId: null, recipient: "partner", to, contactName: bizName(ib), subject: mail.subject, message: mail.text, html: mail.html, text: mail.text, label: "upgrades_office", record: { businessId: ib.id }, idempotencyKey: c.keys.office });
  return r.status === "sent" ? "sent" : "held";
}

/** The red-flag email to the installer office with a copy to info@. The Needs me event was already recorded by the caller. */
async function redFlagEmail(d: UpgradesWatchDeps, c: Ctx, deadline: string): Promise<"sent" | "held"> {
  const [ib, eb] = await Promise.all([installerOffice(c.jobId), electricianBiz(c.booking.business_id)]);
  const to = (ib?.email ?? "").trim();
  if (!ib || !to) return "held";
  const { test, partnerIsTest } = await isTest(c.job, ib, eb);
  if (!test && !d.redFlagApproved) return "held";
  const mail = upgradesRedFlagEmail({ jobNumber: c.job.job_number, electrician: bizName(eb) ?? "The electrician", upgradesStart: c.booking.scheduled_start, installDeadlineYmd: deadline, test });
  // Recorded BEFORE the send, once per key: the sweep stops retrying from here.
  await d.record(c.jobId, UPGRADES_RED_FLAG_EMAIL_EVENT, "Installer office emailed: upgrades day is past the 30-day rule", { key: c.keys.redFlag, booking_id: c.booking.id, upgrades_ymd: c.ymd, test });
  if (test) {
    const r = await d.sendTestEmail({ jobId: c.jobId, jobSource: c.job.source, partnerIsTest, label: `upgrades_red_flag:${c.jobId}:${c.ymd}`, actorId: null }, to, mail.subject, mail.html, mail.text);
    return r.status === "sent" ? "sent" : "held";
  }
  const base = { actorId: null, recipient: "partner" as const, subject: mail.subject, message: mail.text, html: mail.html, text: mail.text, label: "upgrades_red_flag", record: { businessId: ib.id } };
  const r = await d.sendOfficeEmail({ ...base, to, contactName: bizName(ib), idempotencyKey: c.keys.redFlag });
  await d.sendOfficeEmail({ ...base, to: OFFICE_COPY_EMAIL, contactName: "Home Insulation Victoria", idempotencyKey: `${c.keys.redFlag}:copy` }).catch((e) => console.error("upgrades watch: office copy skipped", (e as Error).message));
  return r.status === "sent" ? "sent" : "held";
}
