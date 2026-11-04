// GO / DON'T START check (2pm the day before, 6:30am on the day) + ESC AP task facts. Portal decides "cleared to start"; Mitti itself is unchanged.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { WorkflowError, logEvent, piesaStatus } from "./workflow.server";
import { dueGoSlot, escTask, isGoSlot, prestartFailures, prestartLocked, prestartNotes, prestartRunAt, type EscNotice, type GoSlot, type LeadCert } from "./prestart.core";
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
  const {data:selected}=await admin.from('workflow_events').select('details').eq('job_id',jobId).eq('event_type','piisa_crew_selected').order('created_at',{ascending:false}).limit(1).maybeSingle();
  const selection=(selected?.details as {selection?:{lead?:unknown}}|null)?.selection;
  const selectedWorkerId=typeof selection?.lead==='string'?selection.lead:null;
  let workerQuery=admin.from("partner_workers").select("id, email, full_legal_name, mobile, business_id, trade_role, removed_at, certification, esc_registered").eq("business_id", a.business_id ?? "").is("removed_at", null);
  workerQuery=selectedWorkerId?workerQuery.eq('id',selectedWorkerId):workerQuery.eq('profile_id',a.user_id);
  const {data:w}=await workerQuery.limit(1).maybeSingle();
  if (!w) return none;
  const email = (w.email ?? "").trim().toLowerCase() || null;
  // Decision 130: the lead must have acknowledged the ESC collection notice (own secure link / My business).
  const noticeAcknowledged = (await (await import("./esc-collection-notice.server")).noticeAckMap([w as never])).get(w.id) ?? null;
  // Decision 319: the lead's White Card (office-verified once); whether it blocks depends on when the install was booked.
  const whiteCard = (await import("./worker-compliance.core")).whiteCardState(w as { trade_role: string; certification: unknown });
  const { data: certs } = await admin.from("partner_worker_certifications").select("id, status, recorded_at, worker_id, worker_email, certificate_number").or(email ? `worker_id.eq.${w.id},worker_email.eq.${email}` : `worker_id.eq.${w.id}`).order("recorded_at", { ascending: false }).limit(1);
  const c = certs?.[0];
  // Part 9 Task 5: ESC registration is the office-audited flag (drizzle 0184); anything but true = not registered.
  const escRegistered = (w as { esc_registered?: unknown }).esc_registered === true;
  if (!c) return { found: true, status: null, level: null, expiresOn: null, name: w.full_legal_name, email, certificateNumber: null, mobile: w.mobile ?? null, noticeAcknowledged, whiteCard, escRegistered };
  const { data: lv } = await admin.from("worker_certification_levels").select("level, expires_on").eq("certification_id", c.id).order("recorded_at", { ascending: false }).limit(1).maybeSingle();
  return { found: true, status: c.status, level: lv?.level ?? null, expiresOn: lv?.expires_on ?? null, name: w.full_legal_name, email, certificateNumber: c.certificate_number ?? null, mobile: w.mobile ?? null, noticeAcknowledged, whiteCard, escRegistered };
}

/** Current notice (not stale/cancelled) and the latest earlier notice that was actually sent and NOT withdrawn in the Registry. */
export async function latestNotices(jobId: string) {
  // A read error leaves both null: no notice is ever assumed sent (the task asks for a submission, the check fails).
  const { data } = await admin.from("esc_notifications").select("id, status, sent_at, submission_reference, scheduled_start, created_at, response, payload_json").eq("job_id", jobId).neq("status", "cancelled").order("created_at", { ascending: false }).limit(10);
  const rows = (data ?? []) as (EscNotice & { id: string; created_at: string; payload_json: unknown })[];
  const current = rows.find((r) => r.status !== "stale") ?? null;
  const previousSent = rows.find((r) => r !== current && !!r.sent_at && !isWithdrawn(r)) ?? null;
  return { current, previousSent };
}

/** Part 9 Task 1: the robot's own rule (`registryChange`) for the office task and reminder — the sent notice's Table 5
 *  payload against the current (unsent) one, for this booking start. Null when there is nothing to compare. */
export function registryChangeFor(start: string, n: Awaited<ReturnType<typeof latestNotices>>, now = new Date()): RegistryChange | null {
  const prev = n.previousSent, cur = n.current;
  if (!prev || !cur || escSentLine(cur)) return null;
  return registryChange(prev, { scheduled_start: start, payload_json: cur.payload_json }, now.toISOString());
}

