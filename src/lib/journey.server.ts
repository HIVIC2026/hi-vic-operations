// Full-journey test runner (server side). TEST data only: every job it touches is created by this run with
// source='qa_test', every person is on the TEST domain, and each step re-checks that before acting.
// Shared by the daily endpoint and the browser runner (which adds screenshots on top of the same steps).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { JOURNEY_INSTALL_CONSENT, JOURNEY_STEPS, expectedEstimate, recipientsOutsideAllowlist, summarise, type JourneyResult, type JourneyStepKey, type StepResult } from "./journey-test.core";

export const JOURNEY_ACTOR_EMAIL = "admin@hivic.test";
export const TEST_INSTALLER_EMAIL = "qa.installer.alpha@hivic-test.example";
export const TEST_ELECTRICIAN_EMAIL = "qa.rec.delta@hivic-test.example";
export const TEST_WORKER_EMAIL = "qa.worker.alpha@hivic-test.example";
const TEST_DOMAIN = "@hivic-test.example";

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
  const { data } = await admin.from("profiles").select("id, business_id, full_name").eq("email", email).maybeSingle();
  if (!data?.business_id) throw new Error(`TEST account ${email} is missing — run "Create TEST trade accounts" in Test Centre first.`);
  return data as { id: string; business_id: string; full_name: string | null };
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
  }).select("id, mobile").single();
  check(r, "calculator registration saved", !error && !!ins, error?.message);
  ctx.calculatorInterestId = ins!.id;
  ctx.notes["owner_phone"] = ins!.mobile;
  // The owner's enquiry arrives as an isolated TEST job (Base44 intake path, qa_test source).
  const { upsertEnquiry } = await import("./enquiry.server");
  const res = await upsertEnquiry({
    external_enquiry_id: `qa-journey-${ctx.runId}`, full_name: `Test Journey`, email: ctx.ownerEmail, phone: ins!.mobile,
    address_line: (ctx.notes["address_line"] as string | undefined) ?? `${ctx.runId.slice(0, 2).replace(/\D/g, "") || "7"} Journey Test Street`, suburb: "Frankston", postcode: "3199", state: "VIC", occupancy: "owner_occupied",
    estimated_area_m2: 120, life_support: false, life_support_status: "no", declared_property_type: "house", declared_over_five_years: "yes", declared_previous_upgrade: "no",
    contact_consent: true, contact_consent_version: "journey-test", contact_consented_at: new Date().toISOString(), age_confirmed: true,
    base44_answers: { existing_insulation: "none", property_type: "house" },
  } as never, "qa_test", ctx.actorId);
  ctx.jobId = res.job_id; ctx.jobNumber = res.job_number ?? null;
  await assertOwnTestJob(ctx);
  // Website contact consent, recorded exactly as the Base44 intake does (TEST job).
  const { data: safetyJob, error: safetyRead } = await admin.from("jobs").select("external_refs").eq("id", ctx.jobId).eq("source", "qa_test").single();
  if (safetyRead || !safetyJob) throw new Error("TEST delivery safety could not be checked.");
  const { error: safetyWrite } = await admin.from("jobs").update({ external_refs: { ...((safetyJob.external_refs ?? {}) as Record<string, never>), qa_no_delivery: true } }).eq("id", ctx.jobId).eq("source", "qa_test");
  if (safetyWrite) throw new Error("TEST delivery safety could not be saved.");
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
  const again = await upsertEnquiry({ full_name: "Test Journey", email: ctx.ownerEmail, phone: ctx.notes["owner_phone"] as string, address_line: p.address_line, suburb: p.suburb, postcode: p.postcode, estimated_area_m2: 130 } as never, "qa_test", ctx.actorId);
  check(r, "repeat calculator enquiry attaches to the same job", again.job_id === ctx.jobId, `got ${again.job_number}`);
  ctx.screens.push({ step: "s2_owner_links", persona: "owner_token", path: `/estimate/${ctx.token}/campaign`, mustSee: ["spot"] });
  ctx.screens.push({ step: "s2_owner_links", persona: "owner_token", path: `/estimate/${ctx.token}/calculator` });
  ctx.screens.push({ step: "s2_owner_links", persona: "owner_token", path: `/my-job/${ctx.token}`, mustSee: ["Your progress"], mustNotSee: ["version —"] });
};


/** Owner signs every outstanding item for the given gates via the real secure-link path: code request → 6-digit
 *  code → signing session → signGateDoc. On this TEST job only, the code's stored hash is set to a known code
 *  (we can't read a real one, and nothing is delivered to the TEST address). */
/** The owner's verified signing session on the secure link: code request → 6-digit code → session. On this TEST job only,
 *  the code's stored hash is set to a known code (we can't read a real one, and nothing is delivered to the TEST address). */
async function ownerLinkSession(ctx: JourneyCtx, r: StepResult) {
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
  return ov.ownerSession(ctx.token, session);
}

