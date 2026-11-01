// Office-authorised callers only. Allocation is atomic; approved owner notices use the guarded sender afterwards.
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { batchJobEligible, batchPartnerCovers, suggestBatches, readyInHouseBatch, type BatchJob, type InHousePartner } from "./in-house-batch.core";
import { QUICK_TAPS_ANSWERED_EVENT } from "./quick-taps.core";
import { sendInHousePartnerCall } from "./in-house-batch-email.server";
import { inHouseFactsFor } from "./installer-paid-electricians.server";
import { inHouseEnableBlockers } from "./in-house.core";
import { mittiAccessOf } from "./mitti-membership.core";
import { melbourneToday } from "./melbourne-time.core";
import { chunkIds } from "./sweep-batch.core";

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
type Job = { id: string; job_number: string; property_id: string; stage: string; source: string; channel: string; originating_installer_business_id: string | null; deleted_at: string | null };
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
export async function loadInHouseBatches() {
  const [jobs, businesses] = await Promise.all([
    pagedRows<Job>((a,b) => db.from("jobs").select("id,job_number,property_id,stage,source,channel,originating_installer_business_id,deleted_at").is("deleted_at", null).neq("source", "qa_test").not("stage", "in", "(complete,cancelled)").order("id").range(a,b)),
    pagedRows<Omit<InHousePartner, "openJobs"> & { trading_name: string | null }>((a,b) => db.from("businesses").select("id,name,trading_name,in_house,is_active,service_postcodes,covers_all_victoria,coverage_lat,coverage_lng,coverage_radius_km").eq("in_house", true).eq("is_active", true).order("id").range(a,b)),
  ]);
  const ids = jobs.map(j => j.id), propertyIds = [...new Set(jobs.map(j => j.property_id))];
  const [assignments, saved, optouts, properties, facts, events] = ids.length ? await Promise.all([
    byIds<Assignment>(ids, (c,a,b) => db.from("job_assignments").select("job_id,business_id,role").in("job_id", c).eq("active", true).order("id").range(a,b)),
    byIds<{ job_id: string; spot_saved_at: string }>(ids, (c,a,b) => db.from("lead_campaign_responses").select("job_id,spot_saved_at").in("job_id", c).not("spot_saved_at", "is", null).order("id").range(a,b)),
    byIds<{ job_id: string }>(ids, (c,a,b) => db.from("customer_email_optouts").select("job_id").in("job_id", c).not("opted_out_at", "is", null).order("id").range(a,b)),
    byIds<Property>(propertyIds, (c,a,b) => db.from("properties").select("id,postcode,address_line,suburb").in("id", c).order("id").range(a,b)),
    byIds<{ property_id: string; value: unknown }>(propertyIds, (c,a,b) => db.from("property_facts").select("property_id,value").in("property_id", c).eq("fact_key", "coordinates").eq("is_current", true).order("id").range(a,b)),
    byIds<{ job_id: string; event_type: string; details: Record<string, unknown> | null; created_at: string }>(ids, (c,a,b) => db.from("workflow_events").select("job_id,event_type,details,created_at").in("job_id", c).in("event_type", [QUICK_TAPS_ANSWERED_EVENT, "area_batch_sent"]).order("created_at", { ascending: false }).order("id", { ascending: false }).range(a,b)),
  ]) : [[], [], [], [], [], []];
  const partners: InHousePartner[] = businesses.map(b => ({ ...b, name: b.trading_name || b.name, openJobs: assignments.filter(a => a.business_id === b.id && a.role === "installer").length }));
  const batchJobs: BatchJob[] = jobs.map(j => {
    const p = properties.find(p => p.id === j.property_id), coords = facts.find(f => f.property_id === j.property_id)?.value;
    const answer = events.find(e => e.job_id === j.id && e.event_type === QUICK_TAPS_ANSWERED_EVENT)?.details;
    const batch = events.find(e => e.job_id === j.id && e.event_type === "area_batch_sent" && e.details?.["batch_id"] === answer?.["batch_id"])?.details;
    return { ...j, spot_saved_at: saved.find(s => s.job_id === j.id)?.spot_saved_at ?? null,
      quickTapsYes: answer?.["outcome"] === "pass" && answer?.["consent_share"] === true,
      waitingBusinessId: j.channel === "installer_sourced" ? j.originating_installer_business_id : typeof batch?.["installer_business_id"] === "string" ? batch["installer_business_id"] : null,
      optedOut: optouts.some(o => o.job_id === j.id), hasActiveInstaller: assignments.some(a => a.job_id === j.id && a.role === "installer"),
      postcode: p?.postcode ?? null, address: [p?.address_line, p?.suburb, p?.postcode].filter(Boolean).join(", "),
      lat: Array.isArray(coords) && typeof coords[1] === "number" ? coords[1] : null,
      lng: Array.isArray(coords) && typeof coords[0] === "number" ? coords[0] : null };
  });
  const eligibleJobs = batchJobs.filter(batchJobEligible);
  return { jobs: eligibleJobs, partners, suggestions: suggestBatches(eligibleJobs, partners) };
}

