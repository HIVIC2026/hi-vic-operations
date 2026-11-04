// New job flow Part 9 Task 8 (Jo 2 Nov 2026): the 30- and 7-day insurance / licence expiry reminders, swept from the
// 15-minute allocation tick. Rules + DRAFT wording: insurance-reminder.core. For every active approved business:
// public liability, workers comp and the business's electrical licence rows (latest expiry per kind), and each
// electrician's own licence expiry (partner_workers.licence_expires_on). Each step (30, 7) goes ONCE per business +
// document + expiry date: to the business's main email (businesses.email) AND a copy to info@homeinsulationvictoria.com.au
// (answer 17) — two sends, one key each (`…:office` for the copy). TEST partners → test-send; real businesses → held
// (recorded once per key as `insurance_reminder_held`) until INSURANCE_REMINDER_APPROVED, customer comms on and the trade
// pause lifted, then the existing guarded partner sender (its Idempotency-Key = the key). The claim
// (`insurance_reminder_sent`) is written only after the sender reports sent. A read failure logs and sends nothing.
// Never changes a credential, a booking or a stage; the hard block (businessDocsBlocker) is separate.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import {
  INSURANCE_REMINDER_APPROVED, INSURANCE_REMINDER_EVENT, INSURANCE_REMINDER_HELD_EVENT, INSURANCE_REMINDER_KINDS, OFFICE_COPY_EMAIL,
  dueInsuranceReminder, insuranceReminderKey, renderInsuranceReminder,
} from "./insurance-reminder.core";
import { melbourneToday } from "./melbourne-time.core";

type Biz = { id: string; name: string | null; email: string | null; onboarding_notes: string | null; is_active: boolean | null; onboarding_status: string | null };
type Due = { business: Biz; kind: string; expiresOn: string; person: { id: string; name: string } | null };
const PAGE = 200;