async function ownerSignGates(ctx: JourneyCtx, r: StepResult, gates: ("A" | "B" | "C" | "D")[], answers: Record<string, string> = {}) {
  const s = await ownerLinkSession(ctx, r);
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
  // Decision 389: the office releases the spot first (the same booking mark the Release button sets), then offers it.
  const { openOwnerReadyCheckBooking } = await import("./ready-check-booking-access.server");
  await openOwnerReadyCheckBooking(ctx.jobId!, ctx.actorId);
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
  // Each time 24h+ ahead (installerTimesBlockers): 10:00 where still allowed, else that day's first allowed time.
  const days = rct.allowedReadyCheckDays().slice(0, 3);
  await tv.tradeOfferReadyCheckTimes(offerId, ctx.installer.id, days.map((day) => { const ok = rct.allowedReadyCheckTimes(day); return { day, time: ok.includes("10:00") ? "10:00" : ok[0]! }; }));
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
    completed_by: ctx.installer.id, completed_at: new Date().toISOString(), measured_on: melbourneDate(0), external_source: "journey_sim", external_id: `sim-${ctx.runId}`, raw_snapshot: { downlight_count: 6, downlight_type: "LED sealed" },
    // Jo 30 Oct 2026: one ceiling area as the Mitti sync stores it (m², before video; product is per job, not per area).
    zones: [{ key: "mitti-1", label: "Main ceiling", name: "Main ceiling", areaM2: 120, existing: "none", present: false, beforeVideo: true, product: null, scope: null, sources: {} }] } as never);
  check(r, "Ready Check recorded", !me, me?.message);
  // The insulation product answer on the form, recorded the way the Mitti sync records it (declared, not verified).
  await (await import("./insulation-product.server")).mittiProductForJob(ctx.jobId!, ctx.installer.id, [{ label: "What insulation product will you be using on this job?", value: "Bradford Gold R5" }], `sim-${ctx.runId}`);
  for (const c of ["measurement", "before_ceiling_space", "access_manhole", "existing_insulation_r_value", "identity_front_of_property"]) await uploadEvidence(ctx, c, ctx.installer.id);
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

/** Pay one owner payment step in full (decisions 139/302/367) as a TEST payment in the Xero Demo Company: the amount is what
 *  the job's own payment plan says is still owing on that step. TEST jobs only (recordDemoTestPayment refuses others).
 *  Paid on that step's own invoice (batch 3b, Jo 29 Oct 2026). */
async function payStep(ctx: JourneyCtx, r: StepResult, step: "safety_check" | "fixes" | "install_deposit" | "balance", label: string) {
  await assertOwnTestJob(ctx);
  const { jobPaymentView } = await import("./payments.server");
  const v = await jobPaymentView(ctx.jobId!);
  check(r, `${label}: the owner's payment plan is ready`, !!v);
  const owing = v!.steps.find((s) => s.key === step)?.outstandingCents ?? 0;
  if (owing <= 0) { check(r, `${label} (nothing owing)`, true); return; }
  const x = await import("./xero.server");
  const { payStepInvoiceId } = await import("./journey.core");
  const invoiceId = payStepInvoiceId(v!, step);
  await act(r, label, () => x.recordDemoTestPayment(invoiceId, owing / 100, ctx.actorId));
  const after = (await jobPaymentView(ctx.jobId!))!.steps.find((s) => s.key === step);
  check(r, `${step.replace(/_/g, " ")} step paid`, after?.state === "paid", after?.state);
}

/** The office's product label review on the install day form (piisa-products.core): the installed product as declared on the
 *  Ready Check form, the measured area. Through the office review path (evidence-review.server). */
async function reviewProductEvidence(ctx: JourneyCtx) {
  await assertOwnTestJob(ctx);
  const { data: req } = await admin.from("evidence_requirements").select("id").eq("job_id", ctx.jobId!).eq("category", "product_evidence" as never).order("sort").limit(1).maybeSingle();
  if (!req) throw new Error("No product label evidence was read from the install day form.");
  const { productBrandModel } = await import("./insulation-product.core");
  const bm = productBrandModel({ option: "Bradford Gold R5" });
  return (await import("./evidence-review.server")).reviewEvidence(ctx.actorId, { requirementId: req.id, status: "verified", actualProducts: [{ brand: bm.brand, model: `${bm.model} R5.0`, rValue: 5 }], installedAreaM2: 120 });
}

/** One TEST PIESA copy the TEST sender held (TEST address, not on the allowlist), recorded through the sender's own
 *  delivery recorder as a simulated email. This run's own TEST job and TEST-domain recipients only. */
