// Part 2 (Jo 3 Nov 2026): tell the electrician (text with the no-login link) and the installer office (email) that an
// own job's safety check (PIESA) is theirs to book, per the installer's "who books" setting (bookerNotices).
//
// Retry (carried decision a): this function owns it. Each send has ONE key per job, round and channel — the round's
// electrician assignment id (`own-job-piesa:v1:<assignment>:office-email`, `own-job-piesa-link:v1:<assignment>:<attempt>`).
// It is safe to call again and again: anything already sent is skipped, anything held or failed is tried again. The
// hand-over sweep (sweepOwnJobPiesaHandoffs) calls it again for every handed-but-unbooked job, so a send that failed
// after the hand-over event was logged is retried on the next tick, never lost.
// - Email: deliverOnce (claim per key; held/"retry" outcomes try again; unknown outcomes never resend). Before the
//   claim: TEST partner → test-send; wording not approved / no email / trade messages paused → nothing recorded, retried.
// - Text: the link is minted ONLY when the text can go now (smsHoldReason), so held texts don't pile up links. A hold is
//   logged once per assignment and reason. A text the sender then refuses or fails has its link switched off. A hard
//   failure ("failed") is retried with the next attempt key, up to 3 tries, then one office item.
// - Missing link table (pending SQL): the text is held ("link not available"); the office email still goes.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { OWN_JOB_PIESA_TO_BOOK_EMAIL_APPROVED, electricianLinkText, officeToBookEmail } from "./electrician-link.core";
import { SET_PASSWORD_BASE } from "./set-password-link.core";

const db = admin as unknown as SupabaseClient;

export const OWN_JOB_PIESA_NOTICE_HELD_EVENT = "own_job_piesa_notice_held";
const TEXT_ATTEMPTS = 3;

export type InstallerOfficeEmailOutcome = { status: "sent" | "test_sent" | "not_approved" | "no_email" | "held" | "not_sent"; detail?: string };

/** One email to an installer office, once per key. Order: business → TEST partner (test-send) → approval → email on file →
 *  "Pause all trade messages" (before the claim, so a later try still sends) → claim once (deliverOnce) → partner sender. */
export async function emailInstallerOffice(p: { jobId: string; businessId: string; key: string; subject: string; text: string; jobUrl?: string; approved: boolean }): Promise<InstallerOfficeEmailOutcome> {
  const { data: biz, error } = await admin.from("businesses").select("id, name, trading_name, email, onboarding_notes").eq("id", p.businessId).maybeSingle();
  if (error) throw new Error(`Installer could not be read: ${error.message}`);
  if (!biz) return { status: "not_sent", detail: "Installer not found." };
  const to = String(biz.email ?? "").trim().toLowerCase();
  const [{ isTestPartner }, { partnerEmailLayout }, { deliverOnce }, { displayName }] = await Promise.all([
    import("./test-send.core"), import("./partner-email.core"), import("./in-house-booking-notices.server"), import("./display-name.core"),
  ]);
  const contactName = displayName(biz.trading_name || biz.name) || null;
  const partnerIsTest = isTestPartner(biz);
  const render = (test: boolean) => ({ to, subject: p.subject, ...partnerEmailLayout({ subject: p.subject, test, blocks: [...p.text.split("\n").filter(Boolean).map((t) => ({ kind: "p" as const, text: t })), ...(p.jobUrl ? [{ kind: "button" as const, label: "Open the job", url: p.jobUrl }] : [])] }) });
  if (partnerIsTest) {
    if (!to) return { status: "no_email" };
    let r: { status: string; detail?: string } | null = null;
    const sent = await deliverOnce(p.jobId, p.key, render(true), async (frozen) => {
      const { sendTestEmail } = await import("./test-send.server");
      r = await sendTestEmail({ jobId: p.jobId, jobSource: null, partnerIsTest, label: p.key, actorId: null }, frozen.to, frozen.subject, frozen.html, frozen.text);
      return r;
    });
    return sent ? { status: "test_sent" } : { status: "not_sent", detail: (r as { detail?: string } | null)?.detail ?? "Already tried." };
  }
  if (!p.approved) return { status: "not_approved" };
  if (!to) return { status: "no_email" };
  const paused = await (await import("./trade-pause.server")).tradeMessagesPausedNow({ businessId: biz.id, jobId: p.jobId });
  if (paused) return { status: "held", detail: paused };
  let r: { status: string; detail?: string } | null = null;
  const sent = await deliverOnce(p.jobId, p.key, render(false), async (frozen) => {
    const { sendOfficeEmail } = await import("./office-email.server");
    r = await sendOfficeEmail({ actorId: null, recipient: "partner", to: frozen.to, contactName, subject: frozen.subject, message: frozen.text, html: frozen.html, text: frozen.text, label: p.key, record: { businessId: biz.id }, pauseJobId: p.jobId, idempotencyKey: p.key });
    return r;
  });
  return sent ? { status: "sent" } : { status: "not_sent", detail: (r as { detail?: string } | null)?.detail ?? "Already tried." };
}

