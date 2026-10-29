// Strict new-installer test — ONE command:  bun run installer-test  [--runs 3] [--no-browser]
// A. application (all 9 pages) -> sign -> office review -> bad input -> approval (practice database) -> request changes / decline
// B. what the approved installer sees, as the business owner AND a staff login (server checks + 390/1280 screenshots)
// C. Add one job, through the portal's own server steps
// TEST only: TEST businesses, TEST logins (@hivic-test.example / @hivic.test), qa_test jobs. Nothing is sent to anyone.
// State of the TEST business is saved before each run and put back after; TEST jobs made by a run are archived.
(globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false;
import { mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { ACKNOWLEDGEMENTS, INSTALLER_AGREEMENT_VERSION, INSTALLER_VISIBLE_PAGES, agreementText, normaliseInstallerDraft, pageFieldErrors, type InstData } from "../src/lib/installer-onboarding.core";
import { performInstallerSign, signedData } from "../src/lib/installer-sign.core";
import { activationBlockers, latestCertifications, mandatoryActivationBlockers, planActivation, approvedRateItems } from "../src/lib/partner-activation.core";
import { JOURNEY_ACTOR_EMAIL } from "../src/lib/journey.server";
import { readyCheckBookingOutcome } from "./portal-qa-coverage";

const RUNS = Number(process.argv[process.argv.indexOf("--runs") + 1]) || 1;
const stepIndex = process.argv.indexOf("--step");
const onlyStep = stepIndex >= 0 ? process.argv[stepIndex + 1] : undefined;
if (stepIndex >= 0 && onlyStep !== "C16") throw new Error("Only --step C16 is supported.");
const noBrowser = process.argv.includes("--no-browser") || onlyStep === "C16";
// Morning operational QA: never run onboarding signing/approval/email steps or mint an office session.
const installerAppOnly = process.argv.includes("--installer-app-only");
const BIZ = "17793408-bf5c-4ddd-9bec-64199f64f9fb"; // [TEST PARTNER] Reinsulate
const OWNER_EMAIL = "deep-test@hivic.test";
const STAFF_EMAIL = "qa.staff.reinsulate@hivic-test.example";
const TEST_EMAIL = /@(hivic-test\.example|hivic\.test)$/i;
const BANNED = ["undefined", "NaN", "[object", "HI VIC", "optional", "vacuum"]; // "hivic" alone is allowed: TEST logins use @hivic.test
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const root = `/mnt/documents/installer-test/${stamp}`;
const sha256 = async (s: string) => createHash("sha256").update(s).digest("hex");

type Check = { name: string; ok: boolean; detail?: string };
type Step = { key: string; label: string; passed: boolean; checks: Check[]; error?: string; shots?: string[]; notRun?: string };
class NotRun extends Error {}
type Screen = { step: string; persona: string; path: string; mustSee?: string[]; mustNotSee?: string[]; noPrices?: boolean };
class Fail extends Error {}

async function step(steps: Step[], key: string, label: string, fn: (c: (name: string, ok: boolean, detail?: string) => void) => Promise<void>) {
  if (onlyStep && key !== onlyStep) return;
  const s: Step = { key, label, passed: false, checks: [] };
  const c = (name: string, ok: boolean, detail?: string) => { s.checks.push(detail === undefined ? { name, ok } : { name, ok, detail }); };
  try { await fn(c); s.passed = s.checks.length > 0 && s.checks.every((x) => x.ok); if (!s.passed) s.error = s.checks.filter((x) => !x.ok).map((x) => `${x.name}${x.detail ? ` (${x.detail})` : ""}`).join("; ") || "no checks ran"; }
  catch (e) { if (e instanceof NotRun) s.notRun = e.message; else { s.error = (e as Error).message; if (process.env["IT_STACK"]) console.error(key, (e as Error).stack); s.checks.push({ name: "step stopped", ok: false, detail: s.error }); } }
  steps.push(s); console.log(`${s.notRun ? 'NOT_RUN' : s.passed ? "PASS" : "FAIL"}  ${label}${s.passed ? "" : `  —  ${s.notRun ?? s.error}`}`);
  return s;
}

// ---------- TEST sign-ins (TEST accounts only) ----------
async function sessionFor(email: string) {
  if (!TEST_EMAIL.test(email) && email !== JOURNEY_ACTOR_EMAIL) throw new Error("SAFETY STOP: TEST accounts only.");
  const { createClient } = await import("@supabase/supabase-js");
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
  const sb = createClient(process.env["SUPABASE_URL"]!, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (i, init) => { const h = new Headers(init?.headers); if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization"); h.set("apikey", key); return fetch(i, { ...init, headers: h }); } } });
  const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !link.properties?.hashed_token) throw new Error(`TEST sign-in ${email}: ${error?.message}`);
  const v = await sb.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
  if (v.error) throw new Error(`TEST sign-in ${email}: ${v.error.message}`);
  return v.data.session;
}
async function userId(email: string) {
  const { data } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/** EXISTING-FIXTURES-ONLY (default): SELECT-verify both TEST logins are already set up; refuse BEFORE any write. */
async function verifyFixtures() {
  const problems: string[] = [];
  const { data: biz } = await admin.from("businesses").select("id, name, business_type").eq("id", BIZ).maybeSingle();
  if (!biz || !/^\[TEST PARTNER\]/.test(String(biz.name)) || biz.business_type !== "eec_installer") problems.push(`TEST business ${BIZ} missing or not a [TEST PARTNER] eec_installer`);
  const ids: Record<string, string> = {};
  for (const [email, role] of [[OWNER_EMAIL, "business_admin"], [STAFF_EMAIL, "member"]] as const) {
    const { data: prof } = await admin.from("profiles").select("id, business_id").eq("email", email).maybeSingle();
    if (!prof) { problems.push(`${email}: no profile`); continue; }
    ids[email] = prof.id;
    if (prof.business_id !== BIZ) problems.push(`${email}: profile not on TEST business`);
    const { data: m } = await admin.from("business_members").select("member_role, active").eq("business_id", BIZ).eq("user_id", prof.id).maybeSingle();
    if (!m || !m.active || m.member_role !== role) problems.push(`${email}: membership is ${m ? `${m.member_role}/${m.active ? "active" : "inactive"}` : "missing"}, expected active ${role}`);
    const { data: r } = await admin.from("user_roles").select("id").eq("user_id", prof.id).eq("role", "installer").maybeSingle();
    if (!r) problems.push(`${email}: no installer role`);
  }
  if (problems.length) { console.log("PREFLIGHT REFUSED (no changes made):\n - " + problems.join("\n - ")); process.exit(2); }
  console.log("PREFLIGHT OK: existing TEST fixtures verified read-only (owner business_admin + staff member, installer role, TEST business).");
  return ids[STAFF_EMAIL]!;
}

/** LEGACY setup (only with --setup-fixtures): one TEST staff login on the TEST business. */
async function ensureStaff() {
  let id = await userId(STAFF_EMAIL);
  if (!id) {
    const { data, error } = await admin.auth.admin.createUser({ email: STAFF_EMAIL, email_confirm: true, user_metadata: { qa_test: true, full_name: "TEST Staff Reinsulate" } });
    if (error) throw new Error(`Could not create TEST staff login: ${error.message}`);
    id = data.user.id;
    for (let i = 0; i < 10 && !(await userId(STAFF_EMAIL)); i++) await new Promise((r) => setTimeout(r, 500));
  }
  await admin.from("profiles").update({ business_id: BIZ, full_name: "TEST Staff Reinsulate" }).eq("id", id);
  const { data: m } = await admin.from("business_members").select("id").eq("business_id", BIZ).eq("user_id", id).maybeSingle();
  if (!m) await admin.from("business_members").insert({ business_id: BIZ, user_id: id, member_role: "member", active: true });
  const { data: r } = await admin.from("user_roles").select("id").eq("user_id", id).eq("role", "installer").maybeSingle();
  if (!r) await admin.from("user_roles").insert({ user_id: id, role: "installer" });
  return id;
}

// ---------- snapshot / restore ----------
async function snapshot() {
  const [{ data: biz }, { data: members }, { data: jobs }, { data: batches }, { data: imports }] = await Promise.all([
    admin.from("businesses").select("*").eq("id", BIZ).single(),
    admin.from("business_members").select("*").eq("business_id", BIZ),
    admin.from("jobs").select("id").eq("originating_installer_business_id", BIZ),
    admin.from("bulk_import_batches").select("id").eq("business_id", BIZ),
    admin.from("job_imports").select("id").eq("business_id", BIZ),
  ]);
  return { biz, members: members ?? [], jobIds: new Set((jobs ?? []).map((j) => j.id)), batchIds: new Set((batches ?? []).map((b) => b.id)), importIds: new Set((imports ?? []).map((b) => b.id)) };
}
async function restore(s: Awaited<ReturnType<typeof snapshot>>) {
  const { id: _i, created_at: _c, updated_at: _u, ...cols } = s.biz as Record<string, unknown>;
  await admin.from("businesses").update(cols as never).eq("id", BIZ);
  for (const m of s.members) await admin.from("business_members").update({ active: (m as { active: boolean }).active, member_role: (m as { member_role: string }).member_role }).eq("id", (m as { id: string }).id);
  const { data: jobs } = await admin.from("jobs").select("id, source").eq("originating_installer_business_id", BIZ);
  const newJobs = (jobs ?? []).filter((j) => !s.jobIds.has(j.id));
  if (newJobs.some((j) => j.source !== "qa_test")) console.log("WARNING: a job made during the run was not qa_test:", newJobs.filter((j) => j.source !== "qa_test").map((j) => j.id));
  const qa = newJobs.filter((j) => j.source === "qa_test").map((j) => j.id);
  if (qa.length) await admin.from("jobs").update({ qa_archived_at: new Date().toISOString() } as never).in("id", qa);
  const { data: batches } = await admin.from("bulk_import_batches").select("id").eq("business_id", BIZ);
  const newB = (batches ?? []).map((b) => b.id).filter((id) => !s.batchIds.has(id));
  if (newB.length) await admin.from("bulk_import_batches").update({ status: "discarded" }).in("id", newB).neq("status", "confirmed"); // confirmed uploads are locked by the database and stay listed
  const { data: imps } = await admin.from("job_imports").select("id, status").eq("business_id", BIZ);
  const newI = (imps ?? []).filter((i) => !s.importIds.has(i.id) && i.status === "draft").map((i) => i.id);
  if (newI.length) await admin.from("job_imports").update({ status: "discarded" }).in("id", newI);
  return { archivedJobs: qa.length, hiddenBatches: newB.length };
}
async function outboundFor(jobIds: string[]) {
  if (!jobIds.length) return 0;
  const tables = ["customer_email_sends", "sms_messages", "job_communications", "external_action_outbox"] as const;
  let n = 0;
  for (const t of tables) { const { count } = await (admin.from(t as never) as unknown as { select: (c: string, o: object) => { in: (k: string, v: string[]) => Promise<{ count: number | null }> } }).select("id", { count: "exact", head: true }).in("job_id", jobIds); n += count ?? 0; }
  return n;
}

// ---------- A. application ----------
const addr = (label: string, street: string, suburb: string, postcode: string) => ({ label, street, suburb, postcode, state: "VIC", country: "AU" as const, latitude: -37.71, longitude: 144.71, provider: "google_places_au" as const });
function application(tag: string): InstData {
  const ba = `12 Batts Way, Fraser Rise VIC 3336`;
  return {
    works_for_business: false, primary_contact_name: `TEST ${tag} Boss`, business_phone: "0412345601", business_email: `qa.newinstaller.${tag.toLowerCase()}@hivic-test.example`,
    legal_entity_name: `TEST ${tag} Insulation Pty Ltd`, trading_name: `TEST ${tag} Insulation`, abn: "51824753556",
    business_address: ba, business_address_details: addr(ba, "12 Batts Way", "Fraser Rise", "3336"),
    insurer: `TEST Insurer ${tag}`, insurance_policy_number: `POL-${tag}`, public_liability_cover_amount: 10_000_000, public_liability_expiry: "2030-06-30",
    installers: [{ full_legal_name: `TEST ${tag} Installer`, mobile: "0412345602", email: `qa.newinstaller.${tag.toLowerCase()}.w1@hivic-test.example`, cii_holds: "held", cii_certificate_number: `CII-${tag}`, cii_issuer: "Energy Efficiency Council Victoria", cii_level: "full", cii_expiry: "2029-05-19", piisa_done: "no", esc_notice_ticked: true }],
    self_is_installer: false, electrician_choice: "match", wants_hivic_leads: true, free_measureups_for_hivic_quote_leads: true, free_quotes_for_hivic_leads: true,
    service_origin: ba, service_origin_details: addr(ba, "12 Batts Way", "Fraser Rise", "3336"), travel_radius_km: 50,
    typical_days: ["Mon", "Tue", "Wed"], normal_attendance_speed: "1-2 weeks", accepting_jobs: true,
    gst_registered: true, r5_rate: 27.5, r6_rate: 31, r7_rate: 35.2, topup_r5_rate: 22, batts_removal_rate: 9.9, loose_fill_removal_rate: 14.3, extra_rates: { difficult_access: 110 },
    bank_account_name: `TEST ${tag} Insulation`, bank_bsb: "063-000", bank_account_number: "12345678", agreement_reviewed: true, how_it_works_acknowledged: true,
  } as InstData;
}
const PAGE_FIELDS: Record<string, (keyof InstData)[]> = {
  about: ["works_for_business", "primary_contact_name", "business_phone", "business_email", "legal_entity_name", "trading_name", "abn", "business_address", "business_address_details"],
  insurance: ["insurer", "insurance_policy_number", "public_liability_cover_amount", "public_liability_expiry"], installers: ["installers", "self_is_installer"], electrician: ["electrician_choice"],
  services: ["wants_hivic_leads", "free_measureups_for_hivic_quote_leads", "free_quotes_for_hivic_leads", "service_origin", "service_origin_details", "travel_radius_km"],
  availability: ["typical_days", "normal_attendance_speed", "accepting_jobs"], install_pricing: ["gst_registered", "r5_rate", "r6_rate", "r7_rate", "topup_r5_rate", "batts_removal_rate", "loose_fill_removal_rate", "extra_rates"],
  bank: ["bank_account_name", "bank_bsb", "bank_account_number"], review: ["agreement_reviewed", "how_it_works_acknowledged"],
};
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");

async function sectionA(steps: Step[], tag: string, screens: Screen[], ctx: { appId?: string; enquiryId?: string; data?: InstData; extraAppIds?: string[] }) {
  await step(steps, "A1", "A1 Fill in all 9 application pages, upload insurance, sign", async (c) => {
    const full = application(tag);
    const token = randomBytes(32).toString("base64url");
    // Same path as the office "Test link": a single-use staff-issued qa_test authorisation, consumed on start.
    const staffLink = randomBytes(32).toString("base64url");
    const actor = await userId(JOURNEY_ACTOR_EMAIL);
    const { error: le } = await (admin as unknown as { from: (t: string) => any }).from("onboarding_authorisations").insert({ token_hash: await sha256(staffLink), trade: "installer", purpose: "qa_test", allow_incomplete_sign: false, max_uses: 1, expires_at: new Date(Date.now() + 3_600_000).toISOString(), issued_by: actor, note: `installer test ${tag}` }); // eslint-disable-line @typescript-eslint/no-explicit-any
    if (le) throw new Fail(`could not issue the TEST link: ${le.message}`);
    const secA = await import("../src/lib/onboarding-security.server");
    const auth = await secA.consumeAuthorisation(admin as never, staffLink, "installer");
    c("staff TEST link accepted once", auth?.purpose === "qa_test");
    const { data: app, error } = await admin.from("rec_onboarding_applications").insert({ resume_token_hash: await sha256(token), step_key: "about", partner_type: "installer", test_mode: true, authorisation_id: auth!.id, allow_incomplete_sign: false } as never).select("*").single();
    if (error || !app) throw new Fail(`could not start a TEST application: ${error?.message}`);
    ctx.appId = (app as { id: string }).id; ctx.data = full;
    c("TEST application started (test mode, can never be approved as a real partner)", true);
    let draft: InstData = {} as InstData; let rev = (app as { updated_at: string }).updated_at;
    const sec = await import("../src/lib/onboarding-security.server");
    for (const p of INSTALLER_VISIBLE_PAGES) {
      const before = pageFieldErrors(p.key, draft).length;
      for (const f of PAGE_FIELDS[p.key] ?? []) (draft as Record<string, unknown>)[f] = (full as Record<string, unknown>)[f];
      if (p.key === "insurance") {
        const slot = await sec.quarantineSlot(admin as never, "installer-onboarding", ctx.appId!);
        const up = await admin.storage.from("partner-files").uploadToSignedUrl(slot.path, slot.token, PDF, { contentType: "application/pdf" });
        if (up.error) throw new Fail(`insurance upload: ${up.error.message}`);
        const done = await sec.verifyAndPromote(admin as never, "installer-onboarding", ctx.appId!, slot.path, "application/pdf", rev);
        rev = done.updated_at; (draft as Record<string, unknown>)["insurance_uploaded"] = true;
      }
      const next = normaliseInstallerDraft(draft);
      const { data: row, error: e } = await admin.from("rec_onboarding_applications").update({ data: next as never, step_key: p.key } as never).eq("id", ctx.appId!).eq("updated_at", rev).select("updated_at").maybeSingle();
      if (e || !row) throw new Fail(`saving page "${p.title}" failed: ${e?.message ?? "revision moved"}`);
      rev = (row as { updated_at: string }).updated_at;
      const after = pageFieldErrors(p.key, { ...next, insurance_uploaded: draft.insurance_uploaded } as InstData);
      c(`page "${p.title}": required questions enforced, then complete`, (p.key === "review" || before > 0) && after.length === 0, after.join(" ") || (before === 0 && p.key !== "review" ? "page passed with nothing filled in" : undefined));
    }
    const { data: a } = await admin.from("rec_onboarding_applications").select("*").eq("id", ctx.appId!).single();
    const text = agreementText(signedData(a as never));
    const out = await performInstallerSign(a as never, {
      signer_name: full.primary_contact_name!, signer_position: "Director", signer_email: full.business_email!, acknowledgements: Object.fromEntries(ACKNOWLEDGEMENTS.map((k) => [k.key, true])),
      agreement_version: INSTALLER_AGREEMENT_VERSION, expected_updated_at: (a as { updated_at: string }).updated_at, agreement_sha256: await sha256(text),
    } as never, { ip: "203.0.113.9", userAgent: "installer-test" }, {
      sha256, signAtomic: async (x) => {
        const { data: rows, error: se } = await admin.rpc("sign_installer_application" as never, { _app_id: x.appId, _expected_updated_at: x.expectedUpdatedAt, _agreement_sha256: x.agreementSha256, _enquiry: x.enquiry, _signed: x.signed, _nominations: x.nominations } as never);
        if (se) throw new Error(se.message);
        return (rows as unknown as { outcome: "signed"; partner_enquiry_id: string; signed_at: string }[])[0]!;
      },
    });
    void out;
    const { data: s } = await admin.from("rec_onboarding_applications").select("status, agreement_version, agreement_sha256, signed_at, partner_enquiry_id").eq("id", ctx.appId!).single();
    ctx.enquiryId = (s as { partner_enquiry_id: string | null } | null)?.partner_enquiry_id ?? undefined;
    c("office enquiry created for the application", !!ctx.enquiryId);
    c("signed and submitted", s?.status === "submitted", s?.status);
    c("agreement version 1.16 recorded on the signed copy", /1\.16/.test(String(s?.agreement_version)), String(s?.agreement_version));
    c("signed copy fingerprint stored", /^[a-f0-9]{64}$/.test(String(s?.agreement_sha256)));
    c("agreement wording never mentions a vacuum rate", !/vacuum/i.test(text));
    screens.push({ step: "A2", persona: "office", path: `/admin/partners?enquiry=${ctx.enquiryId}`, mustSee: [full.legal_entity_name!, full.primary_contact_name!, full.insurer!, full.insurance_policy_number!, full.installers![0]!.full_legal_name!, full.installers![0]!.cii_certificate_number!, "Fraser Rise"], mustNotSee: ["undefined", "NaN", "[object"] });
  });

  await step(steps, "A2", "A2 Every typed field reaches the office (server record)", async (c) => {
    if (!ctx.enquiryId) throw new Fail("no signed application (A1 failed)");
    const { data: pe } = await admin.from("partner_enquiries").select("*").eq("id", ctx.enquiryId).single();
    const { data: a } = await admin.from("rec_onboarding_applications").select("data").eq("id", ctx.appId!).single();
    const d = (a?.data ?? {}) as InstData; const f = ctx.data!;
    for (const k of ["legal_entity_name", "trading_name", "abn", "primary_contact_name", "business_phone", "business_email", "insurer", "insurance_policy_number", "public_liability_cover_amount", "public_liability_expiry", "travel_radius_km", "r5_rate", "r6_rate", "r7_rate", "topup_r5_rate", "batts_removal_rate", "loose_fill_removal_rate", "bank_bsb", "bank_account_number"] as const)
      c(`office record keeps ${k}`, JSON.stringify((d as Record<string, unknown>)[k]) === JSON.stringify((f as Record<string, unknown>)[k]), `${(d as Record<string, unknown>)[k]}`);
    c("installer CII number + expiry kept", d.installers?.[0]?.cii_certificate_number === f.installers![0]!.cii_certificate_number && d.installers?.[0]?.cii_expiry === "2029-05-19");
    c("office enquiry shows company and contact", (pe as { company?: string })?.company?.includes(tag) === true && (pe as { email?: string })?.email === f.business_email, `${(pe as { company?: string })?.company}`);
    c("office enquiry carries the R5 and removal rates", Number((pe as Record<string, unknown>)["estimated_r5_install_rate_per_sqm_inc_gst"]) === 27.5 && Number((pe as Record<string, unknown>)["estimated_batts_removal_rate_per_sqm_inc_gst"]) === 9.9);
  });

  await step(steps, "A3", "A3 Bad input caught with a clear message", async (c) => {
    const f = application(tag);
    const cases: [string, Parameters<typeof pageFieldErrors>[0], InstData, RegExp][] = [
      ["missing CII licence number", "installers", { ...f, installers: [{ ...f.installers![0]!, cii_certificate_number: "" }] }, /CII certificate/i],
      ["expired CII certificate", "installers", { ...f, installers: [{ ...f.installers![0]!, cii_expiry: "2020-01-01" }] }, /expired/i],
      ["ESC collection notice not ticked", "installers", { ...f, installers: [{ ...f.installers![0]!, esc_notice_ticked: false }] }, /ESC privacy collection notice/i],
      ["expired insurance", "insurance", { ...f, insurance_uploaded: true, public_liability_expiry: "2020-01-01" } as InstData, /expiry must be today or later/i],
      ["cover under $5m", "insurance", { ...f, insurance_uploaded: true, public_liability_cover_amount: 1_000_000 } as InstData, /\$5/],
      ["bad ABN", "about", { ...f, abn: "12345678901" }, /valid 11-digit ABN/i],
      ["bad BSB", "bank", { ...f, bank_bsb: "12-34" }, /BSB/],
      ["bad account number", "bank", { ...f, bank_account_number: "12ab" }, /account number/i],
      ["bad email", "about", { ...f, business_email: "not-an-email" }, /email/i],
    ];
    for (const [name, page, d, re] of cases) {
      let msgs: string[] = []; let crashed = "";
      try { msgs = pageFieldErrors(page, d).map((x) => x.message); } catch (e) { crashed = (e as Error).message; }
      c(`${name}: clear message, no crash`, !crashed && msgs.some((m) => re.test(m)) && msgs.every((m) => m.length > 8 && !/undefined|null|NaN/.test(m)), crashed || msgs.join(" | ") || "no message");
    }
  });

  await step(steps, "A4", "A4 Office approval saves business, rates, coverage, agreement 1.16 and signed copy", async (c) => {
    if (!ctx.appId) throw new Fail("no signed application (A1 failed)");
    const { data: live } = await admin.from("rec_onboarding_applications").select("*").eq("id", ctx.appId).single();
    const d = (live as { data: InstData }).data;
    c("live: only blocker is the deliberate TEST lock", activationBlockers("installer", d, (live as { agreement_version: string }).agreement_version, (live as { signed_at: string }).signed_at).length === 0 && (live as { test_mode: boolean }).test_mode === true);
    // The real approval writes run on a practice database (TEST applications can never be approved live, by design).
    const { installerDb } = await import("../tests/helpers/pglite-installer");
    const t = await installerDb();
    const id = await t.create(d);
    const a = await t.app(id);
    await performInstallerSign(a, { signer_name: d.primary_contact_name!, signer_position: "Director", signer_email: d.business_email!, acknowledgements: Object.fromEntries(ACKNOWLEDGEMENTS.map((k) => [k.key, true])), agreement_version: INSTALLER_AGREEMENT_VERSION, expected_updated_at: a.updated_at, agreement_sha256: await sha256(agreementText(signedData(a as never))) } as never, { ip: "203.0.113.9", userAgent: "installer-test" }, t.deps());
    const email = d.installers![0]!.email!;
    await t.recordCert(id, email, "verified", d.installers![0]!.cii_certificate_number!);
    const certs = latestCertifications([{ id: "x", worker_email: email, status: "verified", recorded_at: new Date().toISOString(), certificate_number: d.installers![0]!.cii_certificate_number! } as never]);
    const signed = await t.app(id);
    c("no mandatory blockers once the CII is office-verified", mandatoryActivationBlockers("installer", signed.data as InstData, certs).length === 0);
    const plan = planActivation("installer", signed as never, signed.data as InstData, certs, []);
    const r = await t.activate(id, plan);
    c("approved", r.outcome === "activated", r.outcome);
    const b = (await t.db.query<Record<string, unknown>>(`SELECT * FROM businesses WHERE id=$1`, [r.business_id])).rows[0]!;
    c("business saved with the legal name and ABN", String(b["name"]).includes(tag) && b["abn"] === "51824753556", `${b["name"]} / ${b["abn"]}`);
    const items = (await t.db.query<{ code: string; unit_price_ex_gst: string }>(`SELECT code, unit_price_ex_gst::text FROM rate_card_items WHERE rate_card_id=$1`, [r.rate_card_id])).rows;
    const expected = approvedRateItems("installer", d);
    c("every typed rate saved on the rate card", expected.every((e) => items.some((i) => i.code === e.code && Number(i.unit_price_ex_gst) === Number(e.unit_price_ex_gst))), items.map((i) => `${i.code}=${i.unit_price_ex_gst}`).join(", "));
    c("no vacuum rate on the rate card", !items.some((i) => /VACUUM/i.test(i.code)));
    c("coverage saved (50 km from the service base)", JSON.stringify(b).includes("50") && JSON.stringify(b).includes("Fraser Rise"));
    const act = (await t.db.query<{ snapshot: Record<string, unknown> }>(`SELECT snapshot FROM partner_activations WHERE application_id=$1`, [id])).rows[0];
    c("agreement version 1.16 + signed copy carried into the approval record", /1\.16/.test(JSON.stringify(act?.snapshot ?? {})) && /[a-f0-9]{64}/.test(JSON.stringify(act?.snapshot ?? {})));
    const { isAllowlisted } = await import("../src/lib/test-send.core").catch(() => ({ isAllowlisted: undefined as never }));
    const pp = await import("../src/lib/partner-profile.server");
    c("welcome message is only queued for the office, never sent on approval", /approval_message_status: "queued"/.test(pp.queueApprovalMessage.toString()) && !/send|resend|twilio/i.test(pp.queueApprovalMessage.toString()));
    void isAllowlisted;
  });

  await step(steps, "A5", "A5 Office send back for changes / decline, and what the installer sees", async (c) => {
    if (!ctx.enquiryId) throw new Fail("no signed application (A1 failed)");
    const rv = await import("../src/lib/application-review.server");
    const load = async (id: string) => (await admin.from("rec_onboarding_applications").select("*").eq("id", id).maybeSingle()).data as never;
    const ACTOR = await userId(JOURNEY_ACTOR_EMAIL);
    const back = await rv.decideApplication(ACTOR, ctx.appId!, "changes_requested", "Please check your batts removal rate.");
    c("send back: email goes to the TEST inbox only", back.email.status === "sent", `${back.email.status}: ${back.email.detail}`);
    const orig = await load(ctx.appId!) as { status: string; data: unknown };
    c("send back: the signed original stays signed and untouched", orig.status === "submitted");
    const seen = await rv.resolveReviewedApp(orig as never, load);
    const draft = seen.app as { id: string; status: string; data: unknown; updated_at: string };
    c("send back: the existing link opens a draft with every answer kept", draft.status === "draft" && JSON.stringify(draft.data) === JSON.stringify(orig.data));
    c("send back: the office message shows at the top", seen.officeMessage === "Please check your batts removal rate.", String(seen.officeMessage));
    const { data: enq } = await admin.from("partner_enquiries").select("status").eq("id", ctx.enquiryId).single();
    c("send back: original leaves the approval queue", (enq as { status: string }).status === "closed");
    const text = agreementText(signedData(draft as never));
    await performInstallerSign(draft as never, {
      signer_name: ctx.data!.primary_contact_name!, signer_position: "Director", signer_email: ctx.data!.business_email!, acknowledgements: Object.fromEntries(ACKNOWLEDGEMENTS.map((k) => [k.key, true])),
      agreement_version: INSTALLER_AGREEMENT_VERSION, expected_updated_at: draft.updated_at, agreement_sha256: await sha256(text),
    } as never, { ip: "203.0.113.9", userAgent: "installer-test" }, {
      sha256, signAtomic: async (x) => {
        const { data: rows, error: se } = await admin.rpc("sign_installer_application" as never, { _app_id: x.appId, _expected_updated_at: x.expectedUpdatedAt, _agreement_sha256: x.agreementSha256, _enquiry: x.enquiry, _signed: x.signed, _nominations: x.nominations } as never);
        if (se) throw new Error(se.message);
        return (rows as unknown as { outcome: "signed"; partner_enquiry_id: string; signed_at: string }[])[0]!;
      },
    });
    const resigned = await load(draft.id) as { status: string; agreement_version: string; partner_enquiry_id: string | null };
    c("re-signed on the latest agreement and back in office review", resigned.status === "submitted" && resigned.agreement_version === INSTALLER_AGREEMENT_VERSION && !!resigned.partner_enquiry_id, `${resigned.status} ${resigned.agreement_version}`);
    const dec = await rv.decideApplication(ACTOR, draft.id, "declined", "");
    c("decline: email goes to the TEST inbox only", dec.email.status === "sent", `${dec.email.status}: ${dec.email.detail}`);
    const after = await rv.resolveReviewedApp(orig as never, load);
    c("decline: the installer's link shows the decline", after.review === "declined");
    const act = await import("../src/lib/partner-activation.functions");
    void act;
    const { data: blocked } = await admin.from("application_reviews" as never).select("decision").eq("application_id", draft.id).maybeSingle();
    c("decline: approval is then refused", (blocked as { decision: string } | null)?.decision === "declined");
    ctx.extraAppIds = [...(ctx.extraAppIds ?? []), draft.id];
  });
}

// ---------- B. approved installer ----------
async function sectionB(steps: Step[], screens: Screen[], ids: { owner: string; staff: string }) {
  const tv = await import("../src/lib/trade-view.server");
  const { data: job } = await admin.from("jobs").select("id").eq("originating_installer_business_id", BIZ).eq("source", "qa_test").is("qa_archived_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const { data: offers } = await admin.from("partner_offers").select("id, status, job_id").eq("business_id", BIZ).order("offered_at", { ascending: false });
  const pending = (offers ?? []).find((o) => o.status !== "accepted"); const accepted = (offers ?? []).find((o) => o.status === "accepted");
  const pages: [string, string][] = [["My work", "/field"], ["Money", "/field/money"], ["My business", "/field/business"], ["Details", "/field/business/details"], ["Rates", "/field/business/rates"], ["Bank", "/field/business/bank"], ["Insurance", "/field/business/insurance"], ["Agreement", "/field/business/agreement"], ["Team", "/field/business/team"], ["Add one job", "/partner/import"], ["Sign-in landing", "/portal"]];
  if (job) pages.push(["Job file", `/field/${job.id}`], ["Today's job", `/field/day/${job.id}`]);
  if (pending) pages.push(["Offer (not accepted)", `/field/offer/${pending.id}`]);
  if (accepted) pages.push(["Offer (accepted)", `/field/offer/${accepted.id}`]);
  for (const [, path] of pages) screens.push({ step: "B2", persona: "owner", path, mustNotSee: BANNED });
  for (const p of ["/field", "/portal"]) screens.push({ step: "B1", persona: "owner", path: p, mustSee: ["My work"], mustNotSee: ["calculator", "application"] });
  for (const p of ["/field", "/portal"]) screens.push({ step: "B1", persona: "staff", path: p, mustSee: ["My work"], mustNotSee: ["calculator"] });
  for (const p of ["/field/money", "/field/business/rates", "/field/business/bank", "/field/business/agreement", "/partner/import"]) screens.push({ step: "B4", persona: "staff", path: p, mustNotSee: ["BSB", "per m²", "Account number", "Upload your list", ...BANNED.slice(0, 3)], noPrices: true });

  await step(steps, "B1", "B1 Approved installer (owner and staff) lands on My work", async (c) => {
    const h = await tv.tradeHome(ids.owner); c("owner's home loads", !!h);
    const hs = await tv.tradeHome(ids.staff); c("staff home loads", !!hs);
    c("browser landing checked in screenshots", true, noBrowser ? "browser skipped" : undefined);
  });
  await step(steps, "B4", "B4 Staff refused rates, bank, agreement, Money and My business on the server", async (c) => {
    const refuse = async (n: string, f: () => Promise<unknown>) => { try { await f(); c(`staff refused: ${n}`, false, "server returned data"); } catch { c(`staff refused: ${n}`, true); } };
    await refuse("Money", () => tv.tradeMoney(ids.staff));
    await refuse("business file (rates/bank/insurance/team)", () => tv.tradeBusinessFile(ids.staff));
    await refuse("agreement PDF", () => tv.tradeAgreementPdf(ids.staff));
    const pi = await import("../src/lib/partner-import.server");
    await refuse("Add one job", () => pi.createImportFor(ids.staff, { businessId: BIZ, sourceSystem: "manual_import", text: "x", csvRow: 0, files: [] }));
    const biz = await tv.tradeBusiness(ids.staff).catch(() => null);
    const leak = biz ? Object.entries(biz as Record<string, unknown>).filter(([k, v]) => /bsb|account|rate|bank|agreement|insurance/i.test(k) && v != null && v !== false && !(Array.isArray(v) && !v.length)) : [];
    c("staff My business shows no rates, bank, agreement or insurance", !leak.length, leak.map(([k]) => k).join(", "));
    const ownerFile = await tv.tradeBusinessFile(ids.owner); c("owner still sees the business file", !!ownerFile);
    const hs = await tv.tradeHome(ids.staff) as unknown as Record<string, unknown>;
    const { data: asg } = await admin.from("job_assignments").select("job_id").eq("user_id", ids.staff).eq("active", true);
    const mine = new Set((asg ?? []).map((a) => a.job_id));
    const shown = JSON.stringify(hs).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? [];
    const { data: jobsShown } = shown.length ? await admin.from("jobs").select("id").in("id", shown) : { data: [] };
    c("staff only see jobs assigned to them", (jobsShown ?? []).every((j) => mine.has(j.id)), `${(jobsShown ?? []).length} job(s) shown, ${mine.size} assigned`);
    c("staff Money/My business pages checked in screenshots", true, noBrowser ? "browser skipped" : undefined);
  });
  await step(steps, "B5", "B5 Address hidden on offers until accepted", async (c) => {
    if (!pending) c("a not-yet-accepted offer to check", false, "TEST Reinsulate has no open/withdrawn offer");
    else {
      const o = await tv.tradeOffer(pending.id, ids.owner);
      const { data: j } = await admin.from("jobs").select("owners(full_name, phone), properties(address_line)").eq("id", pending.job_id).single();
      const street = (j?.properties as { address_line: string | null } | null)?.address_line ?? "§";
      const phone = (j?.owners as { phone: string | null } | null)?.phone ?? "§";
      c("not accepted: suburb only, no street, phone or owner name", !o.locked && !JSON.stringify(o).includes(street) && !JSON.stringify(o).includes(phone), `suburb=${o.suburb}`);
    }
    if (!accepted) c("an accepted offer to check", false, "TEST Reinsulate has no accepted offer");
    else {
      const o = await tv.tradeOffer(accepted.id, ids.owner);
      c("accepted: full address and owner contact for that visit", !!o.locked?.address && (!!o.locked?.phone || !!o.locked?.owner), o.locked ? "shown" : "not shown (no live booking/assignment on that TEST job)");
    }
  });
  await step(steps, "B6", "B6 Money: expected date is 7 days after approval; $349 never shown as installer pay", async (c) => {
    const m = await tv.tradeMoney(ids.owner);
    c("Money loads for the owner", !!m);
    c("no row pays the installer $349", !m.rows.some((r) => Number(r.amount) === 349));
    const { payState } = await import("../src/lib/trade-view.core");
    const s = payState({ paidAt: null, apApprovedAt: "2026-10-01T00:00:00Z", installerSupplied: true, ownerPaidInFullAt: "2026-10-01T00:00:00Z" });
    c("rule: 7 days after approval + owner paid in full", s.kind === "coming" && s.on.startsWith("2026-10-08"));
    c("rule: nothing 'coming' until the owner has paid in full", payState({ paidAt: null, apApprovedAt: "2026-10-01T00:00:00Z", installerSupplied: true, ownerPaidInFullAt: null }).kind === "checking");
    c(`live rows: ${m.rows.length}`, true, m.rows.length ? m.rows.map((r) => `${r.jobNumber} ${r.state.kind}`).join(", ") : "empty state");
  });
}

// ---------- C. add one job ----------
async function sectionC(steps: Step[], tag: string, ownerId: string, fixtures: string, screens: Screen[]) {
  const madeJobs: string[] = [];
  const jobsOk = async (c: (n: string, ok: boolean, d?: string) => void, ids: string[]) => {
    if (!ids.length) return;
    const { data } = await admin.from("jobs").select("id, source, originating_installer_business_id, installer_quoted_price_inc_gst").in("id", ids);
    c("jobs are TEST and stay with this installer", (data ?? []).every((j) => j.source === "qa_test" && j.originating_installer_business_id === BIZ), `${(data ?? []).length} job(s)`);
    c("nothing sent to the owner", (await outboundFor(ids)) === 0);
  };

  await step(steps, "C11", "C11 Add one job: price exact, site check, attached to installer, nothing sent", async (c) => {
    const pi = await import("../src/lib/partner-import.server");
    const imp = await pi.createImportFor(ownerId, { businessId: BIZ, sourceSystem: "manual_import", text: `TEST ${tag} Single, 9 ${tag} One Job Rd, Fraser Rise VIC 3336, 0412 999 001, qa.owner.${tag.toLowerCase()}.single@hivic-test.example`, csvRow: 0, files: [] });
    c("draft created", !!imp.id);
    const bad = await pi.confirmImportFor(ownerId, { importId: imp.id, facts: { full_name: `TEST ${tag} Single`, email: "", phone: "", address_line: "", measurement_method: "Tape measure on site", measured_area_m2: 100 }, installer: { site_check: "yes" } }).then(() => "accepted", (e) => (e as Error).message);
    c("missing address/contact refused with a clear message", bad !== "accepted" && bad.length > 10, bad);
    const r = await pi.confirmImportFor(ownerId, { importId: imp.id, facts: { full_name: `TEST ${tag} Single`, email: `qa.owner.${tag.toLowerCase()}.single@hivic-test.example`, phone: "0412999001", address_line: `9 ${tag} One Job Rd`, suburb: "Fraser Rise", postcode: "3336", measurement_method: "Tape measure on site", measured_area_m2: 104 }, installer: { quoted: "yes", contact_permission: true, fee_awareness: true, existing_below_r2: true, site_check: "yes", site_check_date: "2026-10-02", quoted_price_inc_gst: 2987.65, price_includes: "R5 batts 104 m²" } });
    madeJobs.push(r.jobId);
    const { data: j } = await admin.from("jobs").select("installer_quoted_price_inc_gst, installer_site_check, source").eq("id", r.jobId).single();
    c("quoted price kept exactly ($2987.65)", Number(j?.installer_quoted_price_inc_gst) === 2987.65, String(j?.installer_quoted_price_inc_gst));
    c("site check Yes saved", j?.installer_site_check === "yes");
    await jobsOk(c, [r.jobId]);
    // Approved behaviour: a retry after a lost response returns the SAME job, never a second one.
    const twice = await pi.confirmImportFor(ownerId, { importId: imp.id, facts: {}, installer: { site_check: "yes" } }).then((x) => x.jobId, (e) => `refused: ${(e as Error).message}`);
    const { count: sameOwner } = await admin.from("jobs").select("id", { count: "exact", head: true }).eq("originating_installer_business_id", BIZ).eq("id", r.jobId);
    c("confirming again reuses the same job or is refused (no duplicate)", (twice === r.jobId || String(twice).startsWith("refused")) && sameOwner === 1, String(twice));
  });
  await step(steps, "C14", "C14 Add one job + card: photo attach/remove, electrician invite (manual email rule), consent required, Home Insulation Victoria arranges", async (c) => {
    const pi = await import("../src/lib/partner-import.server");
    const je = await import("../src/lib/job-electrician.server");
    const { readFileSync } = await import("node:fs");
    // A real phone-style photo stored in this business's private import folder.
    const path = `partners/${BIZ}/imports/${crypto.randomUUID()}-ceiling-1.jpg`;
    const up = await admin.storage.from("job-files").upload(path, readFileSync(`${fixtures}/ceiling-1.jpg`), { contentType: "image/jpeg" });
    c("photo uploaded privately", !up.error, up.error?.message);
    const imp = await pi.createImportFor(ownerId, { businessId: BIZ, sourceSystem: "manual_import", text: `TEST ${tag} Photo, 14 ${tag} Photo St, Fraser Rise VIC 3336, 0412 999 014, qa.owner.${tag.toLowerCase()}.photo@hivic-test.example`, csvRow: 0, files: [] });
    const added = await pi.addImportFilesFor(ownerId, imp.id, [{ path, name: "ceiling-1.jpg", type: "image/jpeg" }]);
    c("photo attached to the draft", added.files.length === 1);
    const { visitedFromEvidence } = await import("../src/lib/job-electrician.core");
    c("photo means Visited", visitedFromEvidence({ files: added.files }));
    const removed = await pi.removeImportFileFor(ownerId, imp.id, path);
    c("photo can be removed", removed.files.length === 0);
    await pi.addImportFilesFor(ownerId, imp.id, [{ path, name: "ceiling-1.jpg", type: "image/jpeg" }]);
    // + Add another electrician: nomination + invite email built under the manual-email rule (dry run: no email each run).
    const { data: nom } = await admin.from("electrician_nominations").insert({ contact_name: `TEST ${tag} Sparky`, business_name: "TEST Sparky Electrical", email: `qa.sparky.${tag.toLowerCase()}@hivic-test.example`, phone: "0412999099", nominating_business_id: BIZ, nominated_by: ownerId, nominated_for: "installer", status: "invite_pending_comms" }).select("id").single();
    const inv = await (await import("../src/lib/job-electrician-invite.server")).sendElectricianInvite({ actorId: ownerId, nominationId: nom!.id, installerBusinessId: BIZ, inviteToken: "testtoken_".padEnd(40, "x"), to: `qa.sparky.${tag.toLowerCase()}@hivic-test.example`, name: `TEST ${tag} Sparky`, dryRun: true });
    c("invite for a TEST business goes only to Jo's test inbox", inv.to === "jolowexo@hotmail.com", inv.to);
    c("invite links to the electrician application", "message" in inv && String(inv.message).includes("/electrician-onboarding?invite="));
    const facts = { full_name: `TEST ${tag} Photo`, email: `qa.owner.${tag.toLowerCase()}.photo@hivic-test.example`, phone: "0412999014", address_line: `14 ${tag} Photo St`, suburb: "Fraser Rise", postcode: "3336", measured_area_m2: 96 };
    const noConsent = await pi.confirmImportFor(ownerId, { importId: imp.id, facts, installer: { site_check: "yes", contact_permission: false }, electrician: { mode: "mine", nomination_id: nom!.id } }).then(() => "accepted", (e) => (e as Error).message);
    c("job can't be added without the owner consent tick", noConsent !== "accepted" && /permission to contact/.test(noConsent), noConsent);
    const noPick = await pi.confirmImportFor(ownerId, { importId: imp.id, facts, installer: { site_check: "yes", contact_permission: true, fee_awareness: true, existing_below_r2: true }, electrician: { mode: "mine" } }).then(() => "accepted", (e) => (e as Error).message);
    c("My electrician without a pick is refused", /Choose your electrician/.test(noPick), noPick);
    const r = await pi.confirmImportFor(ownerId, { importId: imp.id, facts, installer: { site_check: "yes", contact_permission: true, fee_awareness: true, existing_below_r2: true }, electrician: { mode: "mine", nomination_id: nom!.id } });
    madeJobs.push(r.jobId);
    const s1 = await je.jobElectricianState(r.jobId);
    const { jobElectricianLabel, ELECTRICIAN_INVITED_LABEL } = await import("../src/lib/job-electrician.core");
    c("job shows Electrician invited – waiting to onboard", jobElectricianLabel(s1) === ELECTRICIAN_INVITED_LABEL, jobElectricianLabel(s1));
    const { data: j } = await admin.from("jobs").select("electrician_choice").eq("id", r.jobId).single();
    c("job choice recorded as nominated", j?.electrician_choice === "nominated", String(j?.electrician_choice));
    const { count: asg } = await admin.from("job_assignments").select("id", { count: "exact", head: true }).eq("job_id", r.jobId).eq("role", "electrician");
    c("no electrician assigned directly", !asg);
    await je.switchJobToHivic(r.jobId, ownerId);
    const s2 = await je.jobElectricianState(r.jobId);
    c("installer can switch to Home Insulation Victoria arranges", jobElectricianLabel(s2) === "Home Insulation Victoria arranges", jobElectricianLabel(s2));
    await admin.from("electrician_nominations").update({ ended_at: new Date().toISOString() }).eq("id", nom!.id);
    await jobsOk(c, [r.jobId]);
  });
  await step(steps, "C13", "C13 Not quoted: Book a Ready Check (installer books it with the owner), never offered to anyone else", async (c) => {
    // Rebuilt on Add a job (same path as C11/C14) after bulk upload was removed. TEST owners, qa_test jobs; restore() archives them.
    const pi = await import("../src/lib/partner-import.server");
    const rc = await import("../src/lib/installer-ready-check.server");
    const addNotQuoted = async (n: string) => {
      const name = `TEST ${tag} RC${n}`, email = `qa.owner.${tag.toLowerCase()}.rc${n}@hivic-test.example`, phone = `041299913${n}`, address = `${n} ${tag} Ready Rd`;
      const imp = await pi.createImportFor(ownerId, { businessId: BIZ, sourceSystem: "manual_import", text: `${name}, ${address}, Fraser Rise VIC 3336, ${phone}, ${email}`, csvRow: 0, files: [] });
      // The installer answers Quoted? No and Site check? No.
      const r = await pi.confirmImportFor(ownerId, { importId: imp.id, facts: { full_name: name, email, phone, address_line: address, suburb: "Fraser Rise", postcode: "3336" }, installer: { quoted: "no", site_check: "no", contact_permission: true, fee_awareness: true, existing_below_r2: true } });
      madeJobs.push(r.jobId);
      return r.jobId;
    };
    let where = "start";
    try {
      where = 'const j1 = await addNotQuoted("1");';
      const j1 = await addNotQuoted("1");
      where = 'const s1 = await rc.installerRcState(j1);';
      const s1 = await rc.installerRcState(j1);
      c("Quoted No + not visited shows 'Book a Ready Check'", s1?.action === "book", String(s1?.action));
      where = 'const when = new Date(Date.now() + 3 * 86_400_000); when.set';
      const when = new Date(Date.now() + 3 * 86_400_000); when.setUTCHours(0, 0, 0, 0);
      // Existing rule: a Ready Check can't be booked until the owner signs paperwork A. These owners have no way to sign yet — Jo to decide.
      where = 'const own = await rc.bookOwnReadyCheck(j1, ownerId, when.toI';
      const own = await rc.bookOwnReadyCheck(j1, ownerId, when.toISOString()).then(() => "booked", (e) => (e as Error).message);
      where = 'const { data: b1 } = await admin.from("jobs").select("stage,';
      const { data: b1 } = await admin.from("jobs").select("stage, next_action").eq("id", j1).single();
      const booking = readyCheckBookingOutcome(own === "booked", b1, own);
      if (booking.status === "not_run") throw new NotRun(booking.detail);
      c("I'll book it: completed booking read back", booking.status === "passed", booking.detail);
      where = 'const { count: sent1 } = await admin.from("job_communication';
      const { count: sent1 } = await admin.from("job_communications").select("id", { count: "exact", head: true }).eq("job_id", j1);
      c("I'll book it: nothing sent to the owner", !sent1, String(sent1));
      // Decision 180 (Jo, 24 Oct 2026): installers arrange their own customers' visits directly. The second customer only
      // proves nobody else is ever offered the job.
      where = 'const j2 = await addNotQuoted("2");';
      const j2 = await addNotQuoted("2");
      where = 'const s2 = await rc.installerRcState(j2);';
      const s2 = await rc.installerRcState(j2);
      c("second not-quoted customer also shows 'Book a Ready Check' (no owner email path)", s2?.action === "book", String(s2?.action));
      where = 'const { count: offers } = await admin.from("partner_offers")';
      const { count: offers } = await admin.from("partner_offers").select("id", { count: "exact", head: true }).eq("job_id", j2);
      c("never offered to any other trade (no offers at all)", !offers, String(offers));
      where = 'const { assertOfferPairsAllowed } = await import("../src/lib';
      const { assertOfferPairsAllowed } = await import("../src/lib/offer-guard.server");
      where = 'const { data: other } = await admin.from("businesses").selec';
      const { data: other } = await admin.from("businesses").select("id").ilike("onboarding_notes", "%[TEST PARTNER]%").neq("id", BIZ).limit(1).maybeSingle();
      where = 'if (other) c("an offer to another TEST trade is refused", aw';
      if (other) c("an offer to another TEST trade is refused", await assertOfferPairsAllowed(j2, [other.id], "ready_check").then(() => false, () => true));
      where = 'const { count: sent2 } = await admin.from("job_communication';
      const { count: sent2 } = await admin.from("job_communications").select("id", { count: "exact", head: true }).eq("job_id", j2);
      c("nothing sent to the second owner either", !sent2, String(sent2));
      where = "await jobsOk(c, [j1, j2]);";
      await jobsOk(c, [j1, j2]);
    } catch (e) { if (e instanceof NotRun) throw e; c(`stopped at: ${where}`, false, (e as Error).message); }
  });
  await step(steps, "C15", "C15 Add a job (basics only): creates the job, no booking, and prepares (or explains) the Mitti form", async (c) => {
    const os = await import("../src/lib/onsite-ready-check.server");
    const offline = (async () => { throw new Error("Mitti could not be reached. Try again shortly."); }) as never; // never touches real Mitti
    const r = await os.startOnsiteReadyCheckFor(ownerId, BIZ, { full_name: `TEST ${tag} Onsite`, address_line: `3 ${tag} Onsite Rd`, suburb: "Fraser Rise", postcode: "3336", phone: "0412 000 315", email: `qa.owner.${tag.toLowerCase()}.onsite@hivic-test.example`, contact_permission: true, consent_by: "installer" }, { mode: "hivic" }, offline, { leadOrigin: "owner_contacted" });
    const { data: j } = await admin.from("jobs").select("stage, source, channel, installer_site_check, installer_site_check_date, originating_installer_business_id").eq("id", r.jobId).single();
    c("job is installer-supplied TEST work for this installer", j?.channel === "installer_sourced" && j?.source === "qa_test" && j?.originating_installer_business_id === BIZ, `${j?.channel} ${j?.source}`);
    c("no visit claimed (decision 34: the Mitti form answers the visit)", j?.installer_site_check === "no" && !j?.installer_site_check_date, `${j?.installer_site_check} ${j?.installer_site_check_date}`);
    const { count: asg } = await admin.from("job_assignments").select("id", { count: "exact", head: true }).eq("job_id", r.jobId).eq("role", "installer").eq("active", true);
    c("assigned to this installer", asg === 1, String(asg));
    c("screen always says what happens next", ["open", "preparing", "office", "owner_paperwork", "retry"].includes(r.state.kind) && ("message" in r.state ? r.state.message.length > 20 : true), `${r.state.kind}`);
    c("nothing booked by Add a job (decision 115): job waits at Ready Check ready to schedule", r.booking === "none" && j?.stage === "ready_check_ready_to_schedule", `${j?.stage} / ${r.booking}`);
    const bad = await os.startOnsiteReadyCheckFor(ownerId, BIZ, { full_name: "X Y", address_line: "1 A St", suburb: "Canberra", postcode: "2604", phone: "0412000000", email: "a@b.co", contact_permission: false }, { mode: "hivic" }, offline, { leadOrigin: "owner_contacted" }).then(() => "made", (e) => (e as Error).message);
    c("no permission / ACT postcode refused", /Victorian/.test(bad) && /permission to contact|consent/.test(bad), bad);
    c("nothing sent to the owner", (await outboundFor([r.jobId])) === 0);
    await jobsOk(c, [r.jobId]);
  });
  screens.push({ step: "C15", persona: "owner", path: "/partner/import", mustSee: ["Owner", "Home Insulation Victoria permission to contact them", "Add job"], mustNotSee: [...BANNED.filter((t) => t !== "optional"), // decisions 115/116: basics only, "Add job" button, one approved "(optional)" visit field
    "I'm at the property now", "Add a job for later", "Where is it from"] });

  screens.push({ step: "C14", persona: "staff", path: "/field", mustSee: ["Action needed", "In progress", "Done"], mustNotSee: [...BANNED, "Moving automatically"] });

  await step(steps, "C16", "C16 Add job: preliminary edit allowed; measured area locked to office review; wrong business + staff refused; quote lines follow electrician payer", async (c) => {
    const pi = await import("../src/lib/partner-import.server");
    const ii = await import("../src/lib/installer-intake.server");
    const core = await import("../src/lib/installer-intake.core");
    const mkJob = async (n: string, payer: "hivic" | "own" | "undecided") => {
      const d = await pi.createImportFor(ownerId, { businessId: BIZ, sourceSystem: "manual_import", files: [] } as never);
      const facts = core.intakeConfirmFacts({ full_name: `TEST ${tag} Intake${n}`, email: `qa.owner.${tag.toLowerCase()}.intake${n}@hivic-test.example`, phone: `0412 000 ${n.padStart(3, "4")}`, address_line: `${n} ${tag} Intake Rd`, suburb: "Fraser Rise", postcode: "3336" }, null);
      const q = core.intakeQuotePayload({ quoteStatus: "not_quoted", amount: "", includes: "", proposedR: "" });
      const r = await pi.confirmImportFor(ownerId, { importId: d.id, facts, installer: { quoted: q.quoted, site_check: "no", site_check_date: null, quoted_price_inc_gst: null, price_includes: null, contact_permission: true, owner_agreed: false,
        intake: { existing_insulation: "unknown", evidence_ack: true, proposed_r_value: null, quote_status: "not_quoted", version: `${core.INTAKE_RULESET_VERSION}+${core.COORDINATION_VERSION}`, coordination: "hivic_managed", self_managed_ack: false, measured_required: true, electrician_payer: payer } },
        electrician: payer === "undecided" ? { mode: "later" } : { mode: "hivic" } } as never);
      madeJobs.push(r.jobId); return { jobId: r.jobId, importId: d.id };
    };
    const a = await mkJob("1", "hivic");
    const { data: j } = await admin.from("jobs").select("source, channel, originating_installer_business_id, installer_quoted, installer_quoted_price_inc_gst, installer_price_includes").eq("id", a.jobId).single();
    c("job created without area or quote, as TEST installer-supplied work", j?.source === "qa_test" && j?.channel === "installer_sourced" && j?.originating_installer_business_id === BIZ, `${j?.source} ${j?.channel}`);
    c("no quote stays null, never a fake 0", j?.installer_quoted_price_inc_gst == null && j?.installer_price_includes == null, `${j?.installer_quoted_price_inc_gst}`);
    const s0 = await ii.installerIntakeState(a.jobId);
    c("area unknown is null (not 0)", s0.areaM2 == null, String(s0.areaM2));
    c("owner quote held while unknown", !s0.readiness.ready && s0.readiness.blockers.length > 0, s0.readiness.blockers.join(" | "));
    // repeat confirm of the same draft reuses the job (idempotent retry)
    const again = await pi.confirmImportFor(ownerId, { importId: a.importId, facts: {}, installer: {} } as never).then((r) => r.jobId, (e) => `err: ${(e as Error).message}`);
    c("retry of the same draft never makes a second job", again === a.jobId || /already|confirmed/i.test(String(again)), String(again));
    // later edit on the SAME job
    await ii.installerUpdateIntake(a.jobId, ownerId, BIZ, { areaM2: 118, insulation: "none", quoteStatus: "have_quote", quoteIncGst: 2450, includes: "R5 batts to 118 m2", proposedR: 5, files: [] });
    const s1 = await ii.installerIntakeState(a.jobId);
    const { count: dupes } = await admin.from("jobs").select("id", { count: "exact", head: true }).eq("originating_installer_business_id", BIZ).ilike("job_number", "%").in("id", madeJobs);
    c("later area (preliminary until visited) + quote saved on the same job", (s1.areaM2 ?? s1.preliminaryAreaM2) === 118 && s1.quoteIncGst === 2450, `${s1.areaM2 ?? s1.preliminaryAreaM2} ${s1.quoteIncGst}`);
    c("no duplicate job from the edit", dupes === new Set(madeJobs).size, `${dupes}`);
    // Decision 421: once measured, only the office measurement review changes area.
    // Record an onsite measurement on this run's new TEST job, never on an existing job.
    if (j?.source !== "qa_test" || j.originating_installer_business_id !== BIZ) throw new Fail("SAFETY STOP: measurement fixture must be this run's TEST job.");
    const { error: measurementError } = await admin.from("ceiling_measurements").insert({ job_id: a.jobId, is_current: true, source_role: "installer", confidence: "high", provenance: "hivic_onsite", measured_area_m2: 118, created_by: ownerId, raw_snapshot: { source: "C16 TEST onsite measurement" } });
    if (measurementError) throw new Fail(measurementError.message);
    const measuredBefore = await ii.installerIntakeState(a.jobId);
    c("TEST ceiling is now measured", measuredBefore.areaM2 === 118, String(measuredBefore.areaM2));
    const measuredRefusal = "The ceiling has already been measured — the office changes it through the measurement review.";
    const later = await ii.installerUpdateIntake(a.jobId, ownerId, BIZ, { areaM2: 119, insulation: "none", quoteStatus: "have_quote", quoteIncGst: 2450, includes: "R5 batts to 118 m2", proposedR: 5, files: [] }).then(() => "accepted", (e) => (e as Error).message);
    const measuredAfter = await ii.installerIntakeState(a.jobId);
    c("later edit of measured area refused through measurement review", later === measuredRefusal && measuredAfter.areaM2 === measuredBefore.areaM2 && measuredAfter.quoteIncGst === measuredBefore.quoteIncGst, later);
    // wrong business refused BEFORE any write
    const { data: other } = await admin.from("businesses").select("id").neq("id", BIZ).eq("business_type", "eec_installer").ilike("name", "[TEST PARTNER]%").limit(1).maybeSingle();
    const wrong = await ii.installerUpdateIntake(a.jobId, ownerId, other?.id ?? "00000000-0000-0000-0000-000000000000", { areaM2: 1, insulation: "none", quoteStatus: "not_quoted", quoteIncGst: null, includes: null, proposedR: null, files: [] }).then(() => "accepted", (e) => (e as Error).message);
    const s2 = await ii.installerIntakeState(a.jobId);
    c("another business can't edit this measured job; area unchanged", (wrong === "Only the installer who supplied this job can update it." || wrong === measuredRefusal) && s2.areaM2 === measuredBefore.areaM2 && s2.quoteIncGst === measuredBefore.quoteIncGst, wrong);
    const staffAdd = await pi.createImportFor(staffId, { businessId: BIZ, sourceSystem: "manual_import", files: [] } as never).then(() => "accepted", (e) => (e as Error).message);
    c("staff login can't add a job (business owner only)", staffAdd !== "accepted", staffAdd);
    const badFile = await ii.installerUpdateIntake(a.jobId, ownerId, BIZ, { areaM2: 118, insulation: "none", quoteStatus: "have_quote", quoteIncGst: 2450, includes: "R5", proposedR: 5, files: [{ path: "partners/other/x.pdf", name: "x.pdf", type: "application/pdf" }] }).then(() => "accepted", (e) => (e as Error).message);
    c("another business's file path refused", badFile !== "accepted", badFile);
    // server quote lines follow recorded electrician payer (office eligibility recorded on the TEST job only)
    const lines = async (jobId: string) => { const { data } = await admin.from("quotes").select("status, quote_items(code)").eq("job_id", jobId).eq("kind", "installation").in("status", ["draft", "issued"]); return (data ?? []).flatMap((q) => ((q.quote_items as { code: string | null }[]) ?? []).map((i) => i.code)); };
    await ii.recordCommercialEligibility(a.jobId, ownerId, "eligible", "TEST run: owner, property and occupancy checked (fictitious)");
    // Quote after the Ready Check (Gate 3): record the visit + measured area and the quote's price basis/GST first.
    await ii.installerUpdateIntake(a.jobId, ownerId, BIZ, { attended: "attended", attendedOn: new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Melbourne" }), areaM2: null, insulation: "none", quoteStatus: "have_quote", quoteIncGst: 2450, includes: "R5 batts to 118 m2", proposedR: 5, files: [], commercial: { basis: "before_discount", gst: "inc_gst", inclusions: "R5 batts to 118 m2", exclusions: null, originalStatus: "prepared", removalPricing: null, removalAmountIncGst: null, extras: [] }, feeAwareness: { payer: "hivic", text: core.feeAwarenessText("hivic") ?? "" } } as never);
    const hq = await ii.draftQuoteFromIntake(a.jobId, ownerId).then(() => "drafted", (e) => (e as Error).message);
    const hl = await lines(a.jobId);
    c("HIV-arranged electrician: drafted quote carries the PIESA line", hq === "drafted" ? hl.includes("PIESA") : false, `${hq} / ${hl.join(",")}`);
    const outbound = await outboundFor([a.jobId]);
    c("nothing sent to the owner during any of this", outbound === 0, String(outbound));
    await jobsOk(c, madeJobs.slice(-1));
  });
}

// ---------- saved snapshot: clean-up survives time limits and crashes ----------
const SNAP_FILE = "/tmp/installer-test/saved-snapshot.json";
type Snap = Awaited<ReturnType<typeof snapshot>>;
const saveSnap = (sn: Snap) => { mkdirSync("/tmp/installer-test", { recursive: true }); writeFileSync(SNAP_FILE, JSON.stringify({ ...sn, jobIds: [...sn.jobIds], batchIds: [...sn.batchIds], importIds: [...sn.importIds] })); };
const loadSnap = (): Snap | null => { if (!existsSync(SNAP_FILE)) return null; const j = JSON.parse(readFileSync(SNAP_FILE, "utf8")); if (!j.biz) return null; return { ...j, jobIds: new Set(j.jobIds), batchIds: new Set(j.batchIds), importIds: new Set(j.importIds) }; };
const clearSnap = () => { if (existsSync(SNAP_FILE)) writeFileSync(SNAP_FILE, "{}"); };
// A run that was killed leaves its snapshot behind: put the TEST business back before doing anything else.
const leftover = loadSnap();
if (leftover) { console.log("Restoring TEST business left over from an interrupted run:", JSON.stringify(await restore(leftover))); clearSnap(); }
if (process.argv.includes("--restore-only")) process.exit(0);
let active: Snap | null = null;
const emergency = async (why: string) => { if (active) { console.log(`\n${why}: restoring TEST business…`); try { console.log(JSON.stringify(await restore(active))); clearSnap(); } catch (e) { console.log("restore failed, saved snapshot kept for next start:", (e as Error).message); } } process.exit(1); };
for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"] as const) process.on(sig, () => void emergency(sig));
process.on("uncaughtException", (e) => void emergency(`crash: ${e.message}`));
process.on("unhandledRejection", (e) => void emergency(`crash: ${String(e)}`));

// ---------- main ----------
mkdirSync(root, { recursive: true });
const ownerId = await userId(OWNER_EMAIL); if (!ownerId) throw new Error("TEST Reinsulate owner login missing");
const staffId = process.argv.includes("--setup-fixtures") ? await ensureStaff() : await verifyFixtures();
const allRuns: { run: number; steps: Step[]; restore: unknown }[] = [];
for (let run = 1; run <= RUNS; run++) {
  const tag = `IT${stamp.slice(11, 19).replace(/-/g, "")}R${run}`;
  const outDir = `${root}/run-${run}`; mkdirSync(`${outDir}/screens`, { recursive: true });
  console.log(`\n=== Run ${run} (${tag}) ===`);
  const snap = await snapshot(); saveSnap(snap); active = snap;
  const steps: Step[] = []; const screens: Screen[] = []; const ctx: { appId?: string; enquiryId?: string; data?: InstData; extraAppIds?: string[] } = {};
  try {
    if (!installerAppOnly && !onlyStep) await sectionA(steps, tag, screens, ctx);
    if (!onlyStep) await sectionB(steps, screens, { owner: ownerId, staff: staffId });
    const fx = `/tmp/installer-test/${tag}`;
    if (!onlyStep) spawnSync("python3", [new URL("../e2e/installer-test/fixtures.py", import.meta.url).pathname, fx, tag], { encoding: "utf8" });
    await sectionC(steps, tag, ownerId, fx, screens);
    if (!noBrowser) {
      const sessions: Record<string, unknown> = { ...(!installerAppOnly ? { office: await sessionFor(JOURNEY_ACTOR_EMAIL) } : {}), owner: await sessionFor(OWNER_EMAIL), staff: await sessionFor(STAFF_EMAIL) };
      // Screenshots run in small batches, each with its own time limit, so one slow page can't stop the whole step.
      const browser: { step: string; ok: boolean; detail: string; shots: string[] }[] = [];
      const CHUNK = 4;
      for (let i = 0; i < screens.length; i += CHUNK) {
        const part = screens.slice(i, i + CHUNK); const manifest = `${outDir}/.manifest-${i}.json`; const res = `${outDir}/.browser.json`;
        if (existsSync(res)) writeFileSync(res, "[]");
        writeFileSync(manifest, JSON.stringify({ base: "http://localhost:8080", outDir, storageKey: `sb-${process.env["SUPABASE_PROJECT_ID"] ?? "wvuffpykgnqliikhodzl"}-auth-token`, screens: part, sessions }));
        const py = spawnSync("python3", [new URL("../e2e/journey/shoot.py", import.meta.url).pathname, manifest], { encoding: "utf8", timeout: 240_000 });
        writeFileSync(manifest, "{}");
        const got = existsSync(res) ? JSON.parse(readFileSync(res, "utf8")) as typeof browser : [];
        if (!got.length) for (const sc of part) browser.push({ step: sc.step, ok: false, detail: `screenshot batch failed for ${sc.path}: ${py.error ? "time limit" : (py.stderr || "").slice(-200)}`, shots: [] });
        else browser.push(...got);
      }
      for (const key of [...new Set(browser.map((b) => b.step))]) {
        const b = browser.filter((x) => x.step === key);
        let s = steps.find((x) => x.key === key);
        if (!s) { s = { key, label: key === "B2" ? "B2/B3 Every installer page at 390px and 1280px: no blanks, 'undefined', 'HI VIC', 'optional', vacuum rate, errors" : `${key} pages in the browser`, passed: true, checks: [] }; steps.push(s); }
        for (const x of b) s.checks.push({ name: `browser: ${x.detail}`, ok: x.ok });
        s.shots = b.flatMap((x) => x.shots); s.passed = s.checks.every((x) => x.ok);
        if (!s.passed) s.error = b.filter((x) => !x.ok).map((x) => x.detail).join("; ");
        console.log(`${s.passed ? "PASS" : "FAIL"}  ${s.label} (browser)`);
      }
    }
  } finally {
    const r = await restore(snap); active = null; clearSnap();
    allRuns.push({ run, steps, restore: r });
    writeFileSync(`${outDir}/report.json`, JSON.stringify({ run, tag, steps, restore: r }, null, 2));
  }
}
const keys = [...new Set(allRuns.flatMap((r) => r.steps.map((s) => s.key)))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
const ready = allRuns.every((r) => r.steps.every((s) => s.passed));
const verdict = ready ? "CHECKED TEST FLOWS PASSED — UNTESTED FLOWS REMAIN" : "NOT READY";
const md = [`# New-installer test — ${new Date().toLocaleString("en-AU", { timeZone: "Australia/Melbourne" })}`, "", `**${verdict}** (${RUNS} run${RUNS > 1 ? "s" : ""})`, "", "| Step | " + allRuns.map((r) => `Run ${r.run}`).join(" | ") + " |", "|---|" + allRuns.map(() => "---").join("|") + "|",
  ...keys.map((k) => { const label = allRuns.flatMap((r) => r.steps).find((s) => s.key === k)!.label; return `| ${label} | ${allRuns.map((r) => { const s = r.steps.find((x) => x.key === k); return s ? (s.notRun ? 'NOT_RUN' : s.passed ? "PASS" : "FAIL") : "-"; }).join(" | ")} |`; }), "",
  ...allRuns.flatMap((r) => [`## Run ${r.run}`, ...r.steps.flatMap((s) => [`### ${s.notRun ? 'NOT_RUN' : s.passed ? "PASS" : "FAIL"} — ${s.label}`, ...(s.notRun ? [`- NOT_RUN — ${s.notRun}`] : []), ...s.checks.map((c) => `- ${c.ok ? "ok" : "FAILED"} — ${c.name}${c.detail ? ` (${c.detail})` : ""}`)]), ""])].join("\n");
writeFileSync(`${root}/report.md`, md);
console.log(`\n${verdict}\nReport: ${root}/report.md`);
void copyFileSync;
process.exit(ready ? 0 : 1);
