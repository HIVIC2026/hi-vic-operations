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
import { OWN_JOB_PIESA_INSTALLER_NOT_TOLD_EVENT, OWN_JOB_PIESA_TO_BOOK_EMAIL_APPROVED, electricianLinkText } from "./own-job-electrician-link.core";
import { officeToBookEmail } from "./own-job-office-emails.core";
import { SET_PASSWORD_BASE } from "./set-password-link.core";

const db = admin as unknown as SupabaseClient;

export const OWN_JOB_PIESA_NOTICE_HELD_EVENT = "own_job_piesa_notice_held";
const TEXT_ATTEMPTS = 3;

export type InstallerOfficeEmailOutcome = { status: "sent" | "test_sent" | "not_approved" | "no_email" | "held" | "not_sent"; detail?: string };

/** One email to an installer office, once per key. Order: business → TEST partner (test-send) → approval → email on file →
 *  "Pause all trade messages" (before the claim, so a later try still sends) → claim once (deliverOnce) → partner sender. */
export async function emailInstallerOffice(p: { jobId: string; businessId: string; key: string; subject: string; text: string; jobUrl?: string; approved: boolean; /** Suite look (5 Nov 2026): the structured email when the builder gives one; otherwise the text lines are laid out. */ mail?: import("./own-job-office-emails.core").OfficeEmail }): Promise<InstallerOfficeEmailOutcome> {
  const { data: biz, error } = await admin.from("businesses").select("id, name, trading_name, email, onboarding_notes").eq("id", p.businessId).maybeSingle();
  if (error) throw new Error(`Installer could not be read: ${error.message}`);
  if (!biz) return { status: "not_sent", detail: "Installer not found." };
  const to = String(biz.email ?? "").trim().toLowerCase();
  const [{ isTestPartner }, { partnerEmailLayout }, { deliverOnce }, { displayName }] = await Promise.all([
    import("./test-send.core"), import("./partner-email.core"), import("./in-house-booking-notices.server"), import("./display-name.core"),
  ]);
  const contactName = displayName(biz.trading_name || biz.name) || null;
  const partnerIsTest = isTestPartner(biz);
  // A TEST job never emails a real installer office (same guard as the in-house notices).
  const { data: jobRow, error: jobErr } = await admin.from("jobs").select("source").eq("id", p.jobId).maybeSingle();
  // Suite look (5 Nov 2026): the job card and the greeting are best-effort reads — a job with no owner or property row still emails.
  const jobFacts = await (async () => {
    try {
      const { data: jf } = await admin.from("jobs").select("job_number, owners(full_name, phone), properties(address_line, suburb)").eq("id", p.jobId).maybeSingle();
      const jo = (Array.isArray(jf?.owners) ? jf?.owners[0] : jf?.owners) as { full_name: string | null; phone: string | null } | null | undefined;
      const jp = jf?.properties as { address_line: string | null; suburb: string | null } | null | undefined;
      return jf ? { jobNumber: (jf as { job_number?: string | null }).job_number ?? null, address: [jp?.address_line, jp?.suburb].filter(Boolean).join(", ") || null, owner: jo?.full_name ?? null, mobile: jo?.phone ?? null } : null;
    } catch { return null; }
  })();
  const greetName = contactName; // "Hi Rapid," — the trading name (Jo 5 Nov 2026)
  if (jobErr) throw new Error(`Job could not be read: ${jobErr.message}`);
  if ((jobRow?.source as string | null | undefined) === "qa_test" && !partnerIsTest) return { status: "not_sent", detail: "TEST job: not sent to a real installer." };
  const { officeEmailBlocks } = await import("./own-job-office-emails.core");
  const render = (test: boolean) => ({ to, subject: p.subject, ...(p.mail
    ? partnerEmailLayout({ subject: p.subject, heading: p.mail.heading, preview: p.mail.lines[0], test, blocks: officeEmailBlocks(p.mail, greetName, jobFacts, p.jobUrl ?? null) })
    : partnerEmailLayout({ subject: p.subject, test, blocks: [...p.text.split("\n").filter(Boolean).map((t) => ({ kind: "p" as const, text: t })), ...(p.jobUrl ? [{ kind: "button" as const, label: "Open the job", url: p.jobUrl }] : [])] })) });
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
  // Master switch off: nothing recorded, so a later try still sends.
  if (!(await (await import("./comms.server")).customerCommsEnabled())) return { status: "held", detail: "partner emails paused (master switch off)" };
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

async function heldOnce(jobId: string, key: string, channel: "text" | "email", reason: string, needsOffice = false, as?: { eventType: string; extra: Record<string, unknown> }, what?: string) {
  const eventType = as?.eventType ?? OWN_JOB_PIESA_NOTICE_HELD_EVENT;
  const { count, error } = await admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("event_type", eventType).contains("details", { key });
  if (error) throw new Error(error.message);
  if (count) return;
  const { logEvent } = await import("./workflow.server");
  await logEvent(jobId, null, eventType, as ? `Installer office email not sent: ${reason}` : `${what ?? `Electrician's safety check ${channel === "text" ? "text" : "email"}`} not sent yet: ${reason}`, { key, channel, reason, ...(needsOffice ? { needs_office: true } : {}), ...(as?.extra ?? {}) }, { internal: true });
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
    admin.from("partner_workers").select("mobile, full_legal_name").eq("business_id", electricianBusinessId).eq("profile_id", a.user_id).is("removed_at", null).limit(1).maybeSingle(),
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
    const els = await import("./own-job-electrician-link.server");
    try { link = await els.createElectricianLink(jobId, electricianBusinessId); }
    catch (e) { await heldOnce(jobId, `${base}:no_link`, "text", "the link isn't available yet"); return `held: ${(e as Error).message}`; }
    const { error: ce } = await db.from("workflow_events").insert({ id: await stableUuid(`${base}:test`), job_id: jobId, actor_id: null, event_type: "own_job_piesa_link_test_sent", summary: "TEST: electrician's safety check link text", details: { key: base }, internal: true });
    if (ce) { await els.revokeElectricianLinks(jobId, "text_not_sent", { linkId: link.id }).catch(() => 0); if (ce.code === "23505") return "already"; throw new Error(ce.message); }
    const { sendTestSms } = await import("./test-send.server");
    const r = await sendTestSms({ jobId, jobSource, partnerIsTest: isTestPartner(b), label: base, actorId: null }, to ?? "", electricianLinkText({ installer, address, url: link.url, firstName: (w as { full_legal_name?: string | null } | null)?.full_legal_name ?? null }));
    return `test_${r.status}`;
  }
  const input = { type: "own_job_piesa_link" as const, idempotencyKey: key, to, body: "", jobId, businessId: electricianBusinessId };
  const { smsHoldReason, sendRealSms } = await import("./sms.server");
  const hold = await smsHoldReason(input);
  if (hold) { await heldOnce(jobId, `${base}:${hold}`, "text", hold); return `held: ${hold}`; }
  const els = await import("./own-job-electrician-link.server");
  let link: { id: string; url: string };
  try { link = await els.createElectricianLink(jobId, electricianBusinessId); }
  catch (e) { await heldOnce(jobId, `${base}:no_link`, "text", "the link isn't available yet"); return `held: ${(e as Error).message}`; }
  const r = await sendRealSms({ ...input, body: electricianLinkText({ installer, address, url: link.url, firstName: (w as { full_legal_name?: string | null } | null)?.full_legal_name ?? null }) });
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
  const [{ whoBooksFor: readPiesaBooker }, { bookerNotices }, { displayName }] = await Promise.all([import("./who-books.server"), import("./piesa-booker.core"), import("./display-name.core")]);
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
      const r = await emailInstallerOffice({ jobId, businessId: installerId, key: `own-job-piesa:v1:${a.id}:office-email`, subject: mail.subject, text: mail.text, jobUrl, mail, approved: OWN_JOB_PIESA_TO_BOOK_EMAIL_APPROVED });
      out.push(`email: ${r.status}`);
      // Wording held: nobody told the installer. One office item per hand-over (it clears once the email goes or the check is booked).
      if (r.status === "not_approved") await heldOnce(jobId, `own-job-piesa:v1:${a.id}:installer-not-told`, "email", "installer not told yet — message wording not approved", false, { eventType: OWN_JOB_PIESA_INSTALLER_NOT_TOLD_EVENT, extra: { assignment_id: a.id, installer, address, needs_office: true } });
    } catch (e) { out.push(`email: error ${(e as Error).message}`); }
  }
  if (n.textElectrician) {
    try { out.push(`text: ${await textElectrician(jobId, a, a.business_id, installer, address, (job.source as string | null) ?? null)}`); }
    catch (e) { out.push(`text: error ${(e as Error).message}`); }
  }
  return out.join("; ") || "nothing to send";
}

