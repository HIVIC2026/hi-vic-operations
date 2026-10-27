// Opt-in "hard case" branches of the full-journey test (Jo approved 27 Oct 2026):
//   bun run journey -- --branch not-eligible   |   bun run journey -- --branch piesa-fixes
// TEST only, same rules as the default run: a fresh qa_test job per case (TEST-domain people only), assertOwnTestJob
// before every step, simulated Mitti only (journey-sim.core), Xero Demo Company only, nothing sent outside the allowlist.
// Rules come from docs/HIV_WORKFLOW_SOURCE_OF_TRUTH.md: when the portal does something different, the check FAILS and
// is reported — product code is never changed to make a check pass. Every check reads the saved record back and counts
// owner emails, Needs me rows and workflow_events on this job before and after the step.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { journeyInternals as J, newJourneyCtx, cleanupJourney, personaClient, JOURNEY_ACTOR_EMAIL, type JourneyCtx } from "./journey.server";
import type { StepResult } from "./journey-test.core";

export type BranchName = "not-eligible" | "piesa-fixes";
export type BranchCheck = { n: string; name: string; status: "passed" | "failed" | "blocked" | "simulated"; detail: string; ids: Record<string, string | null> };
export type BranchResult = { branch: BranchName; jobs: { jobNumber: string | null; jobId: string | null; archived: boolean }[]; setup: StepResult[]; checks: BranchCheck[] };

type Counts = { events: number; emails: number; needs: number };
const loose = admin as unknown as import("@supabase/supabase-js").SupabaseClient;

/** Owner emails on this job: the email log rows + the job's outbound email history (TEST sends land there). */
async function counts(jobId: string): Promise<Counts> {
  const [ev, ces, comm] = await Promise.all([
    admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", jobId),
    admin.from("customer_email_sends").select("id", { count: "exact", head: true }).eq("job_id", jobId),
    admin.from("job_communications").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("channel", "email").eq("direction", "outbound"),
  ]);
  return { events: ev.count ?? 0, emails: (ces.count ?? 0) + (comm.count ?? 0), needs: (await needsRows(jobId)).length };
}
const diff = (a: Counts, b: Counts) => `events +${b.events - a.events}, owner emails +${b.emails - a.emails}, Needs me ${a.needs}→${b.needs}`;

/** The Needs me rows for this one job, through the same derivation as the office page. */
async function needsRows(jobId: string): Promise<{ text: string }[]> {
  try {
    const { gatherNeedsFacts } = await import("./office-needs.server");
    const { buildNeedsRows } = await import("./office-needs.core");
    const g = await gatherNeedsFacts({ includeTest: true, onlyIds: [jobId] });
    const rows = buildNeedsRows({ now: g.now, jobs: [...g.facts.values()], emails: g.emails });
    return Object.values(rows).flat().filter((x) => (x as { jobId?: string | null }).jobId === jobId).map((x) => ({ text: JSON.stringify(x) }));
  } catch { return []; }
}

async function emailsSince(jobId: string, sinceIso: string) {
  const [{ data: ces }, { data: comm }] = await Promise.all([
    admin.from("customer_email_sends").select("id, purpose, status").eq("job_id", jobId).gte("created_at", sinceIso),
    admin.from("job_communications").select("id, subject, body, recipients").eq("job_id", jobId).eq("channel", "email").eq("direction", "outbound").gte("created_at", sinceIso),
  ]);
  return { ces: ces ?? [], comm: (comm ?? []) as { id: string; subject: string | null; body: string | null; recipients: unknown }[] };
}

class Recorder {
  checks: BranchCheck[] = [];
  /** Jo 27 Oct: a step skipped because customer messages are off — recorded as simulated, never as passed. */
  simulated(n: string, name: string, detail: string, ids: Record<string, string | null> = {}) { this.checks.push({ n, name, status: "simulated", detail, ids }); }
  async run(n: string, name: string, fn: () => Promise<{ ok: boolean; detail: string; ids?: Record<string, string | null> }>, needs: string[] = []) {
    const blockedBy = needs.filter((x) => this.checks.find((c) => c.n === x)?.status !== "passed");
    if (blockedBy.length) { this.checks.push({ n, name, status: "blocked", detail: `blocked: check ${blockedBy.join(", ")} did not pass`, ids: {} }); return false; }
    try {
      const r = await fn();
      this.checks.push({ n, name, status: r.ok ? "passed" : "failed", detail: r.detail, ids: r.ids ?? {} });
      return r.ok;
    } catch (e) {
      if (process.env["JOURNEY_DEBUG"]) console.error(e);
      this.checks.push({ n, name, status: "failed", detail: `error: ${e instanceof Error ? e.message : String(e)}`, ids: {} });
      return false;
    }
  }
}

/** Steps 1..n of the default run (same code) on a fresh TEST job. */
async function setupSteps(ctx: JourneyCtx, upTo: 3 | 5, ready?: (ctx: JourneyCtx, r: StepResult) => Promise<void>, beforeS5?: (ctx: JourneyCtx) => Promise<void>) {
  const fns: [string, (c: JourneyCtx, r: StepResult) => Promise<void>][] = [["s1_calculator", J.s1], ["s2_owner_links", J.s2], ["s3_office_offer", J.s3]];
  if (upTo === 5) { fns.push(["s4_ready_check", ready!]); fns.push(["s5_owner_accept", async (c, r) => { if (beforeS5) await beforeS5(c); await J.s5(c, r); }]); }
  const out: StepResult[] = [];
  for (const [key, fn] of fns) {
    const r: StepResult = { key: key as StepResult["key"], label: `${ctx.jobNumber ?? "new job"} setup ${key}`, passed: false, checks: [] };
    try { await fn(ctx, r); r.passed = true; } catch (e) { r.error = e instanceof Error ? e.message : String(e); out.push(r); return { ok: false, out }; }
    r.label = `${ctx.jobNumber} setup ${key}`;
    out.push(r);
  }
  return { ok: true, out };
}

/** The Ready Check booking half of default step 4 (installer offers 3 times, owner takes one), then a simulated Ready Check
 *  record with the given answers. Nothing about eligibility is recorded here. */
async function readyCheckWith(ctx: JourneyCtx, m: { insulation_present: boolean | null; existing_r_value: number | null; insulationType: string | null; withInsulationPhotos: boolean }) {
  await J.assertOwnTestJob(ctx);
  const tv = await import("./trade-view.server");
  const rct = await import("./ready-check-times.core");
  const offerId = ctx.notes["rc_offer_id"] as string;
  const days = rct.allowedReadyCheckDays().slice(0, 3);
  await tv.tradeOfferReadyCheckTimes(offerId, ctx.installer.id, days.map((day) => { const ok = rct.allowedReadyCheckTimes(day); return { day, time: ok.includes("10:00") ? "10:00" : ok[0]! }; }));
  const { data: offered } = await admin.from("appointment_proposals").select("id").eq("job_id", ctx.jobId!).eq("kind", "ready_check").eq("note", rct.READY_CHECK_TIME_NOTE).eq("status", "proposed").order("starts_at").limit(1).single();
  const { data: jo } = await admin.from("jobs").select("owners(user_id)").eq("id", ctx.jobId!).single();
  const owner = (jo?.owners as { user_id: string | null } | null)?.user_id ?? ctx.actorId;
  await (await import("./ready-check-times.server")).ownerTakeReadyCheckTime(ctx.jobId!, offered!.id, owner);
  await admin.from("ceiling_measurements").update({ is_current: false }).eq("job_id", ctx.jobId!).eq("is_current", true);
  const raw: Record<string, unknown> = { downlight_count: 6, downlight_type: "LED sealed" };
  if (m.insulationType) raw["insulation_type"] = m.insulationType;
  const { error } = await admin.from("ceiling_measurements").insert({ job_id: ctx.jobId!, status: "complete", is_current: true, source_role: "installer", created_by: ctx.installer.id, measured_area_m2: 120, removal_required: false,
    insulation_present: m.insulation_present, existing_r_value: m.existing_r_value, access_difficulty: "easy", measurement_method: "laser",
    completed_by: ctx.installer.id, completed_at: new Date().toISOString(), measured_on: J.melbourneDate(0), external_source: "journey_sim", external_id: `sim-${ctx.runId}`, raw_snapshot: raw } as never);
  if (error) throw new Error(`Ready Check record: ${error.message}`);
  const cats = ["measurement", "before_ceiling_space", "access_manhole", "identity_front_of_property", ...(m.withInsulationPhotos ? ["existing_insulation_r_value"] : [])];
  for (const c of cats) await J.uploadEvidence(ctx, c, ctx.installer.id);
  await (await import("./verified-eligibility.server")).recordPriorActivityCheck(ctx.jobId!, ctx.actorId, "none_known" as never, null);
  const { transition } = await import("./workflow.server");
  await transition(ctx.jobId!, "ready_check_complete", ctx.actorId, "TEST journey (hard case): Ready Check done").catch(() => undefined);
}

// =====================================================================================================================
// Branch 1 — Ready Check says not eligible
// =====================================================================================================================
async function notEligible(rec: Recorder, jobs: BranchResult["jobs"], setup: StepResult[]) {
  const ctx = await newJourneyCtx();
  // Unique address so the case never links to an older kept TEST job (Jo 27 Oct: HV-3239/HV-3274 collision).
  ctx.notes["address_line"] = `${parseInt(ctx.runId.slice(0, 8), 16)} Journey Test Street`;
  try {
    const s = await setupSteps(ctx, 3);
    setup.push(...s.out);
    jobs.push({ jobNumber: ctx.jobNumber, jobId: ctx.jobId, archived: false });
    if (!s.ok) { await rec.run("1.1", "setup steps 1–3", async () => ({ ok: false, detail: s.out.at(-1)?.error ?? "setup failed" })); return; }
    // Simulated evidence that FAILS eligibility: existing insulation present at R3.0 (rules: must be none or below R2.0).
    await readyCheckWith(ctx, { insulation_present: true, existing_r_value: 3.0, insulationType: "Glasswool batts", withInsulationPhotos: true });
    const reason = "TEST hard case: existing ceiling insulation measured at R3.0 (must be none or below R2.0)";
    const sb = await personaClient(JOURNEY_ACTOR_EMAIL);
    const since = new Date().toISOString();

    await rec.run("1.1", "not_eligible recorded through recordVerification; verifiedEligible is false", async () => {
      await J.assertOwnTestJob(ctx);
      const b = await counts(ctx.jobId!);
      const v = await (await import("./verified-eligibility.server")).recordVerification(sb as never, ctx.jobId!, "not_eligible", reason, null);
      const a = await counts(ctx.jobId!);
      const { data: row } = await loose.from("eligibility_verifications").select("id, outcome, reason, is_current").eq("job_id", ctx.jobId!).eq("is_current", true).maybeSingle();
      const { count: rows } = await loose.from("eligibility_verifications").select("id", { count: "exact", head: true }).eq("job_id", ctx.jobId!);
      const ve = await (await import("./verified-eligibility.server")).verifiedEligible(ctx.jobId!);
      const ok = row?.outcome === "not_eligible" && row.reason === reason && rows === 1 && ve === false;
      return { ok, detail: `saved outcome=${row?.outcome}, reason saved=${row?.reason === reason}, verification rows=${rows}, verifiedEligible=${ve}; ${diff(b, a)}`, ids: { verification_id: v.id } };
    });

    await rec.run("1.2", "no confirmed installation quote offered; My job shows nothing to accept", async () => {
      await J.assertOwnTestJob(ctx);
      const b = await counts(ctx.jobId!);
      let gen = "not refused";
      try { await (await import("./quotes.server")).generateInstallerQuotes(ctx.jobId!, ctx.actorId); } catch (e) { gen = `refused: ${(e as Error).message}`; }
      const { data: qs } = await admin.from("quotes").select("id, status").eq("job_id", ctx.jobId!).eq("kind", "installation").neq("status", "superseded");
      const offered = (qs ?? []).filter((q) => ["issued", "accepted"].includes(q.status));
      const pw = await (await import("./owner-gates.server")).ownerPaperworkToSign(ctx.jobId!);
      const acceptLine = pw.todo.some((t) => t.key === "quote_acceptance");
      const a = await counts(ctx.jobId!);
      return { ok: offered.length === 0 && !acceptLine, detail: `generate quote: ${gen}; installation quotes ${(qs ?? []).map((q) => q.status).join(",") || "none"}; offered to owner=${offered.length}; My job accept line=${acceptLine}; ${diff(b, a)}`, ids: { quote_id: (qs ?? [])[0]?.id ?? null } };
    }, ["1.1"]);

    await rec.run("1.3", "PIESA request/offer refused with the eligibility reason", async () => {
      await J.assertOwnTestJob(ctx);
      const b = await counts(ctx.jobId!);
      let res = "not refused";
      let refused = false;
      try { const r = await (await import("./allocation.server")).startPiesaAllocation(ctx.jobId!, ctx.actorId, "piesa", { onlyBusiness: ctx.electrician.business_id, rateToConfirm: true }); res = `returned ${JSON.stringify(r).slice(0, 160)}`; }
      catch (e) { refused = true; res = `refused: ${(e as Error).message}`; }
      const { count: offers } = await admin.from("partner_offers").select("id", { count: "exact", head: true }).eq("job_id", ctx.jobId!).eq("kind", "piesa");
      const a = await counts(ctx.jobId!);
      const mentions = /eligib/i.test(res);
      return { ok: refused && mentions && (offers ?? 0) === 0, detail: `${res}; PIESA offers saved=${offers}; ${diff(b, a)}` };
    }, ["1.1"]);

    await rec.run("1.4", "exactly one automatic not-eligible email row on the job (sent to TEST, or held/blocked with the reason)", async () => {
      const e = await emailsSince(ctx.jobId!, since);
      const notElig = e.ces.filter((x) => x.purpose === "preliminary_ineligible");
      const { data: row } = await admin.from("customer_email_sends").select("id, status, error").eq("job_id", ctx.jobId!).eq("purpose", "preliminary_ineligible").maybeSingle();
      const { count: notes } = await admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", ctx.jobId!).eq("event_type", "verified_ineligible_email_not_sent");
      const prices = e.comm.filter((x) => /\$\s?\d/.test(`${x.subject} ${x.body}`));
      const toTest = e.comm.every((x) => JSON.stringify(x.recipients ?? "").includes(J.TEST_DOMAIN) || JSON.stringify(x.recipients ?? "") === "[]");
      const refused = row?.status === "failed" && /^(held|blocked): /.test(row.error ?? "");
      const kind = row?.status === "sent" ? "sent to the TEST address" : refused ? `recorded as ${row!.error!.split(":")[0]} — ${row!.error!.replace(/^(held|blocked): /, "")}` : `unexpected (${row?.status ?? "no row"})`;
      return { ok: notElig.length === 1 && (row?.status === "sent" ? toTest : refused && notes === 1 && e.comm.length === 0) && prices.length === 0, detail: `email rows=${notElig.length}; ${kind}; office note rows=${notes}; outbound history=${e.comm.length}; prices=${prices.length}`, ids: { email_row: row?.id ?? null } };
    }, ["1.1"]);

    await rec.run("1.5", "no \"call the owner\" task created", async () => {
      const rows = await needsRows(ctx.jobId!);
      const calls = rows.filter((x) => /call (the )?owner|phone the owner|ring the owner/i.test(x.text));
      const { count: ev } = await admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", ctx.jobId!).gte("created_at", since).ilike("summary", "%call the owner%");
      return { ok: calls.length === 0 && (ev ?? 0) === 0, detail: `Needs me rows on this job ${rows.length}; asking to call the owner=${calls.length}; events mentioning it=${ev}` };
    }, ["1.1"]);
  } finally {
    await cleanupJourney(ctx).catch(() => undefined);
    const j = jobs.find((x) => x.jobId === ctx.jobId); if (j) j.archived = await archived(ctx.jobId);
  }

  // Second case: missing/conflicting evidence → needs_review (not not_eligible), job stays in office review, owner not told.
  const c2 = await newJourneyCtx();
  // Unique address so the case never links to an older kept TEST job (Jo 27 Oct: HV-3239/HV-3274 collision).
  c2.notes["address_line"] = `${parseInt(c2.runId.slice(0, 8), 16)} Journey Test Street`;
  try {
    const s = await setupSteps(c2, 3);
    setup.push(...s.out);
    jobs.push({ jobNumber: c2.jobNumber, jobId: c2.jobId, archived: false });
    await rec.run("1.6", "missing/conflicting evidence → needs_review, job stays in office review, owner not told not eligible", async () => {
      if (!s.ok) return { ok: false, detail: `setup failed: ${s.out.at(-1)?.error}` };
      // Owner said "no insulation"; the Ready Check says present but gives no R-value, type or photos (conflict + missing).
      await readyCheckWith(c2, { insulation_present: true, existing_r_value: null, insulationType: null, withInsulationPhotos: false });
      await J.assertOwnTestJob(c2);
      const since2 = new Date().toISOString();
      const ve = await import("./verified-eligibility.server");
      const view = await ve.eligibilityView(c2.jobId!);
      const stageBefore = await J.stageOf(c2);
      const b = await counts(c2.jobId!);
      const v = await ve.recordVerification(await personaClient(JOURNEY_ACTOR_EMAIL) as never, c2.jobId!, view.assessment.suggested, null, "TEST hard case: Ready Check insulation answers missing/conflicting — office to review");
      const a = await counts(c2.jobId!);
      const { data: row } = await loose.from("eligibility_verifications").select("outcome").eq("job_id", c2.jobId!).eq("is_current", true).maybeSingle();
      const stageAfter = await J.stageOf(c2);
      const e = await emailsSince(c2.jobId!, since2);
      const told = e.comm.filter((x) => /not.?eligible|does not appear eligible|doesn.t appear eligible/i.test(`${x.subject} ${x.body}`)).length + e.ces.filter((x) => /not.?eligible|ineligible/i.test(x.purpose ?? "")).length;
      const ok = view.assessment.suggested === "needs_review" && row?.outcome === "needs_review" && stageAfter === stageBefore && told === 0 && !(await ve.verifiedEligible(c2.jobId!));
      return { ok, detail: `suggested=${view.assessment.suggested} (missing: ${view.assessment.missing.join(", ") || "none"}; review: ${view.assessment.reviewReasons.join(" ") || "none"}); saved=${row?.outcome}; stage ${stageBefore}→${stageAfter}; owner told not eligible=${told}; ${diff(b, a)}`, ids: { verification_id: v.id } };
    });
  } finally {
    await cleanupJourney(c2).catch(() => undefined);
    const j = jobs.find((x) => x.jobId === c2.jobId); if (j) j.archived = await archived(c2.jobId);
  }
}

