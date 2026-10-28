// Automatic retry for failed Mitti form creation. A cron route (Task 5) calls runMittiRetrySweep once a minute.
// Rules live in mitti-retry.core.ts (pure). Per failed form: wait 2 minutes, check Mitti for a form already made
// for this job, link it if there is exactly one, create nothing if we cannot tell, otherwise release the old attempt
// and try again through the normal creator (and its claim guard). Two retries, then one email to the office.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import { formatPropertyAddress } from "./address";
import { mittiApi, pickUser, type MittiCall } from "./mitti.core";
import { pickupTemplateMatches } from "./mitti-pickup.core";
import { CLAIM_HELD, CLAIM_EVENT, RELEASE_EVENT, UNCERTAIN_EVENT, isUniqueViolation, stableUuid, type MittiFormKind } from "./mitti-create-claim.core";
import {
  ALERT_SENT_EVENT, MAX_RETRIES, MITTI_RETRY_FROM, RETRY_LINKED_EVENT, RETRY_NOT_NEEDED_EVENT, RETRY_STARTED_EVENT,
  alertEmail, auditIdentity, collectFailureCases, matchAudits, nextAction, retriesFor, runStartedAt, type AuditToMatch, type FailureCase, type WorkflowEventRow,
} from "./mitti-retry.core";
import { retryable } from "./onsite-ready-check.core";
import { PIESA_AUTOFORM_FAILED_EVENT } from "./piesa-autoform.core";
import { PIISA_AUDIT_CREATED_EVENT, PIISA_AUTOSEND_FAILED_EVENT } from "./piisa-autosend.core";
import { FIXES_FORM_CREATED_EVENT, FIXES_FORM_HELD_EVENT } from "./fixes-day.core";
import { SET_PASSWORD_BASE } from "./set-password-link.core";

export const RETRY_ERROR_EVENT = "mitti_retry_error";
/** Look back this far before the failed attempt began when searching Mitti (clock differences; matching is strict anyway). */
const SEARCH_SLACK_MS = 5 * 60_000;
/** Only this much history is read each minute (I7): a failure older than this is left to the office. */
const LOOKBACK_MS = 14 * 86_400_000;
/** Mitti's audit search page size (mitti.core searchAudits). A full page may hide more forms: never create then (M3). */
const SEARCH_PAGE_LIMIT = 200;
/** The Mitti user the portal's API token belongs to (I1). After a lost reply the share / set-owner calls never ran, so a
 *  form Mitti did make is still owned by this account. Unset = unknown: such a form is never adopted (the office is
 *  emailed instead). Set it to the token user's Mitti user id. */
export const MITTI_API_USER_ENV = "MITTI_API_USER_ID";
export type RetrySweepOpts = { now?: Date; callFor?: (jobId: string) => MittiCall };
export type RetrySweepResult = { checked: number; linked: number; retried: number; alerted: number };

/** Every event type collectFailureCases / retriesFor read. */
const EVENT_TYPES = [
  "mitti_audit_create_uncertain", "mitti_access_needed", PIESA_AUTOFORM_FAILED_EVENT, FIXES_FORM_HELD_EVENT, PIISA_AUTOSEND_FAILED_EVENT,
  RETRY_LINKED_EVENT, RETRY_NOT_NEEDED_EVENT, ALERT_SENT_EVENT, RETRY_STARTED_EVENT, RELEASE_EVENT,
  "mitti_audit_created", "mitti_audit_reshared", "mitti_access_override", "mitti_audit_linked", PIISA_AUDIT_CREATED_EVENT, FIXES_FORM_CREATED_EVENT,
];

