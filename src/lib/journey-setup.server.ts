// TEST setup for the live full-journey runner (journey.server.ts). Brings the Test Centre's TEST trades up to every
// current gate the run meets, the way the office and the trades record those facts. TEST identities ONLY: businesses
// named "TEST …" carrying the [TEST PARTNER] mark and people on the @hivic-test.example domain; anything else is a hard
// stop. Idempotent: each fact is recorded only when it is missing, so repeated runs on the live database add nothing.
//
// Where a fact has a plain server-module recording path it is used (ESC collection notice: tradeAcknowledgeNotice on the
// person's own login; electrician rates: the activate_electrician_rate SQL function). The office approvals that exist only
// as signed-in server functions (worker approval, EEC/CII check, White Card check, PIISA check, credential check) are
// recorded with exactly the rows those actions write (same tables, statuses and admin_config_events), as the Test
// Centre's own fixtures do (qa-access.server, jo-tradie.server). No gate is changed or skipped: the run still goes through
// every real check, and a TEST person the office REJECTED is never overridden.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { isTestPartner } from "./test-send.core";
import { crewClearance, whiteCardPathPrefix, whiteCardState, withWhiteCardDecision, withWhiteCardUpload, piisaState, WHITE_CARD_EVENTS } from "./worker-compliance.core";
import { eecUploadMeta, mergeEec } from "./worker-invite.core";
import { credentialState } from "./pilot.core";

export const TEST_DOMAIN = "@hivic-test.example";
export const JOURNEY_POSTCODE = "3199";
const YEARS_2 = 730 * 86_400_000;

// 1×1 JPEG: a real image file for the TEST certificates (upload checks read the bytes).
const TEST_JPEG = Uint8Array.from(atob("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k="), (c) => c.charCodeAt(0));

