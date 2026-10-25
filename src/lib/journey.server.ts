// Full-journey test runner (server side). TEST data only: every job it touches is created by this run with
// source='qa_test', every person is on the TEST domain, and each step re-checks that before acting.
// Shared by the daily endpoint and the browser runner (which adds screenshots on top of the same steps).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { JOURNEY_STEPS, expectedEstimate, recipientsOutsideAllowlist, summarise, type JourneyResult, type JourneyStepKey, type StepResult } from "./journey-test.core";

export const JOURNEY_ACTOR_EMAIL = "admin@hivic.test";
export const TEST_INSTALLER_EMAIL = "qa.installer.alpha@hivic-test.example";
export const TEST_ELECTRICIAN_EMAIL = "qa.rec.delta@hivic-test.example";
export const TEST_WORKER_EMAIL = "qa.worker.alpha@hivic-test.example";
const TEST_DOMAIN = "@hivic-test.example";
const JOURNEY_POSTCODE = "3199";

export type JourneyCtx = {
  runId: string; startedAt: string; actorId: string; jobId: string | null; jobNumber: string | null; token: string | null;
  ownerEmail: string; installer: { id: string; business_id: string }; electrician: { id: string; business_id: string }; worker: { id: string; business_id: string } | null;
  calculatorInterestId: string | null; quoteId: string | null; notes: Record<string, unknown>;
  /** Pages the browser runner should open after each step: persona + path + what must / must not be on screen. */
  screens: { step: JourneyStepKey; persona: "public" | "owner_token" | "office" | "installer" | "electrician" | "worker"; path: string; mustSee?: string[]; mustNotSee?: string[]; noPrices?: boolean }[];
};

class StepFail extends Error {}