async function loadEvents(now: Date): Promise<WorkflowEventRow[]> {
  const out: WorkflowEventRow[] = [];
  const PAGE = 1000;
  const since = new Date(Math.max(Date.parse(MITTI_RETRY_FROM), now.getTime() - LOOKBACK_MS)).toISOString();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin.from("workflow_events").select("job_id, event_type, created_at, summary, details")
      .in("event_type", EVENT_TYPES).gte("created_at", since).order("created_at", { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as WorkflowEventRow[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

const msgOf = (e: unknown) => (e instanceof Error ? e.message : "Mitti error");
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

// ---------- adopting a form that Mitti already made ----------
/**
 * Record a form found in Mitti against the job, the same way each creator records its own on success.
 * ready_check: the existing link step. piesa: assessments.external_mitti_id. fixes: fixes_form_created.
 * install_day: mitti_piisa_audit_created.
 */
export async function adoptExistingAudit(
  jobId: string, kind: MittiFormKind, auditId: string,
  ctx: { bookingId?: string | null; templateId?: string | null; assigneeEmail?: string | null; call?: MittiCall } = {},
): Promise<void> {
  switch (kind) {
    case "ready_check": {
      const { linkMittiReadyCheckToJob } = await import("./mitti-pickup.server");
      await linkMittiReadyCheckToJob(null, { auditId, jobId }, ctx.call);
      return;
    }
    case "piesa": {
      const { data: a } = await admin.from("assessments").select("id").eq("job_id", jobId).maybeSingle();
      const fields = {
        external_mitti_id: auditId, mitti_template_id: ctx.templateId ?? null, mitti_assignee_email: ctx.assigneeEmail ?? null,
        mitti_last_error: null, mitti_sync_status: "pending" as const,
      };
      if (a) { const { error } = await admin.from("assessments").update(fields).eq("id", a.id); if (error) throw new Error(error.message); return; }
      const { data: asg } = await admin.from("job_assignments").select("user_id").eq("job_id", jobId).eq("role", "electrician").eq("active", true).maybeSingle();
      const { error } = await admin.from("assessments").insert({ ...fields, job_id: jobId, assessor_id: asg?.user_id ?? null } as never);
      if (error) throw new Error(error.message);
      return;
    }
    case "fixes":
      await logEvent(jobId, null, FIXES_FORM_CREATED_EVENT, "Electrical fixes form found in Mitti and recorded (the reply to the create request had been lost)",
        { audit_id: auditId, booking_id: ctx.bookingId ?? null, template_id: ctx.templateId ?? null, assignee_email: ctx.assigneeEmail ?? null, adopted: true });
      return;
    case "install_day":
      await logEvent(jobId, null, PIISA_AUDIT_CREATED_EVENT, "Install day form found in Mitti and recorded (the reply to the create request had been lost)",
        { audit_id: auditId, template: ctx.templateId ?? null, adopted: true });
      return;
  }
}

// ---------- the office alert ----------
const TRADE_ROLE: Record<MittiFormKind, "installer" | "electrician"> = { ready_check: "installer", install_day: "installer", piesa: "electrician", fixes: "electrician" };
const BOOKING_KIND: Record<MittiFormKind, string> = { ready_check: "ready_check", piesa: "assessment", fixes: "rectification", install_day: "installation" };

async function alertOffice(c: FailureCase, error: string, counts: RetrySweepResult) {
  const { data: job } = await admin.from("jobs").select("job_number, property_id").eq("id", c.jobId).maybeSingle();
  const [{ data: prop }, { data: asg }, { data: bk }] = await Promise.all([
    job?.property_id ? admin.from("properties").select("address_line, suburb, state, postcode").eq("id", job.property_id).maybeSingle() : Promise.resolve({ data: null }),
    admin.from("job_assignments").select("profiles:user_id(full_name, email)").eq("job_id", c.jobId).eq("role", TRADE_ROLE[c.kind]).eq("active", true).maybeSingle(),
    admin.from("bookings").select("scheduled_start").eq("job_id", c.jobId).eq("kind", BOOKING_KIND[c.kind]).eq("status", "confirmed").order("scheduled_start", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const trade = ((asg as unknown as { profiles: { full_name: string | null; email: string | null } | null } | null)?.profiles) ?? null;
  const content = alertEmail({
    jobNumber: job?.job_number ?? c.jobId, address: formatPropertyAddress(prop as never), kind: c.kind,
    tradeName: trade?.full_name ?? null, tradeEmail: trade?.email ?? null, bookingAt: (bk as { scheduled_start?: string } | null)?.scheduled_start ?? null,
    error: error || c.detail || "Unknown error", jobUrl: `${SET_PASSWORD_BASE}/admin/jobs/${c.jobId}`,
  });
  const { sendMittiFailureAlert } = await import("./office-alert-email.server");
  const outcome = await sendMittiFailureAlert(c.jobId, c.kind, `${c.jobId}:${c.kind}:${c.failedAt}`, content);
  if (outcome === "sent" || outcome === "test_routed") counts.alerted++;
}

/** The Ready Check office flag ("mitti_setup_installer") clears on this event (see mittiOfficeItems). Ready Check only (I4):
 *  the other forms clear through their own records (created / adopted events, assessments row). */
const clearReadyCheckFlag = (jobId: string, summary: string, auditId?: string | null) =>
  logEvent(jobId, null, "mitti_access_override", summary, { kind: "ready_check", ...(auditId ? { audit_id: auditId } : {}) }, { internal: true });

/** The claim row that tells what the failed attempt was making: the uncertain one, or (nothing held) the latest one
 *  released before the failure — creators claim before any Mitti call, so an outage happens after the claim. */
async function claimFor(c: FailureCase): Promise<{ details: Record<string, unknown>; created_at: string } | null> {
  if (c.claimId) {
    const { data } = await admin.from("workflow_events").select("details, created_at").eq("id", c.claimId).eq("event_type", CLAIM_EVENT).maybeSingle();
    return (data as never) ?? null;
  }
  const { data } = await admin.from("workflow_events").select("id, details, created_at").eq("job_id", c.jobId).eq("event_type", CLAIM_EVENT);
  const rows = ((data ?? []) as { id: string; details: Record<string, unknown> | null; created_at: string }[])
    .filter((r) => r.details?.["kind"] === c.kind && Date.parse(r.created_at) <= Date.parse(c.failedAt))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const latest = rows[0];
  if (!latest) return null;
  // It must be the attempt that failed: released (nothing was made). A claim still held means we can't tell.
  const { data: rel } = await admin.from("workflow_events").select("details").eq("job_id", c.jobId).eq("event_type", RELEASE_EVENT);
  const released = ((rel ?? []) as { details: Record<string, unknown> | null }[]).some((r) => r.details?.["claim_id"] === latest.id);
  return released ? { details: latest.details ?? {}, created_at: latest.created_at } : null;
}

async function countUncertain(jobId: string, kind: MittiFormKind): Promise<number> {
  const { data } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", UNCERTAIN_EVENT);
  return (data ?? []).filter((r) => (r.details as { kind?: string } | null)?.kind === kind).length;
}

// ---------- one failed form ----------
async function handleCase(c: FailureCase, events: WorkflowEventRow[], opts: RetrySweepOpts, now: Date, counts: RetrySweepResult) {
  const retries = retriesFor(events, c);
  const action = nextAction(c, retries, now);
  if (action === "wait") return;
  if (action === "alert") { await alertOffice(c, c.detail, counts); return; }

  // ---- search_then_retry: what was the failed attempt trying to make? (from its claim row)
  const claim = await claimFor(c);
  const cd = (claim?.details ?? {}) as Record<string, unknown>;
  const templateId = str(cd["template_id"]), email = str(cd["assignee_email"]);
  const claimAt = Date.parse(String(claim?.created_at ?? ""));
  if (!claim || !templateId || !email || Number.isNaN(claimAt)) { await alertOffice(c, "Could not tell what the failed attempt was making, so nothing was retried. " + c.detail, counts); return; }

  const { data: job } = await admin.from("jobs").select("id, job_number, property_id, owner_id, source").eq("id", c.jobId).maybeSingle();
  const [{ data: prop }, { data: owner }, { data: asg }] = await Promise.all([
    job?.property_id ? admin.from("properties").select("address_line, suburb, state, postcode").eq("id", job.property_id).maybeSingle() : Promise.resolve({ data: null }),
    job?.owner_id ? admin.from("owners").select("full_name").eq("id", job.owner_id).maybeSingle() : Promise.resolve({ data: null }),
    admin.from("job_assignments").select("user_id, businesses(onboarding_notes)").eq("job_id", c.jobId).eq("role", TRADE_ROLE[c.kind]).eq("active", true).maybeSingle(),
  ]);
  const siteAddress = formatPropertyAddress(prop as never), homeownerName = str(owner?.full_name);
  if (!job?.job_number || !siteAddress || !homeownerName) { await alertOffice(c, "The job's number, address or owner name is missing, so Mitti could not be checked for an existing form. " + c.detail, counts); return; }

  // TEST jobs (qa_test, TEST partners) only ever use the TEST Mitti account: never retry one that was aimed elsewhere.
  const { isTestPartner } = await import("./test-send.core");
  const { isTestMittiEmail } = await import("./mitti-test-route.core");
  const testJob = (job as { source?: string | null }).source === "qa_test" || isTestPartner(((asg as { businesses?: unknown } | null)?.businesses ?? null) as never);
  if (testJob && !isTestMittiEmail(email)) { await alertOffice(c, "This is a TEST job but the failed attempt was not for the TEST Mitti account, so nothing was retried. " + c.detail, counts); return; }

  const { realMittiCall, mittiCallFor } = await import("./mitti.server");
  const override = opts.callFor?.(c.jobId);
  const call = override ?? realMittiCall;
  const searchCall = await mittiCallFor(call, email); // test people use the simulator
  const api = mittiApi(searchCall);
  const apiOwnerId = str(process.env[MITTI_API_USER_ENV]) || null;
  // I6: search from the FIRST attempt of this run (its claim, or its first failure), with a margin for clock differences.
  const searchFrom = Math.min(claimAt, Date.parse(runStartedAt(events, c))) - SEARCH_SLACK_MS;

  let ownerId = "";
  const candidates: (AuditToMatch & { auditId: string })[] = [];
  try {
    const user = pickUser(await api.searchUsers(email), email);
    ownerId = str(user?.id ?? user?.user_id);
    if (!ownerId) throw new Error(`${email} was not found in Mitti`);
    const found = (await api.searchAudits(new Date(searchFrom).toISOString())) as { audits?: { audit_id?: string; template_id?: string }[]; metadata?: Record<string, unknown>; next_page?: unknown; next_page_token?: unknown };
    const hits = found?.audits ?? [];
    const meta = found?.metadata ?? {};
    if (hits.length >= SEARCH_PAGE_LIMIT || found?.next_page || found?.next_page_token || meta["next_page"] || Number(meta["remaining_records"] ?? 0) > 0) {
      await alertOffice(c, `Mitti returned a full page of forms (${hits.length}), so not every form could be checked and nothing was retried. ` + c.detail, counts);
      return;
    }
    for (const hit of hits) {
      const id = str(hit.audit_id);
      if (!id || !pickupTemplateMatches(str(hit.template_id), templateId)) continue;
      const p = auditIdentity(c.kind, await api.getAudit(id));
      // The template id is written the way the claim wrote it, so matchAudits compares like with like.
      if (p) candidates.push({ ...p, templateId });
    }
  } catch (e) {
    await alertOffice(c, `Could not check Mitti for an existing form, so nothing was retried: ${msgOf(e)}`, counts);
    return;
  }

  const want = { templateId, mittiOwnerUserId: ownerId, apiOwnerUserId: apiOwnerId, jobNumber: job.job_number, siteAddress, homeownerName };
  const verdict = matchAudits(candidates, want);
  if (verdict === "many") { await alertOffice(c, "More than one matching form was found in Mitti, so nothing was retried or linked. " + c.detail, counts); return; }
  if (verdict === "unclear") { await alertOffice(c, "A form in Mitti could not be read (no job number or address), so we can't tell if it is this job's and nothing was retried. " + c.detail, counts); return; }
  if (verdict === "elsewhere") {
    // A form for this job exists but sits with someone other than the trade: we cannot tell if it is ours, so never create.
    await alertOffice(c, "A form for this job was found in Mitti but it is not with the assigned person, so nothing was retried. " + c.detail, counts);
    return;
  }

  if (verdict === "one") {
    const hit = candidates.find((a) => matchAudits([a], want) === "one")!;
    const auditId = hit.auditId;
    try {
      await adoptExistingAudit(c.jobId, c.kind, auditId, { bookingId: str(cd["booking_id"]) || null, templateId, assigneeEmail: email, call: searchCall });
    } catch (e) {
      await alertOffice(c, `The form was found in Mitti (${auditId}) but could not be linked to the job: ${msgOf(e)}`, counts);
      return;
    }
    // I1: the lost reply also skipped the creator's hand-over, so do it now (the same share + set-owner calls).
    if (hit.mittiOwnerUserId !== ownerId) {
      try { await api.shareAudit(auditId, ownerId); await api.setAuditOwner(auditId, ownerId); }
      catch (e) { await alertOffice(c, `The form was found in Mitti (${auditId}) and linked, but could not be handed to ${email}: ${msgOf(e)}`, counts); return; }
    }
    await logEvent(c.jobId, null, RETRY_LINKED_EVENT, "The failed Mitti form was found in Mitti and linked to the job", { kind: c.kind, audit_id: auditId }, { internal: true });
    counts.linked++;
    return;
  }

  // ---- nothing in Mitti: close the old attempt and try again. The started event (explicit id) is what makes
  // two sweeps agree on who owns this attempt.
  const attempt = retries.length + 1;
  const startedId = await stableUuid(`mitti-retry:${c.jobId}:${c.kind}:${c.failedAt}:${attempt}`);
  const { error: startErr } = await admin.from("workflow_events").insert({
    id: startedId, job_id: c.jobId, actor_id: null, event_type: RETRY_STARTED_EVENT,
    summary: `Retrying the Mitti form (attempt ${attempt} of 2) after checking Mitti: nothing found`, details: { kind: c.kind, attempt } as never, internal: true,
  });
  if (startErr) { if (isUniqueViolation(startErr)) return; throw new Error(startErr.message); }
  counts.retried++;

  const { releaseMittiCreate, MittiClaimHeld, MittiOutcomeUncertain } = await import("./mitti-create.server");
  // A "retryable" case holds no claim (the creator released it: nothing was made), so there is nothing to release.
  if (c.claimId) await releaseMittiCreate(c.jobId, c.kind, c.claimId, null, "retry_after_search_found_nothing");
  /** I5: an outage again before anything was made: the next sweep tries once more (2 minutes on); the last try emails. */
  const outageAgain = (msg: string) => retryable(msg) && attempt < MAX_RETRIES;

  const uncertainBefore = await countUncertain(c.jobId, c.kind);
  try {
    const m = await import("./mitti.server");
    let auditId: string | null = null;
    switch (c.kind) {
      case "ready_check": {
        const { readyCheckFormFacts, testAssignee } = await import("./mitti-create.server");
        const f = await readyCheckFormFacts(c.jobId);
        const assignee = f?.installerUserId ? await testAssignee(f.job.source, f.installerUserId) : null;
        auditId = (await m.createAssignMittiAudit(c.jobId, null, call, { readyCheck: true, ...(assignee ? { assignee } : {}) })).auditId;
        await clearReadyCheckFlag(c.jobId, "Retry made the form automatically", auditId);
        break;
      }
      case "piesa": {
        // C2: the same TEST rule as the booking path (qa_test / TEST partner → TEST Mitti account only).
        const { piesaTestAssignee } = await import("./piesa-autoform.server");
        const assignee = await piesaTestAssignee((job as { source?: string | null }).source ?? null, asg as never);
        auditId = (await m.createAssignMittiAudit(c.jobId, null, call, assignee ? { assignee } : {})).auditId;
        break;
      }
      case "install_day":
        auditId = (await m.createPiisaMittiAudit(c.jobId, null, call)).auditId;
        break;
      case "fixes": {
        let bookingId = str(cd["booking_id"]);
        if (!bookingId) {
          const { data: bk } = await admin.from("bookings").select("id").eq("job_id", c.jobId).eq("kind", "rectification").eq("status", "confirmed").order("scheduled_start", { ascending: false }).limit(1).maybeSingle();
          bookingId = bk?.id ?? "";
        }
        if (!bookingId) { await alertOffice(c, "No booked electrical fixes visit was found, so the form could not be retried.", counts); return; }
        // createFixesForm picks the simulator itself for test people when no call is given.
        const r = await (await import("./fixes-day.server")).createFixesForm(c.jobId, null, bookingId, override);
        if (r.status === "held") {
          if (r.reason === CLAIM_HELD) return;
          if ((await countUncertain(c.jobId, "fixes")) > uncertainBefore) return; // lost reply again: it is the new failure
          if (outageAgain(r.reason ?? "")) return;
          await alertOffice(c, r.reason ?? "The form was not made", counts);
          return;
        }
        if (r.status === "not_needed") {
          await logEvent(c.jobId, null, RETRY_NOT_NEEDED_EVENT, `Mitti form retry stopped: ${r.reason ?? "not needed"}`.trim(), { kind: c.kind }, { internal: true });
          return;
        }
        auditId = r.auditId ?? null;
        break;
      }
    }
    void auditId; // recorded by the creator itself (created event / assessments row)
  } catch (e) {
    if (e instanceof MittiClaimHeld) return;
    if (e instanceof MittiOutcomeUncertain) return; // the creator already recorded a fresh uncertain event: the next failedAt
    if (outageAgain(msgOf(e))) return;
    await alertOffice(c, msgOf(e), counts);
  }
}

/** Run once a minute. One bad case never stops the others. */
export async function runMittiRetrySweep(opts: RetrySweepOpts = {}): Promise<RetrySweepResult> {
  const now = opts.now ?? new Date();
  const counts: RetrySweepResult = { checked: 0, linked: 0, retried: 0, alerted: 0 };
  const events = await loadEvents(now);
  for (const c of collectFailureCases(events, now)) {
    counts.checked++;
    try { await handleCase(c, events, opts, now, counts); }
    catch (e) {
      // M4: at most one error row per job + form each hour (deterministic id), however often the sweep runs.
      const hour = Math.floor(now.getTime() / 3_600_000);
      const id = await stableUuid(`mitti-retry-error:${c.jobId}:${c.kind}:${hour}`);
      await admin.from("workflow_events").insert({
        id, job_id: c.jobId, actor_id: null, event_type: RETRY_ERROR_EVENT, summary: `Mitti retry check failed: ${msgOf(e).slice(0, 300)}`,
        details: { kind: c.kind, failed_at: c.failedAt } as never, internal: true,
      }).then(() => undefined, () => undefined);
    }
  }
  return counts;
}