// ====================================================================================================
// Part 3 Task 3 (Jo 3 Nov 2026): "add your Certificate of Electrical Safety" text with the electrician's link.
// ====================================================================================================

/** ONE text per electrician assignment and round ("now" = right after Part C was recorded without the certificate; the Task 5
 *  chase uses its own rounds). Same rules as textElectrician: the link is minted only when the text can go now; TEST jobs /
 *  TEST partners → the test sender, claimed once by a stable event; a hold is logged once per assignment, round and reason.
 *  Wording HELD (SMS type electrician_certificate_link; the chase reminder electrician_certificate_chase; wordingApproved:false) until Jo approves — until then nothing is sent
 *  and no link is minted. Returns a short status for logs and tests. Nothing when the certificate is already on the job.
 *  Part 3 Task 5: `text: "chase"` = the 2-business-day reminder wording (certificate-chase.core certificateChaseText). */
const CERT_TEXT = "Electrician's certificate text";
export async function textCertificateLink(jobId: string, round: string, opts: { text?: "add" | "chase"; facts?: import("./certificate-later.server").CertificateFacts } = {}): Promise<string> {
  const [{ certificateAddLinkText }, { certificateChaseText }] = await Promise.all([import("./certificate-later.core"), import("./certificate-chase.core")]);
  // Final fix wave item 2: the reminder has its own SMS type (and key / TEST claim), so Jo approves each text on its own.
  const chase = opts.text === "chase";
  return textLinkRound(jobId, {
    type: chase ? "electrician_certificate_chase" : "electrician_certificate_link", keyBase: chase ? "electrician-certificate-chase:v1" : "electrician-certificate-link:v1", round, what: CERT_TEXT,
    testEvent: chase ? "electrician_certificate_chase_test_sent" : "electrician_certificate_link_test_sent", testSummary: chase ? "TEST: electrician's certificate reminder text" : "TEST: electrician's certificate link text",
    due: (f) => (f.state === "waiting_for_certificate" ? null : `not_waiting (${f.state})`),
    render: chase ? certificateChaseText : certificateAddLinkText,
  }, opts.facts);
}