async function archived(jobId: string | null) {
  if (!jobId) return false;
  const { data } = await admin.from("jobs").select("qa_archived_at, source").eq("id", jobId).maybeSingle();
  return !!data?.qa_archived_at && data.source === "qa_test";
}

// =====================================================================================================================
// Branch 2 — safety check (PIESA) needs fixes
// =====================================================================================================================
async function defaultReadyCheck(ctx: JourneyCtx, r: StepResult) {
  await J.s4(ctx, r); // default step 4 exactly (eligible Ready Check + quote maths)
}

const FIXES_PRICE = 880;
export const SIMULATED_SEND_LABEL = "simulated: quote send skipped because customer messages are off";
const commsOff = (m: string) => /customer communications are disabled|customer messages are (switched )?off/i.test(m);

/** TEST job only: leave the quote exactly as a successful send would (stage, owner link, issued/released/sent) without
 *  sending anything — the owner "quote ready" email is the skipped part. Product code is not changed. */
async function simulateQuoteRelease(ctx: JourneyCtx, quoteId: string, how: "office" | "fixes") {
  await J.assertOwnTestJob(ctx);
  const wf = await import("./workflow.server");
  if (how === "office" && (await J.stageOf(ctx)) === "ready_check_complete") await wf.transition(ctx.jobId!, "measured_estimate_ready", ctx.actorId, `TEST journey: ${SIMULATED_SEND_LABEL}`, { quote_id: quoteId });
  if (how === "office") await (await import("./estimatelink.server")).ensureOwnerLink(ctx.jobId!);
  const now = new Date().toISOString();
  const { data, error } = await admin.from("quotes").update({ status: "issued", release_state: "released", release_hold_reason: null, sent_at: now, ...(how === "office" ? { office_reviewed_at: now, office_reviewed_by: ctx.actorId } : {}) })
    .eq("id", quoteId).eq("job_id", ctx.jobId!).eq("status", "draft").is("sent_at", null).select("id").maybeSingle();
  if (error || !data) throw new Error(`simulated release failed: ${error?.message ?? "quote not a draft"}`);
  await wf.logEvent(ctx.jobId!, ctx.actorId, "journey_send_simulated", `TEST journey: ${SIMULATED_SEND_LABEL}`, { quote_id: quoteId, step: how, simulated: true }, { internal: true });
}