async function selectWorkers(businessId: string) {
  const blockers = inHouseEnableBlockers(await inHouseFactsFor(businessId));
  if (blockers.length) return { reason: blockers.join("; ") };
  const [workers, members] = await Promise.all([
    pagedRows<{ profile_id: string | null; trade_role: string; email: string | null; licence_expires_on: string | null; created_at: string }>((a,b) => db.from("partner_workers").select("profile_id,trade_role,email,licence_expires_on,created_at").eq("business_id", businessId).eq("approval_status", "approved").is("removed_at", null).order("created_at").order("id").range(a,b)),
    pagedRows<{ user_id: string }>((a,b) => db.from("business_members").select("user_id").eq("business_id", businessId).eq("active", true).order("id").range(a,b)),
  ]);
  const ids = workers.flatMap(w => w.profile_id ? [w.profile_id] : []);
  const profiles = await byIds<{ id: string; email: string | null; mitti_user_id: string | null; mitti_checked_email: string | null; mitti_checked_at: string | null }>(ids, (c,a,b) => db.from("profiles").select("id,email,mitti_user_id,mitti_checked_email,mitti_checked_at").in("id", c).order("id").range(a,b));
  const live = workers.filter(w => !!w.profile_id && members.some(m => m.user_id === w.profile_id)).sort((a,b) => a.created_at.localeCompare(b.created_at) || (a.profile_id ?? "").localeCompare(b.profile_id ?? ""));
  const installer = live.find(w => w.trade_role === "installer");
  const electricians = live.filter(w => {
    const profile = profiles.find(p => p.id === w.profile_id);
    return w.trade_role === "electrician" && (!w.licence_expires_on || w.licence_expires_on >= melbourneToday()) && !!profile && mittiAccessOf({ ...profile, email: w.email ?? profile.email }) === "member";
  });
  // Choose the business's primary/approved electrician first if a worker marker exists, else the earliest created_at.
  // Live partner_workers has no primary marker; partner_relationships.is_primary identifies a BUSINESS, not a worker.
  const electrician = electricians[0];
  if (!installer?.profile_id || !electrician?.profile_id) return { reason: "No in-house electrician with approved active access" };
  return { installer: installer.profile_id, electrician: electrician.profile_id };
}

export async function sendInHouseBatch(input: { businessId: string; jobIds: string[]; actorId: string }): Promise<{ sent: string[]; refused: { jobId: string; reason: string }[] }> {
  const sent: string[] = [], refused: { jobId: string; reason: string }[] = [];
  const batchId = crypto.randomUUID();
  const screen = await loadInHouseBatches();
  const partner = screen.partners.find(p => p.id === input.businessId);
  const requested = [...new Set(input.jobIds)];
  if (partner) {
    const eligible = requested.filter(id => screen.jobs.some(j => j.id === id && batchPartnerCovers(j, partner) && (!j.waitingBusinessId || j.waitingBusinessId === partner.id)));
    const ready = readyInHouseBatch(eligible);
    if (!ready.length) return { sent, refused: requested.map(jobId => ({ jobId, reason: "Waiting for 5 eligible jobs for this installer" })) };
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
  return { sent, refused };
}