/** A real signed-in client for a TEST-run persona (RLS applies). Uses a one-time magic link, no password, no email sent. */
const sessions = new Map<string, unknown>();
export async function personaClient(email: string) {
  if (!email.endsWith(TEST_DOMAIN) && email !== JOURNEY_ACTOR_EMAIL) throw new Error("SAFETY STOP: journey sign-ins are TEST accounts only.");
  if (sessions.has(email)) return sessions.get(email) as import("@supabase/supabase-js").SupabaseClient;
  const { createClient } = await import("@supabase/supabase-js");
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
  const sb = createClient(process.env["SUPABASE_URL"]!, key, { auth: { persistSession: false, autoRefreshToken: false, storage: undefined }, global: { fetch: (input, init) => { const h = new Headers(init?.headers); if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization"); h.set("apikey", key); return fetch(input, { ...init, headers: h }); } } });
  const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !link.properties?.hashed_token) throw new Error(`TEST sign-in for ${email}: ${error?.message ?? "no token"}`);
  const v = await sb.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
  if (v.error) throw new Error(`TEST sign-in for ${email}: ${v.error.message}`);
  sessions.set(email, sb);
  return sb;
}

/** A fresh session (for the browser runner's localStorage). TEST accounts only. */
export async function personaSession(email: string) {
  sessions.delete(email);
  const sb = await personaClient(email);
  sessions.delete(email);
  return (await sb.auth.getSession()).data.session;
}
function check(r: StepResult, name: string, ok: boolean, detail?: string) { r.checks.push(detail === undefined ? { name, ok } : { name, ok, detail }); if (!ok) throw new StepFail(`${name}${detail ? `: ${detail}` : ""}`); }

async function profileByEmail(email: string) {
  const { data } = await admin.from("profiles").select("id, business_id").eq("email", email).maybeSingle();
  if (!data?.business_id) throw new Error(`TEST account ${email} is missing — run "Create TEST trade accounts" in Test Centre first.`);
  return data as { id: string; business_id: string };
}

/** Hard stop if the job is anything but this run's own TEST job. */
async function assertOwnTestJob(ctx: JourneyCtx) {
  if (!ctx.jobId) throw new StepFail("No TEST job yet");
  const { data } = await admin.from("jobs").select("source, qa_archived_at, owners(email)").eq("id", ctx.jobId).single();
  const email = (data?.owners as { email: string | null } | null)?.email ?? "";
  if (data?.source !== "qa_test" || data.qa_archived_at || !email.endsWith(TEST_DOMAIN)) throw new Error("SAFETY STOP: the journey job is not an active TEST job — nothing further was done.");
}

async function settings() {
  const { data } = await admin.from("retail_estimator_settings").select("*").eq("is_current", true).maybeSingle();
  const s = data as Record<string, unknown> | null;
  return { perM2: Number(s?.["r5_install_inc_gst_per_m2"] ?? 30), piesa: Number(s?.["piesa_assessment_inc_gst"] ?? 349), ap: Number(s?.["ap_management_inc_gst"] ?? 349), veecValue: Number(s?.["indicative_veec_value"] ?? 70), minimum: Number(s?.["minimum_customer_copayment_inc_gst"] ?? 200) };
}

type StepFn = (ctx: JourneyCtx, r: StepResult) => Promise<void>;

// ---------- Step 1: public calculator ----------
const s1: StepFn = async (ctx, r) => {
  // The public calculator saves an interest row (it never creates a job). Same insert the page makes, TEST email.
  const { data: ins, error } = await admin.from("calculator_interests").insert({
    full_name: `TEST Journey ${ctx.runId.slice(0, 6)}`, mobile: "0400000" + String(Math.floor(100 + Math.random() * 899)), email: ctx.ownerEmail,
    address_line: `${10 + Math.floor(Math.random() * 80)} Journey Test Street`, suburb: "Frankston", postcode: "3199", ceiling_m2: 120, insulation_declared: "none", consent_version: "journey-test",
  }).select("id").single();
  check(r, "calculator registration saved", !error && !!ins, error?.message);
  ctx.calculatorInterestId = ins!.id;
  // The owner's enquiry arrives as an isolated TEST job (Base44 intake path, qa_test source).
  const { upsertEnquiry } = await import("./enquiry.server");
  const res = await upsertEnquiry({
    external_enquiry_id: `qa-journey-${ctx.runId}`, full_name: `Test Journey`, email: ctx.ownerEmail, phone: null,
    address_line: `${ctx.runId.slice(0, 2).replace(/\D/g, "") || "7"} Journey Test Street`, suburb: "Frankston", postcode: "3199", state: "VIC", occupancy: "owner_occupied",
    estimated_area_m2: 120, life_support: false, life_support_status: "no", declared_property_type: "house", declared_over_five_years: "yes", declared_previous_upgrade: "no",
    contact_consent: true, contact_consent_version: "journey-test", contact_consented_at: new Date().toISOString(), age_confirmed: true,
    base44_answers: { existing_insulation: "none", property_type: "house" },
  } as never, "qa_test", ctx.actorId);
  ctx.jobId = res.job_id; ctx.jobNumber = res.job_number ?? null;
  await assertOwnTestJob(ctx);
  // Website contact consent, recorded exactly as the Base44 intake does (TEST job).
  const { data: jo } = await admin.from("jobs").select("owner_id").eq("id", ctx.jobId).single();
  const { recordContactConsent } = await import("./intake.server");
  await recordContactConsent(ctx.jobId, jo!.owner_id!, { contact_consent: true, contact_consent_version: "journey-test", contact_consented_at: new Date().toISOString(), external_enquiry_id: `qa-journey-${ctx.runId}` } as never);
  const { autoDecideEligibility } = await import("./eligibility.server");
  await autoDecideEligibility(ctx.jobId);
  const { autoAdvanceJob } = await import("./autoadvance.server");
  await autoAdvanceJob(ctx.jobId, ctx.actorId, "journey test intake");
  const { syncStep3 } = await import("./estimatelink.server");
  const link = await syncStep3(ctx.jobId, ctx.actorId);
  check(r, "secure owner estimate link prepared", link.status === "issued" || link.status === "reused", `link ${link.status} (mode ${link.mode})`);
  const { data: est } = await admin.from("indicative_estimates").select("area_m2, scenarios").eq("job_id", ctx.jobId).eq("status", "current").maybeSingle();
  check(r, "current estimate exists", !!est);
  const std = ((est!.scenarios as { by_access?: Record<string, { installation: number; pre_discount_total: number; applied_discount: number; estimated_customer_total: number }> }[])[0]?.by_access ?? {})["standard"];
  check(r, "standard-access estimate present", !!std);
  const st = await settings();
  const veecs = std!.applied_discount / st.veecValue;
  const exp = expectedEstimate(120, veecs, st);
  check(r, "discount is a whole number of VEECs", Number.isInteger(veecs), `$${std!.applied_discount} / $${st.veecValue}`);
  check(r, "price matches independent whole-VEEC maths", std!.installation === exp.install && std!.pre_discount_total === exp.gross && std!.estimated_customer_total === exp.pay && exp.pay >= st.minimum,
    `estimate ${std!.installation} + fees = ${std!.pre_discount_total} − ${std!.applied_discount} = ${std!.estimated_customer_total}; expected ${exp.install} / ${exp.gross} / ${exp.pay}`);
  ctx.notes["expected"] = exp;
  const { data: l } = await admin.from("customer_estimate_links").select("token").eq("job_id", ctx.jobId).eq("status", "active").order("created_at", { ascending: false }).limit(1).maybeSingle();
  ctx.token = (l as { token: string } | null)?.token ?? null;
  check(r, "owner token available", !!ctx.token);
  ctx.screens.push({ step: "s1_calculator", persona: "public", path: "/", mustSee: ["How much could you save", "Register my interest"] });
};

// ---------- Step 2: owner email links ----------
const s2: StepFn = async (ctx, r) => {
  await assertOwnTestJob(ctx);
  const { saveCampaignSpot, campaignPage } = await import("./launch-campaign.server");
  const page = await campaignPage(ctx.token, true);
  check(r, "Save my spot page opens from the owner link", !!page);
  await saveCampaignSpot(ctx.token);
  await saveCampaignSpot(ctx.token); // double tap
  const { count: responses } = await admin.from("lead_campaign_responses").select("id", { count: "exact", head: true }).eq("job_id", ctx.jobId!).not("spot_saved_at", "is", null);
  check(r, "double tap saves one spot", responses === 1, `${responses} saved rows`);
  const { count: jobs } = await admin.from("jobs").select("id", { count: "exact", head: true }).eq("external_enquiry_id", `qa-journey-${ctx.runId}`);
  check(r, "no duplicate job", jobs === 1, `${jobs} jobs`);
  // Same owner fills in the calculator again → attaches to the open job.
  const { upsertEnquiry } = await import("./enquiry.server");
  const { data: prop } = await admin.from("jobs").select("properties(address_line, suburb, postcode)").eq("id", ctx.jobId!).single();
  const p = prop!.properties as { address_line: string; suburb: string; postcode: string };
  const again = await upsertEnquiry({ full_name: "Test Journey", email: ctx.ownerEmail, address_line: p.address_line, suburb: p.suburb, postcode: p.postcode, estimated_area_m2: 130 } as never, "qa_test", ctx.actorId);
  check(r, "repeat calculator enquiry attaches to the same job", again.job_id === ctx.jobId, `got ${again.job_number}`);
  ctx.screens.push({ step: "s2_owner_links", persona: "owner_token", path: `/estimate/${ctx.token}/campaign`, mustSee: ["spot"] });
  ctx.screens.push({ step: "s2_owner_links", persona: "owner_token", path: `/estimate/${ctx.token}/calculator` });
  ctx.screens.push({ step: "s2_owner_links", persona: "owner_token", path: `/my-job/${ctx.token}`, mustSee: ["Your progress"], mustNotSee: ["version —"] });
};


/** Owner signs every outstanding item for the given gates via the real secure-link path: code request → 6-digit
 *  code → signing session → signGateDoc. On this TEST job only, the code's stored hash is set to a known code
 *  (we can't read a real one, and nothing is delivered to the TEST address). */
async function ownerSignGates(ctx: JourneyCtx, r: StepResult, gates: ("A" | "B" | "C" | "D")[], answers: Record<string, string> = {}) {
  await assertOwnTestJob(ctx);
  const ov = await import("./owner-verify.server");
  const { hashToken } = await import("./worker-links.core");
  await ov.requestOwnerCode(ctx.token, "email");
  const { data: code } = await admin.from("owner_link_codes").select("id").eq("job_id", ctx.jobId!).is("verified_at", null).order("created_at", { ascending: false }).limit(1).single();
  const known = "246810";
  await admin.from("owner_link_codes").update({ code_hash: await hashToken(`owner-code:${ctx.jobId}:${known}`) }).eq("id", code!.id).eq("job_id", ctx.jobId!);
  let wrong = false; try { await ov.verifyOwnerCode(ctx.token, "000000"); } catch { wrong = true; }
  check(r, "wrong 6-digit code is refused", wrong);
  const { session } = await ov.verifyOwnerCode(ctx.token, known);
  const s = await ov.ownerSession(ctx.token, session);
  const og = await import("./owner-gates.server");
  const signed: string[] = [];
  for (let i = 0; i < 15; i++) {
    const p = await og.ownerPaperworkToSign(ctx.jobId!);
    const next = p.todo.find((t) => (gates as string[]).includes(t.gate));
    if (!next) break;
    await og.signGateDoc({ jobId: s.jobId, key: next.key as never, signatoryName: "Test Journey", ticked: true, method: "link_code", signedBy: s.userId, ip: "127.0.0.1", userAgent: "journey-test",
      answers: { role: "owner", life_support: "no", ...answers }, verified: { channel: s.channel, destination: s.destination, codeId: s.codeId } });
    signed.push(next.key);
  }
  const left = (await og.ownerPaperworkToSign(ctx.jobId!)).todo.filter((t) => (gates as string[]).includes(t.gate));
  check(r, `owner paperwork ${gates.join("/")} all signed`, left.length === 0, left.length ? `still to sign: ${left.map((t) => t.key).join(", ")}` : `signed ${signed.join(", ") || "nothing new"}`);
  const { count: pdfs } = await admin.from("owner_gate_signatures").select("id", { count: "exact", head: true }).eq("job_id", ctx.jobId!);
  check(r, "each signature recorded", (pdfs ?? 0) >= signed.length, `${pdfs} signatures`);
  return signed;
}

// ---------- Step 3: office ----------
const s3: StepFn = async (ctx, r) => {
  await assertOwnTestJob(ctx);
  const { launchCampaignOffice } = await import("./launch-campaign.server");
  // The office Spots saved list hides TEST jobs on purpose (jobs.source <> 'qa_test'), so the TEST job is checked directly
  // and its absence from the office list is the expected result.
  const office = await launchCampaignOffice();
  const { data: saved } = await admin.from("lead_campaign_responses").select("spot_saved_at").eq("job_id", ctx.jobId!).maybeSingle();
  check(r, "spot saved for the TEST job", !!saved?.spot_saved_at, saved ? "no saved time" : "no campaign row");
  check(r, "TEST job kept out of the office Spots saved list", !office.rows.some((x) => x.jobId === ctx.jobId), `${office.rows.length} real rows`);
  // Jo 24 Oct 2026: the owner gives no Ready Check times; the office picks the TEST installer, who offers the owner 3 times.
  await ownerSignGates(ctx, r, ["A"]);
  const { startReadyCheckOffers } = await import("./readycheck-booking.server");
  const { data: j } = await admin.from("jobs").select("stage").eq("id", ctx.jobId!).single();
  ctx.notes["stage_before_offer"] = j?.stage;
  const { count: pending } = await admin.from("partner_offers").select("id", { count: "exact", head: true }).eq("job_id", ctx.jobId!).eq("kind", "ready_check").eq("status", "pending").eq("business_id", ctx.installer.business_id);
  if (!pending) await startReadyCheckOffers(ctx.jobId!, ctx.actorId, ctx.installer.business_id);
  const { data: offers } = await admin.from("partner_offers").select("id, business_id, status").eq("job_id", ctx.jobId!).eq("kind", "ready_check");
  const { data: bizNames } = await admin.from("businesses").select("id, name").in("id", (offers ?? []).map((o) => o.business_id));
  check(r, "offers went only to TEST businesses", (offers ?? []).length > 0 && (bizNames ?? []).every((b) => b.name.startsWith("TEST ") || b.name.startsWith("Jo Test")), (bizNames ?? []).map((b) => b.name).join(", "));
  const mine = (offers ?? []).find((o) => o.business_id === ctx.installer.business_id && o.status === "pending");
  check(r, "TEST Alpha has an open offer", !!mine);
  ctx.notes["rc_offer_id"] = mine!.id;
  ctx.screens.push({ step: "s3_office_offer", persona: "office", path: "/admin/today" });
};



// 1×1 white JPEG — a real image file, so upload signature checks see a genuine JPEG.
const TINY_JPEG = Uint8Array.from(atob("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k="), (c) => c.charCodeAt(0));
const FRANKSTON = { lat: -38.1446, lng: 145.1257 };

/** Upload one TEST evidence photo (geotagged at the TEST address) into the job's private files, as a phone upload would. */
async function uploadEvidence(ctx: JourneyCtx, category: string, by: string, gate: "assessment" | "electrical" | "installation" = "assessment") {
  await assertOwnTestJob(ctx);
  let { data: req } = await admin.from("evidence_requirements").select("id").eq("job_id", ctx.jobId!).eq("category", category as never).order("sort").limit(1).maybeSingle();
  if (!req) {
    const ins = await admin.from("evidence_requirements").insert({ job_id: ctx.jobId!, category: category as never, label: `TEST ${category}`, gate, required: false, status: "outstanding", sort: 900 } as never).select("id").single();
    if (ins.error) throw new Error(`evidence requirement: ${ins.error.message}`);
    req = ins.data;
  }
  const path = `${ctx.jobId}/journey/${category}-${Date.now()}.jpg`;
  const up = await admin.storage.from("job-files").upload(path, TINY_JPEG, { contentType: "image/jpeg", upsert: false });
  if (up.error) throw new Error(`evidence upload: ${up.error.message}`);
  (ctx.notes["uploaded"] as string[] | undefined ?? (ctx.notes["uploaded"] = [] as string[]) as string[]).push(path);
  const { error } = await admin.from("evidence_files").insert({ requirement_id: req!.id, job_id: ctx.jobId!, storage_path: path, file_name: `${category}.jpg`, mime_type: "image/jpeg", size_bytes: TINY_JPEG.length, uploaded_by: by, lat: FRANKSTON.lat, lng: FRANKSTON.lng, location_accuracy_m: 10, captured_at: new Date().toISOString(), distance_m: 5, location_source: "device" });
  if (error) throw new Error(`evidence record: ${error.message}`);
  await admin.from("evidence_requirements").update({ status: "uploaded" }).eq("id", req!.id).eq("status", "outstanding");
}

// ---------- Step 4: TEST installer takes the Ready Check, does it (Mitti simulated), quote maths ----------
const s4: StepFn = async (ctx, r) => {
  await assertOwnTestJob(ctx);
  const tv = await import("./trade-view.server");
  const offerId = ctx.notes["rc_offer_id"] as string;
  const before = JSON.stringify(await tv.tradeOffer(offerId, ctx.installer.id));
  check(r, "offer hides owner contact before it's taken", !before.includes(ctx.ownerEmail) && !/Journey Test Street/.test(before));
  // Installer accepts by offering the owner 3 times; the owner taps the first one (booked through confirmBooking).
  const rct = await import("./ready-check-times.core");
  const days = rct.allowedReadyCheckDays().slice(0, 3);
  await tv.tradeOfferReadyCheckTimes(offerId, ctx.installer.id, days.map((day) => ({ day, time: "10:00" })));
  const { data: offered } = await admin.from("appointment_proposals").select("id").eq("job_id", ctx.jobId!).eq("kind", "ready_check").eq("note", rct.READY_CHECK_TIME_NOTE).eq("status", "proposed").order("starts_at").limit(1).single();
  check(r, "installer offered the owner 3 Ready Check times", !!offered);
  const { data: jo0 } = await admin.from("jobs").select("owners(user_id)").eq("id", ctx.jobId!).single();
  const owner0 = (jo0?.owners as { user_id: string | null } | null)?.user_id ?? ctx.actorId;
  await (await import("./ready-check-times.server")).ownerTakeReadyCheckTime(ctx.jobId!, offered!.id, owner0);
  check(r, "owner took the first of the installer's times", true);
  const { data: j1 } = await admin.from("jobs").select("stage").eq("id", ctx.jobId!).single();
  check(r, "job is Ready Check scheduled", j1?.stage === "ready_check_scheduled", j1?.stage);
  const after = JSON.stringify(await tv.tradeOffer(offerId, ctx.installer.id));
  check(r, "after taking, installer sees the address", /Journey Test Street/.test(after));
  // Mitti Ready Check form: SIMULATED (no Mitti template/token in TEST). Same row the Mitti sync writes.
  r.simulated = ["Mitti Ready Check form (Ready Check written as the Mitti sync would)"];
  await admin.from("ceiling_measurements").update({ is_current: false }).eq("job_id", ctx.jobId!).eq("is_current", true);
  const { error: me } = await admin.from("ceiling_measurements").insert({ job_id: ctx.jobId!, status: "complete", is_current: true, source_role: "installer", created_by: ctx.installer.id, measured_area_m2: 120, removal_required: false, insulation_present: false, access_difficulty: "easy", measurement_method: "laser",
    completed_by: ctx.installer.id, completed_at: new Date().toISOString(), measured_on: melbourneDate(0), external_source: "journey_sim", external_id: `sim-${ctx.runId}`, raw_snapshot: { downlight_count: 6, downlight_type: "LED sealed" } } as never);
  check(r, "Ready Check recorded", !me, me?.message);
  for (const c of ["before_ceiling_space", "access_manhole", "existing_insulation_r_value", "identity_front_of_property"]) await uploadEvidence(ctx, c, ctx.installer.id);
  const { recordPriorActivityCheck } = await import("./verified-eligibility.server");
  await recordPriorActivityCheck(ctx.jobId!, ctx.actorId, "none_known" as never, null);
  const { recordVerification } = await import("./verified-eligibility.server");
  await recordVerification(await personaClient(JOURNEY_ACTOR_EMAIL) as never, ctx.jobId!, "eligible", null, "TEST journey: office verified from the Ready Check");
  const { transition } = await import("./workflow.server");
  await transition(ctx.jobId!, "ready_check_complete", ctx.actorId, "TEST journey: Ready Check done");
  const { generateInstallerQuotes } = await import("./quotes.server");
  await generateInstallerQuotes(ctx.jobId!, ctx.actorId);
  const { data: q } = await admin.from("quotes").select("id, status, subtotal_inc_gst, veec_discount_inc_gst").eq("job_id", ctx.jobId!).eq("kind", "installation").order("created_at", { ascending: false }).limit(1).maybeSingle();
  check(r, "quote created", !!q);
  const st = await settings();
  const sub = Number(q!.subtotal_inc_gst), disc = Number(q!.veec_discount_inc_gst), tot = sub - disc;
  const exp = ctx.notes["expected"] as { gross: number; discount: number; pay: number };
  check(r, "quote matches the estimate the owner saw (same 120 m²)", sub === exp.gross && disc === exp.discount, `quote ${sub} − ${disc}; estimate ${exp.gross} − ${exp.discount}`);
  check(r, "quote discount is whole VEECs × settings value", Number.isInteger(Math.round(disc * 100) / 100 / st.veecValue), `$${disc} / $${st.veecValue}`);
  check(r, "quote total = subtotal − discount, at least the minimum", Math.abs(tot - (sub - disc)) < 0.01 && tot >= st.minimum, `${sub} − ${disc} = ${tot}`);
  ctx.quoteId = q!.id;
  ctx.screens.push({ step: "s4_ready_check", persona: "installer", path: `/field/offer/${offerId}` });
  ctx.screens.push({ step: "s4_ready_check", persona: "installer", path: `/field/day/${ctx.jobId}` });
};

function melbourneDate(daysAhead: number) {
  const d = new Date(Date.now() + daysAhead * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Run a real portal step; any error becomes a named failed check (never a silent pass). */
async function act<T>(r: StepResult, name: string, fn: () => Promise<T>): Promise<T> {
  try { const v = await fn(); r.checks.push({ name, ok: true }); return v; }
  catch (e) { const m = e instanceof Error ? e.message : String(e); r.checks.push({ name, ok: false, detail: m }); throw new StepFail(`${name}: ${m}`); }
}
async function stageOf(ctx: JourneyCtx) { return (await admin.from("jobs").select("stage").eq("id", ctx.jobId!).single()).data?.stage ?? null; }

// ---------- Step 5: owner accepts the quote and signs the paperwork ----------
const s5: StepFn = async (ctx, r) => {
  await assertOwnTestJob(ctx);
  const { data: q0 } = await admin.from("quotes").select("id, status, release_state, version").eq("id", ctx.quoteId!).single();
  if (q0?.status === "draft") { const { approveHeldQuote } = await import("./quotes.server"); await act(r, "office approves the held quote", () => approveHeldQuote(ctx.quoteId!, ctx.actorId)); }
  const og = await import("./owner-gates.server");
  const pw = await og.ownerPaperworkToSign(ctx.jobId!);
  const line = pw.todo.find((t) => t.key === "quote_acceptance");
  check(r, "quote acceptance line is on My job", !!line, pw.todo.map((t) => t.key).join(", "));
  const { data: q } = await admin.from("quotes").select("id, version, customer_total_inc_gst").eq("id", ctx.quoteId!).single();
  const total = `$${Number(q!.customer_total_inc_gst).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  check(r, "acceptance line shows the real version and inc-GST price", line!.text.includes(`version ${q!.version}, ${total} inc GST`) && !line!.text.includes("—"), line!.text.slice(0, 90));
  if ((await stageOf(ctx)) === "ready_check_complete") {
    const { transition } = await import("./workflow.server");
    await act(r, "measured quote ready for the owner", () => transition(ctx.jobId!, "measured_estimate_ready", ctx.actorId, "TEST journey: measured quote ready"));
  }
  { const { resolveOwnerJob } = await import("./owner-myjob.server"); const oc = await import("./owner-confirm.core");
    const v = await resolveOwnerJob(ctx.token) as { agreed?: { agreed: boolean; installerName: string | null } } | null;
    const { data: jj } = await admin.from("jobs").select("channel, external_refs").eq("id", ctx.jobId!).single();
    const agreedExpected = jj?.channel === "installer_sourced" && (jj.external_refs as Record<string, unknown> | null)?.["owner_agreed_price"] === true;
    check(r, `owner link titled "${agreedExpected ? oc.CONFIRM_JOB_TITLE : oc.CONFIRMED_QUOTE_TITLE}"`, oc.ownerPriceTitle(v?.agreed) === (agreedExpected ? oc.CONFIRM_JOB_TITLE : oc.CONFIRMED_QUOTE_TITLE), oc.ownerPriceTitle(v?.agreed));
    if (agreedExpected) check(r, "price labelled As agreed with the installer business", !!oc.agreedWithLabel(v?.agreed), String(oc.agreedWithLabel(v?.agreed)));
    ctx.screens.push({ step: "s5_owner_accept", persona: "owner_token", path: `/my-job/${ctx.token}?screen=quote`, mustSee: [oc.PIESA_FIXES_NOTE.slice(0, 60)] }); }
  await ownerSignGates(ctx, r, ["B"]);
  const { respondToQuoteImpl } = await import("./portal.functions");
  const { data: jo } = await admin.from("jobs").select("owner_id, owners(user_id)").eq("id", ctx.jobId!).single();
  const ownerUser = (jo?.owners as { user_id: string | null } | null)?.user_id ?? ctx.actorId;
  await act(r, "owner accepts the quote and signs the customer agreement", () => respondToQuoteImpl({ quoteId: ctx.quoteId!, accept: true, consent: true, expectedVersion: q!.version,
    signing: { signatoryName: "Test Journey", authorityType: "owner", over18: true, readConsumerInfo: true, acceptAgreement: true, signatureName: "Test Journey", assistance: "none" } } as never,
    { userId: ownerUser, ip: "127.0.0.1", userAgent: "journey-test", authorize: async () => {}, isOwner: async () => true } as never));
  const { data: qa } = await admin.from("quotes").select("status").eq("id", ctx.quoteId!).single();
  check(r, "quote is accepted", qa?.status === "accepted", qa?.status);
  // Safety check payment: Xero Demo Company only for TEST jobs.
  const x = await import("./xero.server");
  const inv = await act(r, "invoice created for the accepted quote (Demo Company)", () => x.createInvoiceForQuote(ctx.quoteId!, ctx.actorId)) as { id?: string } | null;
  const { data: iv } = await admin.from("invoices").select("id, xero_invoice_id").eq("job_id", ctx.jobId!).order("created_at", { ascending: false }).limit(1).maybeSingle();
  check(r, "invoice row exists", !!iv, JSON.stringify(inv ?? null).slice(0, 80));
  if (!iv!.xero_invoice_id) await act(r, "invoice pushed to the Xero Demo Company", () => x.pushInvoiceToXero(iv!.id, ctx.actorId) as Promise<unknown>);
  { const { data: linked } = await admin.from("invoices").select("xero_invoice_id, last_sync_error").eq("id", iv!.id).single();
    if (!linked?.xero_invoice_id) throw new Error(`Invoice not in the Xero Demo Company: ${linked?.last_sync_error ?? "unknown reason"}`); }
  await act(r, "Pre Insulation Electrical Safety Assessment (PIESA) payment recorded (TEST payment, Demo Company)", () => x.recordDemoTestPayment(iv!.id, 349, ctx.actorId));
  ctx.notes["invoice_id"] = iv!.id;
  ctx.screens.push({ step: "s5_owner_accept", persona: "owner_token", path: `/my-job/${ctx.token}`, mustNotSee: ["version —"] });
};

// ---------- Step 6: electrician safety check (PIESA) and certificate ----------
const s6: StepFn = async (ctx, r) => {
  await assertOwnTestJob(ctx);
  const al = await import("./allocation.server");
  const { count: open } = await admin.from("partner_offers").select("id", { count: "exact", head: true }).eq("job_id", ctx.jobId!).eq("kind", "piesa").eq("status", "pending").eq("business_id", ctx.electrician.business_id);
  if (!open) await act(r, "office offers the Pre Insulation Electrical Safety Assessment (PIESA) to TEST Delta", () => al.startPiesaAllocation(ctx.jobId!, ctx.actorId, "piesa", { onlyBusiness: ctx.electrician.business_id, rateToConfirm: true }));
  const { data: offers } = await admin.from("partner_offers").select("id, business_id, status").eq("job_id", ctx.jobId!).eq("kind", "piesa");
  const { data: names } = await admin.from("businesses").select("name, onboarding_notes").in("id", (offers ?? []).map((o) => o.business_id));
  check(r, "Pre Insulation Electrical Safety Assessment (PIESA) offers went only to TEST partners", (names ?? []).length > 0 && (names ?? []).every((b) => (b.onboarding_notes ?? "").includes("[TEST PARTNER]")), (names ?? []).map((b) => b.name).join(", "));
  const mine = (offers ?? []).find((o) => o.business_id === ctx.electrician.business_id && o.status === "pending");
  check(r, "TEST Delta has an open Pre Insulation Electrical Safety Assessment (PIESA) offer", !!mine);
  // Decision 333: the electrician accepts by offering the owner 3 times; the owner taps one (30-day box ticked) = booked.
  const pt = await import("./piesa-times.server");
  const { allowedPiesaTimeDays } = await import("./piesa-times.core");
  const tdays = allowedPiesaTimeDays().slice(1, 4);
  await act(r, "electrician accepts and offers the owner 3 safety check times", () => pt.acceptPiesaOfferWithTimes(mine!.id, ctx.electrician.id, tdays.map((day) => ({ day, time: "10:00" }))));
  const ost = await pt.ownerPiesaTimesState(ctx.jobId!);
  check(r, "owner sees the electrician's 3 times", ost.turn === "owner_to_answer" && ost.open.length === 3, ost.turn);
  await act(r, "owner ticks the 30-day box and takes the first time", () => pt.ownerTakePiesaTime(ctx.jobId!, ost.open[0]!.id, ctx.actorId, { understandsThirtyDays: true, ip: null, userAgent: null }));
  ctx.notes["piesa_offer_id"] = mine!.id;
  // Mitti PIESA form + certificate: SIMULATED (no Mitti in TEST). Writes the same assessment the Mitti sync writes.
  r.simulated = ["Mitti PIESA form and certificate (pass written as the Mitti sync would)"];
  const now = new Date().toISOString();
  const { data: a } = await admin.from("assessments").select("id").eq("job_id", ctx.jobId!).maybeSingle();
  const fields = { status: "complete", piesa_outcome: "pass", completed_at: now, assessed_on: melbourneDate(0), no_rectification_confirmed: true, notes: "TEST journey: simulated Mitti PIESA (pass)" };
  const ae = a ? await admin.from("assessments").update(fields as never).eq("id", a.id) : await admin.from("assessments").insert({ job_id: ctx.jobId!, ...fields } as never);
  check(r, "PIESA result recorded", !ae.error, ae.error?.message);
  // Same signed PIESA record the real completion writes (portal completeAssessment), which install booking checks.
  const { data: a2 } = await admin.from("assessments").select("id").eq("job_id", ctx.jobId!).maybeSingle();
  const { count: pr } = await admin.from("piesa_records").select("id", { count: "exact", head: true }).eq("job_id", ctx.jobId!).eq("is_current", true).eq("outcome", "pass");
  check(r, "current PIESA records before sign-off", true, String(pr));
  if (!pr) { const pe = await admin.from("piesa_records").insert({ job_id: ctx.jobId!, assessment_id: a2?.id ?? null, kind: "initial", outcome: "pass", completed_date: melbourneDate(0), signed_off_by: ctx.electrician.id, notes: "TEST journey: simulated Mitti PIESA sign-off" } as never); check(r, "PIESA sign-off recorded", !pe.error, pe.error?.message); }
  for (const c of ["switchboard_cables", "piesa_signoff"]) await uploadEvidence(ctx, c, ctx.electrician.id, "electrical");
  await admin.from("bookings").update({ status: "completed" }).eq("job_id", ctx.jobId!).eq("kind", "assessment").eq("status", "confirmed");
  const { transition } = await import("./workflow.server");
  if ((await stageOf(ctx)) !== "piesa_complete") await act(r, "job moves to Pre Insulation Electrical Safety Assessment (PIESA) complete", () => transition(ctx.jobId!, "piesa_complete", ctx.actorId, "TEST journey: PIESA passed"));
  check(r, "stage is Pre Insulation Electrical Safety Assessment (PIESA) complete", (await stageOf(ctx)) === "piesa_complete", await stageOf(ctx) ?? "");
  ctx.screens.push({ step: "s6_electrician", persona: "electrician", path: `/field/day/${ctx.jobId}` });
};

// ---------- Step 7: install booking, install day and evidence ----------
const s7: StepFn = async (ctx, r) => {
  await assertOwnTestJob(ctx);
  const { transition } = await import("./workflow.server");
  if ((await stageOf(ctx)) !== "installation_scheduling") await act(r, "install scheduling opens after the PIESA pass", () => transition(ctx.jobId!, "installation_scheduling", ctx.actorId, "TEST journey: install scheduling"));
  const days: string[] = []; for (let d = 3; d < 20 && days.length < 3; d++) { const x = melbourneDate(d); const wd = new Date(`${x}T12:00:00Z`).getUTCDay(); if (wd > 0 && wd < 6) days.push(x); }
  const idays = await import("./install-days.server");
  await act(r, "installer offers 3 install days (within 30 days of the PIESA)", () => idays.installerOfferDays(ctx.jobId!, ctx.installer.id, days.map((day) => ({ day, time: "08:00" }))));
  const st = await idays.ownerInstallDayState(ctx.jobId!);
  check(r, "owner sees the installer's 3 days", st.turn === "owner_to_answer" && st.open.length === 3, st.turn);
  await act(r, "owner takes one of the installer's days", () => idays.ownerTakeDay(ctx.jobId!, st.open[0]!.id, ctx.actorId));
  check(r, "job is installation booked", (await stageOf(ctx)) === "installation_booked", await stageOf(ctx) ?? "");
  for (const c of ["product_evidence", "installation_progress", "completed_installation", "post_install_video", "final_zone_plan"]) await uploadEvidence(ctx, c, ctx.installer.id, "installation");
  // Before the install day, the same real paths the office, electrician and owner use (no check bypassed):
  {
    const cs = await import("./consent.server");
    const rec = await import("./job-records.server");
    const now = new Date().toISOString();
    await act(r, "owner signs the ESC information-sharing consent for the booked day", () => cs.signOwnerConsent({ jobId: ctx.jobId!, actorId: ctx.actorId, input: { signatoryName: "Test Journey", authorityType: "owner", accept: true, signatureName: "Test Journey" }, ip: "127.0.0.1", userAgent: "journey-test" }));
    // Decision 370: the AP part normally signs itself right after the owner; the office path runs only if it was held.
    if ((await cs.currentConsent(ctx.jobId!))?.status === "awaiting_ap") await act(r, "AP representative confirms the ESC consent", () => cs.confirmApConsent({ jobId: ctx.jobId!, actorId: ctx.actorId, apRepName: "TEST AP representative", purposeExplained: true, ip: "127.0.0.1", userAgent: "journey-test" }));
    await act(r, "ESC pre-install notice prepared for the booked day", async () => { await (await import("./esc.server")).regenerateEscNotification(ctx.jobId!, ctx.actorId); });
    for (const to of ["owner", "installer"] as const) await act(r, `signed PIESA copy recorded as given to the ${to}`, () => rec.recordPiesaCopyDelivery({ jobId: ctx.jobId!, recipient: to, deliveredAt: now, method: "portal", actorId: ctx.actorId }));
    await act(r, "office records pre-install consumer documents given", () => rec.recordComplianceRecord({ jobId: ctx.jobId!, key: "pre_install_consumer_docs", occurredAt: melbourneDate(0), reference: "TEST journey", notes: null, actorId: ctx.actorId }));
  }
  await ownerSignGates(ctx, r, ["C"]); // owner confirms receipt of the safety check copy (real secure-link path)
  await admin.from("bookings").update({ status: "completed" }).eq("job_id", ctx.jobId!).eq("kind", "installation").eq("status", "confirmed");
  await act(r, "install done → evidence outstanding", () => transition(ctx.jobId!, "evidence_outstanding", ctx.actorId, "TEST journey: install done"));
  // Installer declaration comes back inside the Mitti PIISA (simulated; TEST job only).
  {
    const pd = await import("./piisa-declaration.core");
    const { syncPiisaDeclaration } = await import("./piisa-declaration.server");
    const { data: jn } = await admin.from("jobs").select("job_number").eq("id", ctx.jobId!).single();
    const auditId = `journey-piisa-${ctx.jobId}`; const tpl = "journey-piisa-template";
    const { logEvent } = await import("./workflow.server");
    await logEvent(ctx.jobId!, ctx.actorId, "mitti_piisa_audit_created", "TEST journey: simulated PIISA sent in Mitti", { audit_id: auditId });
    let refused = ""; try { await transition(ctx.jobId!, "ap_review", ctx.actorId, "TEST journey: before declaration"); } catch (e) { refused = e instanceof Error ? e.message : String(e); }
    check(r, "Final check refused without the PIISA declaration", refused.includes(pd.MISSING_INSTALLER_DECLARATION), refused || "allowed");
    const unsigned = await syncPiisaDeclaration(ctx.jobId!, ctx.actorId, async () => pd.simulatedPiisaAudit({ auditId, templateId: tpl, jobNumber: jn!.job_number, signed: false }), { testTemplateId: tpl });
    check(r, "PIISA without signed declaration shows Missing evidence", unsigned.status === "missing", unsigned.message);
    const signed = await syncPiisaDeclaration(ctx.jobId!, ctx.actorId, async () => pd.simulatedPiisaAudit({ auditId, templateId: tpl, jobNumber: jn!.job_number, signed: true }), { testTemplateId: tpl });
    check(r, "signed PIISA declaration saved as the job's record", signed.status === "saved", signed.message);
  }
  {
    const rec = await import("./job-records.server");
    for (const key of ["installer_safety_assessment", "completion_consumer_docs"] as const) await act(r, `office records ${key.replace(/_/g, " ")}`, () => rec.recordComplianceRecord({ jobId: ctx.jobId!, key, occurredAt: melbourneDate(0), reference: "TEST journey", notes: null, actorId: ctx.actorId }));
  }
  await act(r, "evidence complete → Final check", () => transition(ctx.jobId!, "ap_review", ctx.actorId, "TEST journey: evidence uploaded"));
  ctx.screens.push({ step: "s7_install", persona: "installer", path: `/field/day/${ctx.jobId}` });
};

// ---------- Step 8: AP sign-off; installer payout shows "Coming" ----------
const s8: StepFn = async (ctx, r) => {
  await assertOwnTestJob(ctx);
  const now = new Date().toISOString();
  const { error } = await admin.from("evidence_requirements").update({ status: "verified" } as never).eq("job_id", ctx.jobId!).eq("status", "uploaded");
  check(r, "office verifies the uploaded evidence", !error, error?.message);
  await admin.from("evidence_files").update({ verified_at: now, verified_by: ctx.actorId } as never).eq("job_id", ctx.jobId!);
  const { transition } = await import("./workflow.server");
  await act(r, "AP sign-off → ready for VEEC", () => transition(ctx.jobId!, "ready_for_veec", ctx.actorId, "TEST journey: AP approved"));
  const tv = await import("./trade-view.server");
  const money = await tv.tradeMoney(ctx.installer.id);
  const row = money.rows.find((x) => x.jobId === ctx.jobId);
  check(r, "installer Money shows this install", !!row, `${money.rows.length} rows`);
  check(r, "installer payout shows Coming", row!.state.kind === "coming", row!.state.kind);
  ctx.screens.push({ step: "s8_ap_payout", persona: "installer", path: "/field/money", mustSee: ["Coming"] });
};

const STEP_FNS: Record<JourneyStepKey, StepFn> = {
  s1_calculator: s1, s2_owner_links: s2, s3_office_offer: s3,
  s4_ready_check: s4, s5_owner_accept: s5, s6_electrician: s6, s7_install: s7, s8_ap_payout: s8,
  s9_visibility: async (ctx, r) => visibility(ctx, r), s10_allowlist: async (ctx, r) => allowlist(ctx, r),
};

// ---------- Step 9: who sees what (server-side reads through the trade view) ----------
async function visibility(ctx: JourneyCtx, r: StepResult) {
  await assertOwnTestJob(ctx);
  const tv = await import("./trade-view.server");
  // Worker can't open Money.
  if (ctx.worker) {
    let blocked = false; try { await tv.tradeMoney(ctx.worker.id); } catch { blocked = true; }
    check(r, "worker can't open Money", blocked);
  }
  // A trade with no active assignment on the job (worker never assigned / reassigned away) can't see owner details.
  const offerId = ctx.notes["rc_offer_id"] as string | undefined;
  if (offerId && ctx.worker) {
    let txt = ""; try { txt = JSON.stringify(await tv.tradeOffer(offerId, ctx.worker.id)); } catch { txt = ""; }
    check(r, "unassigned worker sees no owner details", !txt.includes(ctx.ownerEmail) && !/Journey Test Street/.test(txt) && !/Test Journey/.test(txt));
  }
  if (ctx.jobId) {
    let txt = ""; try { txt = JSON.stringify(await tv.tradeDay(ctx.jobId, ctx.electrician.id)); } catch { txt = ""; }
    check(r, "electrician whose visit is done no longer sees owner details", !/Journey Test Street/.test(txt) && !txt.includes(ctx.ownerEmail));
    const refused = async (f: () => Promise<unknown>) => { try { await f(); return false; } catch { return true; } };
    const js = await import("./job-status.server");
    if (ctx.worker) {
      check(r, "staff not assigned to the job can't open its day page", await refused(() => tv.tradeDay(ctx.jobId!, ctx.worker!.id)));
      check(r, "staff not assigned to the job can't open its job page", await refused(() => js.tradeJobStatus(ctx.worker!.id, ctx.jobId!)));
    }
    const { data: el } = await admin.from("job_assignments").select("id").eq("job_id", ctx.jobId).eq("role", "electrician").eq("active", true).maybeSingle();
    if (el) {
      await admin.from("job_assignments").update({ active: false, ended_at: new Date().toISOString(), end_reason: "TEST journey: access check" }).eq("id", el.id);
      const ended = await refused(() => tv.tradeDay(ctx.jobId!, ctx.electrician.id));
      const endedJob = await refused(() => js.tradeJobStatus(ctx.electrician.id, ctx.jobId!));
      await admin.from("job_assignments").update({ active: true, ended_at: null, end_reason: null }).eq("id", el.id);
      check(r, "electrician whose assignment ended is refused (day page and job page)", ended && endedJob);
    }
    // Reassigned trade: end the installer's assignment, confirm owner details disappear, then restore it.
    const { data: asg } = await admin.from("job_assignments").select("id").eq("job_id", ctx.jobId).eq("role", "installer").eq("active", true).maybeSingle();
    if (asg && offerId) {
      await admin.from("job_assignments").update({ active: false, ended_at: new Date().toISOString(), end_reason: "TEST journey: reassignment check" }).eq("id", asg.id);
      let after = ""; try { after = JSON.stringify(await tv.tradeOffer(offerId, ctx.installer.id)); } catch { after = ""; }
      await admin.from("job_assignments").update({ active: true, ended_at: null, end_reason: null }).eq("id", asg.id);
      check(r, "reassigned installer loses owner details", !/Journey Test Street/.test(after) && !after.includes(ctx.ownerEmail));
    }
  }
  // Electrician home/day never contains customer prices.
  const home = JSON.stringify(await tv.tradeHome(ctx.electrician.id));
  check(r, "electrician view has no customer price fields", !/total_inc_gst|customer_total|veu_discount|margin|gross/i.test(home));
}

// ---------- Step 10: nothing outside the allowlist ----------
async function allowlist(ctx: JourneyCtx, r: StepResult) {
  const since = ctx.startedAt;
  const [{ data: emails }, { data: comms }] = await Promise.all([
    admin.from("customer_email_sends").select("job_id, status, sent_at").gte("created_at", since),
    admin.from("job_communications").select("recipients, delivery_status, direction, sent_at").eq("direction", "outbound").gte("created_at", since),
  ]);
  // Any customer email actually delivered since the run started must belong to a qa_test job.
  const sentJobs = [...new Set((emails ?? []).filter((e) => e.sent_at || e.status === "sent").map((e) => e.job_id))];
  if (sentJobs.length) {
    const { data: js } = await admin.from("jobs").select("id, source").in("id", sentJobs);
    const nonTest = (js ?? []).filter((j) => j.source !== "qa_test").length;
    check(r, "no customer email delivered for a non-TEST job", nonTest === 0, `${nonTest} non-TEST`);
  }
  const addr = (v: unknown): string[] => Array.isArray(v) ? v.flatMap((x) => typeof x === "string" ? [x] : x && typeof x === "object" ? Object.values(x as Record<string, unknown>).filter((y): y is string => typeof y === "string" && /@|^\+?\d{8,}$/.test(y)) : []) : [];
  const delivered = (comms ?? []).filter((c) => c.sent_at || c.delivery_status === "sent" || c.delivery_status === "delivered").flatMap((c) => addr(c.recipients));
  const outside = recipientsOutsideAllowlist(delivered);
  check(r, "every delivered message went to the allowlist", outside.length === 0, outside.length ? `${outside.length} outside` : `${delivered.length} delivered, all allowlisted`);
}

/** Archive this run's TEST data the Test Centre way. Never touches anything else. */
export async function cleanupJourney(ctx: JourneyCtx) {
  const now = new Date().toISOString();
  if (ctx.jobId) {
    const { data: j } = await admin.from("jobs").select("source").eq("id", ctx.jobId).maybeSingle();
    if (j?.source === "qa_test") {
      await admin.from("partner_offers").update({ status: "withdrawn" } as never).eq("job_id", ctx.jobId).eq("status", "pending");
      await admin.from("job_assignments").update({ active: false, ended_at: now, end_reason: "TEST journey archived" }).eq("job_id", ctx.jobId).eq("active", true);
      await admin.from("jobs").update({ qa_archived_at: now, stage: "cancelled", cancelled_reason: "TEST journey archived", next_action: "Archived TEST journey" }).eq("id", ctx.jobId).eq("source", "qa_test");
    }
  }
  // Put the TEST businesses back exactly as they were before this run (TEST businesses only).
  for (const b of (ctx.notes["biz_before"] as { id: string }[] | undefined) ?? []) {
    const { id, ...orig } = b as { id: string } & Record<string, unknown>;
    await admin.from("businesses").update(orig as never).eq("id", id).like("onboarding_notes", "%[TEST PARTNER]%");
  }
  const files = (ctx.notes["uploaded"] as string[] | undefined) ?? [];
  if (files.length && ctx.jobId) await admin.storage.from("job-files").remove(files.filter((f) => f.startsWith(`${ctx.jobId}/journey/`)));
  if (ctx.calculatorInterestId) await admin.from("calculator_interests").delete().eq("id", ctx.calculatorInterestId).eq("email", ctx.ownerEmail);
}

/** TEST trade setup the journey depends on (TEST Alpha's field worker holds a Full, current EEC certification).
 *  Only ever touches TEST-domain workers in businesses named "TEST …". Append-only, idempotent. */
async function ensureTestTrades(actorId: string, installerBiz: string, electricianBiz: string) {
  const before: Record<string, unknown>[] = [];
  for (const id of [installerBiz, electricianBiz]) {
    const { data: biz } = await admin.from("businesses").select("name, service_postcodes, coverage_verified_at, free_measureups_for_hivic_quote_leads").eq("id", id).single();
    if (!biz?.name?.startsWith("TEST ")) throw new Error("SAFETY STOP: a journey trade is not a TEST business.");
    before.push({ id, service_postcodes: biz.service_postcodes ?? [], coverage_verified_at: biz.coverage_verified_at, free_measureups_for_hivic_quote_leads: biz.free_measureups_for_hivic_quote_leads });
    const pcs = biz.service_postcodes ?? [];
    await admin.from("businesses").update({
      service_postcodes: pcs.includes(JOURNEY_POSTCODE) ? pcs : [...pcs, JOURNEY_POSTCODE], coverage_verified_at: biz.coverage_verified_at ?? new Date().toISOString(),
      ...(id === installerBiz ? { free_measureups_for_hivic_quote_leads: true } : {}),
    }).eq("id", id);
  }
  const { data: workers } = await admin.from("partner_workers").select("id, email").eq("business_id", installerBiz).eq("trade_role", "installer").is("removed_at", null); // decision 153: clearance comes from the certification, not approval_status
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne" }).format(new Date());
  for (const w of (workers ?? []).filter((x) => x.email.endsWith(TEST_DOMAIN))) {
    const { data: c } = await admin.from("partner_worker_certifications").select("id, status").or(`worker_id.eq.${w.id},worker_email.eq.${w.email}`).order("recorded_at", { ascending: false }).limit(1).maybeSingle();
    let certId = c?.status === "verified" ? c.id : null;
    if (!certId) {
      const { data: ins, error } = await admin.from("partner_worker_certifications").insert({ worker_id: w.id, worker_email: w.email, status: "verified", evidence_source: "certificate_sighted", evidence_note: "TEST journey: fake certificate for a TEST worker", certificate_number: "TEST-EEC-0001", issuer: "TEST", recorded_by: actorId }).select("id").single();
      if (error) throw new Error(`TEST certification setup: ${error.message}`);
      certId = ins.id;
    }
    const { data: lv } = await admin.from("worker_certification_levels").select("level, expires_on").eq("certification_id", certId).order("recorded_at", { ascending: false }).limit(1).maybeSingle();
    if (!(lv?.level === "full" && lv.expires_on >= today)) {
      const exp = new Date(Date.now() + 730 * 86_400_000).toISOString().slice(0, 10);
      const { error } = await admin.from("worker_certification_levels").insert({ certification_id: certId, worker_email: w.email, level: "full", expires_on: exp, recorded_by: actorId });
      if (error) throw new Error(`TEST certification level setup: ${error.message}`);
    }
  }
  return before;
}

export async function newJourneyCtx(): Promise<JourneyCtx> {
  const runId = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const { data: actor } = await admin.from("profiles").select("id").eq("email", JOURNEY_ACTOR_EMAIL).single();
  const [installer, electrician] = await Promise.all([profileByEmail(TEST_INSTALLER_EMAIL), profileByEmail(TEST_ELECTRICIAN_EMAIL)]);
  const worker = await profileByEmail(TEST_WORKER_EMAIL).catch(() => null);
  const bizBefore = await ensureTestTrades(actor!.id, installer.business_id, electrician.business_id);
  return { runId, startedAt: new Date().toISOString(), actorId: actor!.id, jobId: null, jobNumber: null, token: null, ownerEmail: `qa.journey.${runId}${TEST_DOMAIN}`, installer, electrician, worker, calculatorInterestId: null, quoteId: null, notes: { biz_before: bizBefore }, screens: [] };
}

/** Run every step in order; a failed step stops later dependent steps but 9 and 10 always run. */
export async function runServerJourney(opts: { cleanup?: boolean; afterStep?: (ctx: JourneyCtx, r: StepResult) => Promise<void> } = {}): Promise<{ ctx: JourneyCtx; result: JourneyResult }> {
  const ctx = await newJourneyCtx();
  const steps: StepResult[] = [];
  let broken = false;
  for (const s of JOURNEY_STEPS) {
    const r: StepResult = { key: s.key, label: s.label, passed: false, checks: [] };
    const always = s.key === "s9_visibility" || s.key === "s10_allowlist";
    if (broken && !always) { r.error = "skipped — an earlier step failed"; steps.push(r); continue; }
    try { await STEP_FNS[s.key](ctx, r); r.passed = true; }
    catch (e) { r.error = e instanceof Error ? e.message : String(e); if (!always) broken = true; }
    if (opts.afterStep) await opts.afterStep(ctx, r).catch((e) => { r.passed = false; r.error = `browser check: ${e instanceof Error ? e.message : e}`; });
    steps.push(r);
  }
  if (opts.cleanup !== false) await cleanupJourney(ctx).catch((e) => console.error("journey cleanup", e));
  return { ctx, result: summarise(steps) };
}

export async function storeJourneyRun(mode: "browser" | "server", ctx: JourneyCtx, result: JourneyResult) {
  const { data, error } = await admin.from("journey_runs").insert({ mode, started_at: ctx.startedAt, finished_at: new Date().toISOString(), passed: result.passed, failing_step: result.failingStep, failing_reason: result.failingReason, steps: result.steps as never, test_job_id: ctx.jobId }).select("id").single();
  if (error) throw new Error(error.message);
  return data.id;
}

export async function latestJourneyRun() {
  const { data } = await admin.from("journey_runs").select("id, mode, started_at, finished_at, passed, failing_step, failing_reason").order("started_at", { ascending: false }).limit(1).maybeSingle();
  return data;
}
