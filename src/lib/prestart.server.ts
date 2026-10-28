// Day-before pre-start check + ESC AP task facts. Portal decides "cleared to start"; Mitti itself is unchanged.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { WorkflowError, logEvent, piesaStatus } from "./workflow.server";
import { escTask, prestartFailures, prestartLocked, prestartRunAt, type EscNotice, type LeadCert } from "./prestart.core";
import { escSentLine, isWithdrawn, registryBlock, registryChange, REGISTRY_FIELDS_SOURCE, type EscField, type RegistryChange } from "./esc.core";

async function upcomingBooking(jobId: string) {
  const { data } = await admin.from("bookings").select("id, scheduled_start, assignment_id, created_at").eq("job_id", jobId).eq("kind", "installation").eq("status", "confirmed").order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data;
}

/** The job's lead installer = the active assigned installer person, matched to their worker record. */
export async function leadInstallerCert(jobId: string): Promise<LeadCert & { email: string | null; certificateNumber: string | null; mobile?: string | null }> {
  const none = { found: false, status: null, level: null, expiresOn: null, name: null, email: null, certificateNumber: null, mobile: null, whiteCard: null };
  const { data: a } = await admin.from("job_assignments").select("user_id, business_id").eq("job_id", jobId).eq("role", "installer").eq("active", true).maybeSingle();
  if (!a) return none;
  const { data: w } = await admin.from("partner_workers").select("id, email, full_legal_name, mobile, business_id, trade_role, removed_at, certification").eq("profile_id", a.user_id).eq("business_id", a.business_id ?? "").is("removed_at", null).limit(1).maybeSingle();
  if (!w) return none;
  const email = (w.email ?? "").trim().toLowerCase() || null;
  // Decision 130: the lead must have acknowledged the ESC collection notice (own secure link / My business).
  const noticeAcknowledged = (await (await import("./esc-collection-notice.server")).noticeAckMap([w as never])).get(w.id) ?? null;
  // Decision 319: the lead's White Card (office-verified once); whether it blocks depends on when the install was booked.
  const whiteCard = (await import("./worker-compliance.core")).whiteCardState(w as { trade_role: string; certification: unknown });
  const { data: certs } = await admin.from("partner_worker_certifications").select("id, status, recorded_at, worker_id, worker_email, certificate_number").or(email ? `worker_id.eq.${w.id},worker_email.eq.${email}` : `worker_id.eq.${w.id}`).order("recorded_at", { ascending: false }).limit(1);
  const c = certs?.[0];
  if (!c) return { found: true, status: null, level: null, expiresOn: null, name: w.full_legal_name, email, certificateNumber: null, mobile: w.mobile ?? null, noticeAcknowledged, whiteCard };
  const { data: lv } = await admin.from("worker_certification_levels").select("level, expires_on").eq("certification_id", c.id).order("recorded_at", { ascending: false }).limit(1).maybeSingle();
  return { found: true, status: c.status, level: lv?.level ?? null, expiresOn: lv?.expires_on ?? null, name: w.full_legal_name, email, certificateNumber: c.certificate_number ?? null, mobile: w.mobile ?? null, noticeAcknowledged, whiteCard };
}

/** Current notice (not stale/cancelled) and the latest earlier notice that was actually sent and NOT withdrawn in the Registry. */
export async function latestNotices(jobId: string) {
  const { data } = await admin.from("esc_notifications").select("id, status, sent_at, submission_reference, scheduled_start, created_at, response").eq("job_id", jobId).neq("status", "cancelled").order("created_at", { ascending: false }).limit(10);
  const rows = (data ?? []) as (EscNotice & { id: string; created_at: string })[];
  const current = rows.find((r) => r.status !== "stale") ?? null;
  const previousSent = rows.find((r) => r !== current && !!r.sent_at && !isWithdrawn(r)) ?? null;
  return { current, previousSent };
}

/** H3 (24 Oct 2026): the assigned installer business's public liability insurance must not have lapsed before the install starts. */
async function installerPublicLiabilityBlocker(jobId: string): Promise<string | null> {
  const { data: a } = await admin.from("job_assignments").select("business_id").eq("job_id", jobId).eq("role", "installer").eq("active", true).maybeSingle();
  if (!a?.business_id) return null;
  const { publicLiabilityExpiryFor } = await import("./business-insurance.server");
  const { publicLiabilityBlocker, melbourneToday } = await import("./worker-compliance.core");
  return publicLiabilityBlocker((await publicLiabilityExpiryFor([a.business_id])).get(a.business_id) ?? null, melbourneToday());
}