async function heldOnce(jobId: string, key: string, channel: "text" | "email", reason: string, needsOffice = false) {
  const { count, error } = await admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("event_type", OWN_JOB_PIESA_NOTICE_HELD_EVENT).contains("details", { key });
  if (error) throw new Error(error.message);
  if (count) return;
  const { logEvent } = await import("./workflow.server");
  await logEvent(jobId, null, OWN_JOB_PIESA_NOTICE_HELD_EVENT, `Electrician's safety check ${channel === "text" ? "text" : "email"} not sent yet: ${reason}`, { key, channel, reason, ...(needsOffice ? { needs_office: true } : {}) }, { internal: true });
}

type Assignment = { id: string; user_id: string; business_id: string | null; booking_confirmed_at: string | null };

/** The electrician's text with a fresh link, once per assignment (see the header for the retry rules). */
async function textElectrician(jobId: string, a: Assignment, electricianBusinessId: string, installer: string, address: string, jobSource: string | null): Promise<string> {
  const base = `own-job-piesa-link:v1:${a.id}`;
  const keys = Array.from({ length: TEXT_ATTEMPTS }, (_, i) => `${base}:${i + 1}`);
  const { data: prior, error } = await db.from("sms_messages").select("idempotency_key, status").in("idempotency_key", keys);
  if (error) throw new Error(error.message);
  const rows = (prior ?? []) as { idempotency_key: string; status: string }[];
  if (rows.some((r) => !["failed", "undelivered"].includes(r.status))) return "already";
  if (rows.length >= TEXT_ATTEMPTS) { await heldOnce(jobId, `${base}:gave_up`, "text", `the text failed ${TEXT_ATTEMPTS} times — call the electrician`, true); return "gave_up"; }
  const key = keys[rows.length]!;
  const [{ data: w }, { data: b }] = await Promise.all([
    admin.from("partner_workers").select("mobile").eq("business_id", electricianBusinessId).eq("profile_id", a.user_id).is("removed_at", null).limit(1).maybeSingle(),
    admin.from("businesses").select("phone, onboarding_notes").eq("id", electricianBusinessId).maybeSingle(),
  ]);
  const to = (w?.mobile as string | null | undefined) || (b?.phone as string | null | undefined) || null;
  const { isTestPartner } = await import("./test-send.core");
  if (jobSource === "qa_test" || isTestPartner(b)) {
    // TEST: the test sender only (Jo's phone allow-list), claimed once per assignment by a stable event id.
    const { stableUuid } = await import("./mitti-create-claim.core");
    const { data: done, error: de } = await db.from("workflow_events").select("id").eq("id", await stableUuid(`${base}:test`)).maybeSingle();
    if (de) throw new Error(de.message);
    if (done) return "already";
    let link: { id: string; url: string };
    const els = await import("./electrician-link.server");
    try { link = await els.createElectricianLink(jobId, electricianBusinessId); }
    catch (e) { await heldOnce(jobId, `${base}:no_link`, "text", "the link isn't available yet"); return `held: ${(e as Error).message}`; }
    const { error: ce } = await db.from("workflow_events").insert({ id: await stableUuid(`${base}:test`), job_id: jobId, actor_id: null, event_type: "own_job_piesa_link_test_sent", summary: "TEST: electrician's safety check link text", details: { key: base }, internal: true });
    if (ce) { await els.revokeElectricianLinks(jobId, "text_not_sent", { linkId: link.id }).catch(() => 0); if (ce.code === "23505") return "already"; throw new Error(ce.message); }
    const { sendTestSms } = await import("./test-send.server");
    const r = await sendTestSms({ jobId, jobSource, partnerIsTest: isTestPartner(b), label: base, actorId: null }, to ?? "", electricianLinkText({ installer, address, url: link.url }));
    return `test_${r.status}`;
  }
  const input = { type: "own_job_piesa_link" as const, idempotencyKey: key, to, body: "", jobId, businessId: electricianBusinessId };
  const { smsHoldReason, sendRealSms } = await import("./sms.server");
  const hold = await smsHoldReason(input);
  if (hold) { await heldOnce(jobId, `${base}:${hold}`, "text", hold); return `held: ${hold}`; }
  const els = await import("./electrician-link.server");
  let link: { id: string; url: string };
  try { link = await els.createElectricianLink(jobId, electricianBusinessId); }
  catch (e) { await heldOnce(jobId, `${base}:no_link`, "text", "the link isn't available yet"); return `held: ${(e as Error).message}`; }
  const r = await sendRealSms({ ...input, body: electricianLinkText({ installer, address, url: link.url }) });
  // A text that didn't go (or another run sent its own) leaves this link unused: switch it off.
  if (["blocked", "failed", "already"].includes(r.status)) await els.revokeElectricianLinks(jobId, "text_not_sent", { linkId: link.id }).catch(() => 0);
  return r.status;
}