async function recordTestPiesaCopy(ctx: JourneyCtx, to: "owner" | "installer", recordDelivery: typeof import("./piesa-delivery.server").recordDelivery) {
  await assertOwnTestJob(ctx);
  const { currentCopy } = await import("./official-forms.server");
  const pe = await currentCopy(ctx.jobId!, "piesa");
  const { data: prec } = await admin.from("piesa_records").select("id").eq("job_id", ctx.jobId!).eq("is_current", true).single();
  const email = to === "installer"
    ? (await admin.from("profiles").select("email").eq("id", ctx.installer.id).single()).data?.email ?? null
    : ((await admin.from("jobs").select("owners(email)").eq("id", ctx.jobId!).single()).data?.owners as { email: string | null } | null)?.email ?? null;
  if (!pe.copy || !prec || !email?.endsWith(TEST_DOMAIN)) throw new Error("SAFETY STOP: no signed PIESA copy, or the recipient is not a TEST address.");
  await recordDelivery({ jobId: ctx.jobId!, recipient: to, piesaRecordId: prec.id, signedCopyId: pe.copy.id, recipientUserId: to === "installer" ? ctx.installer.id : null, to: email, detail: "TEST journey: simulated email — TEST addresses are not on the send allowlist" });
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
  // Ready Check quotes wait on Quotes to check; the office presses Send (installer quote approval retired, Jo 24 Oct 2026).
  if (q0?.status === "draft") { const { sendOfficeReviewedQuote } = await import("./office-quote-review.server"); await act(r, "office checks the quote and presses Send", () => sendOfficeReviewedQuote(ctx.jobId!, ctx.quoteId!, ctx.actorId)); }
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
  const { data: iv } = await admin.from("invoices").select("id, xero_invoice_id").eq("job_id", ctx.jobId!).eq("kind", "installation").order("created_at", { ascending: false }).limit(1).maybeSingle();
  check(r, "invoice row exists", !!iv, JSON.stringify(inv ?? null).slice(0, 80));
  if (!iv!.xero_invoice_id) await act(r, "invoice pushed to the Xero Demo Company", () => x.pushInvoiceToXero(iv!.id, ctx.actorId) as Promise<unknown>);
  { const { data: linked } = await admin.from("invoices").select("xero_invoice_id, last_sync_error").eq("id", iv!.id).single();
    if (!linked?.xero_invoice_id) throw new Error(`Invoice not in the Xero Demo Company: ${linked?.last_sync_error ?? "unknown reason"}`); }
  // Decision 302: the upfront safety check is the quote's PIESA line (read from the payment plan, never a fixed $349).
  await payStep(ctx, r, "safety_check", "Pre Insulation Electrical Safety Assessment (PIESA) payment recorded (TEST payment, Demo Company)");
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
  const { allowedPiesaTimeDays, allowedPiesaTimes } = await import("./piesa-times.core");
  const tdays = allowedPiesaTimeDays().slice(1, 4);
  // Arm the same simulator guard as the branches BEFORE booking can automatically create A3.
  const now = new Date().toISOString();
  const sim = await import("./journey-sim.core");
  const { data: ws } = await admin.from("workflow_settings").select("mitti_piesa_template_id").eq("id", 1).maybeSingle();
  const { data: el } = await admin.from("profiles").select("email, full_name").eq("id", ctx.electrician.id).single();
  if (!el?.email || !ws?.mitti_piesa_template_id) throw new StepFail("TEST PIESA simulator requires template and electrician email");
  const tpl = ws.mitti_piesa_template_id.trim();
  const pass = sim.simulatedA3PassAnswers({ seed: `${ctx.runId}-a3`, inspectionDate: melbourneDate(0), capturedAt: now, electrician: el.full_name ?? "TEST Delta Electrician", jobNumber: ctx.jobNumber });
  const office = ["Portal Job Number", "Property Address", "Owner name"].map((label, i) => ({ item_id: `sim_a3_office_${i}`, label, type: "textsingle" }));
  const mitti = sim.simulatedMitti({ templates: { [tpl]: sim.templateOfItems([...office, ...pass.items]) }, users: [{ id: "sim-mitti-electrician", email: el.email }] });
  const ms = await import("./mitti.server");
  const guard = ms.armJourneyMittiGuard(mitti.call);
  (ctx.notes["mitti_guard_routes"] as string[][]).push(guard.routed);
  await act(r, "electrician accepts and offers the owner 3 safety check times", () => pt.acceptPiesaOfferWithTimes(mine!.id, ctx.electrician.id, tdays.map((day) => { const ok = allowedPiesaTimes(day); return { day, time: ok.includes("10:00" as never) ? "10:00" : ok[0]! }; })));
  const ost = await pt.ownerPiesaTimesState(ctx.jobId!);
  check(r, "owner sees the electrician's 3 times", ost.turn === "owner_to_answer" && ost.open.length === 3, ost.turn);
  await act(r, "owner ticks the 30-day box and takes the first time", () => pt.ownerTakePiesaTime(ctx.jobId!, ost.open[0]!.id, ctx.actorId, { understandsThirtyDays: true, ip: null, userAgent: null }));
  ctx.notes["piesa_offer_id"] = mine!.id;
  // Mitti A3 PIESA form: SIMULATED (no phone fills it in for a TEST job). Booking the PIESA made the A3 form (decision 398);
  // when that form could not be made (the TEST electrician has no Mitti account) the office backup "Create Mitti form" path
  // makes it here. Either way the electrician's answers are filled in an in-memory Mitti and read by the REAL Mitti sync
  // (evidence rule, decision 178); the real Mitti is never read or written.
  r.simulated = ["Mitti A3 PIESA form (a completed pass, filled in a simulated Mitti and read by the real Mitti sync)"];
  const { data: a0 } = await admin.from("assessments").select("id, external_mitti_id, mitti_template_id").eq("job_id", ctx.jobId!).maybeSingle();
  let auditId = a0?.external_mitti_id ?? null;
  if (auditId) mitti.seed(auditId, tpl);
  else auditId = (await act(r, "office backup: the A3 form is made for the electrician", () => import("./mitti.server").then((m) => m.createAssignMittiAudit(ctx.jobId!, ctx.actorId, mitti.call, { officeOverride: true })))).auditId;
  // The real portal prefills Portal Job Number; a blank one fails closed under the identity rule, so fill it as the prefill would.
  mitti.fill(auditId, [{ item_id: "sim_a3_office_0", label: "Portal Job Number", type: "textsingle", responses: { text: ctx.jobNumber ?? "" } }, ...pass.items] as never);
  const synced = await act(r, "electrician completes the A3 → read by the Mitti sync", async () => { await assertOwnTestJob(ctx); return (await import("./mitti.server")).syncMittiAssessment(ctx.jobId!, ctx.actorId, mitti.call, async () => ({ bytes: TINY_JPEG, contentType: "image/jpeg" })); });
  check(r, "A3 synced as complete with its geotagged evidence", synced.completed, synced.issues.join("; "));
  // The electrician's own "No electrical fixes required" tick on the job page (the same assessment field saveAssessment writes).
  const tick = await admin.from("assessments").update({ no_rectification_confirmed: true }).eq("job_id", ctx.jobId!).neq("status", "complete");
  check(r, "electrician ticks No electrical fixes required", !tick.error, tick.error?.message);
  for (const c of ["switchboard_cables", "piesa_signoff"]) await uploadEvidence(ctx, c, ctx.electrician.id, "electrical");
  // Complete PIESA (the electrician's button): PIESA record, the official PIESA signed copy (decision 350), PIESA complete.
  await act(r, "electrician presses Complete PIESA", async () => { await assertOwnTestJob(ctx); return (await import("./piesa-complete.server")).completePiesaAssessment({ jobId: ctx.jobId! }, ctx.electrician.id); });
  await admin.from("bookings").update({ status: "completed" }).eq("job_id", ctx.jobId!).eq("kind", "assessment").eq("status", "confirmed");
  const { count: issued } = await admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", ctx.jobId!).eq("event_type", "official_piesa_issued");
  check(r, "official PIESA signed copy filed", (issued ?? 0) > 0, `${issued ?? 0} issued`);
  check(r, "PIESA complete (install scheduling opens after a pass)", ["piesa_complete", "installation_scheduling"].includes(await stageOf(ctx) ?? ""), await stageOf(ctx) ?? "");
  ctx.screens.push({ step: "s6_electrician", persona: "electrician", path: `/field/day/${ctx.jobId}` });
};