export async function prestartFacts(jobId: string, start: string) {
  const { clearanceFacts } = await import("./allocation.server");
  const { electricalClearance } = await import("./allocation.core");
  const { installWindowDeadline } = await import("./install-days.core");
  const { currentConsent } = await import("./consent.server");
  const { consentValidityBlockers } = await import("./consent.core");
  const cf = await clearanceFacts(jobId);
  const clearance = electricalClearance(cf);
  const ps = await piesaStatus(jobId);
  const deadline = clearance.cleared ? installWindowDeadline(clearance.timingDate, (ps as { install_deadline?: string | null } | null)?.install_deadline ?? null) : null;
  const { current } = await latestNotices(jobId);
  const consent = await currentConsent(jobId);
  return {
    start, clearance: { cleared: clearance.cleared, blocker: clearance.blocker }, deadline, esc: current,
    lead: await leadInstallerCert(jobId), consentBlockers: consentValidityBlockers(consent as never, start), piesaCompletedAt: cf.piesaCompletedAt,
    readyCheckWorksBlockers: await (await import("./ready-check-draft.server")).rcWorksBlockers(jobId),
    siteHoldBlockers: await siteHoldBlockers(jobId),
    publicLiabilityBlocker: await installerPublicLiabilityBlocker(jobId),
    // Decision 261: the portal's safety plan (SWMS) must be signed by the lead and every listed installer.
    swmsBlocker: (await import("./swms.core")).swmsBlocker(await (await import("./swms.server")).swmsStatusFor(jobId)),
    // Decision 319: the White Card rule applies only to installations booked on/after WHITE_CARD_ENFORCED_FROM.
    bookingCreatedAt: await installationBookingCreatedAt(jobId, start),
    // Decision 367: the install cannot start while its 10% deposit is unpaid (payment-rule jobs with an invoice).
    installDepositBlocker: await installDepositBlockerFor(jobId, start),
    // Decision 395: the PIESA copies (owner + installer, 24h before) and the owner's Gate C receipt — the same readers and
    // rules Installation complete uses (esc.server installReadiness / owner-gates), so both places agree.
    piesaCopyBlockers: (await import("./esc.core")).piesaCopyDeliveryBlockers(start, await (await import("./esc.server")).piesaCopyDeliveries(jobId)),
    piesaCopyReceiptBlocker: await (await import("./owner-gates.server")).piesaCopyReceiptBlockerFor(jobId),
  };
}

/** "Install deposit not paid" when the booking for this start is still provisional (or past its hold) — read from the
 *  same jobPaymentView the deposit sweep uses. Null when paid, waived, not under the payment rule, or no invoice. */
export async function installDepositBlockerFor(jobId: string, start: string): Promise<string | null> {
  const { jobPaymentView } = await import("./payments.server");
  const { installDepositPrestartBlocker } = await import("./payments.core");
  const v = await jobPaymentView(jobId);
  if (!v) return null;
  if (v.provisional.installStart && Date.parse(v.provisional.installStart) !== Date.parse(start)) return null;
  return installDepositPrestartBlocker(v.provisional.decision);
}

/** When the installation booking for this start was made (decision 319 cutoff). Null = no matching booking found. */
export async function installationBookingCreatedAt(jobId: string, start?: string | null): Promise<string | null> {
  const b = await upcomingBooking(jobId);
  if (!b) return null;
  if (start && Date.parse(b.scheduled_start) !== Date.parse(start)) return null;
  return (b as { created_at?: string | null }).created_at ?? null;
}

async function latestCheck(jobId: string) {
  const { data } = await admin.from("pre_start_checks").select("scheduled_start, passed, failures, checked_at").eq("job_id", jobId).order("checked_at", { ascending: false }).limit(1).maybeSingle();
  return data ? { scheduled_start: data.scheduled_start, passed: data.passed, failures: (data.failures as string[]) ?? [] } : null;
}

