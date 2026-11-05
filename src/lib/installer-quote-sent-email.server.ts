// "Quote sent" email to the installer's business office (Jo 5 Nov 2026 22:45). Called from `releaseQuoteToOwner`
// (office-quote-review.server) once the quote is committed as sent and the owner has been told — detached with the
// request's waitUntil, otherwise inline — for every quote; this module decides (installer's own customer, installation
// quote, sent, job open) and does nothing for HIV leads. Same shape as the "Enter your price" email
// (boss-price-link.server): ONE `customer_email_sends` attempt per quote (`installerQuoteSentKey`) claimed BEFORE the
// `installer_quote_sent_email` event and the send; held reasons (flag off / no office email / trade messages paused) are
// recorded ONCE as `installer_quote_sent_email_held` and retried by `sweepInstallerQuoteSentEmails` on the 15-minute tick
// (sent quotes of the last 30 days with no attempt yet); TEST jobs / TEST partners → test-send; real partners →
// `sendOfficeEmail` (the one partner email sender, master switch + trade pause inside it).
// A replacement quote (office-quote-review's `installer_price_quote_replaced` event, read through `ownQuoteReplacement`)
// gets the "Updated quote sent." wording. Never throws to its caller; never changes a stage or a quote.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import {
  INSTALLER_QUOTE_SENT_EMAIL_APPROVED, INSTALLER_QUOTE_SENT_EVENT, INSTALLER_QUOTE_SENT_HELD_EVENT, INSTALLER_QUOTE_SENT_PURPOSE,
  firstNameOf, installerQuoteSentKey, installerQuoteSentLink, installerQuoteSentPlan, renderInstallerQuoteSentEmail,
} from "./installer-quote-sent-email.core";

type JobRow = { id: string; job_number: string; source: string | null; channel: string | null; deleted_at: string | null; originating_installer_business_id: string | null; properties: { address_line: string | null; suburb: string | null; postcode: string | null } | null; owners: { full_name: string | null } | null };
type QuoteRow = { id: string; kind: string; status: string | null; sent_at: string | null; customer_total_inc_gst: number | string | null };
type BizRow = { id: string; name: string | null; signer_name: string | null; email: string | null; onboarding_notes: string | null };

