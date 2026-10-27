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
export type BranchCheck = { n: string; name: string; status: "passed" | "failed" | "blocked"; detail: string; ids: Record<string, string | null> };
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
  async run(n: string, name: string, fn: () => Promise<{ ok: boolean; detail: string; ids?: Record<string, string | null> }>, needs: string[] = []) {
    const blockedBy = needs.filter((x) => this.checks.find((c) => c.n === x)?.status !== "passed");
    if (blockedBy.length) { this.checks.push({ n, name, status: "blocked", detail: `blocked: check ${blockedBy.join(", ")} did not pass`, ids: {} }); return false; }
    try {
      const r = await fn();
      this.checks.push({ n, name, status: r.ok ? "passed" : "failed", detail: r.detail, ids: r.ids ?? {} });
      return r.ok;
    } catch (e) {
      this.checks.push({ n, name, status: "failed", detail: `error: ${e instanceof Error ? e.message : String(e)}`, ids: {} });
      return false;
    }
  }
}

/** Steps 1..n of the default run (same code) on a fresh TEST job. */
async function setupSteps(ctx: JourneyCtx, upTo: 3 | 5, ready?: (ctx: JourneyCtx, r: StepResult) => Promise<void>) {
  const fns: [string, (c: JourneyCtx, r: StepResult) => Promise<void>][] = [["s1_calculator", J.s1], ["s2_owner_links", J.s2], ["s3_office_offer", J.s3]];
  if (upTo === 5) { fns.push(["s4_ready_check", ready!]); fns.push(["s5_owner_accept", J.s5]); }
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

    await rec.run("1.4", "exactly one not-eligible owner email row (TEST address, simulated), no prices", async () => {
      const e = await emailsSince(ctx.jobId!, since);
      const notElig = [...e.ces.filter((x) => /not.?eligible|ineligible/i.test(x.purpose ?? "")), ...e.comm.filter((x) => /not.?eligible|doesn.t appear eligible|does not appear eligible/i.test(`${x.subject} ${x.body}`))];
      const prices = e.comm.filter((x) => /\$\s?\d/.test(`${x.subject} ${x.body}`));
      const toTest = e.comm.every((x) => JSON.stringify(x.recipients ?? "").includes(J.TEST_DOMAIN) || JSON.stringify(x.recipients ?? "") === "[]");
      return { ok: notElig.length === 1 && prices.length === 0 && toTest, detail: `owner email rows since not-eligible: log ${e.ces.length} (${e.ces.map((x) => `${x.purpose}/${x.status}`).join(", ") || "none"}), history ${e.comm.length}; not-eligible ones=${notElig.length}; with prices=${prices.length}`, ids: { email_row: (notElig[0] as { id?: string } | undefined)?.id ?? null } };
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

async function piesaFixes(rec: Recorder, jobs: BranchResult["jobs"], setup: StepResult[]) {
  const ctx = await newJourneyCtx();
  try {
    const s = await setupSteps(ctx, 5, defaultReadyCheck);
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
      templates: { [tpl.a3]: sim.templateOfItems(items as never), ...(tpl.fixes ? { [tpl.fixes]: { items: fixesTemplateItems as never } } : {}) },
      users: [{ id: "sim-mitti-electrician", email: el!.email! }, { id: "sim-mitti-test-assignee", email: TEST_MITTI_ASSIGNEE }],
    });
    const fetchMedia = async () => ({ bytes: J.TINY_JPEG, contentType: "image/jpeg" });
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
      mitti.fill(auditId!, items as never);
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
      return { ok: o.result === "held" && !!o.reason && e.ces.length + e.comm.length === 0 && q?.status === "draft", detail: `result=${o.result} reason=${o.reason ?? "-"}; quote status=${q?.status ?? "none"}; held events=${held}; owner emails=${e.ces.length + e.comm.length}; ${diff(b, a)}. Failing check used: no fixes times from the electrician yet`, ids: { quote_id: o.quoteId } };
    }, ["2.1"]);

    await rec.run("2.2", "maybeAutoSendFixesQuote sent when every check passes; one owner email; price = electrician's price + margin by whose electrician", async () => {
      await J.assertOwnTestJob(ctx);
      const rs = await import("./rectification.server");
      const days = [3, 4, 5].map((d) => J.melbourneDate(d));
      await rs.recordRectificationWindows(ctx.jobId!, ctx.electrician.id, 3, days.map((date) => ({ date, slot: "10-12" as const })));
      const b = await counts(ctx.jobId!);
      const since = new Date().toISOString();
      const o = await (await import("./auto-fixes-quote-send.server")).maybeAutoSendFixesQuote(ctx.jobId!, { actorId: ctx.actorId, generate: true });
      rectQuoteId = o.quoteId ?? rectQuoteId;
      const a = await counts(ctx.jobId!);
      const e = await emailsSince(ctx.jobId!, since);
      const { data: q } = rectQuoteId ? await admin.from("quotes").select("status, customer_total_inc_gst, sent_at").eq("id", rectQuoteId).single() : { data: null };
      const { electricianSourceForJob } = await import("./our-lead-piesa-electrician.server");
      const { fixesMarginFor } = await import("./fixes-price.core");
      const src = await electricianSourceForJob(ctx.jobId!, ctx.electrician.business_id);
      const expected = FIXES_PRICE + fixesMarginFor(src);
      const total = Number(q?.customer_total_inc_gst ?? NaN);
      const emails = e.ces.length + e.comm.length;
      return { ok: o.result === "sent" && q?.status === "issued" && emails === 1 && Math.abs(total - expected) < 0.01, detail: `result=${o.result}${o.reason ? ` (${o.reason})` : ""}; saved quote status=${q?.status}, total $${total}; expected $${FIXES_PRICE} + margin $${fixesMarginFor(src)} (${src} electrician) = $${expected}; owner emails=${emails}; ${diff(b, a)}`, ids: { quote_id: rectQuoteId } };
    }, ["2.1"]);

    await rec.run("2.4", "owner accepts and pays the fixes (Demo Company); still no install booking", async () => {
      await J.assertOwnTestJob(ctx);
      const b = await counts(ctx.jobId!);
      const { data: q } = await admin.from("quotes").select("id, version, status").eq("id", rectQuoteId!).single();
      const { data: jo } = await admin.from("jobs").select("owners(user_id)").eq("id", ctx.jobId!).single();
      const ownerUser = (jo?.owners as { user_id: string | null } | null)?.user_id ?? ctx.actorId;
      const { respondToQuoteImpl } = await import("./portal.functions");
      await respondToQuoteImpl({ quoteId: q!.id, accept: true, consent: true, expectedVersion: q!.version, signing: { signatoryName: "Test Journey", authorityType: "owner", over18: true, readConsumerInfo: true, acceptAgreement: true, signatureName: "Test Journey", assistance: "none" } } as never,
        { userId: ownerUser, ip: "127.0.0.1", userAgent: "journey-test", authorize: async () => {}, isOwner: async () => true } as never);
      const x = await import("./xero.server");
      await x.createInvoiceForQuote(q!.id, ctx.actorId).catch(() => null);
      const { data: inv } = await admin.from("invoices").select("id, xero_invoice_id").eq("job_id", ctx.jobId!).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (inv && !inv.xero_invoice_id) await x.pushInvoiceToXero(inv.id, ctx.actorId).catch(() => null);
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

    await rec.run("2.7", "only now install scheduling opens; installer told once; 30-day clock from Section C, not the PIESA date", async () => {
      await J.assertOwnTestJob(ctx);
      const stage = await J.stageOf(ctx);
      const { INSTALL_CLEARANCE_EVENT } = await import("./install-clearance.core");
      const { count: told } = await admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", ctx.jobId!).eq("event_type", INSTALL_CLEARANCE_EVENT);
      const { data: dl } = await admin.from("job_piesa_deadlines").select("piesa_date, install_deadline").eq("job_id", ctx.jobId!).maybeSingle();
      const { data: pr } = await admin.from("piesa_records").select("section_c_signed_at").eq("job_id", ctx.jobId!).eq("kind", "post_rectification").order("created_at", { ascending: false }).limit(1).maybeSingle();
      const sc = pr?.section_c_signed_at ? String(pr.section_c_signed_at).slice(0, 10) : null;
      const want = sc ? new Date(Date.parse(`${sc}T00:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10) : null;
      const got = dl?.install_deadline ? String(dl.install_deadline).slice(0, 10) : null;
      return { ok: stage === "installation_scheduling" && told === 1 && !!want && got === want, detail: `stage=${stage}; installer clearance notices=${told}; Section C ${sc}; deadline saved ${got} (from date ${dl?.piesa_date ?? "?"}), expected ${want}` };
    }, ["2.6"]);

    await rec.run("2.8", "electrician pay due 7 days after the later of the complete form and the owner's payment", async () => {
      const { payoutGateFacts } = await import("./trade-payout-gate.server");
      const ep = await import("./electrician-pay.server");
      const [facts, paid] = await Promise.all([payoutGateFacts([ctx.jobId!]), ep.ownerElectricalStepsPaidAt([ctx.jobId!])]);
      const t = ep.electricianPayTiming("rectification" as never, facts.get(ctx.jobId!), paid.get(ctx.jobId!));
      const later = [t.formCompleteAt, t.ownerPaidAt].filter(Boolean).sort().at(-1) ?? null;
      const want = later ? new Date(Date.parse(later) + 7 * 86_400_000).toISOString().slice(0, 10) : null;
      const got = t.dueAt ? String(t.dueAt).slice(0, 10) : null;
      return { ok: !!t.formCompleteAt && !!t.ownerPaidAt && got === want, detail: `form complete ${t.formCompleteAt ?? "none"}; owner paid ${t.ownerPaidAt ?? "none"}; due ${got ?? "none"}; expected ${want ?? "-"}${t.waiting.length ? `; waiting: ${t.waiting.join("; ")}` : ""}` };
    }, ["2.6"]);
  } finally {
    await cleanupJourney(ctx).catch(() => undefined);
    const j = jobs.find((x) => x.jobId === ctx.jobId); if (j) j.archived = await archived(ctx.jobId);
  }
}

export async function runJourneyBranch(branch: BranchName): Promise<BranchResult> {
  const rec = new Recorder();
  const jobs: BranchResult["jobs"] = [];
  const setup: StepResult[] = [];
  if (branch === "not-eligible") await notEligible(rec, jobs, setup);
  else await piesaFixes(rec, jobs, setup);
  return { branch, jobs, setup, checks: rec.checks };
}