/** Run the check (from 12pm Melbourne the day before until the start). Records only when the result changes. */
export async function runPrestart(jobId: string, trigger: string, now = new Date()) {
  const b = await upcomingBooking(jobId);
  if (!b) return null;
  if (now.getTime() < Date.parse(prestartRunAt(b.scheduled_start)) || now.getTime() >= Date.parse(b.scheduled_start)) return null;
  const failures = prestartFailures(await prestartFacts(jobId, b.scheduled_start));
  const passed = failures.length === 0;
  const prev = await latestCheck(jobId);
  if (prev && Date.parse(prev.scheduled_start) === Date.parse(b.scheduled_start) && prev.passed === passed && JSON.stringify(prev.failures) === JSON.stringify(failures)) return { passed, failures, changed: false };
  const { error } = await admin.from("pre_start_checks").insert({ job_id: jobId, booking_id: b.id, scheduled_start: b.scheduled_start, passed, failures: failures as unknown as Json, trigger });
  if (error) throw new Error(error.message);
  await logEvent(jobId, null, passed ? "prestart_cleared" : "prestart_failed", passed ? "Pre-start check passed — cleared to start" : `Pre-start check failed: ${failures.join(" ")} Installation form and evidence locked. Needs Home Insulation Victoria`, { scheduled_start: b.scheduled_start, failures, trigger }, { internal: true });
  // Decision 326: a failed check is an office item only (the event above → Needs me). There is no approved owner or
  // installer "pre-start check failed" wording, so nothing is queued or sent (the old outbox rows could never deliver).
  return { passed, failures, changed: true };
}

/** Server-side lock for the PIISA send and installation evidence. */
export async function prestartGate(jobId: string, now = new Date()) {
  const b = await upcomingBooking(jobId);
  if (!b) return { locked: false, reasons: [] as string[] };
  return prestartLocked({ start: b.scheduled_start, latest: await latestCheck(jobId), now });
}
export async function requirePrestartClear(jobId: string) {
  // Live original-condition check (installer-intake jobs): never relies on the day-before snapshot, so the PIISA send
  // and install evidence stay locked until insulation/removal/access/downlights are recorded BEFORE any removal.
  const rc = await (await import("./ready-check-draft.server")).rcWorksBlockers(jobId);
  if (rc.length) throw new WorkflowError(`Not cleared to start: record the original ceiling condition in the Ready Check first — ${rc.join(", ")}.`);
  // Live "Site conditions differ" review hold: works stay locked until the office reviews it.
  const sh = await siteHoldBlockers(jobId);
  if (sh.length) throw new WorkflowError(`Not cleared to start: ${sh.join(" ")}.`);
  const g = await prestartGate(jobId);
  if (g.locked) throw new WorkflowError(`Not cleared to start: ${g.reasons.join(" ")}`);
}

/** Timer: run for every install whose 12pm-day-before time has passed and has not started. */
export async function sweepPrestart(now = new Date()) {
  const { data } = await admin.from("bookings").select("job_id, scheduled_start").eq("kind", "installation").eq("status", "confirmed").gt("scheduled_start", now.toISOString()).lt("scheduled_start", new Date(now.getTime() + 2 * 86_400_000).toISOString());
  let ran = 0, failed = 0;
  for (const b of data ?? []) {
    const r = await runPrestart(b.job_id, "timer", now).catch((e) => { console.error("pre-start check failed to run", (e as Error).message); return null; });
    if (r) { ran++; if (!r.passed) failed++; }
  }
  return { ran, failed };
}

/** Needs-attention inputs: ESC tasks, failed checks, and installers needing re-recorded certification (upcoming installs only). */
export async function prestartNeeds(now = new Date()) {
  const { data: bk } = await admin.from("bookings").select("job_id, scheduled_start, created_at").eq("kind", "installation").eq("status", "confirmed").gt("scheduled_start", now.toISOString());
  const esc: { job_id: string; code: string; detail: string }[] = [];
  const failed: { job_id: string; since: string; detail: string }[] = [];
  const certs: { job_id: string; detail: string }[] = [];
  // Decision 319: an office item for every upcoming install whose lead has no verified White Card (blocked or not).
  const whiteCards: { job_id: string; detail: string }[] = [];
  const { whiteCardEnforced } = await import("./worker-compliance.core");
  for (const b of bk ?? []) {
    const n = await latestNotices(b.job_id);
    const t = escTask({ start: b.scheduled_start, current: n.current, previousSent: n.previousSent, now });
    if (t) esc.push({ job_id: b.job_id, ...t });
    const c = await latestCheck(b.job_id);
    if (c && !c.passed && Date.parse(c.scheduled_start) === Date.parse(b.scheduled_start)) failed.push({ job_id: b.job_id, since: now.toISOString(), detail: c.failures.join(" ") });
    const l = await leadInstallerCert(b.job_id);
    if (l.found && l.status === "verified" && (!l.level || !l.expiresOn)) certs.push({ job_id: b.job_id, detail: `${l.name ?? "Lead installer"}: re-record certification as Full with expiry date.` });
    if (l.found && l.whiteCard && l.whiteCard !== "verified" && l.whiteCard !== "not_applicable") {
      const enforced = whiteCardEnforced((b as { created_at?: string | null }).created_at ?? null);
      whiteCards.push({ job_id: b.job_id, detail: `${l.name ?? "Lead installer"}: White Card ${l.whiteCard === "awaiting_check" ? "uploaded, to verify" : l.whiteCard === "rejected" ? "not accepted" : "missing"}${enforced ? " — this install is blocked until it is verified." : " — booked before 26 Oct 2026, so not blocked."}` });
    }
  }
  return { esc, failed, certs, whiteCards };
}