export async function emailInstallerQuoteSent(jobId: string, quoteId: string, opts: { approved?: boolean } = {}): Promise<string> {
  try {
    const key = installerQuoteSentKey(quoteId);
    const [{ data: job }, { data: quote }, { data: attempt }] = await Promise.all([
      admin.from("jobs").select("id, job_number, source, channel, deleted_at, originating_installer_business_id, properties(address_line, suburb, postcode), owners(full_name)").eq("id", jobId).maybeSingle(),
      admin.from("quotes").select("id, kind, status, sent_at, customer_total_inc_gst").eq("id", quoteId).eq("job_id", jobId).maybeSingle(),
      admin.from("customer_email_sends").select("id").eq("job_id", jobId).eq("idempotency_key", key).maybeSingle(),
    ]);
    const j = job as unknown as JobRow | null;
    const q = quote as unknown as QuoteRow | null;
    if (!j) return "skipped: job not found";
    if (!q) return "skipped: quote not found";
    // Cheap refusals first (HIV leads, fixes quotes, unsent, closed) — no business read, nothing recorded.
    const pre = installerQuoteSentPlan({ channel: j.channel, kind: q.kind, sentAt: q.sent_at, deleted: !!j.deleted_at, approved: true, test: true, officeEmail: "x", paused: null, alreadyAttempted: !!attempt });
    if (pre.action === "skip") return `skipped: ${pre.reason}`;
    if (pre.action === "done") return "email already attempted";
    if (!j.originating_installer_business_id) return "skipped: no installer business on the job";
    // Jo 6 Nov 2026: a quote that replaces one already sent to the owner (the office sent a new installer price) reads
    // "Updated quote sent." — same email, same one-per-quote key. A failed check throws → nothing sent now, the sweep retries.
    const updated = !!(await (await import("./own-customer-messages.server")).ownQuoteReplacement(jobId, quoteId));
    const { data: biz } = await admin.from("businesses").select("id, name, signer_name, email, onboarding_notes").eq("id", j.originating_installer_business_id).maybeSingle();
    const b = (biz ?? null) as BizRow | null;
    const { isTestPartner } = await import("./test-send.core");
    const test = j.source === "qa_test" || isTestPartner(b ?? {});
    // Jo 30 Oct 2026: "Pause all trade messages" — held BEFORE the claim (TEST unchanged), so a later run can still send it.
    const tradePaused = test ? null : await (await import("./trade-pause.server")).tradeMessagesPausedNow({ jobId, businessId: b?.id ?? j.originating_installer_business_id });
    const plan = installerQuoteSentPlan({ channel: j.channel, kind: q.kind, sentAt: q.sent_at, deleted: !!j.deleted_at, approved: opts.approved ?? INSTALLER_QUOTE_SENT_EMAIL_APPROVED, test, officeEmail: b?.email, paused: tradePaused, alreadyAttempted: !!attempt });
    if (plan.action === "skip") return `skipped: ${plan.reason}`;
    if (plan.action === "done") return "email already attempted";
    if (plan.action === "held") {
      const { data: held } = await admin.from("workflow_events").select("id, details").eq("job_id", jobId).eq("event_type", INSTALLER_QUOTE_SENT_HELD_EVENT);
      const heldBefore = ((held ?? []) as { details: unknown }[]).some((e) => (e.details as { key?: string } | null)?.key === key);
      if (!heldBefore) await logEvent(jobId, null, INSTALLER_QUOTE_SENT_HELD_EVENT, `"Quote sent" email to the installer's office not sent — ${plan.reason}. Retried on the 15-minute tick for 30 days.`, { key, quote_id: quoteId, business_id: b?.id ?? j.originating_installer_business_id, reason: plan.reason }, { internal: true });
      return `held: ${plan.reason}`;
    }
    // Claim the one attempt per quote BEFORE the event and the send; a lost race means another run already has it.
    const claim = await admin.from("customer_email_sends").insert({ job_id: jobId, purpose: INSTALLER_QUOTE_SENT_PURPOSE, idempotency_key: key }).select("id").maybeSingle();
    if (claim.error || !claim.data) return "email already attempted";
    await logEvent(jobId, null, INSTALLER_QUOTE_SENT_EVENT, `Installer's office emailed "Quote sent" for ${j.job_number} (Jo 5 Nov 2026) — email prepared`, { key, quote_id: quoteId, business_id: b?.id ?? j.originating_installer_business_id, to: plan.to }, { internal: true });
    const { SET_PASSWORD_BASE } = await import("./set-password-link.core");
    const { TEST_APP_BASE, sendTestEmail } = await import("./test-send.server");
    const base = test ? TEST_APP_BASE : SET_PASSWORD_BASE;
    const { quoteExpiresAt } = await import("./quote-expiry.core");
    const { lastValidInstant } = await import("./owner-quote-email.core");
    const p = j.properties;
    const address = [p?.address_line?.trim(), [p?.suburb?.trim(), p?.postcode?.trim() ? `VIC ${p.postcode.trim()}` : null].filter(Boolean).join(" ")].filter(Boolean).join(", ") || "the property";
    const ownerFull = j.owners?.full_name?.trim() || "the owner";
    const m = renderInstallerQuoteSentEmail({
      recipientFirst: firstNameOf(b?.signer_name), ownerFirst: ownerFull === "the owner" ? null : firstNameOf(ownerFull), ownerFull,
      jobNumber: j.job_number, address, totalIncGst: Number(q.customer_total_inc_gst ?? 0),
      validUntil: lastValidInstant(quoteExpiresAt(q.sent_at as string)), quoteUrl: installerQuoteSentLink(base, jobId), updated, test,
    });
    const r = test
      ? await sendTestEmail({ jobId, jobSource: j.source, partnerIsTest: isTestPartner(b ?? {}), label: key, actorId: null }, plan.to, m.subject, m.html, m.text)
      : await (await import("./office-email.server")).sendOfficeEmail({ actorId: null, recipient: "partner", to: plan.to, contactName: b?.name ?? null, subject: m.subject, message: m.text, label: INSTALLER_QUOTE_SENT_PURPOSE, record: { businessId: b?.id ?? j.originating_installer_business_id }, html: m.html, text: m.text, idempotencyKey: key, pauseJobId: jobId });
    // The claim row stays either way (one attempt per quote); only its status records the outcome.
    await admin.from("customer_email_sends").update({ status: r.status === "sent" ? "sent" : "failed", sent_at: r.status === "sent" ? new Date().toISOString() : null, error: r.status === "sent" ? null : r.detail ?? null }).eq("id", claim.data.id);
    return `email${test ? " (test)" : ""} ${r.status}: ${r.detail}`;
  } catch (e) { return `installer "Quote sent" email not sent — ${(e as Error).message}`; }
}