// ---------- Step 7: install booking, install day and evidence ----------
const s7: StepFn = async (ctx, r) => {
  await assertOwnTestJob(ctx);
  const { transition } = await import("./workflow.server");
  if ((await stageOf(ctx)) !== "installation_scheduling") await act(r, "install scheduling opens after the PIESA pass", () => transition(ctx.jobId!, "installation_scheduling", ctx.actorId, "TEST journey: install scheduling"));
  // Decision 296: the owner confirms the safety check on their secure link before an install day can be booked.
  await act(r, "owner confirms the safety check (PIESA) on the secure link", () => import("./piesa-owner-confirm.server").then((m) => m.signOwnerPiesaConfirmation({ jobId: ctx.jobId!, userId: null, codeId: null, fullName: "Test Journey", signatureName: "Test Journey", authority: "owner", confirmed: true, ip: "127.0.0.1", userAgent: "journey-test" })));
  // Locked rule: Demo TEST payment first, then install-day offers and booking.
  await payStep(ctx, r, "install_deposit", "10% install deposit paid (TEST payment, Demo Company)");
  // The installer's own allowed days (business days, 24h+ ahead, inside the PIESA window); the earliest three, so the booked
  // day sits inside the ESC notice window (24 hours to 5 days before the start) whatever weekday the run starts on.
  const idays = await import("./install-days.server");
  const { installStartAt } = await import("./install-days.core");
  const days = (await idays.installerInstallDayState(ctx.jobId!, ctx.installer.id)).days.filter((d) => installStartAt(d, "08:00").getTime() > Date.now() + 25 * 3_600_000).slice(0, 3);
  check(r, "installer has 3 install days to offer", days.length === 3, days.join(", "));
  await act(r, "installer offers 3 install days (within 30 days of the PIESA)", () => idays.installerOfferDays(ctx.jobId!, ctx.installer.id, days.map((day) => ({ day, time: "08:00" }))));
  const st = await idays.ownerInstallDayState(ctx.jobId!);
  check(r, "owner sees the installer's 3 days", st.turn === "owner_to_answer" && st.open.length === 3, st.turn);
  await act(r, "owner takes one of the installer's days", () => idays.ownerTakeDay(ctx.jobId!, st.open[0]!.id, ctx.actorId));
  check(r, "job is installation booked", (await stageOf(ctx)) === "installation_booked", await stageOf(ctx) ?? "");
  for (const c of ["installation_progress", "completed_installation", "post_install_video", "final_zone_plan"]) await uploadEvidence(ctx, c, ctx.installer.id, "installation");
  // Before the install day, the same real paths the office, electrician and owner use (no check bypassed):
  {
    const cs = await import("./consent.server");
    const rec = await import("./job-records.server");
    await act(r, "owner signs the ESC information-sharing consent for the booked day", () => cs.signOwnerConsent({ jobId: ctx.jobId ?? "", actorId: ctx.actorId, input: JOURNEY_INSTALL_CONSENT, ip: "127.0.0.1", userAgent: "journey-test" }));
    // Decision 370: the AP part normally signs itself right after the owner; the office path runs only if it was held.
    if ((await cs.currentConsent(ctx.jobId!))?.status === "awaiting_ap") await act(r, "AP representative confirms the ESC consent", () => cs.confirmApConsent({ jobId: ctx.jobId!, actorId: ctx.actorId, apRepName: "TEST AP representative", purposeExplained: true, ip: "127.0.0.1", userAgent: "journey-test" }));
    const esc = await import("./esc.server");
    await act(r, "ESC pre-install notice prepared for the booked day", async () => { await esc.regenerateEscNotification(ctx.jobId!, ctx.actorId); });
    // The office submits the notice in the VEU Registry and records the reference (SIMULATED for a TEST job: no Registry).
    (r.simulated ??= []).push("ESC Registry submission (the office records a TEST reference; nothing goes to the Registry)");
    const { data: n } = await admin.from("esc_notifications").select("id").eq("job_id", ctx.jobId!).not("status", "in", "(stale,cancelled)").order("created_at", { ascending: false }).limit(1).maybeSingle();
    check(r, "ESC notification prepared", !!n);
    await act(r, "office records the ESC notification as submitted", () => esc.recordEscSubmission({ notificationId: n!.id, reference: `TEST-ESC-${ctx.runId}`, sentAt: new Date().toISOString(), method: "manual_portal", confirmed: true, actorId: ctx.actorId }));
    // Decision 111: the signed PIESA copy is emailed to the owner and the installer (the 15-minute tick's own sender). TEST
    // addresses are never on the send allowlist, so the TEST sender holds those emails; each held copy is then recorded the
    // way an accepted email is (SIMULATED for this TEST job) so PIISA Part 8(a) and the pre-start check read a real record.
    const pd = await import("./piesa-delivery.server");
    const sent = await act(r, "signed PIESA copies emailed to the owner and the installer (the tick's sender)", () => pd.deliverPiesaCopies(ctx.jobId!));
    check(r, "PIESA copies not held for another reason", !sent.hold, sent.hold ?? "");
    for (const to of ["owner", "installer"] as const) {
      if (sent.sent.includes(to)) continue;
      check(r, `PIESA copy to the ${to} held only by a TEST hold (allowlist or this run's no-delivery marker)`, /not on the test allowlist|TEST browser run: no delivery/.test(sent.held[to] ?? ""), sent.held[to] ?? "not attempted");
      (r.simulated ??= []).push(`Signed PIESA copy email to the TEST ${to} (held by the TEST sender; recorded as delivered for this TEST job)`);
      await act(r, `signed PIESA copy recorded as delivered to the ${to} (simulated email)`, () => recordTestPiesaCopy(ctx, to, pd.recordDelivery));
    }
    await act(r, "office records pre-install consumer documents given", () => rec.recordComplianceRecord({ jobId: ctx.jobId!, key: "pre_install_consumer_docs", occurredAt: melbourneDate(0), reference: "TEST journey", notes: null, actorId: ctx.actorId }));
  }
  await ownerSignGates(ctx, r, ["C"]); // owner confirms receipt of the safety check copy (real secure-link path)
  // The installer picks the install crew (the TEST business owner as lead), then signs the safety plan (decision 261).
  const lead = ctx.notes["lead_installer"] as { workerId: string; name: string } | undefined;
  check(r, "TEST lead installer is listed and cleared", !!lead, "no cleared TEST lead installer");
  await act(r, "installer chooses the install crew (lead installer)", () => import("./piisa-a3.server").then((m) => m.saveCrewSelection(ctx.jobId!, ctx.installer.id, { lead: lead!.workerId, additional: [] })));
  {
    const tv = await import("./trade-view.server");
    const sw = await tv.tradeSwms(ctx.jobId!, ctx.installer.id) as { myKeys?: string[] };
    check(r, "safety plan lists the lead installer's line", (sw.myKeys ?? []).length > 0);
    for (const key of sw.myKeys ?? []) await act(r, "lead installer signs the safety plan (SWMS)", () => tv.tradeSwmsSign(ctx.jobId!, ctx.installer.id, key, lead!.name));
  }
  // Noon the day before: the pre-start check (deposit, ESC notice, PIESA copies 24h ahead + Gate C receipt, the lead
  // installer's CII / White Card / ESC notice, safety plan — decisions 153/319/367/395) runs as the 15-minute tick would then.
  const { data: bk } = await admin.from("bookings").select("scheduled_start").eq("job_id", ctx.jobId!).eq("kind", "installation").eq("status", "confirmed").maybeSingle();
  const startMs = Date.parse(bk!.scheduled_start);
  const ps = await import("./prestart.server");
  const pre = await act(r, "pre-start check at noon the day before", () => ps.runPrestart(ctx.jobId!, "journey", new Date(startMs - 20 * 3_600_000 + 30 * 60_000)));
  check(r, "pre-start check passed", pre?.passed === true, (pre?.failures ?? ["did not run"]).join(" "));
  // The install day form (A5, decision 262) is created by the real path; Mitti itself is SIMULATED (in-memory, never contacted).
  (r.simulated ??= []).push("Mitti A5 install day form (created by the real path in a simulated Mitti; the lead installer's answers filled in there)");
  const sim = await import("./journey-sim.core");
  const idc = await import("./install-day.core");
  const { data: ws } = await admin.from("workflow_settings").select("mitti_piisa_template_id").eq("id", 1).maybeSingle();
  const tplId = ws?.mitti_piisa_template_id?.trim() ?? "";
  const { data: boss } = await admin.from("profiles").select("email").eq("id", ctx.installer.id).single();
  const mitti = sim.simulatedMitti({ templates: { [tplId]: sim.simulatedInstallDayTemplate(idc.INSTALL_DAY_QUESTIONS) }, users: [{ id: "sim-mitti-user", email: boss!.email! }] });
  const guard = (await import("./mitti.server")).armJourneyMittiGuard(mitti.call);
  (ctx.notes["mitti_guard_routes"] as string[][]).push(guard.routed);
  const created = await act(r, "install day form (A5) created for the lead installer", () => import("./mitti.server").then((m) => m.createPiisaMittiAudit(ctx.jobId!, ctx.actorId, mitti.call)));
  const zones = await (await import("./install-evidence.server")).jobUpgradeZones(ctx.jobId!);
  const a5 = sim.simulatedCompletedA5({ q: idc.INSTALL_DAY_Q as unknown as Record<string, string>, ruler: idc.INSTALL_DAY_RULER_Q, capturedAt: new Date(startMs + 2 * 3_600_000).toISOString(), seed: `${ctx.runId}-a5`, lead: lead!.name, areas: zones.length });
  const syncA5 = async () => { await assertOwnTestJob(ctx); return (await import("./piisa-declaration.server")).syncPiisaDeclaration(ctx.jobId!, ctx.installer.id, mitti.call, { fetchMedia: async (_audit, mediaId) => ({ bytes: TINY_JPEG, contentType: a5.videoIds.has(mediaId) ? "video/mp4" : "image/jpeg" }) }); };
  const early = await syncA5();
  check(r, "nothing is recorded before the install day form is complete", early.status !== "saved" && (await stageOf(ctx)) === "installation_booked", `${early.status}: ${early.message}`);
  mitti.fill(created.auditId, a5.startItems, { complete: false });
  const started = await act(r, "lead installer signs the start-of-work part of the install day form (read before work starts)", () => syncA5());
  check(r, "start-of-work check captured before the form is complete", started.status === "pending", `${started.status}: ${started.message}`);
  mitti.fill(created.auditId, a5.finishItems);
  await act(r, "lead installer completes the install day form (every answer, photo, video and ruler photo)", () => syncA5());
  // Product labels are a human office review (piisa-products.core): the office confirms the installed product.
  await act(r, "office reviews the product label evidence", () => reviewProductEvidence(ctx));
  const done = await act(r, "install day form read again → installation recorded", () => syncA5());
  check(r, "installation recorded from the install day form", (await stageOf(ctx)) === "evidence_outstanding", `${done.status}: ${done.message} (stage ${await stageOf(ctx)})`);
  // The office checks the installer's signed declaration (saved from the install day form) against the evidence checklist.
  await act(r, "office verifies the signed installer declaration on the checklist", async () => {
    await assertOwnTestJob(ctx);
    const { count: signed } = await admin.from("installer_declarations").select("id", { count: "exact", head: true }).eq("job_id", ctx.jobId!).eq("status", "signed");
    if (!signed) throw new Error("No signed installer declaration on this job.");
    const { data: req } = await admin.from("evidence_requirements").select("id, status").eq("job_id", ctx.jobId!).eq("category", "installer_declaration" as never).eq("required", true).maybeSingle();
    if (req && !["uploaded", "verified"].includes(req.status)) await (await import("./evidence-review.server")).reviewEvidence(ctx.actorId, { requirementId: req.id, status: "verified", notes: "Declaration signed by the lead installer in the install day form (TEST journey)" });
  });
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
  // Decision 139: the balance is paid on the install day (bank transfer) — a TEST payment in the Xero Demo Company.
  await payStep(ctx, r, "balance", "balance paid in full (TEST payment, Demo Company)");
  // Decision 276 (G1): the completion pack (O47) is the one sender that gives the owner the product warranty copy. The TEST
  // owner's address is not on the send allowlist, so the TEST sender holds it; the copy is then recorded through the pack's
  // own recorder as a simulated send for this TEST job.
  {
    const cp = await import("./completion-pack.server");
    const pack = await act(r, "completion pack emailed to the owner (the tick's sender)", () => cp.sendCompletionPack(ctx.jobId!, ctx.actorId));
    const { count: provided } = await admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", ctx.jobId!).eq("event_type", "warranty_copy_provided");
    if (!provided) {
      // Held by a TEST safeguard (the allowlist, or the per-job TEST "no delivery" marker): count as delivered for this TEST job.
      check(r, "completion pack held only by a TEST safeguard (allowlist or TEST no-delivery marker)", pack.outcome === "not_sent" && (/allowlist/.test(pack.detail) || /TEST browser run: no delivery/.test(pack.detail)), `${pack.outcome}: ${pack.detail}`);
      (r.simulated ??= []).push("Completion pack email to the TEST owner (held by the TEST sender; the warranty copy recorded as given for this TEST job)");
      await act(r, "product warranty copy recorded as given to the owner (simulated email)", async () => {
        await assertOwnTestJob(ctx);
        const pw = await import("./product-warranty.server");
        const decision = await pw.warrantyDecisionFor(ctx.jobId!);
        const copies = await pw.prepareWarrantyCopies(ctx.jobId!, ctx.actorId, decision);
        const ok = await cp.recordWarrantyCopyProvided(ctx.jobId!, ctx.actorId, { via: "completion_pack", result: "sent", decision, attached: copies.attached, missing: copies.missing });
        if (!ok) throw new Error(`warranty copy not recorded (products ${decision.products.join(", ") || "none"}; missing ${copies.missing.map((m) => m.product).join(", ") || "none"})`);
      });
    }
  }
  // The VEEC assignment form (decisions 119/120/271): lead installer (Part B) → AP (Part A, automatic) → owner (Section 4).
  const asg = await import("./assignment.server");
  const lead = ctx.notes["lead_installer"] as { name: string } | undefined;
  // The office prepares Section 2 from the job facts (Compliance › VEEC assignment), supplying the one field the reviewed
  // product labels don't carry: the ESC product type of the batts installed (48A).
  await act(r, "office prepares the VEEC assignment form (Section 2 from the job facts)", async () => {
    const { PRODUCT_TYPES } = await import("./veec-assignment-form.core");
    return asg.prepareFinalAssignment(ctx.jobId!, ctx.actorId, { area_1_product_type: PRODUCT_TYPES[0] });
  });
  await act(r, "lead installer signs the VEEC assignment form (Part B)", () => asg.signFinalAssignment({ jobId: ctx.jobId!, actorId: ctx.installer.id, party: "installer", signatureName: lead?.name ?? "TEST Lead Installer", ip: "127.0.0.1", userAgent: "journey-test" }));
  const ap = await act(r, "AP declaration (Part A) signs itself once every prerequisite is recorded", () => import("./veec-ap-auto.server").then((m) => m.tryAutoApSignature(ctx.jobId!)));
  const cur = await asg.currentAssignment(ctx.jobId!);
  check(r, "AP part signed", !!cur?.ap_signed_at, JSON.stringify(ap).slice(0, 300));
  const s = await ownerLinkSession(ctx, r);
  await act(r, "owner signs the VEEC assignment form on the secure link (Section 4 Part B)", () => asg.signFinalAssignment({ jobId: ctx.jobId!, actorId: s.userId, party: "consumer", signatureName: "Test Journey", signatoryName: "Test Journey", authorityType: "owner", over18: true, confirmsSection2: true, ip: "127.0.0.1", userAgent: "journey-test" }));
  await ownerSignGates(ctx, r, ["D"]);
  // Activity 48: the signed copy goes to the owner (O62). TEST owner → held by the TEST sender; the office records the copy as
  // given (the owner also has it on My job).
  {
    const sentCopy = await act(r, "signed VEEC assignment copy emailed to the owner (the tick's sender)", () => import("./veec-copy-email.server").then((m) => m.sendVeecCopyEmail(ctx.jobId!)));
    (r.simulated ??= []).push(`VEEC assignment copy email to the TEST owner (${String(sentCopy).slice(0, 80)}); the office records the copy as given`);
    const rec = await import("./job-records.server");
    await act(r, "office records the signed VEEC assignment copy given to the owner", () => rec.recordComplianceRecord({ jobId: ctx.jobId!, key: "assignment_copy_to_consumer", occurredAt: melbourneDate(0), reference: "TEST journey: copy on the owner's My job page", notes: null, actorId: ctx.actorId }));
  }
  // The office's Final check: every uploaded evidence item reviewed, the automated compliance review, the office's own
  // checks recorded, then AP approval (decision 372) — the one path to Ready for VEEC.
  {
    const er = await import("./evidence-review.server");
    const { data: up } = await admin.from("evidence_requirements").select("id").eq("job_id", ctx.jobId!).eq("status", "uploaded");
    for (const e of up ?? []) await act(r, "office verifies an uploaded evidence item", () => er.reviewEvidence(ctx.actorId, { requirementId: e.id, status: "verified" }));
    const cr = await import("./compliance-review.server");
    await act(r, "office runs the automated compliance review", () => cr.runAutomatedComplianceReview(ctx.jobId!, ctx.actorId));
    const { data: checks } = await admin.from("compliance_checks").select("id, check_key, label, status").eq("job_id", ctx.jobId!).eq("blocking", true);
    const automated = new Set(["eligibility", "owner_consent", "owner_authority", "electrical_assessment", "rectification", "installation_evidence", "declarations"]);
    for (const c of (checks ?? []).filter((x) => !automated.has(x.check_key) && x.status !== "pass")) await act(r, `office passes ${c.label}`, () => cr.setComplianceCheckStatus(ctx.actorId, { checkId: c.id, status: "pass", notes: "TEST journey: office Final check" }));
    const failed = (await admin.from("compliance_checks").select("label, status").eq("job_id", ctx.jobId!).eq("blocking", true)).data?.filter((c) => c.status !== "pass") ?? [];
    check(r, "every compliance check passed", failed.length === 0, failed.map((c) => c.label).join(", "));
  }
  await act(r, "AP approves on the Final check → ready for VEEC", () => import("./ap-approve.server").then((m) => m.approveApJobAs(ctx.jobId!, ctx.actorId, "TEST journey")));
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
  // The TEST sender stamps sent_at on every attempt it records, including the ones it held (blocked_prelaunch / failed):
  // only messages a provider actually accepted count as delivered.
  const delivered = (comms ?? []).filter((c) => (c.sent_at || c.delivery_status === "sent" || c.delivery_status === "delivered") && !/^(blocked|failed|held)/.test(String(c.delivery_status ?? ""))).flatMap((c) => addr(c.recipients));
  const outside = recipientsOutsideAllowlist(delivered);
  check(r, "every delivered message went to the allowlist", outside.length === 0, outside.length ? `${outside.length} outside` : `${delivered.length} delivered, all allowlisted`);
}

