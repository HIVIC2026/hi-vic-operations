// Office-authorised callers only. Allocation is atomic; approved owner notices use the guarded sender afterwards.
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { TEST_GIVE_REFUSED, WAITING_FOR_CALL_CONSENT, batchJobEligible, isTestGiveBusiness, testGiveBlocker, batchPartnerCovers, jobGiveOffer, suggestBatches, readyInHouseBatch, waitingForCallConsent, type BatchJob, type ConsentRow, type InHousePartner } from "./in-house-batch.core";
import { QUICK_TAPS_ANSWERED_EVENT } from "./quick-taps.core";
import { sendInHousePartnerCall } from "./in-house-batch-email.server";
import { sendInHouseGiveEmail } from "./in-house-give-email.server";
import type { GiveEmailOutcome } from "./in-house-give-email.core";
import { inHouseFactsFor } from "./installer-paid-electricians.server";
import { inHouseEnableBlockers } from "./in-house.core";
import { chunkIds } from "./sweep-batch.core";
import { displayName } from "./display-name.core";

// Pending tables/columns are deliberately a local overlay, not generated schema edits.
const db = supabaseAdmin as unknown as SupabaseClient;
/** Admin role is checked again by the service-only atomic RPC; actor comes from the authenticated boundary. */
export async function pullBackInHouseJob(input: { jobId: string; reason: string; actorId: string }): Promise<void> {
  if (!input.reason.trim()) throw new Error("Reason required");
  const result = await db.rpc("pull_back_in_house_job", { _job: input.jobId, _reason: input.reason.trim(), _actor: input.actorId });
  if (result.error) {
    if (["PGRST202", "42883"].includes(result.error.code)) throw new Error("Taking jobs back is awaiting the approved database change.");
    throw new Error(result.error.message);
  }
}
type Property = { id: string; postcode: string | null; address_line: string; suburb: string | null };
type Job = { owners?: { full_name: string | null; phone: string | null } | null; id: string; job_number: string; property_id: string; stage: string; source: string; channel: string; originating_installer_business_id: string | null; deleted_at: string | null };
type Assignment = { job_id: string; business_id: string | null; role: string };
async function rows<T>(query: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const result = await query;
  if (result.error) throw new Error(result.error.message);
  return (result.data ?? []) as T[];
}
async function pagedRows<T>(query: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += 200) {
    const page = await rows<T>(query(from, from + 199));
    all.push(...page);
    if (page.length < 200) return all;
  }
}
async function byIds<T>(ids: string[], query: (ids: string[], from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  return (await Promise.all(chunkIds([...new Set(ids)], 200).map(ids => pagedRows<T>((from, to) => query(ids, from, to))))).flat();
}
/** TEST office only (Jo 5 Nov 2026): the job and business ids its own guards already checked (qa_office-access). */
export type TestOfficeScope = { jobIds: string[]; businessIds: string[] };
/** `now` is injectable (tests); the phone consent check is against it. `jobIds` scopes the read (job page offer).
 *  `testOffice`: read ONLY those qa_test jobs and TEST businesses; without it (the real office) qa_test jobs are never read. */
export async function loadInHouseBatches(opts: { now?: Date | undefined; jobIds?: string[]; testOffice?: TestOfficeScope | undefined } = {}) {
  const nowIso = (opts.now ?? new Date()).toISOString();
  const test = opts.testOffice;
  if (test && (!test.jobIds.length || !test.businessIds.length)) return { jobs: [] as BatchJob[], partners: [] as InHousePartner[], suggestions: [] as { businessId: string; jobIds: string[] }[], waitingForCallConsent: [] as string[] };
  const scoped = (q: any) => { const s = opts.jobIds ? q.in("id", opts.jobIds) : q; return test ? s.eq("source", "qa_test").in("id", test.jobIds) : s.neq("source", "qa_test"); };
  const [jobs, businesses] = await Promise.all([
    pagedRows<Job>((a,b) => scoped(db.from("jobs").select("id,job_number,property_id,owners(full_name,phone),stage,source,channel,originating_installer_business_id,deleted_at").is("deleted_at", null).not("stage", "in", "(complete,cancelled)")).order("id").range(a,b)),
    test
      ? pagedRows<Omit<InHousePartner, "openJobs"> & { trading_name: string | null; email: string | null; onboarding_notes: string | null }>((a,b) => db.from("businesses").select("id,name,trading_name,email,onboarding_notes,in_house,is_active,service_postcodes,covers_all_victoria,coverage_lat,coverage_lng,coverage_radius_km").eq("in_house", true).eq("is_active", true).in("id", test.businessIds).order("id").range(a,b))
        .then(rows => rows.filter(isTestGiveBusiness).map(({ email: _e, onboarding_notes: _n, ...b }) => b))
      : pagedRows<Omit<InHousePartner, "openJobs"> & { trading_name: string | null }>((a,b) => db.from("businesses").select("id,name,trading_name,in_house,is_active,service_postcodes,covers_all_victoria,coverage_lat,coverage_lng,coverage_radius_km").eq("in_house", true).eq("is_active", true).order("id").range(a,b)),
  ]);
  const ids = jobs.map(j => j.id), propertyIds = [...new Set(jobs.map(j => j.property_id))];
  const [assignments, saved, optouts, properties, facts, events, consents] = ids.length ? await Promise.all([
    byIds<Assignment>(ids, (c,a,b) => db.from("job_assignments").select("job_id,business_id,role").in("job_id", c).eq("active", true).order("id").range(a,b)),
    byIds<{ job_id: string; spot_saved_at: string }>(ids, (c,a,b) => db.from("lead_campaign_responses").select("job_id,spot_saved_at").in("job_id", c).not("spot_saved_at", "is", null).order("id").range(a,b)),
    byIds<{ job_id: string }>(ids, (c,a,b) => db.from("customer_email_optouts").select("job_id").in("job_id", c).not("opted_out_at", "is", null).order("id").range(a,b)),
    byIds<Property>(propertyIds, (c,a,b) => db.from("properties").select("id,postcode,address_line,suburb").in("id", c).order("id").range(a,b)),
    byIds<{ property_id: string; value: unknown }>(propertyIds, (c,a,b) => db.from("property_facts").select("property_id,value").in("property_id", c).eq("fact_key", "coordinates").eq("is_current", true).order("id").range(a,b)),
    byIds<{ job_id: string; event_type: string; details: Record<string, unknown> | null; created_at: string }>(ids, (c,a,b) => db.from("workflow_events").select("job_id,event_type,details,created_at").in("job_id", c).in("event_type", [QUICK_TAPS_ANSWERED_EVENT, "area_batch_sent"]).order("created_at", { ascending: false }).order("id", { ascending: false }).range(a,b)),
    byIds<ConsentRow & { job_id: string }>(ids, (c,a,b) => db.from("owner_contact_consents").select("job_id,consent_status,consented_at,snapshot,source,consent_key").in("job_id", c).order("id").range(a,b)),
  ]) : [[], [], [], [], [], [], []];
  const partners: InHousePartner[] = businesses.map(b => ({ ...b, name: displayName(b.trading_name || b.name), openJobs: assignments.filter(a => a.business_id === b.id && a.role === "installer").length }));
  const batchJobs: BatchJob[] = jobs.map(j => {
    const p = properties.find(p => p.id === j.property_id), coords = facts.find(f => f.property_id === j.property_id)?.value;
    const answer = events.find(e => e.job_id === j.id && e.event_type === QUICK_TAPS_ANSWERED_EVENT)?.details;
    const batch = events.find(e => e.job_id === j.id && e.event_type === "area_batch_sent" && e.details?.["batch_id"] === answer?.["batch_id"])?.details;
    const { owners, ...jobFields } = j;
    return { ...jobFields, ownerName: owners?.full_name ?? null, ownerPhone: owners?.phone ?? null, spot_saved_at: saved.find(s => s.job_id === j.id)?.spot_saved_at ?? null,
      quickTapsYes: answer?.["outcome"] === "pass" && answer?.["consent_share"] === true,
      quickTapsBatchId: typeof answer?.["batch_id"] === "string" ? answer["batch_id"] : null,
      oldStylePass: answer?.["outcome"] === "pass" && !answer?.["go_label"],
      waitingBusinessId: j.channel === "installer_sourced" ? j.originating_installer_business_id : typeof batch?.["installer_business_id"] === "string" ? batch["installer_business_id"] : null,
      optedOut: optouts.some(o => o.job_id === j.id), hasActiveInstaller: assignments.some(a => a.job_id === j.id && a.role === "installer"),
      postcode: p?.postcode ?? null, address: [p?.address_line, p?.suburb, p?.postcode].filter(Boolean).join(", "),
      lat: Array.isArray(coords) && typeof coords[1] === "number" ? coords[1] : null,
      lng: Array.isArray(coords) && typeof coords[0] === "number" ? coords[0] : null };
  });
  const waiting = new Set(batchJobs.filter(j => waitingForCallConsent(j, consents.filter(c => c.job_id === j.id), nowIso, !!test)).map(j => j.id));
  const eligibleJobs = batchJobs.filter(j => batchJobEligible(j, !!test) && !waiting.has(j.id));
  return { jobs: eligibleJobs, partners, suggestions: suggestBatches(eligibleJobs, partners, !!test), waitingForCallConsent: [...waiting] };
}

/** Job page offer (office only): null unless this job can be given to its nominated in-house partner right now. */
export async function inHouseGiveForJob(jobId: string, opts: { testOffice?: TestOfficeScope | undefined } = {}) {
  const screen = await loadInHouseBatches({ jobIds: [jobId], testOffice: opts.testOffice });
  return jobGiveOffer(screen.jobs.find(j => j.id === jobId), screen.partners);
}

async function selectWorkers(businessId: string) {
  const blockers = inHouseEnableBlockers(await inHouseFactsFor(businessId));
  if (blockers.length) return { reason: blockers.join("; ") };
  const [workers, members] = await Promise.all([
    pagedRows<{ profile_id: string | null; trade_role: string; email: string | null; licence_expires_on: string | null; created_at: string }>((a,b) => db.from("partner_workers").select("profile_id,trade_role,email,licence_expires_on,created_at").eq("business_id", businessId).eq("approval_status", "approved").is("removed_at", null).order("created_at").order("id").range(a,b)),
    pagedRows<{ user_id: string }>((a,b) => db.from("business_members").select("user_id").eq("business_id", businessId).eq("active", true).order("id").range(a,b)),
  ]);
  const live = workers.filter(w => !!w.profile_id && members.some(m => m.user_id === w.profile_id)).sort((a,b) => a.created_at.localeCompare(b.created_at) || (a.profile_id ?? "").localeCompare(b.profile_id ?? ""));
  const installer = live.find(w => w.trade_role === "installer");
  if (!installer?.profile_id) return { reason: "No approved installer worker with active Team access" };
  // The business explicitly chooses its verified Team electrician after handoff.
  return { installer: installer.profile_id, electrician: null };
}

/** `testOffice` (TEST office only, Jo 5 Nov 2026): refused whole unless EVERY job is a qa_test job inside the checked scope
 *  and the business is a TEST partner (fresh read here; the allocation RPC re-checks under lock). Messages stay on test-send. */
export async function sendInHouseBatch(input: { businessId: string; jobIds: string[]; actorId: string }, opts: { now?: Date; testOffice?: TestOfficeScope } = {}): Promise<{ sent: string[]; refused: { jobId: string; reason: string }[]; installerEmail?: GiveEmailOutcome }> {
  const sent: string[] = [], refused: { jobId: string; reason: string }[] = [];
  const batchId = crypto.randomUUID();
  const test = opts.testOffice;
  if (test) {
    const ids = [...new Set(input.jobIds)];
    if (!ids.every(id => test.jobIds.includes(id)) || !test.businessIds.includes(input.businessId)) throw new Error(TEST_GIVE_REFUSED);
    const [jobRows, biz] = await Promise.all([
      db.from("jobs").select("id,source,deleted_at").in("id", ids),
      db.from("businesses").select("id,email,onboarding_notes").eq("id", input.businessId).maybeSingle(),
    ]);
    if (jobRows.error || biz.error) throw new Error("The TEST give could not be checked. Try again.");
    const blocked = testGiveBlocker(ids, (jobRows.data ?? []) as { id: string; source: string | null; deleted_at: string | null }[], biz.data as { email: string | null; onboarding_notes: string | null } | null);
    if (blocked) throw new Error(blocked);
  }
  const screen = await loadInHouseBatches({ now: opts.now, testOffice: test });
  const partner = screen.partners.find(p => p.id === input.businessId);
  // Task 5: a lead whose owner hasn't tapped "can call me" (phone consent over 3 months old) is never handed off.
  for (const jobId of new Set(input.jobIds)) if (screen.waitingForCallConsent.includes(jobId)) refused.push({ jobId, reason: WAITING_FOR_CALL_CONSENT });
  const requested = [...new Set(input.jobIds)].filter(id => !screen.waitingForCallConsent.includes(id));
  if (!requested.length) return { sent, refused };
  input = { ...input, jobIds: requested };
  if (partner) {
    const eligible = requested.filter(id => screen.jobs.some(j => j.id === id && batchPartnerCovers(j, partner) && (!j.waitingBusinessId || j.waitingBusinessId === partner.id)));
    const ready = readyInHouseBatch(eligible);
    if (!ready.length) return { sent, refused: [...refused, ...requested.map(jobId => ({ jobId, reason: "No eligible jobs for this installer" }))] };
    input = { ...input, jobIds: ready };
  }
  const workers = partner ? await selectWorkers(input.businessId) : { reason: "Partner is not active in-house" };
  for (const jobId of [...new Set(input.jobIds)]) {
    // The RPC handles stale jobs (including previously batched jobs) under lock and returns the exact reason.
    const job = screen.jobs.find(j => j.id === jobId);
    if (job && partner && !batchPartnerCovers(job, partner)) { refused.push({ jobId, reason: "Outside this partner's coverage" }); continue; }
    if ("reason" in workers) { refused.push({ jobId, reason: workers.reason ?? "Partner unavailable" }); continue; }
    const result = await db.rpc("allocate_in_house_batch_job", { _batch: batchId, _business: input.businessId, _job: jobId, _actor: input.actorId, _installer: workers.installer, _electrician: workers.electrician });
    if (result.error) {
      if (["PGRST202", "42883", "42P01"].includes(result.error.code)) throw new Error("Batch allocation is awaiting the approved database change.");
      // Each RPC rolls back independently. Preserve successful jobs and surface this job's refused reason.
      refused.push({ jobId, reason: "Allocation could not be saved. Try again." });
      console.error("In-house job allocation failed", result.error.message);
      continue;
    }
    const outcome = result.data as { sent: boolean; reason?: string };
    if (outcome.sent) {
      sent.push(jobId);
      // Email failure never undoes allocation. The durable pending event is picked up after approval by the tick.
      try { await sendInHousePartnerCall(jobId); } catch (error) { console.error("Partner call email after allocation failed", error instanceof Error ? error.message : "unknown"); }
    } else refused.push({ jobId, reason: outcome.reason ?? "Job unavailable" });
  }
  if (!sent.length) return { sent, refused };
  // ONE installer email for this Give, listing only the jobs actually given. Never undoes the allocation; `approved` is
  // never passed, so the sender's own switch decides.
  let installerEmail: GiveEmailOutcome;
  try {
    // Jo 5 Nov 2026: each job card carries what the owner told us on the website (best-effort read; a gap shows nothing).
    const { ownerSaidRows } = await import("./owner-said.core");
    const said = new Map<string, [string, string | null][]>();
    try {
      const [{ data: rows }, { data: savedRows }] = await Promise.all([
        db.from("jobs").select("id, estimated_area_m2, properties(enrichment)").in("id", sent),
        db.from("lead_campaign_responses").select("job_id, saved_insulation").in("job_id", sent),
      ]);
      for (const r of (rows ?? []) as { id: string; estimated_area_m2: number | string | null; properties: { enrichment: Record<string, unknown> | null } | { enrichment: Record<string, unknown> | null }[] | null }[]) {
        const prop = Array.isArray(r.properties) ? r.properties[0] : r.properties;
        const b44 = (prop?.enrichment?.["base44"] ?? {}) as { raw?: { answers?: Record<string, unknown> }; declared?: Record<string, unknown> };
        const savedIns = ((savedRows ?? []) as { job_id: string; saved_insulation: string | null }[]).find((x) => x.job_id === r.id)?.saved_insulation ?? null;
        said.set(r.id, ownerSaidRows({ answers: b44.raw?.answers ?? null, declared: b44.declared ?? null, savedInsulation: savedIns, estimatedAreaM2: r.estimated_area_m2 }));
      }
    } catch (e) { console.error("Give email: owner-said rows skipped", (e as Error).message); }
    const jobs = sent.map(id => {
      const j = screen.jobs.find(x => x.id === id);
      return { jobId: id, jobNumber: j?.job_number ?? "", ownerName: j?.ownerName ?? null, ownerMobile: j?.ownerPhone ?? null, address: j?.address ?? null, ownerSaid: said.get(id) ?? null };
    });
    installerEmail = await sendInHouseGiveEmail({ batchId, businessId: input.businessId, jobs, actorId: input.actorId });
  } catch (error) {
    console.error("Installer email after Give failed", error instanceof Error ? error.message : "unknown");
    installerEmail = { status: "not_sent" };
  }
  return { sent, refused, installerEmail };
}