/** Office: copy-ready Registry block, AP task, recorded submission and the day-before pre-start result for the job page. */
export async function prestartSummary(jobId: string) {
  const b = await upcomingBooking(jobId);
  if (!b) return null;
  const n = await latestNotices(jobId);
  const { data: cur } = await admin.from("esc_notifications").select("id, version, status, payload_json, due_by, earliest_send_at, sent_at, submission_reference, submission_method, last_error").eq("job_id", jobId).not("status", "in", "(stale,cancelled)").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const { activeEscConfig } = await import("./esc.server");
  const cfg = await activeEscConfig();
  const fields: EscField[] | undefined = cfg?.required_fields.length ? cfg.required_fields : undefined;
  const registry = cur ? registryBlock((cur.payload_json ?? {}) as Record<string, unknown>, fields) : null;
  const prev = n.previousSent;
  // Same-ID update vs withdraw + resubmit (Activity Guide v1.2 §3.3.3): only when an earlier notice was sent and the current one is not.
  let change: RegistryChange | null = null;
  if (prev && cur && !escSentLine(cur)) {
    const { data: pp } = await admin.from("esc_notifications").select("scheduled_start, sent_at, submission_reference, payload_json").eq("id", prev.id).maybeSingle();
    if (pp) change = registryChange(pp, { scheduled_start: b.scheduled_start, payload_json: cur.payload_json }, new Date().toISOString());
  }
  return {
    change,
    start: b.scheduled_start, runAt: prestartRunAt(b.scheduled_start),
    task: escTask({ start: b.scheduled_start, current: n.current, previousSent: prev, now: new Date() }),
    notification: cur ? { id: cur.id, version: cur.version, status: cur.status, payload: cur.payload_json, due_by: cur.due_by, earliest: cur.earliest_send_at, sent_at: cur.sent_at, reference: cur.submission_reference, method: cur.submission_method, last_error: cur.last_error, canRecord: ["ready", "pending_submission", "error"].includes(cur.status) } : null,
    registry, sentLine: escSentLine(cur ?? null), fieldsSource: cfg ? `approved config ${cfg.version}` : REGISTRY_FIELDS_SOURCE,
    previousSent: prev ? { id: prev.id, sent_at: prev.sent_at, reference: prev.submission_reference, scheduled_start: prev.scheduled_start, sentLine: escSentLine(prev) } : null,
    check: await latestCheck(jobId), gate: await prestartGate(jobId),
  };
}

/** Office records Full/Provisional + expiry against the latest VERIFIED certification for that installer. */
export async function recordCertLevel(p: { applicationId: string; workerEmail: string; level: "full" | "provisional"; expiresOn: string; actorId: string }) {
  const email = p.workerEmail.trim().toLowerCase();
  const { data: c } = await admin.from("partner_worker_certifications").select("id, status").eq("application_id", p.applicationId).eq("worker_email", email).order("recorded_at", { ascending: false }).limit(1).maybeSingle();
  if (!c || c.status !== "verified") throw new WorkflowError("Record the certification as verified first.");
  const { error } = await admin.from("worker_certification_levels").insert({ certification_id: c.id, worker_email: email, level: p.level, expires_on: p.expiresOn, recorded_by: p.actorId });
  if (error) throw new WorkflowError(error.message);
  await admin.from("admin_config_events").insert({ actor_id: p.actorId, event_type: "worker_certification_level", summary: `Certification recorded as ${p.level}, expires ${p.expiresOn} (${email})`, details: { certification_id: c.id, worker_email: email, level: p.level, expires_on: p.expiresOn } as Json });
  return { ok: true };
}

async function siteHoldBlockers(jobId: string): Promise<string[]> {
  const m = await import("./installer-intake.server");
  const h = await m.siteConditionsHoldFor(jobId); // any job may carry the hold; read failure throws (fail closed)
  if (!h.open) return [];
  const { SITE_HOLD_BLOCKER } = await import("./site-conditions.core");
  return [h.note ? `${SITE_HOLD_BLOCKER}: ${h.note}` : SITE_HOLD_BLOCKER];
}
