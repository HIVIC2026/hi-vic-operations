// Part 9 Task 7: send the GO / DON'T START email after a GO slot run (called by prestart.server runPrestart only).
// Installer business office email through the guarded partner sender (`sendOfficeEmail`: master switch, trade pause,
// recipient rule, Resend Idempotency-Key = the key); the info@ copy of a DON'T START through `sendInHouseOfficeAlert`
// (key `:office`). TEST job / TEST partner → test-send. Real offices: nothing (and nothing recorded) while
// GO_EMAIL_APPROVED is false ("awaiting approval"; wording approved by Jo 4 Nov 2026, switch flipped by the coordinator); when approved, a hold (comms off / trade pause / blocked / failed
// send) is recorded once per key as `go_email_held`, claims nothing and is retried on the next call; a send is claimed
// (`go_email_sent`, one per key + recipient) only after the sender reports `sent`. A read failure throws (the caller
// logs it; the check itself is already recorded). Never changes a booking, a check or a stage.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import { GO_EMAIL_APPROVED, GO_EMAIL_EVENT, GO_EMAIL_HELD_EVENT, GO_EMAIL_OFFICE_COPY_TO, goEmail, goEmailKey } from "./go-email.core";
import { classifyPrestartFailures, isGoSlot, type GoSlot } from "./prestart.core";

export type GoResult = { passed: boolean; failures: string[]; /** The install start the check was recorded for. */ start: string };