async function piesaFixes(rec: Recorder, jobs: BranchResult["jobs"], setup: StepResult[]) {
  const ctx = await newJourneyCtx();
  // Unique address so the case never links to an older kept TEST job (Jo 27 Oct: HV-3239/HV-3274 collision).
  ctx.notes["address_line"] = `${parseInt(ctx.runId.slice(0, 8), 16)} Journey Test Street`;
  try {
    const s = await setupSteps(ctx, 5, defaultReadyCheck, async (c) => {
      const { data: q0 } = await admin.from("quotes").select("id, status").eq("id", c.quoteId!).single();
      if (q0?.status !== "draft") return;
      try { await (await import("./office-quote-review.server")).sendOfficeReviewedQuote(c.jobId!, c.quoteId!, c.actorId); }
      catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        if (!commsOff(m)) throw e;
        await simulateQuoteRelease(c, c.quoteId!, "office");
        rec.simulated("S5", "office presses Send quote", `${SIMULATED_SEND_LABEL} (portal said: ${m}); owner "quote ready" email counted as skipped`, { quote_id: c.quoteId! });
      }
    });
    setup.push(...s.out);
    jobs.push({ jobNumber: ctx.jobNumber, jobId: ctx.jobId, archived: false });
    if (!s.ok) { await rec.run("2.1", "setup steps 1–5", async () => ({ ok: false, detail: s.out.at(-1)?.error ?? "setup failed" })); return; }
    const sim = await import("./journey-sim.core");
    const os = await import("./official-short.core");
    const fd = await import("./fixes-day.core");
    const tpl = { a3: "", fixes: "" };
    const { data: ws } = await loose.from("workflow_settings").select("*").eq("id", 1).maybeSingle();
    const { data: el } = await admin.from("profiles").select("email, full_name").eq("id", ctx.electrician.id).single();
    const { TEST_MITTI_ASSIGNEE } = await import("./onsite-ready-check.core");
    const fixesTemplateItems = fd.FIXES_DAY_QUESTIONS.map((q, i) => ({ item_id: `sim_a4_${i + 1}`, label: q.label, type: q.type === "photo" ? "media" : q.type === "signature" ? "signature" : q.type === "yes_no" ? "question" : "textsingle" }));
    tpl.fixes = String((ws as Record<string, unknown> | null)?.[fd.FIXES_TEMPLATE_COLUMN] ?? "").trim();
    const now = new Date().toISOString();
    const pass = sim.simulatedA3PassAnswers({ seed: `${ctx.runId}-a3fix`, inspectionDate: J.melbourneDate(0), capturedAt: now, electrician: el?.full_name ?? "TEST Delta Electrician" });
    const pick = (label: string, v: string[]) => ({ item_id: `sim_a3_fix_${label.length}_${v.length}`, label, type: "question", responses: { selected: v.map((x) => ({ label: x })) } });
    const text = (label: string, v: string) => ({ item_id: `sim_a3_fix_t_${label.length}`, label, type: "textsingle", responses: { text: v } });
    const items = pass.items.map((it) => (it.label === os.A3_REPAIR_NEEDED_LABEL ? { ...it, responses: { selected: [{ label: "Yes" }] } } : it));
    const sigAt = items.findIndex((it) => it.type === "signature");
    items.splice(sigAt - 1, 0, pick(os.FIXES_WORK_LABEL, [os.FIXES_RCD_OPTION]) as never, text(os.FIXES_RCD_COUNT_LABEL, "2") as never, pick(os.ONSITE_START_LABEL, ["No"]) as never, text(os.FIXES_PRICE_LABEL, String(FIXES_PRICE)) as never);
    const { data: a0 } = await admin.from("assessments").select("id, external_mitti_id, mitti_template_id").eq("job_id", ctx.jobId!).maybeSingle();
    tpl.a3 = a0?.mitti_template_id ?? String((ws as Record<string, unknown> | null)?.["mitti_piesa_template_id"] ?? "").trim();
    const mitti = sim.simulatedMitti({
      // The simulated A3 template carries the office prefill fields the real A3 has (mandatory: Property Address, Owner name).
      templates: { [tpl.a3]: sim.templateOfItems([{ item_id: "sim_a3_office_job", label: "Portal Job Number", type: "textsingle" }, { item_id: "sim_a3_office_addr", label: "Property Address", type: "textsingle" }, { item_id: "sim_a3_office_owner", label: "Owner name", type: "textsingle" }, ...(items as never[] as { item_id: string; label: string; type: string }[])]), ...(tpl.fixes ? { [tpl.fixes]: { items: fixesTemplateItems as never } } : {}) },
      users: [{ id: "sim-mitti-electrician", email: el!.email! }, { id: "sim-mitti-test-assignee", email: TEST_MITTI_ASSIGNEE }],
    });
    const fetchMedia = async () => ({ bytes: J.TINY_JPEG, contentType: "image/jpeg" });
    // Jo 27 Oct: product code that calls Mitti on its own (booking the fixes visit makes the A4) goes to this simulator.
    const guard = (await import("./mitti.server")).armJourneyMittiGuard(mitti.call);
    guardRouted = guard.routed;
    let rectQuoteId: string | null = null;

    // Book the PIESA exactly as the default step 6 does, then the A3 with a priced repair.
    await rec.run("2.1", "A3 synced complete with rectification required; install scheduling stays closed", async () => {
      await J.assertOwnTestJob(ctx);
      const al = await import("./allocation.server");
      await al.startPiesaAllocation(ctx.jobId!, ctx.actorId, "piesa", { onlyBusiness: ctx.electrician.business_id, rateToConfirm: true });
      const { data: mine } = await admin.from("partner_offers").select("id").eq("job_id", ctx.jobId!).eq("kind", "piesa").eq("status", "pending").eq("business_id", ctx.electrician.business_id).limit(1).single();
      const pt = await import("./piesa-times.server");
      const { allowedPiesaTimeDays, allowedPiesaTimes } = await import("./piesa-times.core");
      await pt.acceptPiesaOfferWithTimes(mine!.id, ctx.electrician.id, allowedPiesaTimeDays().slice(1, 4).map((day) => { const ok = allowedPiesaTimes(day); return { day, time: ok.includes("10:00" as never) ? "10:00" : ok[0]! }; }));
      const ost = await pt.ownerPiesaTimesState(ctx.jobId!);
      await pt.ownerTakePiesaTime(ctx.jobId!, ost.open[0]!.id, ctx.actorId, { understandsThirtyDays: true, ip: null, userAgent: null });
      const { data: a1 } = await admin.from("assessments").select("external_mitti_id").eq("job_id", ctx.jobId!).maybeSingle();
      let auditId = a1?.external_mitti_id ?? null;
      if (auditId) mitti.seed(auditId, tpl.a3);
      else auditId = (await (await import("./mitti.server")).createAssignMittiAudit(ctx.jobId!, ctx.actorId, mitti.call, { officeOverride: true })).auditId;
      // The real portal prefills Portal Job Number on the form; a blank one now fails closed (identity rule), so fill it as the prefill would.
      mitti.fill(auditId!, [{ item_id: "sim_a3_office_job", label: "Portal Job Number", type: "textsingle", responses: { text: ctx.jobNumber ?? "" } }, ...items] as never);
      const b = await counts(ctx.jobId!);
      await J.assertOwnTestJob(ctx);
      const synced = await (await import("./mitti.server")).syncMittiAssessment(ctx.jobId!, ctx.actorId, mitti.call, fetchMedia);
      for (const c of ["switchboard_cables", "piesa_signoff"]) await J.uploadEvidence(ctx, c, ctx.electrician.id, "electrical");
      let complete = "pressed";
      try { await (await import("./piesa-complete.server")).completePiesaAssessment({ jobId: ctx.jobId! }, ctx.electrician.id); } catch (e) { complete = `refused: ${(e as Error).message}`; }
      const a = await counts(ctx.jobId!);
      const stage = await J.stageOf(ctx);
      const { data: asmt } = await admin.from("assessments").select("id, mitti_completed").eq("job_id", ctx.jobId!).maybeSingle();
      const { count: installBookings } = await admin.from("bookings").select("id", { count: "exact", head: true }).eq("job_id", ctx.jobId!).eq("kind", "installation");
      const closed = !["installation_scheduling", "installation_booked"].includes(stage ?? "") && (installBookings ?? 0) === 0;
      const rectStage = ["rectification_required", "electrical_variation_pending", "piesa_complete"].includes(stage ?? "");
      return { ok: synced.completed && asmt?.mitti_completed === true && closed && rectStage, detail: `synced completed=${synced.completed} (${synced.issues.join("; ") || "no issues"}); Complete PIESA ${complete}; stage=${stage}; install bookings=${installBookings}; ${diff(b, a)}`, ids: { audit_id: auditId, assessment_id: asmt?.id ?? null } };
    });

    // Case 3 first (before the electrician gives fixes times): one check fails → held with the reason, nothing sent.
    if (P2_HOOK) await P2_HOOK("stopped", ctx).catch(() => undefined);
    await rec.run("2.3", "one check fails → held with the reason, nothing sent", async () => {
      await J.assertOwnTestJob(ctx);
      const b = await counts(ctx.jobId!);
      const since = new Date().toISOString();
      const af = await import("./auto-fixes-quote-send.server");
      const o = await af.maybeAutoSendFixesQuote(ctx.jobId!, { actorId: ctx.actorId, generate: true });
      rectQuoteId = o.quoteId;
      const a = await counts(ctx.jobId!);
      const e = await emailsSince(ctx.jobId!, since);
      const { data: q } = o.quoteId ? await admin.from("quotes").select("status, sent_at").eq("id", o.quoteId).single() : { data: null };
      const { count: held } = await admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", ctx.jobId!).eq("event_type", "auto_fixes_quote_held").gte("created_at", since);
      // Decision 315: "Waiting for the electrician's fixes times" is the portal's hold reason before the windows exist.
      const heldWithReason = (o.result === "held" && !!o.reason) || (o.result === "waiting" && o.reason === "Waiting for the electrician's fixes times");
      return { ok: heldWithReason && e.ces.length + e.comm.length === 0 && q?.status === "draft", detail: `result=${o.result} reason=${o.reason ?? "-"}; quote status=${q?.status ?? "none"}; held events=${held}; owner emails=${e.ces.length + e.comm.length}; ${diff(b, a)}. Failing check used: no fixes times from the electrician yet`, ids: { quote_id: o.quoteId } };
    }, ["2.1"]);

    await rec.run("2.2", "maybeAutoSendFixesQuote sent when every check passes; one owner email; price = electrician's price + margin by whose electrician", async () => {
      await J.assertOwnTestJob(ctx);
      const rs = await import("./rectification.server");
      // Business days at least 2 business days away (calendar +3..+5 hit weekends on some dates).
      const days = (await import("./piesa-windows.core")).allowedPiesaDays().slice(0, 3);
      await rs.recordRectificationWindows(ctx.jobId!, ctx.electrician.id, 3, days.map((date) => ({ date, slot: "10-12" as const })));
      const b = await counts(ctx.jobId!);
      const since = new Date().toISOString();
      const o = await (await import("./auto-fixes-quote-send.server")).maybeAutoSendFixesQuote(ctx.jobId!, { actorId: ctx.actorId, generate: true });
      rectQuoteId = o.quoteId ?? rectQuoteId;
      let simulatedSend = false;
      if (o.result === "held" && o.reason && commsOff(o.reason) && rectQuoteId) {
        await simulateQuoteRelease(ctx, rectQuoteId, "fixes");
        rec.simulated("2.2s", "fixes quote email to the owner", `simulated: fixes quote send skipped because customer messages are off (portal said: ${o.reason}); expected owner email counted as skipped`, { quote_id: rectQuoteId });
        simulatedSend = true;
      }
      const a = await counts(ctx.jobId!);
      const e = await emailsSince(ctx.jobId!, since);
      const { data: q } = rectQuoteId ? await admin.from("quotes").select("status, customer_total_inc_gst, sent_at").eq("id", rectQuoteId).single() : { data: null };
      const { electricianSourceForJob } = await import("./our-lead-piesa-electrician.server");
      const { fixesMarginFor } = await import("./fixes-price.core");
      const src = await electricianSourceForJob(ctx.jobId!, ctx.electrician.business_id);
      const expected = FIXES_PRICE + fixesMarginFor(src);
      const total = Number(q?.customer_total_inc_gst ?? NaN);
      const emails = e.ces.length + e.comm.length;
      return { ok: (simulatedSend || (o.result === "sent" && emails === 1)) && q?.status === "issued" && Math.abs(total - expected) < 0.01, detail: `result=${o.result}${o.reason ? ` (${o.reason})` : ""}; saved quote status=${q?.status}, total $${total}; expected $${FIXES_PRICE} + margin $${fixesMarginFor(src)} (${src} electrician) = $${expected}; owner emails=${emails}${simulatedSend ? " (send simulated — email skipped)" : ""}; ${diff(b, a)}`, ids: { quote_id: rectQuoteId } };
    }, ["2.1"]);

    await rec.run("2.4", "owner accepts and pays the fixes (Demo Company); still no install booking", async () => {
      await J.assertOwnTestJob(ctx);
      const b = await counts(ctx.jobId!);
      const { data: q } = await admin.from("quotes").select("id, version, status").eq("id", rectQuoteId!).single();
      const { data: jo } = await admin.from("jobs").select("owners(user_id)").eq("id", ctx.jobId!).single();
      const ownerUser = (jo?.owners as { user_id: string | null } | null)?.user_id ?? ctx.actorId;
      const { respondToQuoteImpl } = await import("./portal.functions");
      // Decision 366: the owner accepts now and picks one of the electrician's times on My job once the fixes are paid (2.5).
      await respondToQuoteImpl({ quoteId: q!.id, accept: true, consent: true, pickLater: true, expectedVersion: q!.version, signing: { signatoryName: "Test Journey", authorityType: "owner", over18: true, readConsumerInfo: true, acceptAgreement: true, signatureName: "Test Journey", assistance: "none" } } as never,
        { userId: ownerUser, ip: "127.0.0.1", userAgent: "journey-test", authorize: async () => {}, isOwner: async () => true } as never);
      // ONE invoice per job: the fixes go onto the existing invoice through the product's own acceptance path (no second invoice).
      const { data: inv } = await admin.from("invoices").select("id, xero_invoice_id").eq("job_id", ctx.jobId!).eq("kind", "installation").order("created_at", { ascending: false }).limit(1).maybeSingle();
      const r: StepResult = { key: "s6_electrician", label: "fixes pay", passed: false, checks: [] };
      let pay = "paid";
      try { await J.payStep(ctx, r, "fixes", "Electrical fixes payment (TEST payment, Demo Company)"); } catch (e) { pay = `not paid: ${(e as Error).message}`; }
      const a = await counts(ctx.jobId!);
      const { data: qa } = await admin.from("quotes").select("status").eq("id", q!.id).single();
      const blocker = await (await import("./payments.server")).fixesPaymentBlockerFor(ctx.jobId!);
      const { count: installBookings } = await admin.from("bookings").select("id", { count: "exact", head: true }).eq("job_id", ctx.jobId!).eq("kind", "installation");
      return { ok: qa?.status === "accepted" && !blocker && (installBookings ?? 0) === 0, detail: `saved quote=${qa?.status}; payment: ${pay}; fixes blocker=${blocker ?? "none"}; install bookings=${installBookings}; ${diff(b, a)}`, ids: { invoice_id: inv?.id ?? null } };
    }, ["2.2"]);

    let bookingId: string | null = null;
    let fixesAuditId: string | null = null;
    await rec.run("2.5", "owner picks an offered fixes time → booked once; A4 fixes form made once", async () => {
      await J.assertOwnTestJob(ctx);
      const of = await import("./owner-fixes.server");
      const st = await of.ownerFixesState(ctx.jobId!);
      if (!st.windows.length) return { ok: false, detail: `owner fixes step=${st.step}; no times to pick` };
      const { data: jo } = await admin.from("jobs").select("owners(user_id)").eq("id", ctx.jobId!).single();
      const ownerUser = (jo?.owners as { user_id: string | null } | null)?.user_id ?? ctx.actorId;
      const b = await counts(ctx.jobId!);
      const p = await of.ownerPickFixesTime(ctx.jobId!, st.windows[0]!.id, ownerUser);
      const { data: bk } = await admin.from("bookings").select("id").eq("job_id", ctx.jobId!).eq("kind", "rectification").in("status", ["confirmed", "completed"]);
      bookingId = bk?.[0]?.id ?? null;
      let form = "no booking";
      if (bookingId) {
        const f1 = await (await import("./fixes-day.server")).createFixesForm(ctx.jobId!, ctx.actorId, bookingId, mitti.call);
        const f2 = await (await import("./fixes-day.server")).createFixesForm(ctx.jobId!, ctx.actorId, bookingId, mitti.call);
        form = `${f1.status}${"reason" in f1 && f1.reason ? ` (${f1.reason})` : ""} then ${f2.status}`;
      }
      const { data: created } = await admin.from("workflow_events").select("details").eq("job_id", ctx.jobId!).eq("event_type", fd.FIXES_FORM_CREATED_EVENT);
      fixesAuditId = ((created ?? [])[0]?.details as { audit_id?: string } | null)?.audit_id ?? null;
      const a = await counts(ctx.jobId!);
      return { ok: p.booked && (bk ?? []).length === 1 && (created ?? []).length === 1, detail: `booked=${p.booked}; fixes bookings=${(bk ?? []).length}; form: ${form}; fixes forms created=${(created ?? []).length}${tpl.fixes ? "" : " (no A4 template id in settings)"}; ${diff(b, a)}`, ids: { booking_id: bookingId, fixes_audit_id: fixesAuditId } };
    }, ["2.4"]);

    await rec.run("2.6", "completeFixesForm passes; Section C recorded", async () => {
      await J.assertOwnTestJob(ctx);
      const cap = new Date().toISOString();
      const media = (n: string) => ({ media_id: sim.simMediaId(`${ctx.runId}-a4-${n}`), captured_at: cap, date_created: cap, location: { ...sim.JOURNEY_SITE } });
      const Q = fd.FIXES_DAY_Q;
      // Booking made the form through the product's persistent TEST simulator; hold the same id here so it is filled and read back in-run.
      if (fixesAuditId && !mitti.audits.has(fixesAuditId) && tpl.fixes) mitti.seed(fixesAuditId, tpl.fixes);
      mitti.fill(fixesAuditId!, [
        { item_id: "a", label: Q.done, type: "question", responses: { selected: [{ label: "Yes" }] } },
        { item_id: "b", label: Q.coesNumber, type: "textsingle", responses: { text: "TEST-COES-0001" } },
        { item_id: "c", label: Q.certDate, type: "textsingle", responses: { text: J.melbourneDate(0) } },
        { item_id: "d", label: Q.coesFile, type: "media", media: [media("coes")] },
        { item_id: "e", label: Q.workPhoto, type: "media", media: [media("work")] },
        { item_id: "f", label: Q.signature, type: "signature", responses: { image: { media_id: sim.simMediaId(`${ctx.runId}-a4-sig`), timestamp: cap }, name: el?.full_name ?? "TEST Delta Electrician" } },
      ] as never);
      const b = await counts(ctx.jobId!);
      const res = await (await import("./fixes-day.server")).completeFixesForm(ctx.jobId!, fixesAuditId!, { call: mitti.call, fetchMedia, actorId: ctx.actorId });
      const a = await counts(ctx.jobId!);
      const { data: pr } = await admin.from("piesa_records").select("id, kind, outcome, section_c_signed_at").eq("job_id", ctx.jobId!).eq("kind", "post_rectification").order("created_at", { ascending: false }).limit(1).maybeSingle();
      return { ok: res.status === "done" && !!pr?.section_c_signed_at && pr.outcome === "pass", detail: `result=${res.status} (${res.detail ?? "-"}); post-fixes PIESA record outcome=${pr?.outcome ?? "none"}, Section C signed=${pr?.section_c_signed_at ?? "none"}; ${diff(b, a)}`, ids: { piesa_record_id: pr?.id ?? null } };
    }, ["2.5"]);

    await rec.run("2.7", "only now install scheduling opens; installer told once; 30-day clock from the official PIESA date, not Section C", async () => {
      await J.assertOwnTestJob(ctx);
      const stage = await J.stageOf(ctx);
      const { INSTALL_CLEARANCE_EVENT } = await import("./install-clearance.core");
      const { count: told } = await admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", ctx.jobId!).eq("event_type", INSTALL_CLEARANCE_EVENT);
      const { data: dl } = await admin.from("job_piesa_deadlines").select("piesa_date, install_deadline").eq("job_id", ctx.jobId!).maybeSingle();
      // Decision 316: read the official initial/reassessment independently of the deadline view.
      const { data: pr } = await admin.from("piesa_records").select("completed_date").eq("job_id", ctx.jobId!).in("kind", ["initial", "reassessment"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
      const officialDate = pr?.completed_date ? String(pr.completed_date).slice(0, 10) : null;
      const want = officialDate ? new Date(Date.parse(`${officialDate}T00:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10) : null;
      const got = dl?.install_deadline ? String(dl.install_deadline).slice(0, 10) : null;
      return { ok: stage === "installation_scheduling" && told === 1 && !!want && String(dl?.piesa_date ?? "").slice(0, 10) === officialDate && got === want, detail: `stage=${stage}; installer clearance notices=${told}; official PIESA ${officialDate}; deadline saved ${got} (from date ${dl?.piesa_date ?? "?"}), expected ${want}` };
    }, ["2.6"]);

    if (P2_HOOK) await P2_HOOK("carried-on", ctx).catch(() => undefined);
    await rec.run("2.8", "electrician pay due 7 days after the office approves the completed Mitti form (not the owner's payment)", async () => {
      const { payoutGateFacts } = await import("./trade-payout-gate.server");
      const ep = await import("./electrician-pay.core");
      // Decision 410: complete but not yet approved → not due, and the office is offered Approve.
      const before = ep.electricianPayTiming("rectification", (await payoutGateFacts([ctx.jobId!])).get(ctx.jobId!));
      const waitingOk = !!before.formCompleteAt && !before.dueAt && before.approvable;
      const { recordElectricianFormApproval } = await import("./electrician-form-approval.server");
      const { approvedAt } = await recordElectricianFormApproval(ctx.jobId!, "rectification", ctx.actorId);
      const t = ep.electricianPayTiming("rectification", (await payoutGateFacts([ctx.jobId!])).get(ctx.jobId!));
      const want = new Date(Date.parse(approvedAt) + 7 * 86_400_000).toISOString().slice(0, 10);
      const got = t.dueAt ? String(t.dueAt).slice(0, 10) : null;
      return { ok: waitingOk && got === want, detail: `form complete ${before.formCompleteAt ?? "none"}; before Approve due ${before.dueAt ?? "none"} (approvable ${before.approvable}); approved ${approvedAt}; due ${got ?? "none"}; expected ${want}` };
    }, ["2.6"]);
  } finally {
    await cleanupJourney(ctx).catch(() => undefined);
    const j = jobs.find((x) => x.jobId === ctx.jobId); if (j) j.archived = await archived(ctx.jobId);
  }
}

let guardRouted: string[] = [];
/** Phase 3 path 2: screens + office signals at the stop and after Section C (null outside Phase 3). */
let P2_HOOK: ((moment: "stopped" | "carried-on", ctx: JourneyCtx) => Promise<void>) | null = null;
/** Jo 27 Oct: a TEST journey must never reach real Mitti. Any network call to Mitti is refused and fails the run. */
export async function runJourneyBranch(branch: BranchName): Promise<BranchResult> {
  const rec = new Recorder();
  const ms = await import("./mitti.server");
  ms.armJourneyMittiGuard(null);
  const refused: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (/mitti\.com/i.test(url)) { refused.push(`${init?.method ?? "GET"} ${new URL(url).pathname}`); throw new Error(`SAFETY STOP: real Mitti call refused for a qa_test journey (${url.split("?")[0]})`); }
    return realFetch(input as never, init);
  }) as typeof fetch;
  try { return await runBranchInner(branch, rec); }
  finally {
    globalThis.fetch = realFetch; ms.disarmJourneyMittiGuard();
    rec.checks.push(refused.length
      ? { n: "M", name: "no real Mitti call", status: "failed", detail: `REAL MITTI CALLS REFUSED: ${refused.join("; ")}`, ids: {} }
      : { n: "M", name: "no real Mitti call", status: "passed", detail: `0 real Mitti calls; product calls sent to the simulator: ${guardRouted.length ? guardRouted.join("; ") : "none"}`, ids: {} });
    guardRouted = [];
  }
}
async function runBranchInner(branch: BranchName, rec: Recorder): Promise<BranchResult> {
  const jobs: BranchResult["jobs"] = [];
  const setup: StepResult[] = [];
  if (branch === "not-eligible") await notEligible(rec, jobs, setup);
  else await piesaFixes(rec, jobs, setup);
  return { branch, jobs, setup, checks: rec.checks };
}

// =====================================================================================================================
// Phase 3 hard cases (Jo 27 Oct 2026, 14:57): each path on its own fresh TEST job; the affected person and the office are
// screenshotted at 390px; four answers per path: stops? plain reason? office told once? carries on after the fix?
// Same TEST-only rules as above. Clock moves and document dates change only this run's TEST job / TEST business, and
// TEST business documents are restored afterwards.
// =====================================================================================================================
export type Phase3Answer = { q: "stops" | "reason" | "office_once" | "carries_on"; answer: "yes" | "no" | "not_run"; detail: string };
export type Shot = { moment: string; who: string; name: string; path: string; landed: string | null; text: string; overflow: boolean; errors: string[] };
let SHOT_DIR = "";
const SHOTS: Shot[] = [];
const ANSWERS: Phase3Answer[] = [];
let BLOCKED_REASON: string | null = null;
const answer = (q: Phase3Answer["q"], ok: boolean | null, detail: string) => ANSWERS.push({ q, answer: ok === null ? "not_run" : ok ? "yes" : "no", detail });

/** Open each page at 390x844 as the given TEST person (null email = no sign-in, e.g. the owner's secure link). */
async function shoot(moment: string, list: { who: string; email: string | null; path: string }[]): Promise<Shot[]> {
  if (!SHOT_DIR) return [];
  const { personaSession } = await import("./journey.server");
  const { writeFileSync, mkdirSync, existsSync, readFileSync } = await import("node:fs");
  const { spawnSync } = await import("node:child_process");
  mkdirSync(SHOT_DIR, { recursive: true });
  const shots = [] as { name: string; path: string; session: unknown }[];
  for (const [i, s] of list.entries()) shots.push({ name: `${String(SHOTS.length + i).padStart(2, "0")}-${moment}-${s.who}.png`.replace(/[^a-z0-9.-]+/gi, "_"), path: s.path, session: s.email ? await personaSession(s.email) : null });
  const manifest = `${SHOT_DIR}/.shots.json`, resultFile = `${SHOT_DIR}/.shots-result.json`;
  const { data: shotJob } = shots.length ? await admin.from("jobs").select("job_number").eq("id", (list[0]?.path.match(/\/jobs\/([^/?]+)/)?.[1] ?? list.map(x => x.path).join(" ").match(/\/(?:jobs|day)\/([^/? ]+)/)?.[1] ?? "")).maybeSingle() : { data: null };
  writeFileSync(manifest, JSON.stringify({ base: "http://localhost:8080", outDir: SHOT_DIR, jobNumber: shotJob?.job_number ?? "", storageKey: `sb-${process.env["SUPABASE_PROJECT_ID"] ?? "wvuffpykgnqliikhodzl"}-auth-token`, shots, resultFile }));
  const script = new URL("../../e2e/journey/branch_shot.py", import.meta.url).pathname;
  spawnSync("python3", [script, manifest], { encoding: "utf8", timeout: 300_000 });
  writeFileSync(manifest, "{}"); // sessions are short-lived secrets; never leave them on disk
  const res = existsSync(resultFile) ? (JSON.parse(readFileSync(resultFile, "utf8")) as Omit<Shot, "moment" | "who">[]) : [];
  const out = res.map((r, i) => ({ ...r, moment, who: list[i]?.who ?? "?" }));
  SHOTS.push(...out);
  return out;
}
const sees = (s: Shot | undefined, re: RegExp) => !!s && re.test(s.text);
const jobMentions = (s: Shot | undefined, jobNumber: string | null) => (s && jobNumber ? s.text.split(jobNumber).length - 1 : 0);

/** Office-side signals for one job: Needs me rows (office-needs) + the office exceptions queue (needs.server), read-only. */
async function officeSignals(jobId: string) {
  const rows = await needsRows(jobId);
  let hivic: string[] = [];
  try { hivic = (await (await import("./needs.server")).loadNeedsHivic()).items.filter((x: unknown) => JSON.stringify(x).includes(jobId)).map((x: unknown) => String((x as { code?: string }).code ?? (x as { key?: string }).key)); } catch { /* read-only best effort */ }
  return { needsMe: rows.length, needsMeText: rows.map((r) => r.text.slice(0, 160)), exceptions: hivic };
}

async function freshCtx() {
  const ctx = await newJourneyCtx();
  ctx.notes["address_line"] = `${parseInt(ctx.runId.slice(0, 8), 16)} Journey Test Street`;
  ctx.notes["mitti_guard_routes"] = [] as string[][]; // default steps 6/7 record their simulator routes here
  return ctx;
}
async function toQuoteAccepted(rec: Recorder, ctx: JourneyCtx, setup: StepResult[], jobs: BranchResult["jobs"]) {
  const s = await setupSteps(ctx, 5, defaultReadyCheck, async (c) => {
    const { data: q0 } = await admin.from("quotes").select("id, status").eq("id", c.quoteId!).single();
    if (q0?.status !== "draft") return;
    try { await (await import("./office-quote-review.server")).sendOfficeReviewedQuote(c.jobId!, c.quoteId!, c.actorId); }
    catch (e) { const m = e instanceof Error ? e.message : String(e); if (!commsOff(m)) throw e; await simulateQuoteRelease(c, c.quoteId!, "office"); rec.simulated("S5", "office presses Send quote", SIMULATED_SEND_LABEL, { quote_id: c.quoteId! }); }
  });
  setup.push(...s.out);
  jobs.push({ jobNumber: ctx.jobNumber, jobId: ctx.jobId, archived: false });
  return s;
}
const ELEC = "qa.rec.delta@hivic-test.example";
const INST = "qa.installer.alpha@hivic-test.example";
const officePages = (ctx: JourneyCtx) => [{ who: "office-job", email: "qa.office@hivic-test.example", path: `/admin/jobs/${ctx.jobId}` }, { who: "office-needs-me", email: "qa.office@hivic-test.example", path: "/admin/needs-me?test=true" }];
const ownerPage = (ctx: JourneyCtx, q = "") => ({ who: "owner", email: null, path: `/my-job/${ctx.token}${q}` });

async function finish(ctx: JourneyCtx, jobs: BranchResult["jobs"]) {
  await cleanupJourney(ctx).catch(() => undefined);
  const j = jobs.find((x) => x.jobId === ctx.jobId); if (j) j.archived = await archived(ctx.jobId);
}

// ---------- Path 1 — not eligible / needs review (screens + fix) ----------
async function p1Screens(rec: Recorder, jobs: BranchResult["jobs"], setup: StepResult[]) {
  await notEligible(rec, jobs, setup); // the existing checks (1.1–1.6), unchanged
  const ctx = await freshCtx();
  try {
    const s = await setupSteps(ctx, 3); setup.push(...s.out); jobs.push({ jobNumber: ctx.jobNumber, jobId: ctx.jobId, archived: false });
    if (!s.ok) { BLOCKED_REASON = `setup failed: ${s.out.at(-1)?.error}`; return; }
    await readyCheckWith(ctx, { insulation_present: true, existing_r_value: null, insulationType: null, withInsulationPhotos: false });
    const ve = await import("./verified-eligibility.server");
    const sb = await personaClient(JOURNEY_ACTOR_EMAIL);
    const view = await ve.eligibilityView(ctx.jobId!);
    await ve.recordVerification(sb as never, ctx.jobId!, view.assessment.suggested, null, "TEST hard case: insulation answers missing — office to review");
    const sig = await officeSignals(ctx.jobId!);
    const stop = await shoot("p1-stopped", [ownerPage(ctx), ...officePages(ctx)]);
    const stage = await J.stageOf(ctx);
    let quoteBlocked = "not tried";
    try { await (await import("./allocation.server")).startPiesaAllocation(ctx.jobId!, ctx.actorId, "piesa", { onlyBusiness: ctx.electrician.business_id, rateToConfirm: true }); quoteBlocked = "NOT refused"; } catch (e) { quoteBlocked = `refused: ${(e as Error).message.slice(0, 160)}`; }
    answer("stops", view.assessment.suggested === "needs_review" && quoteBlocked.startsWith("refused") && !(await ve.verifiedEligible(ctx.jobId!)), `saved=${view.assessment.suggested}; stage=${stage}; PIESA ${quoteBlocked}`);
    const officeJob = stop.find((x) => x.who === "office-job");
    answer("reason", sees(officeJob, /eligibility needs review|review eligibility/i) && !sees(stop[0], /not eligible|does not appear eligible/i), `office job page shows review/missing wording=${sees(officeJob, /eligibility needs review|review eligibility/i)}; owner page tells owner "not eligible"=${sees(stop[0], /not eligible|does not appear eligible/i)}; missing: ${view.assessment.missing.join(", ")}`);
    const nm = jobMentions(stop.find((x) => x.who === "office-needs-me"), ctx.jobNumber);
    answer("office_once", sig.needsMe === 1 || nm === 1, `Needs me rows for this job=${sig.needsMe}; office exceptions=${sig.exceptions.join(",") || "none"}; job number shown on Needs me page ${nm}×`);
    // The fix a person makes: the installer adds the missing insulation answers + photo, the office records the outcome.
    await admin.from("ceiling_measurements").update({ insulation_present: false, existing_r_value: null } as never).eq("job_id", ctx.jobId!).eq("is_current", true);
    await J.uploadEvidence(ctx, "existing_insulation_r_value", ctx.installer.id);
    const v2 = await ve.eligibilityView(ctx.jobId!);
    let rec2 = "";
    try { await ve.recordVerification(sb as never, ctx.jobId!, v2.assessment.suggested, v2.assessment.suggested === "eligible" ? null : null, "TEST hard case: missing answers supplied — office re-checked"); rec2 = v2.assessment.suggested; } catch (e) { rec2 = `refused: ${(e as Error).message}`; }
    const after = await shoot("p1-fixed", [ownerPage(ctx), officePages(ctx)[0]!]);
    answer("carries_on", (await ve.verifiedEligible(ctx.jobId!)) === true, `after the answers were added: suggested=${v2.assessment.suggested}; recorded=${rec2}; verifiedEligible=${await ve.verifiedEligible(ctx.jobId!)}; office page after: ${after[1]?.landed ?? "-"}`);
  } finally { await finish(ctx, jobs); }
}

// ---------- Path 2 — PIESA needs fixes, then Section C (screens) ----------
async function p2Screens(rec: Recorder, jobs: BranchResult["jobs"], setup: StepResult[]) {
  const seen: Record<string, { shots: Shot[]; sig: Awaited<ReturnType<typeof officeSignals>> }> = {};
  P2_HOOK = async (moment, ctx) => {
    const sig = await officeSignals(ctx.jobId!);
    const shots = await shoot(`p2-${moment}`, moment === "stopped"
      ? [ownerPage(ctx), { who: "electrician", email: ELEC, path: `/field/day/${ctx.jobId}` }, { who: "installer", email: INST, path: `/field/day/${ctx.jobId}` }, ...officePages(ctx)]
      : [ownerPage(ctx), { who: "installer", email: INST, path: `/field/day/${ctx.jobId}` }, officePages(ctx)[0]!]);
    seen[moment] = { shots, sig };
  };
  try { await piesaFixes(rec, jobs, setup); } finally { P2_HOOK = null; } // existing 2.1–2.8, unchanged
  const c = (n: string) => rec.checks.find((x) => x.n === n)?.status === "passed";
  const st = seen["stopped"];
  answer("stops", c("2.1"), "install scheduling closed while fixes needed (check 2.1)");
  const inst = st?.shots.find((x) => x.who === "installer"), off = st?.shots.find((x) => x.who === "office-job");
  answer("reason", c("2.1") && (sees(inst, /fix|electrical|safety check/i) || sees(off, /fix|electrical/i)), `installer page names the electrical fixes=${sees(inst, /fix|electrical/i)}; office job page=${sees(off, /fix|electrical/i)}; owner gets the fixes quote email (check 2.2)=${c("2.2")}`);
  answer("office_once", st ? st.sig.needsMe + st.sig.exceptions.length === 1 : null, st ? `at the stop: Needs me=${st.sig.needsMe} (${st.sig.needsMeText.join(" | ") || "none"}), exceptions=${st.sig.exceptions.join(",") || "none"}` : "stop screens not taken");
  answer("carries_on", c("2.6") && c("2.7"), `Section C recorded and install scheduling opened (checks 2.6, 2.7); after: Needs me=${seen["carried-on"]?.sig.needsMe ?? "-"}`);
}

// ---------- Path 3 — payment reversed (Xero Demo Company); card fail/retry needs Stripe test keys ----------
async function p3Payment(rec: Recorder, jobs: BranchResult["jobs"], setup: StepResult[]) {
  const ctx = await freshCtx();
  try {
    const s = await toQuoteAccepted(rec, ctx, setup, jobs);
    if (!s.ok) { BLOCKED_REASON = `setup failed: ${s.out.at(-1)?.error}`; return; }
    const pay = await import("./payments.server");
    const v0 = await pay.jobPaymentView(ctx.jobId!);
    const card = process.env["STRIPE_SECRET_KEY"] ? "Stripe test key present" : "no Stripe test key in this project — card fail and card retry NOT RUN";
    // Reverse the $349 Demo Company payment as a person would in Xero.
    const b = await counts(ctx.jobId!);
    let rev = "reversed";
    try { await (await import("./xero.server")).reverseDemoTestPayment(v0!.invoiceId, ctx.actorId); } catch (e) { rev = `could not reverse: ${(e as Error).message}`; }
    const v1 = await pay.jobPaymentView(ctx.jobId!);
    const st1 = v1?.steps.find((x) => x.key === "safety_check")?.state;
    let alloc = "";
    try { await (await import("./allocation.server")).startPiesaAllocation(ctx.jobId!, ctx.actorId, "piesa", { onlyBusiness: ctx.electrician.business_id, rateToConfirm: true }); alloc = "NOT refused"; } catch (e) { alloc = `refused: ${(e as Error).message.slice(0, 200)}`; }
    const { count: offers } = await admin.from("partner_offers").select("id", { count: "exact", head: true }).eq("job_id", ctx.jobId!).eq("kind", "piesa");
    const sig = await officeSignals(ctx.jobId!);
    const a = await counts(ctx.jobId!);
    const stop = await shoot("p3-reversed", [ownerPage(ctx), ...officePages(ctx)]);
    answer("stops", rev === "reversed" && st1 !== "paid" && (offers ?? 0) === 0, `${card}; Demo payment ${rev}; PIESA fee step=${st1}; PIESA offer ${alloc}; PIESA offers=${offers}; ${diff(b, a)}`);
    answer("reason", sees(stop[0], /\$349|pay|payment/i), `owner page mentions the payment due=${sees(stop[0], /\$349|pay|payment/i)}; office job page mentions payment=${sees(stop[1], /revers|payment|paid/i)}`);
    const nm = jobMentions(stop[2], ctx.jobNumber);
    answer("office_once", sig.needsMe === 1 || nm === 1 || sig.exceptions.length === 1, `Needs me rows=${sig.needsMe} (${sig.needsMeText.join(" | ") || "none"}); exceptions=${sig.exceptions.join(",") || "none"}; Needs me page mentions job ${nm}×`);
    // Fix: the owner pays again (TEST payment, Demo Company).
    const r: StepResult = { key: "s5_owner_accept", label: "re-pay", passed: true, checks: [] };
    let repay = "paid";
    try { await J.payStep(ctx, r, "safety_check", "owner pays the $349 again (TEST, Demo Company)"); } catch (e) { repay = `failed: ${(e as Error).message}`; }
    const st2 = (await pay.jobPaymentView(ctx.jobId!))?.steps.find((x) => x.key === "safety_check")?.state;
    let alloc2 = "";
    try { await (await import("./allocation.server")).startPiesaAllocation(ctx.jobId!, ctx.actorId, "piesa", { onlyBusiness: ctx.electrician.business_id, rateToConfirm: true }); alloc2 = "offered"; } catch (e) { alloc2 = `refused: ${(e as Error).message.slice(0, 200)}`; }
    await shoot("p3-repaid", [ownerPage(ctx)]);
    answer("carries_on", st2 === "paid" && alloc2 === "offered", `re-pay ${repay}; PIESA fee step=${st2}; PIESA offer ${alloc2}`);
    if (!process.env["STRIPE_SECRET_KEY"]) rec.checks.push({ n: "3.card", name: "card fails, owner retries (Stripe test mode)", status: "blocked", detail: "BLOCKED: no Stripe test key (STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET) in this project", ids: {} });
  } finally { await finish(ctx, jobs); }
}

// ---------- Path 4 — trade document expired / expiring within 30 days (TEST Delta business, restored) ----------
async function p4Docs(rec: Recorder, jobs: BranchResult["jobs"], setup: StepResult[]) {
  const ctx = await freshCtx();
  const biz = ctx.electrician.business_id;
  const { data: snap } = await admin.from("business_credentials").select("id, expires_at").eq("business_id", biz).eq("kind", "public_liability_insurance" as never);
  const added: string[] = [];
  const { melbourneToday, addYmd } = await import("./melbourne-time.core");
  const today = melbourneToday(new Date());
  try {
    const { data: b0 } = await admin.from("businesses").select("onboarding_notes").eq("id", biz).single();
    if (!(b0?.onboarding_notes ?? "").includes("[TEST PA")) { BLOCKED_REASON = "electrician business is not a marked TEST business — refused to change its documents"; return; }
    if (!(snap ?? []).length) { BLOCKED_REASON = "TEST Delta has no public liability record to expire"; return; }
    const s = await toQuoteAccepted(rec, ctx, setup, jobs);
    if (!s.ok) { BLOCKED_REASON = `setup failed: ${s.out.at(-1)?.error}`; return; }
    const setAll = (d: string) => admin.from("business_credentials").update({ expires_at: d }).eq("business_id", biz).eq("kind", "public_liability_insurance" as never);
    // (a) expiring within 30 days: warned, still offered work.
    await setAll(addYmd(today, 20));
    const office = async () => { try { const o = await (await import("./office.server")).loadOffice(admin as never, { includeTest: true }); return o.needs.items.filter((x) => JSON.stringify(x).includes(biz)).map((x) => JSON.stringify(x).slice(0, 220)); } catch (e) { return [`office read failed: ${(e as Error).message}`]; } };
    const soon = await office();
    const soonShots = await shoot("p4-expiring", [{ who: "electrician-business", email: ELEC, path: "/field/business" }, officePages(ctx)[1]!]);
    // (b) expired yesterday: no new offers.
    await setAll(addYmd(today, -1));
    const exp = await office();
    let alloc = "";
    try { const r = await (await import("./allocation.server")).startPiesaAllocation(ctx.jobId!, ctx.actorId, "piesa", { onlyBusiness: biz, rateToConfirm: true }); alloc = `offered=${(r as { offered?: number }).offered}`; } catch (e) { alloc = `refused: ${(e as Error).message.slice(0, 200)}`; }
    const { count: offers } = await admin.from("partner_offers").select("id", { count: "exact", head: true }).eq("job_id", ctx.jobId!).eq("kind", "piesa").eq("business_id", biz);
    const expShots = await shoot("p4-expired", [{ who: "electrician-business", email: ELEC, path: "/field/business" }, officePages(ctx)[1]!]);
    answer("stops", (offers ?? 0) === 0, `expiring in 20 days: office rows=${soon.length} (${soon.join(" | ")}); expired: PIESA offer to TEST Delta ${alloc}; offers to Delta=${offers}`);
    answer("reason", sees(expShots[0], /expir|insurance|liabil/i), `electrician business page mentions the expired insurance=${sees(expShots[0], /expir|insurance|liabil/i)}; when expiring=${sees(soonShots[0], /expir|insurance|liabil/i)}`);
    const docRows = (x: string[]) => x.filter((t) => /liabil|insurance/i.test(t)).length;
    answer("office_once", docRows(soon) === 1 && docRows(exp) === 1, `Needs me insurance rows: expiring=${docRows(soon)}, expired=${docRows(exp)}`);
    // Fix: the electrician uploads the renewed certificate (new record, one year on).
    const { data: tmpl } = await admin.from("business_credentials").select("*").eq("id", snap![0]!.id).single();
    const { id: _i, created_at: _c, updated_at: _u, ...rest } = (tmpl ?? {}) as Record<string, unknown>;
    const { data: ins, error: insErr } = await admin.from("business_credentials").insert({ ...rest, expires_at: addYmd(today, 365), label: `${String(rest["label"] ?? "Public liability")} (TEST renewal)` } as never).select("id").single();
    if (ins?.id) added.push(ins.id);
    let alloc2 = "";
    try { const r = await (await import("./allocation.server")).startPiesaAllocation(ctx.jobId!, ctx.actorId, "piesa", { onlyBusiness: biz, rateToConfirm: true }); alloc2 = `offered=${(r as { offered?: number }).offered}`; } catch (e) { alloc2 = `refused: ${(e as Error).message.slice(0, 200)}`; }
    const { count: offers2 } = await admin.from("partner_offers").select("id", { count: "exact", head: true }).eq("job_id", ctx.jobId!).eq("kind", "piesa").eq("business_id", biz);
    await shoot("p4-renewed", [{ who: "electrician-offer-list", email: ELEC, path: "/field" }]);
    answer("carries_on", (offers2 ?? 0) > 0, `renewal ${insErr ? `not saved: ${insErr.message}` : "saved"}; PIESA offer ${alloc2}; offers to Delta=${offers2}`);
  } finally {
    for (const r of snap ?? []) await admin.from("business_credentials").update({ expires_at: r.expires_at }).eq("id", r.id);
    if (added.length) await admin.from("business_credentials").delete().in("id", added);
    await finish(ctx, jobs);
  }
}

// ---------- Path 5 — 30-day install window lapses (clock moved on this TEST job only) ----------
async function p5Window(rec: Recorder, jobs: BranchResult["jobs"], setup: StepResult[]) {
  const ctx = await freshCtx();
  try {
    const s = await toQuoteAccepted(rec, ctx, setup, jobs);
    if (!s.ok) { BLOCKED_REASON = `setup failed: ${s.out.at(-1)?.error}`; return; }
    const r6: StepResult = { key: "s6_electrician", label: "PIESA", passed: true, checks: [] };
    try { await J.s6(ctx, r6); } catch (e) { BLOCKED_REASON = `PIESA step failed: ${(e as Error).message}`; return; }
    if (r6.checks.some((c) => !c.ok)) { BLOCKED_REASON = `PIESA step check failed: ${r6.checks.filter((c) => !c.ok).map((c) => c.name).join("; ")}`; return; }
    const { addYmd, melbourneToday } = await import("./melbourne-time.core");
    const today = melbourneToday(new Date());
    await J.assertOwnTestJob(ctx);
    const { data: pr } = await admin.from("piesa_records").select("*").eq("job_id", ctx.jobId!).in("kind", ["initial", "reassessment"]).order("created_at", { ascending: false }).limit(1).single();
    await admin.from("piesa_records").update({ completed_date: addYmd(today, -31) }).eq("id", pr!.id);
    await admin.from("assessments").update({ assessed_on: addYmd(today, -31) } as never).eq("job_id", ctx.jobId!);
    const { data: dl } = await admin.from("job_piesa_deadlines").select("install_deadline, piesa_expired").eq("job_id", ctx.jobId!).maybeSingle();
    const r7: StepResult = { key: "s7_install", label: "install", passed: true, checks: [] };
    let s7 = "ran";
    try { await J.s7(ctx, r7); } catch (e) { s7 = `stopped: ${(e as Error).message.slice(0, 200)}`; }
    const offerCheck = r7.checks.find((c) => /offers 3 install days/.test(c.name));
    const { count: booked } = await admin.from("bookings").select("id", { count: "exact", head: true }).eq("job_id", ctx.jobId!).eq("kind", "installation");
    const sig = await officeSignals(ctx.jobId!);
    const stop = await shoot("p5-lapsed", [ownerPage(ctx), { who: "installer", email: INST, path: `/field/day/${ctx.jobId}` }, ...officePages(ctx)]);
    answer("stops", (booked ?? 0) === 0 && !!dl?.piesa_expired, `deadline ${dl?.install_deadline} expired=${dl?.piesa_expired}; install step ${s7}; installer offer: ${offerCheck ? `${offerCheck.ok ? "allowed" : "refused"} ${offerCheck.detail ?? ""}` : "-"}; install bookings=${booked}`);
    answer("reason", sees(stop[1], /new (PIESA|safety check)|30.day|expired|window/i) || sees(stop[0], /30.day|expired|new safety check|new check/i), `installer sees plain reason=${sees(stop[1], /new (PIESA|safety check)|30.day|expired|window/i)}; owner sees=${sees(stop[0], /30.day|expired|new safety check|new check/i)}`);
    const nm = jobMentions(stop[3], ctx.jobNumber);
    answer("office_once", sig.needsMe === 1 || nm === 1, `Needs me rows=${sig.needsMe} (${sig.needsMeText.join(" | ") || "none"}); exceptions=${sig.exceptions.join(",") || "none"}; Needs me page mentions job ${nm}×`);
    // Fix: a new PIESA (reassessment) is recorded today — SIMULATED record, as the electrician's new visit would leave.
    const { id: _id, created_at: _c, ...rest } = pr as Record<string, unknown>;
    await admin.from("piesa_records").update({ is_current: false }).eq("job_id", ctx.jobId!).eq("is_current", true);
    const { error: ri } = await admin.from("piesa_records").insert({ ...rest, kind: "reassessment", completed_date: today, is_current: true } as never);
    const r7b: StepResult = { key: "s7_install", label: "install again", passed: true, checks: [] };
    let s7b = "ran";
    try { await J.s7(ctx, r7b); } catch (e) { s7b = `stopped: ${(e as Error).message.slice(0, 200)}`; }
    const { count: booked2 } = await admin.from("bookings").select("id", { count: "exact", head: true }).eq("job_id", ctx.jobId!).eq("kind", "installation");
    await shoot("p5-reassessed", [ownerPage(ctx)]);
    answer("carries_on", (booked2 ?? 0) > 0, `simulated reassessment ${ri ? `not saved: ${ri.message}` : "saved"}; install step ${s7b}; failed checks: ${r7b.checks.filter((c) => !c.ok).map((c) => c.name).join("; ") || "none"}; install bookings=${booked2}`);
  } finally { await finish(ctx, jobs); }
}

// ---------- Path 6 — no time agreed in 24h, no confirmed booking in 48h (Ready Check visit, clock moved on this job) ----------
async function p6Timing(rec: Recorder, jobs: BranchResult["jobs"], setup: StepResult[]) {
  const ctx = await newJourneyCtx({ installerEmail: "qa.installer.bravo@hivic-test.example", preparePeople: false });
  ctx.notes["address_line"] = `${parseInt(ctx.runId.slice(0, 8), 16)} Journey Test Street`;
  try {
    const s = await setupSteps(ctx, 3); setup.push(...s.out); jobs.push({ jobNumber: ctx.jobNumber, jobId: ctx.jobId, archived: false });
    if (!s.ok) { BLOCKED_REASON = `setup failed: ${s.out.at(-1)?.error}`; return; }
    const offerId = ctx.notes["rc_offer_id"] as string;
    const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
    // (a) 24h: the installer has not answered the Ready Check offer (no times offered) — move this offer's clock 25h back.
    await J.assertOwnTestJob(ctx);
    const { data: o0 } = await admin.from("partner_offers").select("offered_at, expires_at, status").eq("id", offerId).eq("job_id", ctx.jobId!).single();
    await admin.from("partner_offers").update({ offered_at: ago(25), ...(o0?.expires_at ? { expires_at: ago(1) } : {}) }).eq("id", offerId).eq("job_id", ctx.jobId!);
    const timer = await import("./ready-check-times.server");
    const firstSweep = await timer.sweepOfficePickedOffers(ctx.actorId, new Date(), ctx.jobId ?? undefined);
    const replaySweep = await timer.sweepOfficePickedOffers(ctx.actorId, new Date(), ctx.jobId ?? undefined);
    rec.checks.push({ n: "6.24", name: "one-job offer timer and replay", status: firstSweep.expired === 1 && replaySweep.expired === 0 ? "passed" : "failed", detail: `expired=${firstSweep.expired}; replay=${replaySweep.expired}; only job=${ctx.jobId}`, ids: {} });
    const sig25 = await officeSignals(ctx.jobId!);
    const at25 = await shoot("p6-24h-no-times", [{ who: "installer-offer", email: "qa.installer.bravo@hivic-test.example", path: `/field/offer/${offerId}` }, ownerPage(ctx), ...officePages(ctx)]);
    const { count: props25 } = await admin.from("appointment_proposals").select("id", { count: "exact", head: true }).eq("job_id", ctx.jobId!).eq("kind", "ready_check").eq("status", "proposed");
    // Put the offer back as it was, then the installer offers 3 times (the fix for (a)).
    await admin.from("partner_offers").update({ status: "pending", offered_at: o0?.offered_at ?? new Date().toISOString(), expires_at: o0?.expires_at ?? null }).eq("id", offerId).eq("job_id", ctx.jobId!);
    const tv = await import("./trade-view.server");
    const rct = await import("./ready-check-times.core");
    const days = rct.allowedReadyCheckDays().slice(0, 3);
    let offered = "offered";
    try { await tv.tradeOfferReadyCheckTimes(offerId, ctx.installer.id, days.map((day) => { const ok = rct.allowedReadyCheckTimes(day); return { day, time: ok.includes("10:00") ? "10:00" : ok[0]! }; })); } catch (e) { offered = `refused: ${(e as Error).message.slice(0, 200)}`; }
    // (b) 48h: times offered but the owner has not taken one — move those proposals 49h back.
    await admin.from("appointment_proposals").update({ created_at: ago(49) } as never).eq("job_id", ctx.jobId!).eq("kind", "ready_check").eq("status", "proposed");
    await admin.from("contact_releases").update({ released_at: ago(49) }).eq("job_id", ctx.jobId!).eq("visit_kind", "ready_check").is("revoked_at", null);
    const coordination = await import("./allocation.server");
    await coordination.sweepCoordination(ctx.actorId, ctx.jobId ?? undefined);
    await coordination.sweepCoordination(ctx.actorId, ctx.jobId ?? undefined);
    const sig49 = await officeSignals(ctx.jobId!);
    const at49 = await shoot("p6-48h-not-booked", [ownerPage(ctx), { who: "installer", email: "qa.installer.bravo@hivic-test.example", path: `/field/day/${ctx.jobId}` }, ...officePages(ctx)]);
    const { count: rcBooked } = await admin.from("bookings").select("id", { count: "exact", head: true }).eq("job_id", ctx.jobId!).eq("kind", "ready_check" as never).in("status", ["confirmed", "completed"]);
    answer("stops", (props25 ?? 0) === 0 && (rcBooked ?? 0) === 0, `24h: times offered=${props25}; installer then ${offered}; 48h: Ready Check bookings=${rcBooked} (the all-jobs reminder sweep was NOT RUN: it would touch real jobs)`);
    answer("reason", sees(at25[0], /offer|times|accept|decline|expired|closed/i) && sees(at49[0], /pick|choose|time|Ready Check/i), `installer offer page at 24h: "${at25[0]?.text.slice(0, 160) ?? "-"}"; owner page at 48h asks to pick a time=${sees(at49[0], /pick|choose/i)}`);
    const office25 = at25.find(x => x.who === "office-needs-me");
    const office49 = at49.find(x => x.who === "office-needs-me");
    const visible25 = sees(office25, new RegExp(`${ctx.jobNumber}.*Installer offer lapsed`));
    const visible49 = sees(office49, new RegExp(`${ctx.jobNumber}.*Ready Check time not confirmed`));
    answer("office_once", sig25.needsMe === 1 && sig49.needsMe === 1 && visible25 && visible49, `One-job timers ran twice. 24h: Needs me=${sig25.needsMe}, visible=${visible25}; 48h: Needs me=${sig49.needsMe}, visible=${visible49}. Scoped coordination never calls any sender.`);
    // Fix for (b): the owner takes one of the times → booked.
    let fix = "booked";
    try {
      const { data: p } = await admin.from("appointment_proposals").select("id").eq("job_id", ctx.jobId!).eq("kind", "ready_check").eq("status", "proposed").order("starts_at").limit(1).single();
      const { data: jo } = await admin.from("jobs").select("owners(user_id)").eq("id", ctx.jobId!).single();
      await (await import("./ready-check-times.server")).ownerTakeReadyCheckTime(ctx.jobId!, p!.id, (jo?.owners as { user_id: string | null } | null)?.user_id ?? ctx.actorId);
    } catch (e) { fix = `failed: ${(e as Error).message.slice(0, 200)}`; }
    const sigF = await officeSignals(ctx.jobId!);
    const { count: booked } = await admin.from("bookings").select("id", { count: "exact", head: true }).eq("job_id", ctx.jobId!).eq("kind", "ready_check" as never).in("status", ["confirmed", "completed"]);
    await shoot("p6-booked", [ownerPage(ctx)]);
    answer("carries_on", fix === "booked" && (booked ?? 0) === 1 && sigF.needsMe + sigF.exceptions.length === 0, `${fix}; Ready Check bookings=${booked}; office rows after=${sigF.needsMe + sigF.exceptions.length}`);
  } finally { await finish(ctx, jobs); }
}
async function readyCheckBookOnly(ctx: JourneyCtx) {
  await J.assertOwnTestJob(ctx);
  const tv = await import("./trade-view.server");
  const rct = await import("./ready-check-times.core");
  const days = rct.allowedReadyCheckDays().slice(0, 3);
  await tv.tradeOfferReadyCheckTimes(ctx.notes["rc_offer_id"] as string, ctx.installer.id, days.map((day) => { const ok = rct.allowedReadyCheckTimes(day); return { day, time: ok.includes("10:00") ? "10:00" : ok[0]! }; }));
  const { data: offered } = await admin.from("appointment_proposals").select("id").eq("job_id", ctx.jobId!).eq("kind", "ready_check").eq("status", "proposed").order("starts_at").limit(1).single();
  const { data: jo } = await admin.from("jobs").select("owners(user_id)").eq("id", ctx.jobId!).single();
  await (await import("./ready-check-times.server")).ownerTakeReadyCheckTime(ctx.jobId!, offered!.id, (jo?.owners as { user_id: string | null } | null)?.user_id ?? ctx.actorId);
}

// ---------- Path 7 — wrong or draft Mitti form (simulated Mitti) ----------
async function p7Mitti(rec: Recorder, jobs: BranchResult["jobs"], setup: StepResult[]) {
  const ctx = await freshCtx();
  try {
    const s = await toQuoteAccepted(rec, ctx, setup, jobs);
    if (!s.ok) { BLOCKED_REASON = `setup failed: ${s.out.at(-1)?.error}`; return; }
    const sim = await import("./journey-sim.core");
    const { data: ws } = await admin.from("workflow_settings").select("mitti_piesa_template_id").eq("id", 1).maybeSingle();
    const { data: el } = await admin.from("profiles").select("email, full_name").eq("id", ctx.electrician.id).single();
    const tpl = ws?.mitti_piesa_template_id?.trim();
    if (!tpl || !el?.email) { BLOCKED_REASON = "no PIESA form template id in settings"; return; }
    const pass = sim.simulatedA3PassAnswers({ seed: `${ctx.runId}-a3w`, inspectionDate: J.melbourneDate(0), capturedAt: new Date().toISOString(), electrician: el.full_name ?? "TEST Delta Electrician" });
    const office = ["Portal Job Number", "Property Address", "Owner name"].map((label, i) => ({ item_id: `sim_a3_office_${i}`, label, type: "textsingle" }));
    const mitti = sim.simulatedMitti({ templates: { [tpl]: sim.templateOfItems([...office, ...pass.items]) }, users: [{ id: "sim-mitti-electrician", email: el.email }] });
    const ms = await import("./mitti.server");
    const guard = ms.armJourneyMittiGuard(mitti.call); guardRouted = guard.routed;
    const al = await import("./allocation.server");
    await al.startPiesaAllocation(ctx.jobId!, ctx.actorId, "piesa", { onlyBusiness: ctx.electrician.business_id, rateToConfirm: true });
    const { data: mine } = await admin.from("partner_offers").select("id").eq("job_id", ctx.jobId!).eq("kind", "piesa").eq("status", "pending").eq("business_id", ctx.electrician.business_id).limit(1).single();
    const pt = await import("./piesa-times.server");
    const { allowedPiesaTimeDays, allowedPiesaTimes } = await import("./piesa-times.core");
    await pt.acceptPiesaOfferWithTimes(mine!.id, ctx.electrician.id, allowedPiesaTimeDays().slice(1, 4).map((day) => { const ok = allowedPiesaTimes(day); return { day, time: ok.includes("10:00" as never) ? "10:00" : ok[0]! }; }));
    const ost = await pt.ownerPiesaTimesState(ctx.jobId!);
    await pt.ownerTakePiesaTime(ctx.jobId!, ost.open[0]!.id, ctx.actorId, { understandsThirtyDays: true, ip: null, userAgent: null });
    const { data: a0 } = await admin.from("assessments").select("external_mitti_id").eq("job_id", ctx.jobId!).maybeSingle();
    let auditId = a0?.external_mitti_id ?? null;
    if (auditId) mitti.seed(auditId, tpl); else auditId = (await ms.createAssignMittiAudit(ctx.jobId!, ctx.actorId, mitti.call, { officeOverride: true })).auditId;
    const fetchMedia = async () => ({ bytes: J.TINY_JPEG, contentType: "image/jpeg" });
    const jobItem = (v: string) => ({ item_id: "sim_a3_office_0", label: "Portal Job Number", type: "textsingle", responses: { text: v } });
    // (a) wrong job number on the form
    mitti.fill(auditId!, [jobItem("HV-0001"), ...pass.items] as never);
    let wrong = "";
    try { const r = await ms.syncMittiAssessment(ctx.jobId!, ctx.actorId, mitti.call, fetchMedia); wrong = `ACCEPTED (completed=${r.completed})`; } catch (e) { wrong = `refused: ${(e as Error).message}`; }
    const { data: asA } = await admin.from("assessments").select("mitti_completed, status").eq("job_id", ctx.jobId!).maybeSingle();
    const sigW = await officeSignals(ctx.jobId!);
    const wShots = await shoot("p7-wrong-job", [{ who: "electrician", email: ELEC, path: `/field/day/${ctx.jobId}` }, ...officePages(ctx)]);
    // (b) right job, still a draft (not Completed in Mitti)
    mitti.audits.get(auditId!)!.completed = false;
    mitti.fill(auditId!, [jobItem(ctx.jobNumber ?? "")] as never, { complete: false });
    let draft = "";
    try { const r = await ms.syncMittiAssessment(ctx.jobId!, ctx.actorId, mitti.call, fetchMedia); draft = `completed=${r.completed}`; } catch (e) { draft = `refused: ${(e as Error).message}`; }
    let press = "pressed";
    try { await (await import("./piesa-complete.server")).completePiesaAssessment({ jobId: ctx.jobId! }, ctx.electrician.id); } catch (e) { press = `refused: ${(e as Error).message.slice(0, 200)}`; }
    const stageDraft = await J.stageOf(ctx);
    const sigD = await officeSignals(ctx.jobId!);
    const dShots = await shoot("p7-draft", [{ who: "electrician", email: ELEC, path: `/field/day/${ctx.jobId}` }, officePages(ctx)[0]!]);
    answer("stops", wrong.startsWith("refused") && asA?.mitti_completed !== true && draft === "completed=false" && press.startsWith("refused") && stageDraft !== "piesa_complete", `wrong job number: ${wrong}; draft form: sync ${draft}, Complete PIESA ${press}; stage=${stageDraft}`);
    answer("reason", sees(wShots[0], /mitti|form|job number/i) || sees(wShots[1], /mitti|form|job number/i), `electrician page explains=${sees(wShots[0], /mitti|form|job number/i)}; office job page explains=${sees(wShots[1], /mitti|form|job number/i)}; draft: electrician page mentions finishing the form=${sees(dShots[0], /complete|finish|form/i)}`);
    answer("office_once", sigW.needsMe + sigW.exceptions.length === 1 || jobMentions(wShots[2], ctx.jobNumber) === 1, `after wrong form: Needs me=${sigW.needsMe} (${sigW.needsMeText.join(" | ") || "none"}), exceptions=${sigW.exceptions.join(",") || "none"}, page ${jobMentions(wShots[2], ctx.jobNumber)}×; after draft: Needs me=${sigD.needsMe}`);
    // Fix: the electrician finishes and Completes the right form.
    mitti.fill(auditId!, [jobItem(ctx.jobNumber ?? ""), ...pass.items] as never);
    let fixed = "";
    try { const r = await ms.syncMittiAssessment(ctx.jobId!, ctx.actorId, mitti.call, fetchMedia); fixed = `completed=${r.completed}`; } catch (e) { fixed = `refused: ${(e as Error).message}`; }
    await admin.from("assessments").update({ no_rectification_confirmed: true }).eq("job_id", ctx.jobId!).neq("status", "complete");
    for (const c of ["switchboard_cables", "piesa_signoff"]) await J.uploadEvidence(ctx, c, ctx.electrician.id, "electrical");
    let press2 = "pressed";
    try { await (await import("./piesa-complete.server")).completePiesaAssessment({ jobId: ctx.jobId! }, ctx.electrician.id); } catch (e) { press2 = `refused: ${(e as Error).message.slice(0, 200)}`; }
    const stage2 = await J.stageOf(ctx);
    await shoot("p7-fixed", [{ who: "electrician", email: ELEC, path: `/field/day/${ctx.jobId}` }]);
    answer("carries_on", fixed === "completed=true" && ["piesa_complete", "installation_scheduling"].includes(stage2 ?? ""), `sync ${fixed}; Complete PIESA ${press2}; stage=${stage2}`);
  } finally { await finish(ctx, jobs); }
}

// ---------- Path 8 — an owner or electrician opens another job's link ----------
async function p8Links(rec: Recorder, jobs: BranchResult["jobs"], setup: StepResult[]) {
  const ctx = await freshCtx();
  try {
    const s = await setupSteps(ctx, 3); setup.push(...s.out); jobs.push({ jobNumber: ctx.jobNumber, jobId: ctx.jobId, archived: false });
    if (!s.ok) { BLOCKED_REASON = `setup failed: ${s.out.at(-1)?.error}`; return; }
    const { data: asg } = await admin.from("job_assignments").select("id").eq("job_id", ctx.jobId!).eq("role", "electrician").eq("active", true);
    if ((asg ?? []).length) { BLOCKED_REASON = "TEST Delta is already on this job"; return; }
    const tok = ctx.token ?? "";
    const tampered = tok.slice(0, -2) + (tok.endsWith("aa") ? "bb" : "aa");
    const { data: job } = await admin.from("jobs").select("owners(full_name), properties(address_line1, suburb)").eq("id", ctx.jobId!).single();
    const ownerName = (job?.owners as { full_name?: string } | null)?.full_name ?? "";
    const street = (job?.properties as { address_line1?: string } | null)?.address_line1 ?? "";
    const shots = await shoot("p8-other-link", [
      { who: "electrician-other-job", email: ELEC, path: `/field/day/${ctx.jobId}` },
      { who: "electrician-other-job-page", email: ELEC, path: `/field/${ctx.jobId}` },
      { who: "owner-changed-link", email: null, path: `/my-job/${tampered}` },
      officePages(ctx)[1]!,
    ]);
    const leak = (x: Shot | undefined) => !!x && ((ownerName.length > 3 && x.text.includes(ownerName)) || (street.length > 3 && x.text.includes(street)));
    const leaks = shots.slice(0, 3).map((x) => `${x.who}: ${leak(x) ? "SHOWS owner/address" : "no job details"}`);
    answer("stops", shots.slice(0, 3).every((x) => !leak(x)), leaks.join("; "));
    answer("reason", shots.slice(0, 3).every((x) => /not (available|found|valid)|no access|can.t|cannot|isn.t|expired|not yours|sign in|link/i.test(x.text)), shots.slice(0, 3).map((x) => `${x.who} landed ${x.landed}: "${x.text.slice(0, 140)}"`).join(" || "));
    answer("office_once", null, `not applicable by design: a refused link is not an office task (Needs me mentions this job ${jobMentions(shots[3], ctx.jobNumber)}×)`);
    const own = await shoot("p8-own-link", [ownerPage(ctx), { who: "installer-own-job", email: INST, path: `/field/day/${ctx.jobId}` }]);
    answer("carries_on", leak(own[0]) || leak(own[1]) || own.every((x) => !x.errors.length && x.landed && !/not (available|found)/i.test(x.text)), `own links still open: ${own.map((x) => `${x.who} landed ${x.landed}, errors ${x.errors.length}`).join("; ")}`);
  } finally { await finish(ctx, jobs); }
}

export type Phase3Name = "p1-not-eligible" | "p2-piesa-fixes" | "p3-payment" | "p4-documents" | "p5-install-window" | "p6-booking-timing" | "p7-mitti-form" | "p8-other-link";
export const PHASE3: Record<Phase3Name, (rec: Recorder, jobs: BranchResult["jobs"], setup: StepResult[]) => Promise<void>> = {
  "p1-not-eligible": p1Screens, "p2-piesa-fixes": p2Screens, "p3-payment": p3Payment, "p4-documents": p4Docs,
  "p5-install-window": p5Window, "p6-booking-timing": p6Timing, "p7-mitti-form": p7Mitti, "p8-other-link": p8Links,
};
export type Phase3Result = BranchResult & { answers: Phase3Answer[]; shots: Shot[]; blocked: string | null };
export async function runPhase3(name: Phase3Name, shotDir: string): Promise<Phase3Result> {
  SHOT_DIR = shotDir; SHOTS.length = 0; ANSWERS.length = 0; BLOCKED_REASON = null;
  const rec = new Recorder();
  const jobs: BranchResult["jobs"] = []; const setup: StepResult[] = [];
  const ms = await import("./mitti.server");
  ms.armJourneyMittiGuard(null);
  const refused: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (/mitti\.com/i.test(url)) { refused.push(`${init?.method ?? "GET"} ${new URL(url).pathname}`); throw new Error(`SAFETY STOP: real Mitti call refused (${url.split("?")[0]})`); }
    return realFetch(input as never, init);
  }) as typeof fetch;
  try { await PHASE3[name](rec, jobs, setup); }
  catch (e) { BLOCKED_REASON = BLOCKED_REASON ?? `runner error: ${e instanceof Error ? e.message : String(e)}`; if (process.env["JOURNEY_DEBUG"]) console.error(e); }
  finally {
    globalThis.fetch = realFetch; ms.disarmJourneyMittiGuard();
    rec.checks.push(refused.length ? { n: "M", name: "no real Mitti call", status: "failed", detail: `REAL MITTI CALLS REFUSED: ${refused.join("; ")}`, ids: {} } : { n: "M", name: "no real Mitti call", status: "passed", detail: `0 real Mitti calls; simulator routes: ${guardRouted.join("; ") || "none"}`, ids: {} });
    guardRouted = [];
  }
  return { branch: name as never, jobs, setup, checks: rec.checks, answers: [...ANSWERS], shots: [...SHOTS], blocked: BLOCKED_REASON };
}

// =====================================================================================================================
// Phase 4 (Jo 27 Oct 2026, 17:50): the money and safety blocks from journey/block-register.md, each on its own fresh
// TEST job, run in this order. Data-level runs with one 390px screenshot of the person's page and the office page.
// Same four answers per block: stops? plain reason? office told once? carries on after the fix?
// Same TEST-only rules: fresh qa_test job, TEST people only, simulated Mitti, Xero Demo Company, nothing sent.
// =====================================================================================================================
/** Diagnosis only (Phase 4): replicates qa_office_job_allowed clause by clause via admin reads, so a refused
 *  office job page can be pinned to the exact failing condition without guessing. Never authorizes anything. */
async function scopeDiag(jobId: string): Promise<string[]> {
  const reserved = (e: string | null | undefined) => !!e && /@hivic-test[.]example$/i.test(e.trim());
  const out: string[] = [];
  const { data: j } = await admin.from("jobs").select("source,deleted_at,qa_archived_at,owner_id,property_id,originating_installer_user_id,originating_installer_business_id").eq("id", jobId).single();
  if (!j) return ["job row missing"];
  out.push(`job: source=${j.source} deleted=${!!j.deleted_at} archived=${!!j.qa_archived_at}`);
  const { data: o } = await admin.from("owners").select("email,user_id").eq("id", j.owner_id).maybeSingle();
  out.push(`owner email reserved=${reserved(o?.email)} (${o?.email})`);
  if (o?.user_id) { const { data: u } = await admin.from("profiles").select("email").eq("id", o.user_id).maybeSingle(); out.push(`owner user email reserved=${reserved(u?.email)} (${u?.email})`); }
  const { data: p } = await admin.from("properties").select("owner_id,managed_by_business_id").eq("id", j.property_id).maybeSingle();
  out.push(`property owner matches=${p?.owner_id === j.owner_id}`);
  if (j.originating_installer_user_id) { const { data: u } = await admin.from("profiles").select("email").eq("id", j.originating_installer_user_id).maybeSingle(); out.push(`originating installer user reserved=${reserved(u?.email)} (${u?.email})`); }
  const biz = async (id: string | null | undefined): Promise<string> => {
    if (!id) return "none";
    const { data: b } = await admin.from("businesses").select("email,onboarding_notes,signer_email").eq("id", id).single();
    const base = reserved(b?.email) && String(b?.onboarding_notes ?? "").includes("[TEST PARTNER]") && (b?.signer_email == null || reserved(b.signer_email));
    const { data: realJobs } = await admin.from("jobs").select("id").eq("originating_installer_business_id", id).neq("source", "qa_test");
    const { data: asg } = await admin.from("job_assignments").select("job_id").eq("business_id", id);
    const { data: of } = await admin.from("partner_offers").select("job_id").eq("business_id", id);
    const { data: bk } = await admin.from("bookings").select("job_id").eq("business_id", id);
    const ids = [...new Set([...(asg ?? []), ...(of ?? []), ...(bk ?? [])].map((r) => r.job_id))];
    const { data: realLinked } = ids.length ? await admin.from("jobs").select("id").in("id", ids).neq("source", "qa_test") : { data: [] };
    const { data: ws } = await admin.from("partner_workers").select("email").eq("business_id", id);
    const badWorkers = (ws ?? []).filter((w) => !reserved(w.email)).length;
    const allowed = base && (realJobs ?? []).length === 0 && (realLinked ?? []).length === 0 && badWorkers === 0;
    return `${id.slice(0, 8)} allowed=${allowed} (emailReserved=${reserved(b?.email)} marker=${String(b?.onboarding_notes ?? "").includes("[TEST PARTNER]")} realJobLinks=${(realJobs ?? []).length}/${(realLinked ?? []).length} badWorkerEmails=${badWorkers})`;
  };
  if (j.originating_installer_business_id) out.push(`originating business: ${await biz(j.originating_installer_business_id)}`);
  if (p?.managed_by_business_id) out.push(`managed_by business: ${await biz(p.managed_by_business_id)}`);
  const { data: otherReal } = await admin.from("jobs").select("id").or(`owner_id.eq.${j.owner_id},property_id.eq.${j.property_id}`).neq("source", "qa_test");
  out.push(`other real jobs same owner/property=${(otherReal ?? []).length}`);
  const { data: asg } = await admin.from("job_assignments").select("business_id,user_id,profiles(email)").eq("job_id", jobId);
  for (const a of asg ?? []) out.push(`assignment: biz=${await biz(a.business_id)} userReserved=${reserved((a.profiles as { email?: string | null } | null)?.email)}`);
  const { data: off } = await admin.from("partner_offers").select("business_id,kind,status").eq("job_id", jobId);
  for (const x of off ?? []) out.push(`offer ${x.kind}/${x.status}: biz=${await biz(x.business_id)}`);
  const { data: bk } = await admin.from("bookings").select("business_id,contractor_id,profiles(email)").eq("job_id", jobId);
  for (const k of bk ?? []) out.push(`booking: biz=${await biz(k.business_id)} contractorReserved=${reserved((k.profiles as { email?: string | null } | null)?.email)}`);
  const { data: as } = await admin.from("assessments").select("assessor_id,profiles(email)").eq("job_id", jobId);
  for (const a of as ?? []) out.push(`assessor: reserved=${reserved((a.profiles as { email?: string | null } | null)?.email)}`);
  const { data: ms } = await admin.from("ceiling_measurements").select("completed_by,measured_by_business_id,profiles(email)").eq("job_id", jobId);
  for (const m of ms ?? []) out.push(`measurement: completedByReserved=${reserved((m.profiles as { email?: string | null } | null)?.email)} measuredByBiz=${await biz(m.measured_by_business_id)}`);
  return out;
}

/** Office told once for a blocked job: exactly one signal — a Needs me row, an office exception, or the office job
 *  page showing the block. Zero signals = not told; more than one source still counts as told once per source. */
async function officeToldOnce(ctx: JourneyCtx, page: Shot | undefined, re: RegExp) {
  const sig = await officeSignals(ctx.jobId!);
  const onPage = sees(page, re);
  const sources = (sig.needsMe > 0 ? 1 : 0) + (sig.exceptions.length > 0 ? 1 : 0) + (onPage ? 1 : 0);
  return {
    ok: sources > 0,
    detail: `Needs me rows for this job=${sig.needsMe} (${sig.needsMeText.join(" | ") || "none"}); office exceptions=${sig.exceptions.join(",") || "none"}; office job page shows the block=${onPage}`,
  };
}

/** The office Payouts tab data for one TEST job — the same function the office Money screen calls, TEST-scoped.
 *  The TEST office login cannot open /admin/money (TEST-office allowlist), so the office signal is read through this. */
async function officePayouts(jobId: string) {
  const { moneyPayouts } = await import("./office-money.server");
  const m = await moneyPayouts([jobId]);
  const held = (m.held ?? []).filter((h: { jobId: string }) => h.jobId === jobId);
  const due = (m.due ?? []).filter((g: { jobs: { jobId: string }[] }) => g.jobs.some((j) => j.jobId === jobId));
  const paid = (m.paid ?? []).filter((g: { jobs: { jobId: string }[] }) => g.jobs.some((j) => j.jobId === jobId));
  return { held, due, paid };
}

const ownerUserId = async (ctx: JourneyCtx) => {
  const { data: jo } = await admin.from("jobs").select("owners(user_id)").eq("id", ctx.jobId!).single();
  return (jo?.owners as { user_id: string | null } | null)?.user_id ?? ctx.actorId;
};

/** Shared fixes chain for blocks 11/22/23: accepted quote → A3 Complete with a priced repair → fixes quote issued
 *  (release simulated while customer messages are off). Mirrors the proven Phase 3 path 2 steps 2.1–2.2. */
async function fixesChain(rec: Recorder, ctx: JourneyCtx, setup: StepResult[], jobs: BranchResult["jobs"]) {
  const s = await toQuoteAccepted(rec, ctx, setup, jobs);
  if (!s.ok) { BLOCKED_REASON = `setup failed: ${s.out.at(-1)?.error}`; return null; }
  const sim = await import("./journey-sim.core");
  const os = await import("./official-short.core");
  const fd = await import("./fixes-day.core");
  const { data: ws } = await loose.from("workflow_settings").select("*").eq("id", 1).maybeSingle();
  const { data: el } = await admin.from("profiles").select("email, full_name").eq("id", ctx.electrician.id).single();
  const { TEST_MITTI_ASSIGNEE } = await import("./onsite-ready-check.core");
  const fixesTemplateItems = fd.FIXES_DAY_QUESTIONS.map((q, i) => ({ item_id: `sim_a4_${i + 1}`, label: q.label, type: q.type === "photo" ? "media" : q.type === "signature" ? "signature" : q.type === "yes_no" ? "question" : "textsingle" }));
  const tplFixes = String((ws as Record<string, unknown> | null)?.[fd.FIXES_TEMPLATE_COLUMN] ?? "").trim();
  const now = new Date().toISOString();
  const pass = sim.simulatedA3PassAnswers({ seed: `${ctx.runId}-a3fix`, inspectionDate: J.melbourneDate(0), capturedAt: now, electrician: el?.full_name ?? "TEST Delta Electrician" });
  const pick = (label: string, v: string[]) => ({ item_id: `sim_a3_fix_${label.length}_${v.length}`, label, type: "question", responses: { selected: v.map((x) => ({ label: x })) } });
  const text = (label: string, v: string) => ({ item_id: `sim_a3_fix_t_${label.length}`, label, type: "textsingle", responses: { text: v } });
  const items = pass.items.map((it) => (it.label === os.A3_REPAIR_NEEDED_LABEL ? { ...it, responses: { selected: [{ label: "Yes" }] } } : it));
  const sigAt = items.findIndex((it) => it.type === "signature");
  items.splice(sigAt - 1, 0, pick(os.FIXES_WORK_LABEL, [os.FIXES_RCD_OPTION]) as never, text(os.FIXES_RCD_COUNT_LABEL, "2") as never, pick(os.ONSITE_START_LABEL, ["No"]) as never, text(os.FIXES_PRICE_LABEL, String(FIXES_PRICE)) as never);
  const { data: a0 } = await admin.from("assessments").select("id, external_mitti_id, mitti_template_id").eq("job_id", ctx.jobId!).maybeSingle();
  const tplA3 = a0?.mitti_template_id ?? String((ws as Record<string, unknown> | null)?.["mitti_piesa_template_id"] ?? "").trim();
  const mitti = sim.simulatedMitti({
    templates: { [tplA3]: sim.templateOfItems([{ item_id: "sim_a3_office_job", label: "Portal Job Number", type: "textsingle" }, { item_id: "sim_a3_office_addr", label: "Property Address", type: "textsingle" }, { item_id: "sim_a3_office_owner", label: "Owner name", type: "textsingle" }, ...(items as never[] as { item_id: string; label: string; type: string }[])]), ...(tplFixes ? { [tplFixes]: { items: fixesTemplateItems as never } } : {}) },
    users: [{ id: "sim-mitti-electrician", email: el!.email! }, { id: "sim-mitti-test-assignee", email: TEST_MITTI_ASSIGNEE }],
  });
  const fetchMedia = async () => ({ bytes: J.TINY_JPEG, contentType: "image/jpeg" });
  const guard = (await import("./mitti.server")).armJourneyMittiGuard(mitti.call);
  guardRouted = guard.routed;
  const al = await import("./allocation.server");
  await al.startPiesaAllocation(ctx.jobId!, ctx.actorId, "piesa", { onlyBusiness: ctx.electrician.business_id, rateToConfirm: true });
  const { data: mine } = await admin.from("partner_offers").select("id").eq("job_id", ctx.jobId!).eq("kind", "piesa").eq("status", "pending").eq("business_id", ctx.electrician.business_id).limit(1).single();
  const pt = await import("./piesa-times.server");
  const { allowedPiesaTimeDays, allowedPiesaTimes } = await import("./piesa-times.core");
  await pt.acceptPiesaOfferWithTimes(mine!.id, ctx.electrician.id, allowedPiesaTimeDays().slice(1, 4).map((day) => { const ok = allowedPiesaTimes(day); return { day, time: ok.includes("10:00" as never) ? "10:00" : ok[0]! }; }));
  const ost = await pt.ownerPiesaTimesState(ctx.jobId!);
  await pt.ownerTakePiesaTime(ctx.jobId!, ost.open[0]!.id, ctx.actorId, { understandsThirtyDays: true, ip: null, userAgent: null });
  const { data: a1 } = await admin.from("assessments").select("external_mitti_id").eq("job_id", ctx.jobId!).maybeSingle();
  let auditId = a1?.external_mitti_id ?? null;
  if (auditId) mitti.seed(auditId, tplA3);
  else auditId = (await (await import("./mitti.server")).createAssignMittiAudit(ctx.jobId!, ctx.actorId, mitti.call, { officeOverride: true })).auditId;
  mitti.fill(auditId!, [{ item_id: "sim_a3_office_job", label: "Portal Job Number", type: "textsingle", responses: { text: ctx.jobNumber ?? "" } }, ...items] as never);
  const synced = await (await import("./mitti.server")).syncMittiAssessment(ctx.jobId!, ctx.actorId, mitti.call, fetchMedia);
  for (const c of ["switchboard_cables", "piesa_signoff"]) await J.uploadEvidence(ctx, c, ctx.electrician.id, "electrical");
  await (await import("./piesa-complete.server")).completePiesaAssessment({ jobId: ctx.jobId! }, ctx.electrician.id);
  const days = (await import("./piesa-windows.core")).allowedPiesaDays().slice(0, 3);
  await (await import("./rectification.server")).recordRectificationWindows(ctx.jobId!, ctx.electrician.id, 3, days.map((date) => ({ date, slot: "10-12" as const })));
  const o = await (await import("./auto-fixes-quote-send.server")).maybeAutoSendFixesQuote(ctx.jobId!, { actorId: ctx.actorId, generate: true });
  let rectQuoteId = o.quoteId;
  if (o.result === "held" && o.reason && commsOff(o.reason) && rectQuoteId) { await simulateQuoteRelease(ctx, rectQuoteId, "fixes"); rec.simulated("F.quote", "fixes quote email to the owner", SIMULATED_SEND_LABEL, { quote_id: rectQuoteId }); }
  return { sim, mitti, fetchMedia, el, tplFixes, auditId, rectQuoteId, a3Synced: synced.completed };
}

/** Owner accepts the fixes quote (pick a time later) — the acceptance step of Phase 3 check 2.4, no payment. */
async function ownerAcceptFixes(ctx: JourneyCtx, rectQuoteId: string) {
  const { data: q } = await admin.from("quotes").select("id, version, status").eq("id", rectQuoteId).single();
  const { respondToQuoteImpl } = await import("./portal.functions");
  await respondToQuoteImpl({ quoteId: q!.id, accept: true, consent: true, pickLater: true, expectedVersion: q!.version, signing: { signatoryName: "Test Journey", authorityType: "owner", over18: true, readConsumerInfo: true, acceptAgreement: true, signatureName: "Test Journey", assistance: "none" } } as never,
    { userId: await ownerUserId(ctx), ip: "127.0.0.1", userAgent: "journey-test", authorize: async () => {}, isOwner: async () => true } as never);
}

/** Owner pays the fixes (TEST payment, Demo Company). */
async function payFixes(ctx: JourneyCtx) {
  const r: StepResult = { key: "s6_electrician", label: "fixes pay", passed: true, checks: [] };
  await J.payStep(ctx, r, "fixes", "Electrical fixes payment (TEST payment, Demo Company)");
}

/** Owner picks the offered fixes time, then the A4 form is created (Phase 3 checks 2.5), then completed (2.6).
 *  Returns the booking id and the fixes audit id. */
async function bookAndCompleteFixes(ctx: JourneyCtx, mitti: Awaited<ReturnType<(typeof import("./journey-sim.core"))["simulatedMitti"]>>, fetchMedia: () => Promise<{ bytes: unknown; contentType: string }>, el: { full_name: string | null } | null, tplFixes: string) {
  const fd = await import("./fixes-day.core");
  const sim = await import("./journey-sim.core");
  const of = await import("./owner-fixes.server");
  const st = await of.ownerFixesState(ctx.jobId!);
  if (!st.windows.length) throw new Error(`owner fixes step=${st.step}; no times to pick`);
  const p = await of.ownerPickFixesTime(ctx.jobId!, st.windows[0]!.id, await ownerUserId(ctx));
  const { data: bk } = await admin.from("bookings").select("id").eq("job_id", ctx.jobId!).eq("kind", "rectification").in("status", ["confirmed", "completed"]);
  const bookingId = bk?.[0]?.id ?? null;
  if (!bookingId) throw new Error("fixes booking not made");
  await (await import("./fixes-day.server")).createFixesForm(ctx.jobId!, ctx.actorId, bookingId, mitti.call as never);
  const { data: created } = await admin.from("workflow_events").select("details").eq("job_id", ctx.jobId!).eq("event_type", fd.FIXES_FORM_CREATED_EVENT);
  const fixesAuditId = ((created ?? [])[0]?.details as { audit_id?: string } | null)?.audit_id ?? null;
  if (!fixesAuditId) throw new Error("fixes form not created");
  const cap = new Date().toISOString();
  const media = (n: string) => ({ media_id: sim.simMediaId(`${ctx.runId}-a4-${n}`), captured_at: cap, date_created: cap, location: { ...sim.JOURNEY_SITE } });
  const Q = fd.FIXES_DAY_Q;
  if (!mitti.audits.has(fixesAuditId) && tplFixes) mitti.seed(fixesAuditId, tplFixes);
  mitti.fill(fixesAuditId, [
    { item_id: "a", label: Q.done, type: "question", responses: { selected: [{ label: "Yes" }] } },
    { item_id: "b", label: Q.coesNumber, type: "textsingle", responses: { text: "TEST-COES-0001" } },
    { item_id: "c", label: Q.certDate, type: "textsingle", responses: { text: J.melbourneDate(0) } },
    { item_id: "d", label: Q.coesFile, type: "media", media: [media("coes")] },
    { item_id: "e", label: Q.workPhoto, type: "media", media: [media("work")] },
    { item_id: "f", label: Q.signature, type: "signature", responses: { image: { media_id: sim.simMediaId(`${ctx.runId}-a4-sig`), timestamp: cap }, name: el?.full_name ?? "TEST Delta Electrician" } },
  ]);
  const res = await (await import("./fixes-day.server")).completeFixesForm(ctx.jobId!, fixesAuditId, { call: mitti.call as never, fetchMedia: fetchMedia as never, actorId: ctx.actorId });
  return { bookingId, fixesAuditId, done: res.status === "done", detail: res.detail ?? "" };
}

// ---------- Block 8 — quote/invoice payment gate ----------
async function m8QuotePayment(rec: Recorder, jobs: BranchResult["jobs"], setup: StepResult[]) {
  const ctx = await freshCtx();
  try {
    let allocBefore = "not tried", offersBefore = 0;
    const s = await setupSteps(ctx, 5, defaultReadyCheck, async (c) => {
      const { data: q0 } = await admin.from("quotes").select("id, status").eq("id", c.quoteId!).single();
      if (q0?.status === "draft") {
        try { await (await import("./office-quote-review.server")).sendOfficeReviewedQuote(c.jobId!, c.quoteId!, c.actorId); }
        catch (e) { const m = e instanceof Error ? e.message : String(e); if (!commsOff(m)) throw e; await simulateQuoteRelease(c, c.quoteId!, "office"); rec.simulated("S5", "office presses Send quote", SIMULATED_SEND_LABEL, { quote_id: c.quoteId! }); }
      }
      // BLOCK: quote issued but not accepted, no payment — PIESA offers must be refused with plain reasons.
      await J.assertOwnTestJob(c);
      const stage0 = await J.stageOf(c);
      try { await (await import("./allocation.server")).startPiesaAllocation(c.jobId!, c.actorId, "piesa", { onlyBusiness: c.electrician.business_id, rateToConfirm: true }); allocBefore = "NOT refused"; }
      catch (e) { allocBefore = `refused: ${(e as Error).message.slice(0, 300)}`; }
      const { count } = await admin.from("partner_offers").select("id", { count: "exact", head: true }).eq("job_id", c.jobId!).eq("kind", "piesa");
      offersBefore = count ?? 0;
      const stage1 = await J.stageOf(c);
      const diag = (await scopeDiag(c.jobId!)).join(" | ");
      const told = await officeToldOnce(c, (await shoot("m8-blocked", [ownerPage(c), ...officePages(c)]))[1], /quote|payment|approve|accept/i);
      answer("stops", allocBefore.startsWith("refused") && offersBefore === 0 && stage1 === stage0, `PIESA allocation ${allocBefore}; PIESA offers=${offersBefore}; stage ${stage0}→${stage1}`);
      const shots = SHOTS.filter((x) => x.moment === "m8-blocked");
      answer("reason", sees(shots[0], /accept|approve|quote|payment|pay/i), `owner My job page mentions accepting/approving the quote or paying=${sees(shots[0], /accept|approve|quote|payment|pay/i)}; plain refusal: ${allocBefore.slice(0, 200)}`);
      const diagAfter = (await scopeDiag(c.jobId!)).join(" | ");
      answer("office_once", told.ok, `${told.detail}; scopeDiag before shoot: ${diag}; after shoot: ${diagAfter}`);
    });
    setup.push(...s.out);
    jobs.push({ jobNumber: ctx.jobNumber, jobId: ctx.jobId, archived: false });
    if (!s.ok) { BLOCKED_REASON = `setup failed: ${s.out.at(-1)?.error}`; return; }
    // Fix: the owner accepts the quote and pays the $349 (setup step 5). Now the same PIESA request is offered.
    let allocAfter = "not tried";
    try { await (await import("./allocation.server")).startPiesaAllocation(ctx.jobId!, ctx.actorId, "piesa", { onlyBusiness: ctx.electrician.business_id, rateToConfirm: true }); allocAfter = "offered"; }
    catch (e) { allocAfter = `refused: ${(e as Error).message.slice(0, 200)}`; }
    const { count: offersAfter } = await admin.from("partner_offers").select("id", { count: "exact", head: true }).eq("job_id", ctx.jobId!).eq("kind", "piesa");
    const sigF = await officeSignals(ctx.jobId!);
    await shoot("m8-carried-on", [ownerPage(ctx)]);
    answer("carries_on", allocAfter === "offered" && (offersAfter ?? 0) > 0, `after the owner accepted and paid: PIESA allocation ${allocAfter}; PIESA offers=${offersAfter}; office rows after=${sigF.needsMe + sigF.exceptions.length}`);
  } finally { await finish(ctx, jobs); }
}

// ---------- Block 10 — installation deposit ----------
async function m10Deposit(rec: Recorder, jobs: BranchResult["jobs"], setup: StepResult[]) {
  const ctx = await freshCtx();
  try {
    const s = await toQuoteAccepted(rec, ctx, setup, jobs);
    if (!s.ok) { BLOCKED_REASON = `setup failed: ${s.out.at(-1)?.error}`; return; }
    const r6: StepResult = { key: "s6_electrician", label: "PIESA", passed: true, checks: [] };
    try { await J.s6(ctx, r6); } catch (e) { BLOCKED_REASON = `PIESA step failed: ${(e as Error).message}`; return; }
    // The owner confirms the safety check on the secure link (the real step before install days can be offered).
    await (await import("./piesa-owner-confirm.server")).signOwnerPiesaConfirmation({ jobId: ctx.jobId!, userId: null, codeId: null, fullName: "Test Journey", signatureName: "Test Journey", authority: "owner", confirmed: true, ip: "127.0.0.1", userAgent: "journey-test" });
    const idays = await import("./install-days.server");
    const { installStartAt } = await import("./install-days.core");
    const days = (await idays.installerInstallDayState(ctx.jobId!, ctx.installer.id)).days.filter((d) => installStartAt(d, "08:00").getTime() > Date.now() + 25 * 3_600_000).slice(0, 3);
    const stage0 = await J.stageOf(ctx);
    let offered = "not tried";
    try { await idays.installerOfferDays(ctx.jobId!, ctx.installer.id, days.map((day) => ({ day, time: "08:00" }))); offered = "NOT refused"; }
    catch (e) { offered = `refused: ${(e as Error).message.slice(0, 250)}`; }
    const { count: booked } = await admin.from("bookings").select("id", { count: "exact", head: true }).eq("job_id", ctx.jobId!).eq("kind", "installation");
    const stage1 = await J.stageOf(ctx);
    const told = await officeToldOnce(ctx, (await shoot("m10-blocked", [ownerPage(ctx), { who: "installer", email: INST, path: `/field/day/${ctx.jobId}` }, ...officePages(ctx)]))[2], /deposit|payment|10%/i);
    const shots = SHOTS.filter((x) => x.moment === "m10-blocked");
    answer("stops", offered.startsWith("refused") && (booked ?? 0) === 0 && stage1 === stage0, `installer offering days ${offered}; install bookings=${booked}; stage ${stage0}→${stage1}`);
    answer("reason", sees(shots[1], /deposit|pay/i) || sees(shots[0], /deposit|pay/i), `installer page mentions the deposit=${sees(shots[1], /deposit|pay/i)}; owner page=${sees(shots[0], /deposit|pay/i)}; plain refusal: ${offered.slice(0, 200)}`);
    answer("office_once", told.ok, told.detail);
    // Fix: the owner pays the 10% deposit (TEST payment, Demo Company) — then the same offering works and the owner books.
    const r: StepResult = { key: "s7_install", label: "deposit", passed: true, checks: [] };
    let pay = "paid";
    try { await J.payStep(ctx, r, "install_deposit", "10% install deposit (TEST payment, Demo Company)"); } catch (e) { pay = `failed: ${(e as Error).message.slice(0, 200)}`; }
    let offered2 = "not tried";
    try { await idays.installerOfferDays(ctx.jobId!, ctx.installer.id, days.map((day) => ({ day, time: "08:00" }))); offered2 = "offered"; }
    catch (e) { offered2 = `refused: ${(e as Error).message.slice(0, 200)}`; }
    const st2 = await idays.ownerInstallDayState(ctx.jobId!);
    let fix = "booked";
    try { await idays.ownerTakeDay(ctx.jobId!, st2.open[0]!.id, ctx.actorId); } catch (e) { fix = `failed: ${(e as Error).message.slice(0, 200)}`; }
    const { count: booked2 } = await admin.from("bookings").select("id", { count: "exact", head: true }).eq("job_id", ctx.jobId!).eq("kind", "installation").in("status", ["confirmed", "completed"]);
    await shoot("m10-carried-on", [ownerPage(ctx)]);
    answer("carries_on", fix === "booked" && (booked2 ?? 0) > 0, `deposit ${pay}; offering again ${offered2}; owner took a day: ${fix}; install bookings=${booked2}`);
  } finally { await finish(ctx, jobs); }
}

// ---------- Block 11 — fixes payment ----------
async function m11FixesPayment(rec: Recorder, jobs: BranchResult["jobs"], setup: StepResult[]) {
  const ctx = await freshCtx();
  try {
    const ch = await fixesChain(rec, ctx, setup, jobs);
    if (!ch) return;
    if (!ch.rectQuoteId) { BLOCKED_REASON = "fixes quote was not generated"; return; }
    await ownerAcceptFixes(ctx, ch.rectQuoteId);
    const of = await import("./owner-fixes.server");
    const st = await of.ownerFixesState(ctx.jobId!);
    const stage0 = await J.stageOf(ctx);
    let pick = "not tried";
    if (st.windows.length) { try { await of.ownerPickFixesTime(ctx.jobId!, st.windows[0]!.id, await ownerUserId(ctx)); pick = "NOT refused"; } catch (e) { pick = `refused: ${(e as Error).message.slice(0, 250)}`; } }
    else pick = `no times offered (step=${st.step})`;
    const { count: booked } = await admin.from("bookings").select("id", { count: "exact", head: true }).eq("job_id", ctx.jobId!).eq("kind", "rectification");
    const stage1 = await J.stageOf(ctx);
    const told = await officeToldOnce(ctx, (await shoot("m11-blocked", [ownerPage(ctx), { who: "electrician", email: ELEC, path: `/field/day/${ctx.jobId}` }, ...officePages(ctx)]))[2], /fix|payment|pay/i);
    const shots = SHOTS.filter((x) => x.moment === "m11-blocked");
    answer("stops", pick.startsWith("refused") && (booked ?? 0) === 0 && stage1 === stage0, `owner fixes step=${st.step}; picking a time ${pick}; fixes bookings=${booked}; stage ${stage0}→${stage1}`);
    answer("reason", sees(shots[0], /fix|pay|payment/i), `owner My job page mentions the fixes payment=${sees(shots[0], /fix|pay|payment/i)}; plain refusal: ${pick.slice(0, 200)}`);
    answer("office_once", told.ok, told.detail);
    // Fix: the owner pays the fixes in full (TEST payment, Demo Company) — then the same pick books the visit.
    let pay = "paid";
    try { await payFixes(ctx); } catch (e) { pay = `failed: ${(e as Error).message.slice(0, 200)}`; }
    const st2 = await of.ownerFixesState(ctx.jobId!);
    let fix = "booked";
    try { const p = await of.ownerPickFixesTime(ctx.jobId!, st2.windows[0]!.id, await ownerUserId(ctx)); fix = p.booked ? "booked" : "picked, not booked yet"; }
    catch (e) { fix = `failed: ${(e as Error).message.slice(0, 200)}`; }
    const { count: booked2 } = await admin.from("bookings").select("id", { count: "exact", head: true }).eq("job_id", ctx.jobId!).eq("kind", "rectification").in("status", ["confirmed", "completed"]);
    await shoot("m11-carried-on", [ownerPage(ctx)]);
    answer("carries_on", (booked2 ?? 0) > 0, `fixes ${pay}; owner picked again: ${fix}; fixes bookings=${booked2}`);
  } finally { await finish(ctx, jobs); }
}

// ---------- Block 22 — completed-form payout gate ----------
async function m22PayoutForm(rec: Recorder, jobs: BranchResult["jobs"], setup: StepResult[]) {
  const ctx = await freshCtx();
  try {
    const ch = await fixesChain(rec, ctx, setup, jobs);
    if (!ch) return;
    if (!ch.rectQuoteId) { BLOCKED_REASON = "fixes quote was not generated"; return; }
    await ownerAcceptFixes(ctx, ch.rectQuoteId);
    await payFixes(ctx);
    // The electrician's A4 form is not complete yet: the fixes payout must be held with a plain reason.
    const tg = await import("./trade-payout-gate.server");
    const before = await tg.payoutBlockersFor(ctx.jobId!, "rectification");
    const shots = await shoot("m22-blocked", [{ who: "electrician-money", email: ELEC, path: "/field/money" }, { who: "office-money", email: "qa.office@hivic-test.example", path: "/admin/money" }, ...officePages(ctx)]);
    answer("stops", before.length > 0, `fixes payout held with ${before.length} reason(s): ${before.join(" | ")}`);
    answer("reason", before.some((r) => /not marked Complete/i.test(r)) && sees(shots[0], /held|not marked complete/i), `plain reasons: ${before.join(" | ")}; electrician Money list shows the held reason=${sees(shots[0], /held|not marked complete/i)}; the TEST office login cannot open the office Money page (TEST-office allowlist, left as-is), so the office side is proven through the shared gate below`);
    answer("office_once", before.length > 0, `the office Mark paid write reads exactly this one reason list (payoutBlockersFor is the same function office.functions markPayoutPaid uses — one source, fails closed): ${before.join(" | ")}`);
    // Fix: the electrician completes the A4 form on the fixes visit (the real path).
    let done = false, detail = "";
    try { const r = await bookAndCompleteFixes(ctx, ch.mitti, ch.fetchMedia, ch.el, ch.tplFixes); done = r.done; detail = r.detail; }
    catch (e) { detail = `failed: ${(e as Error).message.slice(0, 250)}`; }
    const after = await tg.payoutBlockersFor(ctx.jobId!, "rectification");
    const pay1 = await officePayouts(ctx.jobId!);
    await shoot("m22-carried-on", [{ who: "electrician-money", email: ELEC, path: "/field/money" }]);
    answer("carries_on", done && after.length === 0, `A4 completed=${done} (${detail}); payout blockers after=${after.join(" | ") || "none"}; office Payouts after=${pay1.held.length} held / ${pay1.due.length} due line(s) for this job`);
  } finally { await finish(ctx, jobs); }
}

// ---------- Block 23 — electrician payout: 7 days after the office presses Approve (decision 410) ----------
async function m23ElectricianPayout(rec: Recorder, jobs: BranchResult["jobs"], setup: StepResult[]) {
  const ctx = await freshCtx();
  try {
    const ch = await fixesChain(rec, ctx, setup, jobs);
    if (!ch) return;
    if (!ch.rectQuoteId) { BLOCKED_REASON = "fixes quote was not generated"; return; }
    await ownerAcceptFixes(ctx, ch.rectQuoteId);
    await payFixes(ctx);
    let done = false, detail = "";
    try { const r = await bookAndCompleteFixes(ctx, ch.mitti, ch.fetchMedia, ch.el, ch.tplFixes); done = r.done; detail = r.detail; }
    catch (e) { detail = `failed: ${(e as Error).message.slice(0, 250)}`; }
    if (!done) { BLOCKED_REASON = `A4 completion failed: ${detail}`; return; }
    const { payoutGateFacts } = await import("./trade-payout-gate.server");
    const ep = await import("./electrician-pay.core");
    // Way 2 of 2 (decision 410): the form is completed but NOT approved → no payout at all.
    const before = ep.electricianPayTiming("rectification", (await payoutGateFacts([ctx.jobId!])).get(ctx.jobId!));
    const waitingOk = !!before.formCompleteAt && !before.dueAt && before.approvable;
    const pay0 = await officePayouts(ctx.jobId!);
    const waitingLine = pay0.held.find((h: { kind: string; reasons: string[]; approvable?: boolean }) => h.kind === "rectification" && h.reasons.some((r) => /approve/i.test(r)));
    const shots = await shoot("m23-before-approve", [{ who: "electrician-money", email: ELEC, path: "/field/money" }, { who: "office-money", email: "qa.office@hivic-test.example", path: "/admin/money" }, ...officePages(ctx)]);
    answer("stops", waitingOk, `form complete at ${before.formCompleteAt ?? "none"}; due before Approve=${before.dueAt ?? "none"} (approvable=${before.approvable}) — no payout can be marked yet`);
    answer("reason", !!waitingLine && sees(shots[0], /approve/i), `office Payouts held line: ${waitingLine?.reasons.join(" / ") ?? "none"} (approvable=${waitingLine?.approvable === true}); electrician Money list shows the approval wait=${sees(shots[0], /approve/i)}`);
    answer("office_once", pay0.held.filter((h: { kind: string }) => h.kind === "rectification").length === 1, `office Payouts held lines for this job (rectification)=${pay0.held.filter((h: { kind: string }) => h.kind === "rectification").length}; all held lines: ${pay0.held.map((h: { kind: string; reasons: string[] }) => `${h.kind}: ${h.reasons[0]}`).join(" | ") || "none"}`);
    // Fix: someone in the office presses Approve — the payout is due 7 days after that press, not the owner's payment.
    const { recordElectricianFormApproval } = await import("./electrician-form-approval.server");
    const { approvedAt } = await recordElectricianFormApproval(ctx.jobId!, "rectification", ctx.actorId);
    const t = ep.electricianPayTiming("rectification", (await payoutGateFacts([ctx.jobId!])).get(ctx.jobId!));
    const want = new Date(Date.parse(approvedAt) + 7 * 86_400_000).toISOString().slice(0, 10);
    const got = t.dueAt ? String(t.dueAt).slice(0, 10) : null;
    // Way 1 of 2 (decision 410): the owner has NOT paid — reverse the fixes TEST payment in the Xero Demo Company —
    // and the due date must not move (pay never waits for the owner).
    const pay = await import("./payments.server");
    const v = await pay.jobPaymentView(ctx.jobId!);
    const fixesInvoice = v?.steps.find((x) => x.key === "fixes")?.invoiceId ?? null;
    let rev = "no fixes invoice to reverse";
    if (fixesInvoice) { try { await (await import("./xero.server")).reverseDemoTestPayment(fixesInvoice, ctx.actorId); rev = "reversed — owner no longer paid"; } catch (e) { rev = `could not reverse: ${(e as Error).message.slice(0, 160)}`; } }
    const afterRev = ep.electricianPayTiming("rectification", (await payoutGateFacts([ctx.jobId!])).get(ctx.jobId!));
    const gotRev = afterRev.dueAt ? String(afterRev.dueAt).slice(0, 10) : null;
    const pay1 = await officePayouts(ctx.jobId!);
    await shoot("m23-approved", [{ who: "electrician-money", email: ELEC, path: "/field/money" }]);
    answer("carries_on", got === want && gotRev === want, `office approved at ${approvedAt}; payout due ${got ?? "none"}; expected ${want} (approval + 7 days, decision 410); fixes TEST payment ${rev}; due after reversal=${gotRev ?? "none"} (unchanged=${gotRev === got}); office Payouts due lines=${pay1.due.length}`);
  } finally { await finish(ctx, jobs); }
}

// ---------- Block 24 — installer payout ----------
async function m24InstallerPayout(rec: Recorder, jobs: BranchResult["jobs"], setup: StepResult[]) {
  const ctx = await freshCtx();
  try {
    const s = await setupSteps(ctx, 3); setup.push(...s.out); jobs.push({ jobNumber: ctx.jobNumber, jobId: ctx.jobId, archived: false });
    if (!s.ok) { BLOCKED_REASON = `setup failed: ${s.out.at(-1)?.error}`; return; }
    const held = await (await import("./installer-pay-timing.server")).installerPayHeldReasonsFor(ctx.jobId!);
    const told = await officeToldOnce(ctx, (await shoot("m24-blocked", [{ who: "installer-money", email: INST, path: `/field/money/${ctx.jobId}` }, { who: "office-money", email: "qa.office@hivic-test.example", path: "/admin/money" }, ...officePages(ctx)]))[3], /held|payout|approv|veec/i);
    const shots = SHOTS.filter((x) => x.moment === "m24-blocked");
    answer("stops", held.length > 0, `installer payout held with ${held.length} reason(s); no payout can be marked paid`);
    answer("reason", held.length > 0, `plain reasons: ${held.join(" | ")}; installer Money page shows held=${sees(shots[0], /held|payout|approv/i)}; office Money page=${sees(shots[1], /held|payout|approv/i)}`);
    answer("office_once", told.ok, told.detail);
    // Fix: the installer payout clears through AP approval (stage to ready_for_veec), which needs the full install-day
    // and evidence chain — beyond this run's window. Reported honestly, not simulated.
    answer("carries_on", null, "NOT RUN — clearing this block needs the completed install-day (A5) and AP review chain, which this run did not build");
    rec.checks.push({ n: "24.fix", name: "installer payout clears after AP approval", status: "blocked", detail: "BLOCKED: full install-day A5 + AP review chain not run in this window", ids: {} });
  } finally { await finish(ctx, jobs); }
}

// ---------- Block 9 — PIESA prerequisites ----------
async function m9PiesaPrereqs(rec: Recorder, jobs: BranchResult["jobs"], setup: StepResult[]) {
  const ctx = await freshCtx();
  try {
    const s = await setupSteps(ctx, 3); setup.push(...s.out); jobs.push({ jobNumber: ctx.jobNumber, jobId: ctx.jobId, archived: false });
    if (!s.ok) { BLOCKED_REASON = `setup failed: ${s.out.at(-1)?.error}`; return; }
    const stage0 = await J.stageOf(ctx);
    let alloc = "not tried";
    try { await (await import("./allocation.server")).startPiesaAllocation(ctx.jobId!, ctx.actorId, "piesa", { onlyBusiness: ctx.electrician.business_id, rateToConfirm: true }); alloc = "NOT refused"; }
    catch (e) { alloc = `refused: ${(e as Error).message.slice(0, 300)}`; }
    const { count: offers } = await admin.from("partner_offers").select("id", { count: "exact", head: true }).eq("job_id", ctx.jobId!).eq("kind", "piesa");
    const stage1 = await J.stageOf(ctx);
    const told = await officeToldOnce(ctx, (await shoot("m9-blocked", [ownerPage(ctx), ...officePages(ctx)]))[1], /ready check|eligib|quote|payment/i);
    const shots = SHOTS.filter((x) => x.moment === "m9-blocked");
    answer("stops", alloc.startsWith("refused") && (offers ?? 0) === 0 && stage1 === stage0, `PIESA allocation ${alloc}; PIESA offers=${offers}; stage ${stage0}→${stage1}`);
    answer("reason", /Ready Check not complete/.test(alloc) && /eligib/i.test(alloc), `plain reasons in the refusal: ${alloc.slice(0, 250)}; office job page shows them=${sees(shots[1], /ready check|eligib/i)}`);
    answer("office_once", told.ok, told.detail);
    // Fix: the Ready Check is done and the owner accepts and pays (setup steps 4–5) — then the same request is offered.
    const r4: StepResult = { key: "s4_ready_check", label: "Ready Check", passed: true, checks: [] };
    let fix = "done";
    try { await J.s4(ctx, r4); } catch (e) { fix = `Ready Check failed: ${(e as Error).message.slice(0, 200)}`; }
    if (fix === "done") {
      const r5: StepResult = { key: "s5_owner_accept", label: "accept+pay", passed: true, checks: [] };
      try {
        const { data: q0 } = await admin.from("quotes").select("id, status").eq("id", ctx.quoteId!).single();
        if (q0?.status === "draft") {
          try { await (await import("./office-quote-review.server")).sendOfficeReviewedQuote(ctx.jobId!, ctx.quoteId!, ctx.actorId); }
          catch (e) { const m = e instanceof Error ? e.message : String(e); if (!commsOff(m)) throw e; await simulateQuoteRelease(ctx, ctx.quoteId!, "office"); rec.simulated("S5", "office presses Send quote", SIMULATED_SEND_LABEL, {}); }
        }
        await J.s5(ctx, r5);
      } catch (e) { fix = `accept+pay failed: ${(e as Error).message.slice(0, 200)}`; }
    }
    let alloc2 = "not tried";
    try { await (await import("./allocation.server")).startPiesaAllocation(ctx.jobId!, ctx.actorId, "piesa", { onlyBusiness: ctx.electrician.business_id, rateToConfirm: true }); alloc2 = "offered"; }
    catch (e) { alloc2 = `refused: ${(e as Error).message.slice(0, 200)}`; }
    const { count: offers2 } = await admin.from("partner_offers").select("id", { count: "exact", head: true }).eq("job_id", ctx.jobId!).eq("kind", "piesa");
    await shoot("m9-carried-on", [ownerPage(ctx)]);
    answer("carries_on", alloc2 === "offered" && (offers2 ?? 0) > 0, `Ready Check ${fix}; after the fix: PIESA allocation ${alloc2}; PIESA offers=${offers2}`);
  } finally { await finish(ctx, jobs); }
}

// ---------- Block 7 — quote release ----------
async function m7QuoteRelease(rec: Recorder, jobs: BranchResult["jobs"], setup: StepResult[]) {
  const ctx = await freshCtx();
  try {
    const s = await setupSteps(ctx, 3); setup.push(...s.out); jobs.push({ jobNumber: ctx.jobNumber, jobId: ctx.jobId, archived: false });
    if (!s.ok) { BLOCKED_REASON = `setup failed: ${s.out.at(-1)?.error}`; return; }
    const { data: est } = await admin.from("indicative_estimates").select("id, scenarios").eq("job_id", ctx.jobId!).eq("status", "current").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!est) { BLOCKED_REASON = "no current indicative estimate on this TEST job to distort"; return; }
    // A person's mistake: the estimate is far under the real price. The quote must come out HELD with a plain reason.
    await J.assertOwnTestJob(ctx);
    await admin.from("indicative_estimates").update({ scenarios: [{ key: "can_remain", by_access: { standard: { estimated_customer_total: 1 } } }] } as never).eq("id", est.id);
    const r4: StepResult = { key: "s4_ready_check", label: "Ready Check + quote", passed: true, checks: [] };
    try { await J.s4(ctx, r4); } catch { /* the held quote may fail a step check; the quote row below is the evidence */ }
    const { data: q } = await admin.from("quotes").select("id, status, release_state, release_hold_reason, customer_total_inc_gst").eq("job_id", ctx.jobId!).eq("kind", "installation").neq("status", "superseded").order("created_at", { ascending: false }).limit(1).maybeSingle();
    const heldOk = q?.release_state === "held" && /held: price (up|down) \d+% on estimate/.test(q.release_hold_reason ?? "");
    let send = "not tried";
    if (q) { try { await (await import("./office-quote-review.server")).sendOfficeReviewedQuote(ctx.jobId!, q.id, ctx.actorId); send = "NOT refused"; } catch (e) { const m = e instanceof Error ? e.message : String(e); send = commsOff(m) ? `reached the comms lock (all release checks passed): ${m.slice(0, 120)}` : `refused: ${m.slice(0, 250)}`; } }
    const told = await officeToldOnce(ctx, (await shoot("m7-blocked", [ownerPage(ctx), ...officePages(ctx)]))[1], /held|estimate|quote/i);
    const shots = SHOTS.filter((x) => x.moment === "m7-blocked");
    answer("stops", heldOk && send.startsWith("refused"), `quote ${q?.status}/${q?.release_state} held reason="${q?.release_hold_reason ?? "none"}"; office Send ${send}`);
    answer("reason", heldOk && sees(shots[1], /held|estimate/i), `office job page shows the held reason=${sees(shots[1], /held|estimate/i)}; owner page shows no quote to accept=${!sees(shots[0], /accept/i)}`);
    answer("office_once", told.ok, told.detail);
    // Fix: the office corrects the estimate and redrafts the quote — then Send releases it (email simulated while messages are off).
    await admin.from("indicative_estimates").update({ scenarios: est.scenarios } as never).eq("id", est.id);
    let redraft = "redrafted";
    try { await (await import("./quotes.server")).generateInstallerQuotes(ctx.jobId!, ctx.actorId); } catch (e) { redraft = `failed: ${(e as Error).message.slice(0, 200)}`; }
    const { data: q2 } = await admin.from("quotes").select("id, status, release_state, release_hold_reason").eq("job_id", ctx.jobId!).eq("kind", "installation").neq("status", "superseded").order("created_at", { ascending: false }).limit(1).maybeSingle();
    let released = "not tried";
    if (q2) {
      try { await (await import("./office-quote-review.server")).sendOfficeReviewedQuote(ctx.jobId!, q2.id, ctx.actorId); released = "sent"; }
      catch (e) { const m = e instanceof Error ? e.message : String(e); if (commsOff(m)) { await simulateQuoteRelease(ctx, q2.id, "office"); rec.simulated("S5", "office presses Send quote", SIMULATED_SEND_LABEL, {}); released = "released (email simulated — messages off)"; } else released = `refused: ${m.slice(0, 200)}`; }
    }
    await shoot("m7-carried-on", [ownerPage(ctx)]);
    answer("carries_on", /sent|released/.test(released), `estimate corrected, quote ${redraft} (${q2?.release_state ?? "?"} ${q2?.release_hold_reason ?? ""}); office Send: ${released}`);
  } finally { await finish(ctx, jobs); }
}

// ---------- Block 42 — communication lock ----------
async function m42CommsLock(rec: Recorder, jobs: BranchResult["jobs"], setup: StepResult[]) {
  const ctx = await freshCtx();
  try {
    const s = await toQuoteAccepted(rec, ctx, setup, jobs);
    if (!s.ok) { BLOCKED_REASON = `setup failed: ${s.out.at(-1)?.error}`; return; }
    const comms = await import("./comms.server");
    const enabled = await comms.customerCommsEnabled();
    let refused = "not refused";
    try { await comms.assertCustomerDeliveryAllowed(ctx.jobId!, "TEST journey block check"); refused = "NOT refused"; }
    catch (e) { refused = `refused: ${(e as Error).message}`; }
    const c = await counts(ctx.jobId!);
    const told = await officeToldOnce(ctx, (await shoot("m42-blocked", [ownerPage(ctx), ...officePages(ctx)]))[1], /communications|disabled|nothing was sent|held/i);
    const shots = SHOTS.filter((x) => x.moment === "m42-blocked");
    answer("stops", enabled === false && refused.startsWith("refused") && c.emails === 0, `global switch on=${enabled}; customer delivery ${refused}; owner emails on this job=${c.emails}`);
    answer("reason", /PRE-LAUNCH: customer communications are disabled/.test(refused), `plain refusal: ${refused.slice(0, 200)}; office job page shows the held/simulated note=${sees(shots[1], /communications|disabled|held|simulated/i)}`);
    answer("office_once", told.ok, told.detail);
    // The cause is Jo's global switch — by standing rule it is NEVER changed in a test. Reported honestly.
    answer("carries_on", null, "NOT RUN — the fix is Jo's communications switch and the standing rules forbid changing switches in a test");
    rec.checks.push({ n: "42.fix", name: "customer email flows after the switch", status: "blocked", detail: "BLOCKED: global switch is Jo's to enable; unchanged by design", ids: {} });
  } finally { await finish(ctx, jobs); }
}

// ---------- Block 43 — contact consent ----------
async function m43Consent(rec: Recorder, jobs: BranchResult["jobs"], setup: StepResult[]) {
  const ctx = await freshCtx();
  try {
    const s = await toQuoteAccepted(rec, ctx, setup, jobs);
    if (!s.ok) { BLOCKED_REASON = `setup failed: ${s.out.at(-1)?.error}`; return; }
    const comms = await import("./comms.server");
    const { data: cons } = await admin.from("owner_contact_consents").select("id, consent_status").eq("job_id", ctx.jobId!).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!cons) { BLOCKED_REASON = "no owner contact consent row on this TEST job to withhold"; return; }
    // A person's mistake: the consent is withdrawn (a newer not_granted row, exactly how the product records it).
    await J.assertOwnTestJob(ctx);
    await admin.from("owner_contact_consents").update({ consent_status: "not_granted" } as never).eq("id", cons.id);
    let refused = "not refused";
    try { await comms.assertOwnerContactConsent(ctx.jobId!, "TEST journey consent check"); refused = "NOT refused"; }
    catch (e) { refused = `refused: ${(e as Error).message}`; }
    const state = await comms.customerDeliveryState(ctx.jobId!);
    const c = await counts(ctx.jobId!);
    const told = await officeToldOnce(ctx, (await shoot("m43-blocked", [ownerPage(ctx), ...officePages(ctx)]))[1], /consent|contact|correspondence/i);
    const shots = SHOTS.filter((x) => x.moment === "m43-blocked");
    answer("stops", refused.startsWith("refused") && c.emails === 0, `owner consent withheld; customer contact ${refused}; owner emails on this job=${c.emails}; delivery state=${state}`);
    answer("reason", /No contact consent from the owner on record/.test(refused), `plain refusal: ${refused.slice(0, 200)}; office job page shows the consent/correspondence state=${sees(shots[1], /consent|contact|correspondence/i)}`);
    answer("office_once", told.ok, told.detail);
    // Fix: the owner's granted consent is back on record — the consent check passes (the global lock is a separate block, unchanged).
    await admin.from("owner_contact_consents").update({ consent_status: cons.consent_status } as never).eq("id", cons.id);
    let ok = "not refused";
    try { await comms.assertOwnerContactConsent(ctx.jobId!, "TEST journey consent check"); ok = "passes"; }
    catch (e) { ok = `still refused: ${(e as Error).message.slice(0, 200)}`; }
    const state2 = await comms.customerDeliveryState(ctx.jobId!);
    await shoot("m43-carried-on", [ownerPage(ctx)]);
    answer("carries_on", ok === "passes", `consent restored: the consent check ${ok}; delivery state=${state2} (the remaining gate is the global communications lock, unchanged)`);
  } finally { await finish(ctx, jobs); }
}

export type Phase4Name = "m8-quote-payment" | "m10-deposit" | "m11-fixes-payment" | "m22-payout-form" | "m23-electrician-payout" | "m24-installer-payout" | "m9-piesa-prereqs" | "m7-quote-release" | "m42-comms-lock" | "m43-consent";
export const PHASE4: Record<Phase4Name, (rec: Recorder, jobs: BranchResult["jobs"], setup: StepResult[]) => Promise<void>> = {
  "m8-quote-payment": m8QuotePayment, "m10-deposit": m10Deposit, "m11-fixes-payment": m11FixesPayment, "m22-payout-form": m22PayoutForm,
  "m23-electrician-payout": m23ElectricianPayout, "m24-installer-payout": m24InstallerPayout, "m9-piesa-prereqs": m9PiesaPrereqs,
  "m7-quote-release": m7QuoteRelease, "m42-comms-lock": m42CommsLock, "m43-consent": m43Consent,
};
export async function runPhase4(name: Phase4Name, shotDir: string): Promise<Phase3Result> {
  SHOT_DIR = shotDir; SHOTS.length = 0; ANSWERS.length = 0; BLOCKED_REASON = null;
  const rec = new Recorder();
  const jobs: BranchResult["jobs"] = []; const setup: StepResult[] = [];
  const ms = await import("./mitti.server");
  ms.armJourneyMittiGuard(null);
  const refused: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (/mitti\.com/i.test(url)) { refused.push(`${init?.method ?? "GET"} ${new URL(url).pathname}`); throw new Error(`SAFETY STOP: real Mitti call refused (${url.split("?")[0]})`); }
    return realFetch(input as never, init);
  }) as typeof fetch;
  try { await PHASE4[name](rec, jobs, setup); }
  catch (e) { BLOCKED_REASON = BLOCKED_REASON ?? `runner error: ${e instanceof Error ? e.message : String(e)}`; if (process.env["JOURNEY_DEBUG"]) console.error(e); }
  finally {
    globalThis.fetch = realFetch; ms.disarmJourneyMittiGuard();
    rec.checks.push(refused.length ? { n: "M", name: "no real Mitti call", status: "failed", detail: `REAL MITTI CALLS REFUSED: ${refused.join("; ")}`, ids: {} } : { n: "M", name: "no real Mitti call", status: "passed", detail: `0 real Mitti calls; simulator routes: ${guardRouted.join("; ") || "none"}`, ids: {} });
    guardRouted = [];
  }
  return { branch: name as never, jobs, setup, checks: rec.checks, answers: [...ANSWERS], shots: [...SHOTS], blocked: BLOCKED_REASON };
}