/** Sent quotes this many days back are looked at by the sweep; older held ones are left alone. */
export const INSTALLER_QUOTE_SENT_SWEEP_DAYS = 30;
/** Emails attempted per tick, at most. */
export const INSTALLER_QUOTE_SENT_SWEEP_CAP = 50;

async function pagedRows(what: string, page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 200) {
    const { data, error } = await page(from, from + 199);
    if (error) throw new Error(`Could not read ${what}: ${error.message}`);
    out.push(...((data ?? []) as Record<string, unknown>[]));
    if ((data ?? []).length < 200) return out;
  }
}

/** The 15-minute tick: every installation quote on an installer's own-customer job sent in the last 30 days with no
 *  `customer_email_sends` attempt yet (held earlier — no office email, trade messages paused — or never reached) goes through
 *  `emailInstallerQuoteSent` again, which decides and claims as usual. Reads page 200 rows at a time; any read error logs and
 *  stops the run with nothing sent (never a partial list). At most 50 emails a run. */
export async function sweepInstallerQuoteSentEmails(now = new Date()): Promise<{ checked: number; sent: number; held: number }> {
  const out = { checked: 0, sent: 0, held: 0 };
  let due: { jobId: string; quoteId: string }[] = [];
  try {
    const since = new Date(now.getTime() - INSTALLER_QUOTE_SENT_SWEEP_DAYS * 86_400_000).toISOString();
    const quotes = await pagedRows("sent own-customer quotes", (a, b) => admin.from("quotes").select("id, job_id, jobs!inner(channel, deleted_at)").eq("kind", "installation").eq("jobs.channel", "installer_sourced").is("jobs.deleted_at", null).not("sent_at", "is", null).gte("sent_at", since).order("sent_at", { ascending: true }).range(a, b));
    const keys = quotes.map((q) => installerQuoteSentKey(String(q["id"])));
    const attempted = new Set<string>();
    const { chunkIds } = await import("./sweep-batch.core");
    for (const c of chunkIds(keys)) {
      for (const r of await pagedRows("installer quote-sent attempts", (a, b) => admin.from("customer_email_sends").select("idempotency_key").eq("purpose", INSTALLER_QUOTE_SENT_PURPOSE).in("idempotency_key", c).range(a, b))) attempted.add(String(r["idempotency_key"]));
    }
    due = quotes.filter((q) => !attempted.has(installerQuoteSentKey(String(q["id"])))).map((q) => ({ jobId: String(q["job_id"]), quoteId: String(q["id"]) }));
  } catch (e) {
    console.error('installer "Quote sent" email sweep: read failed, nothing sent', (e as Error).message);
    return out;
  }
  for (const d of due.slice(0, INSTALLER_QUOTE_SENT_SWEEP_CAP)) {
    out.checked++;
    const r = await emailInstallerQuoteSent(d.jobId, d.quoteId);
    if (/\bsent:/.test(r)) out.sent++;
    else if (r.startsWith("held")) out.held++;
  }
  return out;
}