async function pageAll<T>(read: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await read(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/** Every (business, document, expiry) a reminder could be due for: latest expiry per business document kind, each electrician's licence. */
export async function insuranceReminderCandidates(): Promise<Due[]> {
  const businesses = await pageAll<Biz>((a, b) => admin.from("businesses").select("id, name, email, onboarding_notes, is_active, onboarding_status").eq("is_active", true).eq("onboarding_status", "approved").order("id").range(a, b));
  if (!businesses.length) return [];
  const ids = businesses.map((b) => b.id);
  const bizOf = new Map(businesses.map((b) => [b.id, b]));
  const kinds = INSURANCE_REMINDER_KINDS.filter((k) => k !== "worker_licence");
  const creds = await pageAll<{ business_id: string; kind: string; expires_at: string | null; verification: string }>((a, b) => admin.from("business_credentials").select("business_id, kind, expires_at, verification").in("business_id", ids).in("kind", [...kinds]).not("expires_at", "is", null).neq("verification", "rejected").order("id").range(a, b));
  const latest = new Map<string, string>();
  for (const c of creds) {
    const k = `${c.business_id}:${c.kind}`;
    const exp = String(c.expires_at).slice(0, 10);
    if (!latest.has(k) || latest.get(k)! < exp) latest.set(k, exp);
  }
  const out: Due[] = [];
  for (const [k, expiresOn] of latest) {
    const [businessId, kind] = k.split(":") as [string, string];
    out.push({ business: bizOf.get(businessId)!, kind, expiresOn, person: null });
  }
  const workers = await pageAll<{ id: string; business_id: string; full_legal_name: string | null; licence_expires_on: string | null }>((a, b) => admin.from("partner_workers").select("id, business_id, full_legal_name, licence_expires_on").in("business_id", ids).eq("trade_role", "electrician").is("removed_at", null).not("licence_expires_on", "is", null).order("id").range(a, b));
  for (const w of workers) {
    if (!w.licence_expires_on) continue;
    out.push({ business: bizOf.get(w.business_id)!, kind: "worker_licence", expiresOn: String(w.licence_expires_on).slice(0, 10), person: { id: w.id, name: w.full_legal_name?.trim() || "Electrician" } });
  }
  return out;
}

/** Keys already sent (claimed) and already held, read once per sweep. */
async function claimedKeys(type: string): Promise<Set<string>> {
  const rows = await pageAll<{ details: { key?: string } | null }>((a, b) => admin.from("admin_config_events").select("details").eq("event_type", type).order("id").range(a, b));
  return new Set(rows.map((r) => r.details?.key).filter((k): k is string => typeof k === "string"));
}

export async function sweepInsuranceReminders(now = new Date(), opts: { approved?: boolean } = {}): Promise<{ checked: number; sent: number; held: number }> {
  const approved = opts.approved ?? INSURANCE_REMINDER_APPROVED;
  const out = { checked: 0, sent: 0, held: 0 };
  let candidates: Due[]; let sent: Set<string>; let held: Set<string>;
  try { [candidates, sent, held] = await Promise.all([insuranceReminderCandidates(), claimedKeys(INSURANCE_REMINDER_EVENT), claimedKeys(INSURANCE_REMINDER_HELD_EVENT)]); }
  catch (e) { console.error("insurance reminder sweep: could not read", (e as Error).message); return out; }
  const today = melbourneToday(now);
  for (const d of candidates) {
    out.checked++;
    const stepKey = (days: number) => insuranceReminderKey(d.business.id, d.kind, d.expiresOn, days, d.person?.id ?? null);
    const done = [30, 7].filter((days) => sent.has(stepKey(days)));
    const due = dueInsuranceReminder(d.expiresOn, today, done);
    if (!due) continue;
    try {
      const r = await remindOne(d, due, stepKey(due), approved, sent, held);
      if (r.startsWith("email")) out.sent++;
      else if (r.startsWith("held")) out.held++;
    } catch (e) { console.error("insurance reminder failed", d.business.id, d.kind, (e as Error).message); }
  }
  return out;
}

async function remindOne(d: Due, days: number, key: string, approved: boolean, sent: Set<string>, held: Set<string>): Promise<string> {
  const to = d.business.email?.trim().toLowerCase() ?? "";
  if (!to) return "skipped: business has no main email";
  const { isTestPartner } = await import("./test-send.core");
  const test = isTestPartner(d.business);
  const hold = async (reason: string) => {
    if (!held.has(key)) {
      held.add(key);
      await admin.from("admin_config_events").insert({ actor_id: null, event_type: INSURANCE_REMINDER_HELD_EVENT, summary: `Insurance reminder held (${days} days, ${d.kind}) for ${d.business.name ?? d.business.id}: ${reason}`, details: { key, business_id: d.business.id, kind: d.kind, expires_on: d.expiresOn, days, person_id: d.person?.id ?? null, reason } });
    }
    return `held: ${reason}`;
  };
  if (!test) {
    const { customerCommsEnabled } = await import("./comms.server");
    const reason = !approved ? "wording not approved yet"
      : !(await customerCommsEnabled()) ? "customer communications are off"
      : await (await import("./trade-pause.server")).tradeMessagesPausedNow({ businessId: d.business.id });
    if (reason) return hold(reason);
  }
  const mail = renderInsuranceReminder({ kind: d.kind, expiresOn: d.expiresOn, businessName: d.business.name ?? "there", person: d.person?.name ?? null, test });
  const results: string[] = [];
  // Two sends, one key each: the business's main email, then the office copy (`:office`).
  for (const target of [{ to, key }, { to: OFFICE_COPY_EMAIL, key: `${key}:office` }]) {
    if (sent.has(target.key)) { results.push("already sent"); continue; }
    const claim = async (status: string) => {
      sent.add(target.key);
      await admin.from("admin_config_events").insert({ actor_id: null, event_type: INSURANCE_REMINDER_EVENT, summary: `Insurance reminder (${days} days, ${d.kind}) to ${target.to} for ${d.business.name ?? d.business.id}: ${status}`, details: { key: target.key, business_id: d.business.id, kind: d.kind, expires_on: d.expiresOn, days, person_id: d.person?.id ?? null, to: target.to, test } });
    };
    if (test) {
      await claim("test");
      const { sendTestEmail } = await import("./test-send.server");
      const r = await sendTestEmail({ jobId: null, jobSource: null, partnerIsTest: true, label: target.key, actorId: null }, target.to, mail.subject, mail.html, mail.text);
      results.push(`(test) ${r.status}: ${r.detail}`);
      continue;
    }
    const { sendOfficeEmail } = await import("./office-email.server");
    const r = await sendOfficeEmail({ actorId: null, recipient: "partner", to: target.to, contactName: d.business.name, subject: mail.subject, message: mail.text, html: mail.html, text: mail.text, label: target.key, record: { businessId: d.business.id }, idempotencyKey: target.key });
    if (r.status !== "sent") { await hold(r.status === "blocked" ? r.detail : `send failed: ${r.detail}`); results.push(`${r.status}: ${r.detail}`); continue; }
    await claim("sent");
    results.push(`sent: ${r.detail}`);
  }
  return results.some((r) => r.startsWith("sent") || r.startsWith("(test)")) ? `email ${results.join(" / ")}` : `held: ${results.join(" / ")}`;
}