/** Archive this run's TEST data the Test Centre way. Never touches anything else. */
export async function cleanupJourney(ctx: JourneyCtx) {
  const now = new Date().toISOString();
  if (ctx.jobId) {
    const { data: j } = await admin.from("jobs").select("source, created_at").eq("id", ctx.jobId).maybeSingle();
    // Only archive a TEST job this run created: an older kept TEST job linked by address is left alone.
    if (j?.source === "qa_test" && j.created_at >= ctx.startedAt) {
      const { error: offerError } = await admin.from("partner_offers").update({ status: "withdrawn" } as never).eq("job_id", ctx.jobId).eq("status", "pending");
      if (offerError) throw new Error(`TEST offer cleanup failed: ${offerError.message}`);
      const { count: remaining, error: remainingError } = await admin.from("partner_offers").select("id", { count: "exact", head: true }).eq("job_id", ctx.jobId).eq("status", "pending");
      if (remainingError || remaining !== 0) throw new Error("TEST cleanup refused: a pending offer remains.");
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

export async function newJourneyCtx(options: { installerEmail?: string; preparePeople?: boolean } = {}): Promise<JourneyCtx> {
  const runId = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const { data: actor } = await admin.from("profiles").select("id").eq("email", JOURNEY_ACTOR_EMAIL).single();
  if (!actor) throw new Error("TEST journey office actor is missing.");
  const installerEmail = options.installerEmail ?? TEST_INSTALLER_EMAIL;
  if (!installerEmail.endsWith(TEST_DOMAIN)) throw new Error("SAFETY STOP: installer must be a TEST-domain persona.");
  const [installer, electrician] = await Promise.all([profileByEmail(installerEmail), profileByEmail(TEST_ELECTRICIAN_EMAIL)]);
  const worker = installerEmail === TEST_INSTALLER_EMAIL ? await profileByEmail(TEST_WORKER_EMAIL).catch(() => null) : null;
  // Bring the TEST trades up to every current gate (TEST identities only, idempotent): journey-setup.server.ts.
  const { ensureJourneyTestTrades, ensureTestBusinessReady } = await import("./journey-setup.server");
  const setup = options.preparePeople === false
    ? { before: [await ensureTestBusinessReady(actor.id, installer.business_id, "installer", []), await ensureTestBusinessReady(actor.id, electrician.business_id, "electrician", [])], log: ["TEST business preferences prepared only; people approvals unchanged"], lead: null }
    : await ensureJourneyTestTrades(actor.id, { ...installer, email: installerEmail }, { ...electrician, email: TEST_ELECTRICIAN_EMAIL });
  return { runId, startedAt: new Date().toISOString(), actorId: actor.id, jobId: null, jobNumber: null, token: null, ownerEmail: `qa.journey.${runId}${TEST_DOMAIN}`, installer, electrician, worker, calculatorInterestId: null, quoteId: null, notes: { biz_before: setup.before, setup: setup.log, lead_installer: setup.lead }, screens: [] };
}

/** Run every step in order; a failed step stops later dependent steps but 9 and 10 always run. */
async function runServerJourneyInner(opts: { cleanup?: boolean; afterStep?: (ctx: JourneyCtx, r: StepResult) => Promise<void> }, refused: string[]): Promise<{ ctx: JourneyCtx; result: JourneyResult }> {
  const ctx = await newJourneyCtx();
  ctx.notes["address_line"] = `${Date.now()} Journey Test Street`;
  ctx.notes["mitti_guard_routes"] = [] as string[][];
  const steps: StepResult[] = [];
  let broken = false;
  for (const s of JOURNEY_STEPS) {
    const r: StepResult = { key: s.key, label: s.label, passed: false, checks: [] };
    const always = s.key === "s9_visibility" || s.key === "s10_allowlist";
    if (broken && !always) { r.error = "skipped — an earlier step failed"; steps.push(r); continue; }
    try {
      if (s.key === "s10_allowlist") check(r, "M: no real Mitti call", refused.length === 0, refused.length ? `REAL MITTI CALLS REFUSED: ${refused.join("; ")}` : `0 real Mitti calls; simulated routes: ${(ctx.notes["mitti_guard_routes"] as string[][]).flat().join("; ") || "none"}`);
      await STEP_FNS[s.key](ctx, r);
      r.passed = true;
    }
    catch (e) { r.error = e instanceof Error ? e.message : String(e); if (!always) broken = true; }
    if (opts.afterStep) await opts.afterStep(ctx, r).catch((e) => { r.passed = false; r.error = `browser check: ${e instanceof Error ? e.message : e}`; });
    steps.push(r);
  }
  if (opts.cleanup !== false) await cleanupJourney(ctx).catch((e) => console.error("journey cleanup", e));
  return { ctx, result: summarise(steps) };
}

/** Same hard network refusal as the branches, armed before any main-journey setup. */
export async function runServerJourney(opts: { cleanup?: boolean; afterStep?: (ctx: JourneyCtx, r: StepResult) => Promise<void> } = {}): Promise<{ ctx: JourneyCtx; result: JourneyResult }> {
  const ms = await import("./mitti.server");
  ms.armJourneyMittiGuard(null);
  const refused: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (/mitti\.com/i.test(url)) { refused.push(`${init?.method ?? "GET"} ${new URL(url).pathname}`); throw new Error("SAFETY STOP: real Mitti call refused for a qa_test journey"); }
    return realFetch(input, init);
  }) as typeof fetch;
  try { return await runServerJourneyInner(opts, refused); }
  finally { globalThis.fetch = realFetch; ms.disarmJourneyMittiGuard(); }
}

export async function storeJourneyRun(mode: "browser" | "server", ctx: JourneyCtx, result: JourneyResult, opts?: { path?: string; runGroup?: string; status?: "passed" | "failed" | "blocked" }) {
  const { data, error } = await admin.from("journey_runs").insert({ mode, started_at: ctx.startedAt, finished_at: new Date().toISOString(), passed: result.passed, failing_step: result.failingStep, failing_reason: result.failingReason, steps: result.steps as never, test_job_id: ctx.jobId,
    ...(opts?.path !== undefined ? { path: opts.path } : {}),
    ...(opts?.runGroup !== undefined ? { run_group: opts.runGroup } : {}),
    ...(opts?.status !== undefined ? { status: opts.status } : {}),
  }).select("id").single();
  if (error) throw new Error(error.message);
  return data.id;
}

export async function latestJourneyRun() {
  const { data } = await admin.from("journey_runs").select("id, mode, started_at, finished_at, passed, failing_step, failing_reason").order("started_at", { ascending: false }).limit(1).maybeSingle();
  return data;
}

/** Test-only access for the opt-in hard-case branches (journey-branches.server.ts). Same functions, no behaviour change. */
export const journeyInternals = { uploadEvidence, assertOwnTestJob, TEST_DOMAIN, stageOf, s1, s2, s3, s4, s5, s6, s7, s8, melbourneDate, TINY_JPEG, payStep };