/** H3 (24 Oct 2026) → Part 9 Task 8 (Jo 2 Nov 2026): the assigned installer business's insurance must be on file, office-verified,
 *  $5m+ public liability, workers comp and unexpired before the install starts (businessDocsBlocker). A read error BLOCKS. */
async function installerBusinessDocsBlocker(jobId: string): Promise<string | null> {
  const { data: a, error } = await admin.from("job_assignments").select("business_id").eq("job_id", jobId).eq("role", "installer").eq("active", true).maybeSingle();
  if (error) return `Couldn't read the installer assignment: ${error.message}`;
  if (!a?.business_id) return null;
  try { return await (await import("./business-docs.server")).businessDocsBlockerFor(a.business_id); }
  catch (e) { return e instanceof Error ? e.message : "Couldn't read insurance records."; }
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
    businessDocsBlocker: await installerBusinessDocsBlocker(jobId),
    // Decision 261: the portal's safety plan (SWMS) must be signed by the lead and every listed installer.
    swmsBlocker: (await import("./swms.core")).swmsBlocker(await (await import("./swms.server")).swmsStatusFor(jobId)),
    // Decision 319: the White Card rule applies only to installations booked on/after WHITE_CARD_ENFORCED_FROM.
    bookingCreatedAt: await installationBookingCreatedAt(jobId, start),
    // Decision 367: the install cannot start while its 10% deposit is unpaid (payment-rule jobs with an invoice).
    installDepositBlocker: await installDepositBlockerFor(jobId, start),
    // Decision 395: the PIESA copies (owner + installer, 24h before) and the owner's Gate C receipt — the same readers and
    // rules Installation complete uses (esc.server installReadiness / owner-gates), so both places agree.
    // Part 9 Task 5: after Part C only a copy delivered at/after its signature counts (clearanceFacts sectionCSignedAt, the same column the reader exposes).
    piesaCopyBlockers: (await import("./esc.core")).piesaCopyDeliveryBlockers(start, await (await import("./esc.server")).piesaCopyDeliveries(jobId), { partCSignedAt: cf.sectionCSignedAt ?? null }),
    piesaCopyReceiptBlocker: null, // Retired owner receipt; recorded PIESA delivery remains independently checked.
    // Part 3 Task 4 (Jo 3 Nov 2026): the install can be booked while the Certificate of Electrical Safety is outstanding; it
    // can't start. Missing → "Certificate of Electrical Safety not in yet"; a file not ticked → "Check electrical certificate — …".
    // On-site-only jobs (electrician at the start of the install day) are clear after the PIESA. Part 9 Task 10 (answer 21):
    // this is the GO check's certificate gate for an install booked before the upgrades day too (fails closed on a read error).
    ...(await (await import("./certificate-later.server")).prestartCertificateFacts(jobId, { onsiteOnly: cf.onsiteStartOnly === true }).then((c) => ({ certificate: c.certificate, certificateWhy: c.certificateWhy }))),
    // Part 9 Task 5: electrician at the install (when the PIESA asked for it), life support plan on file. Read errors throw: the check is not recorded and the lock stays closed.
    electricianAttendance: await electricianAttendanceFor(jobId, start),
    lifeSupportPlanMissing: await (await import("./job-records.server")).lifeSupportPlanMissing(jobId),
    // Part 9 Task 14: a real-run job marked "no ESC" skips only the ESC-notice lines (noted on the check). Read error throws.
    noEsc: await (await import("./no-esc.server")).noEscFor(jobId),
  };
}

/** Part 9 Task 5: does the stored PIESA need the electrician at the start of the install, and have they confirmed for the
 *  booking at THIS start? Never asked for this booking (or no booking at this start) = waiting. */