async function once(jobId: string, type: string, key: string, to?: string): Promise<boolean> {
  const { data, error } = await admin.from("workflow_events").select("id").eq("job_id", jobId).eq("event_type", type).contains("details", to ? { key, to } : { key }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return !!data;
}

export async function sendGoEmail(jobId: string, slot: GoSlot, result: GoResult, opts: { approved?: boolean; now?: Date } = {}): Promise<string> {
  const currentFailures=(await import("./worker-compliance.core")).currentWorkerRequirementLines(result.failures);
  if(currentFailures.length!==result.failures.length && currentFailures.length===0)return "skipped: retired requirement only; await current GO check";
  result={...result,failures:currentFailures};
  const approved = opts.approved ?? GO_EMAIL_APPROVED;
  if (await (await import("./qa-inbox.server")).qaDeliveryHeld(jobId)) return "skipped: TEST delivery held";
  const [{ data: job, error: je }, { data: asg, error: ae }] = await Promise.all([
    admin.from("jobs").select("id, job_number, source, deleted_at, properties(address_line, suburb, postcode)").eq("id", jobId).maybeSingle(),
    admin.from("job_assignments").select("business_id").eq("job_id", jobId).eq("role", "installer").eq("active", true).limit(1).maybeSingle(),
  ]);
  if (je) throw new Error(je.message);
  if (ae) throw new Error(ae.message);
  const j = job as { id: string; job_number: string; source: string | null; deleted_at: string | null; properties: { address_line: string | null; suburb: string | null; postcode: string | null } | null } | null;
  if (!j || j.deleted_at) return "skipped: job not found";
  const bizId = (asg as { business_id: string | null } | null)?.business_id ?? null;
  if (!bizId) return "skipped: no installer assigned";
  const { data: biz, error: be } = await admin.from("businesses").select("id, name, email, onboarding_notes").eq("id", bizId).maybeSingle();
  if (be) throw new Error(be.message);
  const bz = biz as { id: string; name: string | null; email: string | null; onboarding_notes: string | null } | null;
  const to = bz?.email?.trim().toLowerCase() ?? "";
  if (!to) return "skipped: installer business has no office email";
  const { isTestPartner } = await import("./test-send.core");
  const partnerIsTest = isTestPartner(bz ?? {});
  const test = j.source === "qa_test" || partnerIsTest;
  if (!test && !approved) return "awaiting approval"; // flag off (wording approved 4 Nov 2026, flips at go-live): nothing sent, nothing recorded
  const key = goEmailKey(jobId, result.start, slot);
  const officeKey = `${key}:office`;
  const copyOffice = !result.passed; // info@ gets every DON'T START, never a GO
  const officeDone = await once(jobId, GO_EMAIL_EVENT, key, to);
  const copyDone = copyOffice ? await once(jobId, GO_EMAIL_EVENT, officeKey, GO_EMAIL_OFFICE_COPY_TO) : true;
  if (officeDone && copyDone) return "already sent";
  // The Lead Installer the GO check itself read (prestart.server leadInstallerCert) — the same person, never another read.
  const lead = await (await import("./prestart.server")).leadInstallerCert(jobId).then((l) => (l.found ? l.name : null)).catch(() => null);
  const p = j.properties;
  const address = [p?.address_line?.trim(), [p?.suburb?.trim(), p?.postcode?.trim()].filter(Boolean).join(" ")].filter(Boolean).join(", ") || j.job_number;
  const { TEST_APP_BASE } = await import("./test-send.server");
  const { SET_PASSWORD_BASE } = await import("./set-password-link.core");
  // Jo 4 Nov 14:40: each failure is classed fixable / must_move against the booked start and the clock now (unknown = must_move).
  const mail = goEmail({ jobNumber: j.job_number, address, startIso: result.start, lead, failures: classifyPrestartFailures(result.failures, { start: result.start, now: opts.now ?? new Date() }), slot, link: `${test ? TEST_APP_BASE : SET_PASSWORD_BASE}/field/${j.id}`, test });
  const claim = (k: string, recipient: string) => logEvent(jobId, null, GO_EMAIL_EVENT, `${result.passed ? "GO" : "DON'T START"} email (${slot}) to ${recipient}`, { key: k, slot, passed: result.passed, start: result.start, to: recipient, business_id: bz!.id, test }, { internal: true });
  const hold = async (reason: string) => {
    if (!(await once(jobId, GO_EMAIL_HELD_EVENT, key))) await logEvent(jobId, null, GO_EMAIL_HELD_EVENT, `GO / DON'T START email held: ${reason}`, { key, slot, start: result.start, business_id: bz!.id, reason }, { internal: true });
    return `held: ${reason}`;
  };
  if (test) {
    // TEST sends are recorded once per recipient before the send (the test sender has no idempotency key of its own).
    const { sendTestEmail } = await import("./test-send.server");
    const ctx = { jobId, jobSource: j.source, partnerIsTest, actorId: null };
    const out: string[] = [];
    if (!officeDone) { await claim(key, to); const r = await sendTestEmail({ ...ctx, label: key }, to, mail.subject, mail.html, mail.text); out.push(`${to} ${r.status}`); }
    if (copyOffice && !copyDone) { await claim(officeKey, GO_EMAIL_OFFICE_COPY_TO); const r = await sendTestEmail({ ...ctx, label: officeKey }, GO_EMAIL_OFFICE_COPY_TO, mail.subject, mail.html, mail.text); out.push(`${GO_EMAIL_OFFICE_COPY_TO} ${r.status}`); }
    return `sent (test): ${out.join(", ")}`;
  }
  // Real installer offices (approved): the same holds Part 7's Lead Installer email uses, recorded once per key.
  const { customerCommsEnabled } = await import("./comms.server");
  const reason = !(await customerCommsEnabled()) ? "customer communications are off" : await (await import("./trade-pause.server")).tradeMessagesPausedNow({ businessId: bz!.id, jobId });
  if (reason) return hold(reason);
  const out: string[] = [];
  if (!officeDone) {
    const { sendOfficeEmail } = await import("./office-email.server");
    const r = await sendOfficeEmail({ actorId: null, recipient: "partner", to, contactName: bz!.name, subject: mail.subject, message: mail.text, html: mail.html, text: mail.text, label: key, record: { businessId: bz!.id }, idempotencyKey: key, pauseJobId: jobId });
    if (r.status !== "sent") return hold(r.status === "blocked" ? r.detail : `send failed: ${r.detail}`);
    await claim(key, to);
    out.push(`${to} sent`);
  }
  if (copyOffice && !copyDone) {
    const { sendInHouseOfficeAlert } = await import("./in-house-office-alert.server");
    const r = await sendInHouseOfficeAlert({ jobId, jobSource: j.source, actorId: "system", to: GO_EMAIL_OFFICE_COPY_TO, subject: mail.subject, html: mail.html, text: mail.text, idempotencyKey: officeKey });
    if (r.status !== "sent") return hold(`office copy ${r.status}: ${r.detail}`);
    await claim(officeKey, GO_EMAIL_OFFICE_COPY_TO);
    out.push(`${GO_EMAIL_OFFICE_COPY_TO} sent`);
  }
  return `sent: ${out.join(", ")}`;
}

/** G6 S1 (final Part 9 review, 4 Nov 2026): the GO / DON'T START email for a slot that already ran but was never claimed
 *  (`go_email_sent` for its key) is sent again from the recorded slot row — a hold (comms off, trade pause, sender down)
 *  or a crash after the row was written must not leave the office without the email. Called by prestart.server's sweep
 *  on every tick before the start; nothing re-runs the check. `sendGoEmail` itself is idempotent per recipient (an
 *  office send that landed while the info@ copy failed sends only the copy). Returns how many slots were (re)sent. A read
 *  failure throws (the sweep logs it). */
export async function retryUnsentGoEmails(jobId: string, start: string, now = new Date()): Promise<number> {
  if (now.getTime() >= Date.parse(start)) return 0;
  const { data, error } = await admin.from("pre_start_checks").select("scheduled_start, trigger, passed, failures, checked_at").eq("job_id", jobId).eq("scheduled_start", start).order("checked_at", { ascending: false });
  if (error) throw new Error(error.message);
  const latestPerSlot = new Map<GoSlot, { passed: boolean; failures: string[] }>();
  for (const r of (data ?? []) as { trigger?: string | null; passed: boolean; failures: unknown }[]) {
    const slot = String(r.trigger ?? "");
    if (!isGoSlot(slot) || latestPerSlot.has(slot)) continue;
    latestPerSlot.set(slot, { passed: r.passed, failures: Array.isArray(r.failures) ? (r.failures as string[]) : [] });
  }
  let sent = 0;
  for (const [slot, r] of latestPerSlot) {
    if (await once(jobId, GO_EMAIL_EVENT, goEmailKey(jobId, start, slot))) continue; // the office email was claimed (the copy, if any, is handled inside sendGoEmail)
    const out = await sendGoEmail(jobId, slot, { passed: r.passed, failures: r.failures, start }, { now });
    if (out.startsWith("sent")) sent++;
    else if (out !== "awaiting approval" && out !== "already sent") console.warn("GO email retry not sent", jobId, slot, out);
  }
  return sent;
}
