// Office redesign build A server functions: O1 Needs me, O2 Job page, O3 Jobs, O4 Enquiries (decisions 216–249).
// Literal createServerFn chains (AGENTS); admin only; reads are read-only and actions are audited server modules.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin, WorkflowError } from "./workflow.server";
import { HEARD_CHIPS, INSULATION_CHIPS, REGION_CHIPS, SIZE_CHIPS, SOURCE_CHIPS } from "./office-filters.core";
import { JOBS_STAGE_KEYS } from "./office-jobs.core";

const uuid = z.string().uuid();
const range = z.object({ min: z.number().finite().min(0).optional(), max: z.number().finite().min(0).optional() }).optional();
/** Decision 286: per-column filters on Enquiries (text / min–max / picks). */
const columnFilters = z.object({
  job: z.string().max(40).optional(), owner: z.string().max(80).optional(), address: z.string().max(120).optional(),
  size: range, estimate: range,
  insulation: z.array(z.enum(INSULATION_CHIPS)).max(3).optional(), heard: z.array(z.enum(HEARD_CHIPS)).max(4).optional(),
}).default({});
const chips = z.object({
  insulation: z.array(z.enum(INSULATION_CHIPS)).max(3).optional(),
  size: z.array(z.enum(SIZE_CHIPS)).max(4).optional(),
  region: z.array(z.enum(REGION_CHIPS)).max(6).optional(),
  source: z.array(z.enum(SOURCE_CHIPS)).max(4).optional(),
  heard: z.array(z.enum(HEARD_CHIPS)).max(4).optional(),
  stage: z.array(z.enum(JOBS_STAGE_KEYS as [string, ...string[]])).max(6).optional(),
  installer: z.array(z.string().max(200)).max(40).optional(),
  suburb: z.string().max(80).optional(),
  ownJobs: z.boolean().optional(),
}).default({});
const reason = z.string().trim().min(3).max(500);
const tell = { tellOwner: z.boolean().default(false), tellInstaller: z.boolean().default(false) };

export const getNeedsMePage = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ includeTest: z.boolean().default(false), refresh: z.boolean().default(false) }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    // Decision 382: served from the saved copy, refreshed after the response (`refresh` = the office just acted).
    const { getNeedsMeSnapshot } = await import("./office-needs-snapshot.server");
    return getNeedsMeSnapshot(data.includeTest, data.refresh);
  });

export const getOfficeJobPage = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { loadJobPage } = await import("./office-job-page.server");
    return loadJobPage(data.jobId);
  });

export const getOfficeJobMoney = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { loadJobMoney } = await import("./office-job-page.server");
    return loadJobMoney(data.jobId);
  });

export const getEnquiriesList = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    // Decisions 281/285/286: one list, one search box (owner name, address, job number) and column headings that sort
    // AND filter (text / min–max / picks); no pile, no chip panel.
    search: z.string().max(120).default(""),
    sort: z.string().max(20).default(""), dir: z.enum(["asc", "desc"]).default("asc"), page: z.number().int().min(1).max(10_000).default(1),
    filters: columnFilters, refresh: z.boolean().default(false),
    // Jo 26 Oct 2026: the category shown (enquiry-categories.core); wantIds = every id in it (Gone quiet › Close them).
    view: z.enum(["active", "all", "replied", "new", "waiting", "failed", "quiet"]).optional(), wantIds: z.boolean().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    // Decision 383: the default first page comes from the saved copy (`refresh` = the office just acted: work it out now).
    const { getEnquiriesListServed } = await import("./office-needs-snapshot.server");
    const { refresh, ...params } = data;
    return getEnquiriesListServed(params, refresh);
  });

export const getActiveJobsList = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    search: z.string().max(120).default(""), sort: z.string().max(20).default(""), dir: z.enum(["asc", "desc"]).default("desc"),
    page: z.number().int().min(1).max(10_000).default(1), filters: chips, includeTest: z.boolean().default(false), refresh: z.boolean().default(false),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    // Decision 383: the default first page comes from the saved copy (`refresh` = the office just acted: work it out now).
    const { getActiveJobsListServed } = await import("./office-needs-snapshot.server");
    const { refresh, ...params } = data;
    return getActiveJobsListServed(params, refresh);
  });

/** Decision 227: Cancel at any time (one job). */
export const cancelOfficeJob = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, reason, note: z.string().trim().max(500).optional(), ...tell }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { cancelJobFully } = await import("./office-actions.server");
    return cancelJobFully(data.jobId, data.reason, context.userId, { note: data.note ?? null, tell: { owner: data.tellOwner, installer: data.tellInstaller } });
  });

/** Decision 227: Cancel under Actions on Jobs and Enquiries (single or bulk). Each job on its own; one failure never hides the rest. */
export const bulkCancelOfficeJobs = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobIds: z.array(uuid).min(1).max(200), reason, note: z.string().trim().max(500).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { cancelJobFully } = await import("./office-actions.server");
    const results: { jobId: string; ok: boolean; error?: string }[] = [];
    for (const jobId of data.jobIds) {
      try { await cancelJobFully(jobId, data.reason, context.userId, { note: data.note ?? null, bulk: true }); results.push({ jobId, ok: true }); }
      catch (e) { results.push({ jobId, ok: false, error: e instanceof Error ? e.message : "Failed" }); }
    }
    return { results, done: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok) };
  });

export const reopenOfficeJob = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, reason }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { reopenJob } = await import("./office-actions.server");
    return reopenJob(data.jobId, data.reason, context.userId);
  });

export const holdOfficeJob = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, reason, until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), note: z.string().trim().max(500).optional(), ...tell }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { holdJob } = await import("./office-actions.server");
    return holdJob(data.jobId, data.reason, context.userId, { until: data.until ?? null, note: data.note ?? null, tell: { owner: data.tellOwner, installer: data.tellInstaller } });
  });

export const markOfficeJobTest = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, reason }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { markJobAsTest } = await import("./office-actions.server");
    return markJobAsTest(data.jobId, data.reason, context.userId);
  });

export const logOfficeCallOrNote = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    jobId: uuid, what: z.enum(["call", "note", "email_received", "text_received"]), who: z.enum(["owner", "installer", "electrician"]),
    party: z.string().trim().max(200).optional(), said: z.string().trim().min(2).max(5000), waitingFor: z.enum(["us", "owner", "installer", "electrician", "nothing"]),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { logCallOrNote } = await import("./office-actions.server");
    return logCallOrNote(data.jobId, context.userId, { what: data.what, who: data.who, party: data.party ?? null, said: data.said, waitingFor: data.waitingFor });
  });