export async function electricianAttendanceFor(jobId: string, start: string): Promise<{ required: boolean; state: "confirmed" | "declined" | "waiting" }> {
  const att = await import("./install-attendance.server");
  const required = await att.attendanceRequiredFor(jobId);
  if (!required) return { required: false, state: "waiting" };
  const { currentInstallBooking } = await import("./install-booking.server");
  const booking = await currentInstallBooking(jobId);
  const bookingId = booking && Date.parse(booking.scheduled_start) === Date.parse(start) ? booking.id : null;
  const state = (await import("./install-attendance.core")).attendanceState(await att.attendanceEvents(jobId), bookingId);
  return { required: true, state: state?.state ?? "waiting" };
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

/** Slot keys already recorded in pre_start_checks for this exact install start (Part 9 Task 6: one row per slot). */
async function doneGoSlots(jobId: string, start: string): Promise<GoSlot[]> {
  const { data, error } = await admin.from("pre_start_checks").select("scheduled_start, trigger").eq("job_id", jobId).eq("scheduled_start", start);
  if (error) throw new Error(error.message); // fail closed: an unreadable history must not run (and email) a slot twice
  return (data ?? []).map((r) => String((r as { trigger?: string }).trigger ?? "")).filter(isGoSlot);
}

/** Run the check (from 2pm Melbourne the day before until the start). A GO slot trigger (`day_before_2pm` /
 *  `on_day_630am`) always writes ONE row per slot + start (the GO / DON'T START email needs one result per slot);
 *  every other trigger records only when the result changes. */
export async function runPrestart(jobId: string, trigger: string, now = new Date()) {
  const b = await upcomingBooking(jobId);
  if (!b) return null;
  if (now.getTime() < Date.parse(prestartRunAt(b.scheduled_start)) || now.getTime() >= Date.parse(b.scheduled_start)) return null;
  const slot: GoSlot | null = isGoSlot(trigger) ? trigger : null;
  if (slot && (await doneGoSlots(jobId, b.scheduled_start)).includes(slot)) {
    const prev = await latestCheck(jobId);
    if (prev?.passed) await afterPrestartPass(jobId); // main Part 3 Task 4 fix 2: any pass releases a held in-house install form
    return { passed: prev?.passed ?? false, failures: prev?.failures ?? [], changed: false, slot };
  }
  const facts = await prestartFacts(jobId, b.scheduled_start);
  const failures = prestartFailures(facts);
  const notes = prestartNotes(facts); // Part 9 Task 14: the no-ESC note rides on the event, never in failures
  const passed = failures.length === 0;
  const prev = await latestCheck(jobId);
  if (!slot && prev && Date.parse(prev.scheduled_start) === Date.parse(b.scheduled_start) && prev.passed === passed && JSON.stringify(prev.failures) === JSON.stringify(failures)) {
    if (passed) await afterPrestartPass(jobId);
    return { passed, failures, changed: false, slot };
  }
  const { error } = await admin.from("pre_start_checks").insert({ job_id: jobId, booking_id: b.id, scheduled_start: b.scheduled_start, passed, failures: failures as unknown as Json, trigger });
  if (error) throw new Error(error.message);
  await logEvent(jobId, null, passed ? "prestart_cleared" : "prestart_failed", `${passed ? "Pre-start check passed — cleared to start" : `Pre-start check failed: ${failures.join(" ")} Installation form and evidence locked. Needs Home Insulation Victoria`}${notes.length ? ` (${notes.join("; ")})` : ""}`, { scheduled_start: b.scheduled_start, failures, trigger, ...(notes.length ? { notes } : {}) }, { internal: true });
  // Decision 326: a failed check is an office item only (the event above → Needs me). There is no approved owner or
  // installer "pre-start check failed" wording, so nothing is queued or sent (the old outbox rows could never deliver).
  if (passed) await afterPrestartPass(jobId);
  // Part 9 Task 7: a GO slot run tells the installer office by email (GO / DON'T START; info@ copy on DON'T START only;
  // DRAFT behind GO_EMAIL_APPROVED, TEST → test-send). The check is already recorded; a send problem is logged, never thrown.
  if (slot) {
    await import("./go-email.server").then((m) => m.sendGoEmail(jobId, slot, { passed, failures, start: b.scheduled_start }))
      .then((r) => { if (!r.startsWith("sent") && r !== "awaiting approval") console.warn("GO email not sent", jobId, slot, r); })
      .catch((e) => console.error("GO email failed", jobId, slot, (e as Error).message));
  }
  return { passed, failures, changed: true, slot };
}

/** Part 3 Task 4 fix 2 (4 Nov 2026): on ANY pass (new or already on file, from the sweep, office "Run check" or the ESC
 *  paths) an in-house job still holding its install form for the certificate gets it now. Idempotent (stage + existing-form
 *  checks first). Never throws. A failure is ONE office row: none is added while an earlier one is still unrecovered.
 *  Task 4b: once the form exists (made now or already there) an open failure row from here gets ONE recovered row. A job
 *  that isn't in-house never gets either, and a failed partner read is not an office row (the next pass retries). */
async function afterPrestartPass(jobId: string) {
  const forms = await import("./in-house-forms.server");
  let inHouse: boolean;
  try { inHouse = await forms.isInHouseFormJob(jobId); } catch { return; }
  if (!inHouse) return;
  try {
    const r = await forms.releaseHeldInstallForm(jobId, null);
    if (r === "created" || r === "already has an install form") {
      try {
        if (await unrecoveredFormSyncFailure(jobId, { ownOnly: true })) await logEvent(jobId, null, "in_house_form_sync_recovered", "In-house install form created", { reason: "Install form created" }, { internal: true });
      } catch { /* best effort: the next pass tries again */ }
    }
  } catch (e) {
    try {
      if (await unrecoveredFormSyncFailure(jobId)) return;
      await logEvent(jobId, null, "in_house_form_sync_failed", "In-house forms need office attention", { reason: e instanceof Error ? e.message : "Install form not created", needs_office: true }, { internal: true });
    } catch { /* best effort: the next pass tries again */ }
  }
}
/** An in_house_form_sync_failed row with no later recovered row (same rule as office-needs). A read failure says no,
 *  so the office still hears about it (a duplicate row beats a missed one). `ownOnly`: only rows with no work id (the ones
 *  written above), so a recovered row is never added for another piece of in-house work's failure. */
async function unrecoveredFormSyncFailure(jobId: string, opts: { ownOnly?: boolean } = {}): Promise<boolean> {
  const { data, error } = await admin.from("workflow_events").select("event_type, details, created_at").eq("job_id", jobId).in("event_type", ["in_house_form_sync_failed", "in_house_form_sync_recovered"]);
  if (error) return false;
  const rows = (data ?? []) as { event_type: string; details: { work_id?: unknown } | null; created_at: string }[];
  return rows.some((f) => f.event_type === "in_house_form_sync_failed" && (!opts.ownOnly || !f.details?.work_id) && !rows.some((r) => r.event_type === "in_house_form_sync_recovered" && r.created_at >= f.created_at && (!f.details?.work_id || r.details?.work_id === f.details.work_id)));
}

/** Server-side lock for the PIISA send and installation evidence. */
export async function prestartGate(jobId: string, now = new Date()) {
  const leadBlocker=await (await import('./in-house-booking.server')).leadNoticeBlocker(jobId,now);
  if(leadBlocker)return {locked:true,reasons:[leadBlocker]};
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
  // Part 3 Task 4 fix 1 (4 Nov 2026): live Certificate of Electrical Safety check — the PIISA send and install evidence stay
  // locked until it is ticked, whatever the time-based gate says. On-site-only / no upgrades / ticked pass. Fails closed.
  const cert = await (await import("./certificate-later.server")).liveCertificateFact(jobId);
  const certBlock = (await import("./certificate-later.core")).prestartCertificateBlocker(cert.certificate, cert.certificateWhy);
  if (certBlock) throw new WorkflowError(certBlock);
  const g = await prestartGate(jobId);
  if (g.locked) throw new WorkflowError(`Not cleared to start: ${g.reasons.join(" ")}`);
}

/** Timer (15-minute tick): for every upcoming install, run the GO slot that is due (2pm the day before, 6:30am on the
 *  day) and not yet recorded for that start. Counts only runs that wrote a row. */
export async function sweepPrestart(now = new Date()) {
  const { data } = await admin.from("bookings").select("job_id, scheduled_start").eq("kind", "installation").eq("status", "confirmed").gt("scheduled_start", now.toISOString()).lt("scheduled_start", new Date(now.getTime() + 2 * 86_400_000).toISOString());
  let ran = 0, failed = 0;
  for (const b of data ?? []) {
    // Part 9 Task 6: the GO slot that is due (2pm the day before, 6:30am on the day) always writes its row and emails the
    // installer office. Between slots the plain "timer" run keeps main's live behaviour: a row only when the result
    // changed (so a fix at 3pm unlocks the install at the next tick), and every pass retries a held in-house install
    // form (Part 3 Task 4 fix 2). Counts only runs that wrote a row.
    const r = await (async () => {
      const slot = dueGoSlot(b.scheduled_start, now, await doneGoSlots(b.job_id, b.scheduled_start));
      return runPrestart(b.job_id, slot ?? "timer", now);
    })().catch((e) => { console.error("pre-start check failed to run", (e as Error).message); return null; });
    if (r?.changed) { ran++; if (!r.passed) failed++; }
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
    const t = escTask({ start: b.scheduled_start, current: n.current, previousSent: n.previousSent, change: registryChangeFor(b.scheduled_start, n, now), now });
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
  const change = registryChangeFor(b.scheduled_start, n);
  return {
    change,
    leadChange: await (await import('./in-house-booking.server')).latestLeadNotice(jobId),
    start: b.scheduled_start, runAt: prestartRunAt(b.scheduled_start),
    task: escTask({ start: b.scheduled_start, current: n.current, previousSent: prev, change, now: new Date() }),
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