const melbourneToday = (now = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne" }).format(now);
const inTwoYears = (now = new Date()) => new Date(now.getTime() + YEARS_2).toISOString().slice(0, 10);
export const isTestEmail = (e: string | null | undefined) => !!e && e.trim().toLowerCase().endsWith(TEST_DOMAIN);

export type SetupLog = string[];
const fail = (what: string, e: { message: string } | null | undefined) => { if (e) throw new Error(`TEST setup (${what}): ${e.message}`); };

/** Hard stop unless the business is a TEST partner ("TEST …" name AND the [TEST PARTNER] mark). */
export async function assertTestBusiness(id: string) {
  const { data: b, error } = await admin.from("businesses").select("id, name, business_type, capabilities, onboarding_notes, rec_number, licence_number, service_postcodes, coverage_verified_at, free_measureups_for_hivic_quote_leads, receives_hivic_leads, accepting_new_jobs").eq("id", id).maybeSingle();
  fail("read business", error);
  if (!b?.name?.startsWith("TEST ") || !isTestPartner(b)) throw new Error("SAFETY STOP: a journey trade is not a TEST business.");
  return b;
}

async function uploadTestFile(path: string) {
  const { error } = await admin.storage.from("partner-files").upload(path, TEST_JPEG, { contentType: "image/jpeg", upsert: false });
  fail("upload TEST certificate", error);
  return path;
}

async function configEvent(actorId: string, eventType: string, summary: string, details: Record<string, unknown>) {
  const { error } = await admin.from("admin_config_events").insert({ actor_id: actorId, event_type: eventType, summary, details: details as never });
  fail(eventType, error);
}

// ---------------------------------------------------------------------------------------------------------------------
// Businesses: coverage for the journey postcode, free Ready Checks (installer), verified current credentials, REC number.
// ---------------------------------------------------------------------------------------------------------------------

/** Verified, current business credentials of these kinds (as addCredential + office verifyCredential record them). */
export async function ensureTestCredentials(actorId: string, businessId: string, kinds: readonly string[], log: SetupLog, now = new Date()) {
  const b = await assertTestBusiness(businessId);
  const { data: creds, error } = await admin.from("business_credentials").select("kind, verification, expires_at").eq("business_id", businessId);
  fail("read credentials", error);
  for (const kind of kinds) {
    // A credential expiring within 30 days counts as current, but record a fresh one so the TEST trade never lapses mid-demo.
    const ok = (creds ?? []).some((c) => c.kind === kind && c.verification === "verified" && ["valid", "no_expiry"].includes(credentialState(c, now)));
    if (ok) continue;
    const at = now.toISOString();
    const { error: ie } = await admin.from("business_credentials").insert({ business_id: businessId, kind: kind as never, label: `TEST ${kind.replace(/_/g, " ")}`, number: `TEST-${kind.toUpperCase().slice(0, 12)}`, issuer: "TEST", expires_at: inTwoYears(now), critical: true, created_by: actorId, verification: "verified", verified_by: actorId, verified_at: at } as never);
    fail(`credential ${kind}`, ie);
    log.push(`${b.name}: ${kind.replace(/_/g, " ")} recorded and verified (TEST)`);
  }
}

/** Coverage + offer preferences the Ready Check / PIESA matching reads. Returns the fields as they were (for cleanup). */
export async function ensureTestBusinessReady(actorId: string, businessId: string, role: "installer" | "electrician", log: SetupLog) {
  const b = await assertTestBusiness(businessId);
  const before = { id: businessId, service_postcodes: b.service_postcodes ?? [], coverage_verified_at: b.coverage_verified_at, free_measureups_for_hivic_quote_leads: b.free_measureups_for_hivic_quote_leads };
  const pcs = b.service_postcodes ?? [];
  const patch: Record<string, unknown> = {};
  if (!pcs.includes(JOURNEY_POSTCODE)) patch["service_postcodes"] = [...pcs, JOURNEY_POSTCODE];
  if (!b.coverage_verified_at) patch["coverage_verified_at"] = new Date().toISOString();
  if (role === "installer" && b.free_measureups_for_hivic_quote_leads !== true) patch["free_measureups_for_hivic_quote_leads"] = true;
  if (b.receives_hivic_leads === false) patch["receives_hivic_leads"] = true;
  if (b.accepting_new_jobs === false) patch["accepting_new_jobs"] = true;
  // Electricians: the REC number (and licence number) the office records at onboarding — a gate on PIESA offers and acceptance.
  if (role === "electrician" && !b.rec_number) patch["rec_number"] = "TEST-REC-DELTA";
  if (role === "electrician" && !b.licence_number) patch["licence_number"] = "TEST-ESV-DELTA";
  if (Object.keys(patch).length) {
    const { error } = await admin.from("businesses").update(patch as never).eq("id", businessId).like("name", "TEST %");
    fail("business coverage", error);
    log.push(`${b.name}: ${Object.keys(patch).join(", ")} set (TEST)`);
  }
  await ensureTestCredentials(actorId, businessId, role === "installer" ? ["public_liability_insurance", "installer_certification"] : ["public_liability_insurance", "electrical_licence", "rec_registration"], log);
  return before;
}

// ---------------------------------------------------------------------------------------------------------------------
// Installer people: approved login, EEC/CII Full + current (decision 153), White Card (319), PIISA training, ESC notice (130).
// ---------------------------------------------------------------------------------------------------------------------

type WorkerRow = { id: string; business_id: string; email: string; full_legal_name: string; trade_role: string; profile_id: string | null; approval_status: string; certification_status: string | null; certification: unknown; piisa_status: string | null; piisa_certificate_path: string | null; piisa_verified_at: string | null; licence_expires_on: string | null; removed_at: string | null };
const WORKER_COLS = "id, business_id, email, full_legal_name, trade_role, profile_id, approval_status, certification_status, certification, piisa_status, piisa_certificate_path, piisa_verified_at, licence_expires_on, removed_at";

async function testWorkers(businessId: string, role: "installer" | "electrician") {
  await assertTestBusiness(businessId);
  const { data, error } = await admin.from("partner_workers").select(WORKER_COLS).eq("business_id", businessId).eq("trade_role", role).is("removed_at", null);
  fail("read workers", error);
  return ((data ?? []) as WorkerRow[]).filter((w) => isTestEmail(w.email));
}

/** Office approval of the person's login (decideWorker): pending → approved. A rejected TEST person is left rejected. */
async function ensureApproved(actorId: string, w: WorkerRow, log: SetupLog) {
  if (w.approval_status === "approved") return;
  if (w.approval_status === "rejected") { log.push(`${w.full_legal_name}: rejected by the office — left as is`); return; }
  const now = new Date().toISOString();
  const { error } = await admin.from("partner_workers").update({ approval_status: "approved", approved_by: actorId, approved_at: now, rejection_reason: null }).eq("id", w.id).eq("approval_status", w.approval_status);
  fail("worker approval", error);
  await configEvent(actorId, "worker_approved", "Worker approved", { worker_id: w.id, reason: "TEST journey setup (TEST person)" });
  log.push(`${w.full_legal_name}: login approved (TEST)`);
}

/** EEC/CII certificate uploaded by the person, then the office check with level Full + expiry (officeVerifyEec). */
async function ensureEecCleared(actorId: string, w: WorkerRow, log: SetupLog) {
  const today = melbourneToday();
  const email = w.email.trim().toLowerCase();
  const { data: certs, error } = await admin.from("partner_worker_certifications").select("id, status, recorded_at").or(`worker_id.eq.${w.id},worker_email.eq.${email}`).order("recorded_at", { ascending: false }).limit(1);
  fail("read certification", error);
  const c = certs?.[0] ?? null;
  const { data: lv } = c ? await admin.from("worker_certification_levels").select("level, expires_on").eq("certification_id", c.id).order("recorded_at", { ascending: false }).limit(1).maybeSingle() : { data: null };
  const cleared = crewClearance({ certStatus: c?.status ?? null, level: lv?.level ?? null, expiresOn: lv?.expires_on ?? null }, today).cleared;
  const cert0 = (w.certification ?? {}) as { eec_upload?: { path?: string | null; uploaded_at?: string; number?: string | null } | null; verification_id?: string };
  if (cleared && lv?.level === "full" && w.certification_status === "verified" && cert0.verification_id === c!.id) return;
  if (c?.status === "rejected") { log.push(`${w.full_legal_name}: EEC/CII rejected by the office — left as is`); return; }
  const now = new Date().toISOString();
  let certification: unknown = w.certification;
  // The person's own upload (stored privately), as their certificate link records it.
  let upload = cert0.eec_upload;
  if (!upload?.path) {
    const path = await uploadTestFile(`workers/${w.id}/eec-journey-test-${crypto.randomUUID()}.jpg`);
    certification = mergeEec(certification, eecUploadMeta(path, now, "TEST-EEC-0001"));
    upload = (certification as typeof cert0).eec_upload!;
  }
  let certId = cleared && lv?.level === "full" ? c!.id : null;
  if (!certId) {
    const { data: ins, error: ce } = await admin.from("partner_worker_certifications").insert({ worker_id: w.id, worker_email: email, status: "verified", certificate_number: upload.number ?? "TEST-EEC-0001", issuer: null,
      evidence_source: "certificate_sighted", evidence_note: `Office verified the uploaded EEC/CII certificate (full, expires ${inTwoYears()}). TEST person, TEST certificate (journey setup).`, recorded_by: actorId }).select("id").single();
    fail("certification check", ce);
    certId = ins!.id;
    const { error: le } = await admin.from("worker_certification_levels").insert({ certification_id: certId, worker_email: email, level: "full", expires_on: inTwoYears(), recorded_by: actorId });
    fail("certification level", le);
  }
  const { error: ue } = await admin.from("partner_workers").update({ certification_status: "verified", certification: mergeEec(certification, { ...eecUploadMeta(upload.path!, upload.uploaded_at ?? now, upload.number ?? "TEST-EEC-0001"), verification_id: certId, eec_verified_at: now, eec_verified_by: actorId } as never) as never }).eq("id", w.id);
  fail("worker certification", ue);
  await configEvent(actorId, "eec_certificate_verified", `EEC/CII certificate verified (full, expires ${inTwoYears()})`, { worker_id: w.id, certification_id: certId, level: "full", expires_on: inTwoYears(), test_journey_setup: true });
  log.push(`${w.full_legal_name}: EEC/CII Full, current, verified (TEST)`);
}

/** White Card uploaded by the person, then verified once by the office (saveWhiteCard + officeDecideWhiteCard). */
async function ensureWhiteCard(actorId: string, w: WorkerRow, log: SetupLog) {
  const st = whiteCardState(w);
  if (st === "verified" || st === "not_applicable") return;
  if (st === "rejected") { log.push(`${w.full_legal_name}: White Card rejected by the office — left as is`); return; }
  const now = new Date().toISOString();
  let certification = (await admin.from("partner_workers").select("certification").eq("id", w.id).single()).data?.certification ?? w.certification;
  if (whiteCardState({ trade_role: w.trade_role, certification }) === "missing") {
    const path = await uploadTestFile(`${whiteCardPathPrefix(w.id)}${crypto.randomUUID()}.jpg`);
    certification = withWhiteCardUpload(certification, { path, uploadedAt: now, number: "TEST-WC-0001" }) as never;
    await configEvent(actorId, WHITE_CARD_EVENTS.uploaded, "White Card uploaded — office to verify", { worker_id: w.id, path, test_journey_setup: true });
  }
  const next = withWhiteCardDecision(certification, { verified: true, by: actorId, at: now, number: "TEST-WC-0001" });
  const { error } = await admin.from("partner_workers").update({ certification: next as never }).eq("id", w.id);
  fail("White Card", error);
  await configEvent(actorId, WHITE_CARD_EVENTS.verified, "White Card verified", { worker_id: w.id, number: "TEST-WC-0001", reason: null, test_journey_setup: true });
  log.push(`${w.full_legal_name}: White Card verified (TEST)`);
}

/** PIISA training certificate uploaded (savePiisa), then verified by the office (officeVerifyPiisa). */
async function ensurePiisa(actorId: string, w: WorkerRow, log: SetupLog) {
  if (piisaState(w as never) === "verified") return;
  const now = new Date().toISOString();
  let path = w.piisa_certificate_path;
  if (!path || w.piisa_status !== "done") {
    path = await uploadTestFile(`workers/${w.id}/piisa-${crypto.randomUUID()}.jpg`);
    const { error } = await admin.from("partner_workers").update({ piisa_status: "done", piisa_completed_on: melbourneToday(), piisa_certificate_path: path, piisa_verified_at: null, piisa_verified_by: null }).eq("id", w.id);
    fail("PIISA upload", error);
  }
  const { error } = await admin.from("partner_workers").update({ piisa_verified_at: now, piisa_verified_by: actorId }).eq("id", w.id).not("piisa_certificate_path", "is", null);
  fail("PIISA check", error);
  await configEvent(actorId, "piisa_verified", "PIISA certificate verified", { worker_id: w.id, test_journey_setup: true });
  log.push(`${w.full_legal_name}: PIISA training verified (TEST)`);
}

/** Decision 130: the ESC collection notice, acknowledged by each person on their OWN login (real My business path). A
 *  person with no login of their own stays unacknowledged (and so is not offered work), exactly as the rule says. */
export async function ensureTestNoticeAcks(installerBiz: string, log: SetupLog) {
  await assertTestBusiness(installerBiz);
  const notice = await import("./esc-collection-notice.server");
  const workers = await notice.loadNoticeWorkers([installerBiz]);
  const acked = await notice.noticeAckMap(workers);
  const { tradeAcknowledgeNotice } = await import("./esc-collection-notice-send.server");
  for (const w of workers.filter((x) => isTestEmail(x.email) && x.profile_id && !acked.get(x.id))) {
    await tradeAcknowledgeNotice(w.profile_id!);
    log.push(`${w.full_legal_name}: ESC collection notice acknowledged on their own login (TEST)`);
  }
}

/** The business owner lists themself as an installer (My business › Team: pending, CII declared, not verified) — the
 *  person who leads the TEST install, as on every installer business the office approved. Only when not listed yet. */
async function ensureBossListed(actorId: string, installerBiz: string, boss: { id: string; email: string; full_name?: string | null }, log: SetupLog) {
  if (!isTestEmail(boss.email)) throw new Error("SAFETY STOP: the journey installer is not a TEST person.");
  const b = await assertTestBusiness(installerBiz);
  const listed = (await testWorkers(installerBiz, "installer")).some((w) => w.profile_id === boss.id || w.email.trim().toLowerCase() === boss.email.trim().toLowerCase());
  if (listed) return;
  const { installerQualification } = await import("./partner-activation.core");
  const { error } = await admin.from("partner_workers").insert({ business_id: installerBiz, profile_id: boss.id, trade_role: "installer", full_legal_name: boss.full_name?.trim() || `${b.name} Owner`, email: boss.email.trim().toLowerCase(), mobile: "0400000101", qualification: installerQualification({}), approval_status: "pending", certification_status: "unverified", account_status: "linked", added_by: actorId } as never);
  fail("installer person", error);
  log.push(`${b.name}: business owner listed as an installer (TEST)`);
}

export type LeadInstaller = { workerId: string; name: string };

/** Every TEST installer person cleared for offers and crews; returns the business owner's own row as the lead installer
 *  (null when the office has rejected them or they are otherwise not cleared). */
export async function ensureTestInstallerPeople(actorId: string, installerBiz: string, boss: { id: string; email: string; full_name?: string | null }, log: SetupLog): Promise<LeadInstaller | null> {
  await ensureBossListed(actorId, installerBiz, boss, log);
  for (const w of await testWorkers(installerBiz, "installer")) {
    await ensureApproved(actorId, w, log);
    await ensureEecCleared(actorId, w, log);
    await ensureWhiteCard(actorId, w, log);
    await ensurePiisa(actorId, w, log);
  }
  await ensureTestNoticeAcks(installerBiz, log);
  const mine = (await testWorkers(installerBiz, "installer")).find((w) => w.profile_id === boss.id);
  if (!mine || mine.approval_status !== "approved" || mine.certification_status !== "verified" || whiteCardState(mine) !== "verified") return null;
  return { workerId: mine.id, name: mine.full_legal_name };
}

// ---------------------------------------------------------------------------------------------------------------------
// Electrician: an approved licensed electrician (the TEST boss) with a current licence, and active office-approved rates.
// ---------------------------------------------------------------------------------------------------------------------

export async function ensureTestElectricianPeople(actorId: string, electricianBiz: string, boss: { id: string; email: string; full_name?: string | null }, log: SetupLog) {
  if (!isTestEmail(boss.email)) throw new Error("SAFETY STOP: the journey electrician is not a TEST person.");
  const b = await assertTestBusiness(electricianBiz);
  let workers = await testWorkers(electricianBiz, "electrician");
  if (!workers.length) {
    // The business owner lists themself as the licensed electrician (My business › Team), pending the office's approval.
    const { error } = await admin.from("partner_workers").insert({ business_id: electricianBiz, profile_id: boss.id, trade_role: "electrician", full_legal_name: boss.full_name?.trim() || b.name, email: boss.email, mobile: "0400000201", licence_number: "TEST-ESV-DELTA", licence_expires_on: inTwoYears(), approval_status: "pending", account_status: "linked", added_by: actorId } as never);
    fail("electrician person", error);
    log.push(`${b.name}: licensed electrician listed (TEST)`);
    workers = await testWorkers(electricianBiz, "electrician");
  }
  for (const w of workers) {
    if (!w.licence_expires_on || w.licence_expires_on < melbourneToday()) {
      const { error } = await admin.from("partner_workers").update({ licence_expires_on: inTwoYears() }).eq("id", w.id);
      fail("licence expiry", error);
      log.push(`${w.full_legal_name}: licence expiry recorded (TEST)`);
    }
    await ensureApproved(actorId, w, log);
  }
  await ensureTestElectricianRates(actorId, electricianBiz, log);
}

/** Active, office-approved rates for the PIESA and the fixes visit: a draft rate (createElectricianRate) activated through
 *  the real activate_electrician_rate function. */
export async function ensureTestElectricianRates(actorId: string, electricianBiz: string, log: SetupLog) {
  const b = await assertTestBusiness(electricianBiz);
  const db = admin as unknown as { from: (t: string) => any; rpc: (n: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> }; // eslint-disable-line @typescript-eslint/no-explicit-any
  const today = melbourneToday();
  for (const [service, rate] of [["piesa", 220], ["rectification_visit", 180]] as const) {
    const { data: rows, error } = await db.from("electrician_rates").select("id, status, effective_from, effective_to").eq("business_id", electricianBiz).eq("service_type", service).eq("status", "active");
    fail("read rates", error);
    if ((rows ?? []).some((r: { effective_from: string; effective_to: string | null }) => r.effective_from <= today && (!r.effective_to || r.effective_to >= today))) continue;
    const { data: row, error: ie } = await db.from("electrician_rates").insert({ business_id: electricianBiz, service_type: service, rate_inc_gst: rate, effective_from: today, effective_to: null, source_note: "TEST partner rate (journey setup)", created_by: actorId, status: "draft" }).select("id").single();
    fail(`rate ${service}`, ie);
    await db.from("electrician_rate_events").insert({ rate_id: row.id, actor_id: actorId, event_type: "created", details: { rate_inc_gst: rate, service_type: service, source_note: "TEST partner rate (journey setup)" } });
    const { error: ae } = await db.rpc("activate_electrician_rate", { _rate_id: row.id, _actor: actorId });
    fail(`activate rate ${service}`, ae);
    log.push(`${b.name}: ${service.replace(/_/g, " ")} rate $${rate} active (TEST)`);
  }
}

/** Everything the journey's TEST trades need, in order. Returns the business fields as they were (cleanup restores them). */
export async function ensureJourneyTestTrades(actorId: string, installer: { id: string; business_id: string; email: string; full_name?: string | null }, electrician: { id: string; business_id: string; email: string; full_name?: string | null }) {
  const log: SetupLog = [];
  const before = [
    await ensureTestBusinessReady(actorId, installer.business_id, "installer", log),
    await ensureTestBusinessReady(actorId, electrician.business_id, "electrician", log),
  ];
  const lead = await ensureTestInstallerPeople(actorId, installer.business_id, installer, log);
  await ensureTestElectricianPeople(actorId, electrician.business_id, electrician, log);
  return { before, log, lead };
}