/** Send what this job still needs. Returns a short summary (for logs and tests). Never throws for one channel's failure. */
export async function sendOwnJobPiesaNotices(jobId: string): Promise<string> {
  const { data: job, error } = await admin.from("jobs").select("stage, deleted_at, source, originating_installer_business_id").eq("id", jobId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!job || job.deleted_at || job.stage !== "piesa_and_install_window_pending") return "not_current";
  const own = await (await import("./own-job-piesa.server")).ownJobCallAndBook(jobId);
  if (own !== true) return own === null ? "unreadable" : "not_own_job";
  const { data: rows, error: ae } = await admin.from("job_assignments").select("id, user_id, business_id, booking_confirmed_at").eq("job_id", jobId).eq("role", "electrician").eq("active", true).order("assigned_at", { ascending: false });
  if (ae) throw new Error(ae.message);
  const a = ((rows ?? []) as Assignment[])[0];
  if (!a || !a.business_id) return "no_electrician";
  if (a.booking_confirmed_at) return "booked";
  const installerId = (job.originating_installer_business_id as string | null) ?? null;
  if (!installerId) return "no_installer";
  const [{ readPiesaBooker }, { bookerNotices }, { displayName }] = await Promise.all([import("./piesa-booker.server"), import("./piesa-booker.core"), import("./display-name.core")]);
  const booker = await readPiesaBooker(installerId);
  const n = bookerNotices(booker);
  const [{ data: ov }, { data: inst }, { data: el }] = await Promise.all([
    admin.from("job_overview").select("property_address, job_number").eq("id", jobId).maybeSingle(),
    admin.from("businesses").select("name, trading_name").eq("id", installerId).maybeSingle(),
    admin.from("businesses").select("name, trading_name").eq("id", a.business_id).maybeSingle(),
  ]);
  const address = (ov?.property_address as string | null | undefined) || (ov?.job_number as string | null | undefined) || "this job";
  const installer = displayName(inst?.trading_name || inst?.name) || "Installer";
  const electrician = displayName(el?.trading_name || el?.name) || "your electrician";
  const out: string[] = [];
  if (n.emailOffice) {
    try {
      const jobUrl = `${SET_PASSWORD_BASE}/field/${jobId}`;
      const mail = officeToBookEmail({ address, electrician, booker, jobUrl });
      const r = await emailInstallerOffice({ jobId, businessId: installerId, key: `own-job-piesa:v1:${a.id}:office-email`, subject: mail.subject, text: mail.text, jobUrl, approved: OWN_JOB_PIESA_TO_BOOK_EMAIL_APPROVED });
      out.push(`email: ${r.status}`);
    } catch (e) { out.push(`email: error ${(e as Error).message}`); }
  }
  if (n.textElectrician) {
    try { out.push(`text: ${await textElectrician(jobId, a, a.business_id, installer, address, (job.source as string | null) ?? null)}`); }
    catch (e) { out.push(`text: error ${(e as Error).message}`); }
  }
  return out.join("; ") || "nothing to send";
}