/** Part 3 Task 5 (Jo 3 Nov 2026): the reminder to enter the upgrades day, with the electrician's link (SMS type
 *  electrician_upgrades_day_link, HELD wordingApproved:false). Only while upgrades are needed, not done on the day, and no day
 *  is entered. Same once-per-assignment-and-round rules as textCertificateLink. */
export async function textUpgradesDayLink(jobId: string, round: string, facts?: import("./certificate-later.server").CertificateFacts): Promise<string> {
  const { upgradesDayLinkText } = await import("./certificate-chase.core");
  return textLinkRound(jobId, {
    type: "electrician_upgrades_day_link", keyBase: "electrician-upgrades-day-link:v1", round, what: "Electrician's upgrades day text",
    testEvent: "electrician_upgrades_day_link_test_sent", testSummary: "TEST: electrician's upgrades day link text",
    due: (f) => (f.state !== "upgrades_pending" ? `not_pending (${f.state})` : f.upgradesDaySet || f.upgradesToday ? "day_set" : null),
    render: upgradesDayLinkText,
  }, facts);
}

type LinkTextSpec = {
  type: "electrician_certificate_link" | "electrician_certificate_chase" | "electrician_upgrades_day_link"; keyBase: string; round: string; what: string;
  testEvent: string; testSummary: string;
  /** Null = the text is still due; else why not (returned as the status). */
  due: (f: import("./certificate-later.server").CertificateFacts) => string | null;
  render: (i: { first: string | null; address: string; url: string }) => string;
};
/** `known` = the caller's fresh certificate facts for this job (the chase sweeps read them just before), else read here. */
async function textLinkRound(jobId: string, spec: LinkTextSpec, known?: import("./certificate-later.server").CertificateFacts): Promise<string> {
  const { data: job, error } = await admin.from("jobs").select("stage, deleted_at, source").eq("id", jobId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!job || job.deleted_at || job.stage === "cancelled") return "not_current";
  const facts = known ?? await (await import("./certificate-later.server")).jobCertificateFacts(jobId);
  const notDue = spec.due(facts);
  if (notDue) return notDue;
  const { data: rows, error: ae } = await admin.from("job_assignments").select("id, user_id, business_id, booking_confirmed_at").eq("job_id", jobId).eq("role", "electrician").eq("active", true).order("assigned_at", { ascending: false });
  if (ae) throw new Error(ae.message);
  const a = ((rows ?? []) as Assignment[])[0];
  if (!a || !a.business_id) return "no_electrician";
  const base = `${spec.keyBase}:${a.id}:${spec.round}`;
  const { data: prior, error: pe } = await db.from("sms_messages").select("idempotency_key, status").eq("idempotency_key", base).maybeSingle();
  if (pe) throw new Error(pe.message);
  if (prior && !["failed", "undelivered"].includes((prior as { status: string }).status)) return "already";
  // Join (4 Nov 2026): the electrician is the Part 6 Team worker — the one the allocation event names, else (legacy REC
  // electricians with a login) the worker on the assignment's profile. The link is Part 6's worker link (worker_job_links,
  // /e/<token>: the same page that takes the upgrades day and the certificate), minted fresh for this text and the older
  // ones retired once it has gone; a text that did not go revokes the new link instead. The text goes to the worker's own
  // mobile — never the business phone (on an in-house job that is the installer's office).
  const els = await import("./electrician-link.server");
  const allocatedId = await (await import("./in-house-electrician.server")).allocatedWorkerId(jobId).catch(() => null);
  const workerQ = allocatedId
    ? admin.from("partner_workers").select("id, mobile, full_legal_name, business_id").eq("id", allocatedId).is("removed_at", null).maybeSingle()
    : admin.from("partner_workers").select("id, mobile, full_legal_name, business_id").eq("business_id", a.business_id).eq("profile_id", a.user_id).eq("trade_role", "electrician").is("removed_at", null).limit(1).maybeSingle();
  const [{ data: w, error: we }, { data: b }, { data: ov }] = await Promise.all([
    workerQ,
    admin.from("businesses").select("phone, onboarding_notes").eq("id", a.business_id).maybeSingle(),
    admin.from("job_overview").select("property_address, job_number").eq("id", jobId).maybeSingle(),
  ]);
  if (we) throw new Error(we.message);
  const worker = w as { id: string; mobile: string | null; full_legal_name: string | null; business_id: string } | null;
  if (!worker) { await heldOnce(jobId, `${base}:no_worker`, "text", "no Team electrician on the job", false, undefined, spec.what); return "held: no_worker"; }
  const { displayName } = await import("./display-name.core");
  const first = (displayName(worker.full_legal_name) || "").split(/\s+/)[0] || null;
  const address = (ov?.property_address as string | null | undefined) || (ov?.job_number as string | null | undefined) || "this job";
  const to = (worker.mobile ?? "").trim() || null;
  if (!to) { await heldOnce(jobId, `${base}:no_mobile`, "text", "the electrician has no mobile on file", false, undefined, spec.what); return "held: no_mobile"; }
  const mint = () => els.mintElectricianLink(jobId, worker.id, null, Date.now(), { keepOlder: true });
  const sent = (linkId: string) => els.retireOlderElectricianLinks(jobId, worker.id, linkId).catch(() => undefined);
  const unsent = (linkId: string) => els.revokeElectricianLink(linkId).catch(() => undefined);
  const { isTestPartner } = await import("./test-send.core");
  if ((job.source as string | null) === "qa_test" || isTestPartner(b)) {
    const { stableUuid } = await import("./mitti-create-claim.core");
    const claimId = await stableUuid(`${base}:test`);
    const { data: done, error: de } = await db.from("workflow_events").select("id").eq("id", claimId).maybeSingle();
    if (de) throw new Error(de.message);
    if (done) return "already";
    let link: { id: string; url: string };
    try { link = await mint(); }
    catch (e) { await heldOnce(jobId, `${base}:no_link`, "text", "the link isn't available yet", false, undefined, spec.what); return `held: ${(e as Error).message}`; }
    const { error: ce } = await db.from("workflow_events").insert({ id: claimId, job_id: jobId, actor_id: null, event_type: spec.testEvent, summary: spec.testSummary, details: { key: base }, internal: true });
    if (ce) { await unsent(link.id); if (ce.code === "23505") return "already"; throw new Error(ce.message); }
    const { sendTestSms } = await import("./test-send.server");
    const r = await sendTestSms({ jobId, jobSource: (job.source as string | null) ?? null, partnerIsTest: isTestPartner(b), label: base, actorId: null }, to, spec.render({ first, address, url: link.url }));
    if (r.status === "sent") await sent(link.id); else await unsent(link.id);
    return `test_${r.status}`;
  }
  // The recipient's business + the job reach the trade pause check inside the sender (sms.server, `businessId` + `jobId`).
  const input = { type: spec.type, idempotencyKey: base, to, body: "", jobId, businessId: a.business_id };
  const { smsHoldReason, sendRealSms } = await import("./sms.server");
  const hold = await smsHoldReason(input);
  if (hold) { await heldOnce(jobId, `${base}:${hold}`, "text", hold, false, undefined, spec.what); return `held: ${hold}`; }
  let link: { id: string; url: string };
  try { link = await mint(); }
  catch (e) { await heldOnce(jobId, `${base}:no_link`, "text", "the link isn't available yet", false, undefined, spec.what); return `held: ${(e as Error).message}`; }
  const { maskElectricianLinkInText } = await import("./electrician-link.core");
  const r = await sendRealSms({ ...input, body: spec.render({ first, address, url: link.url }), storedBody: maskElectricianLinkInText(spec.render({ first, address, url: link.url })) });
  if (r.status === "sent" || r.status === "sent_unknown") await sent(link.id); else await unsent(link.id);
  return r.status;
}
