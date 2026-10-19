import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "./workflow.server";
import type { EnquiryGroupRow } from "./enquiry-groups.server";

/**
 * The wire shape of one enquiry row. Shared by the full read and the paged read, so the two can never
 * drift apart and the office never sees a field on one screen that is missing on another.
 */
const wireRow = (x: EnquiryGroupRow) => ({
  id: x.id, kind: x.kind, jobNumber: x.jobNumber, reference: x.reference, name: x.name, email: x.email, phone: x.phone, address: x.address, createdAt: x.createdAt, stage: x.stage,
  group: x.group, otherReason: x.otherReason, reason: x.reason, area: x.area, areaLabel: x.areaLabel, videoState: x.videoState, nextAction: x.nextAction, lastEmail: x.lastEmail, declaredInsulation: x.declaredInsulation,
  duplicate: x.kind === "job" && !x.isPrimaryForContact, status: x.status,
  attentionReason: x.attentionReason ?? (x.status === "needs_attention" ? x.reason : null), outcomeAt: x.outcomeAt,
  mediaCount: x.mediaCount, mediaChecked: x.mediaChecked, mediaOutcome: x.mediaOutcome, removed: !!x.removed,
});

export const getEnquiryGroups = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({}).passthrough().parse(d ?? {}))
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase);
    const { loadEnquiryGroups } = await import("./enquiry-groups.server");
    const r = await loadEnquiryGroups();
    return { rows: r.rows.map(wireRow), scope: r.scope };
  });

/**
 * One server-paginated page of the enquiries workspace. Search and ordering run in the database, the
 * view is applied to the whole filtered set, and only this page's rows are sent to the browser.
 */
export const getEnquiryPage = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    view: z.string().max(40).default("all"),
    search: z.string().max(120).default(""),
    sort: z.string().max(40).default("created_at"),
    direction: z.enum(["asc", "desc"]).default("desc"),
    page: z.number().int().min(1).max(100_000).default(1),
    pageSize: z.number().int().min(1).max(100).default(20),
    fresh: z.boolean().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { loadEnquiryPage } = await import("./enquiry-groups.server");
    const r = await loadEnquiryPage(data);
    return { ...r, rows: r.rows.map(wireRow) };
  });

export const prepareEnquiryEmailsFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    ids: z.array(z.string().uuid()).min(1).max(5000),
    group: z.enum(["likely_size", "likely_no_size", "insulation_check", "other"]),
    otherReason: z.enum(["needs_review", "missing_info", "not_eligible", "progressing", "closed"]).nullable(),
    assumedAreaM2: z.number().nullable().optional(),
    withHtmlFor: z.string().uuid().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { prepareEnquiryEmails } = await import("./enquiry-groups.server");
    const { ASSUMED_REFERENCE_AREA_M2 } = await import("./enquiry-groups.core");
    const a = data.assumedAreaM2 ?? ASSUMED_REFERENCE_AREA_M2;
    if (!Number.isFinite(a) || a < 20 || a > 1000) throw new Error("Assumed area must be between 20 and 1000 m².");
    return prepareEnquiryEmails(data.ids, { group: data.group, otherReason: data.otherReason, assumedAreaM2: Math.round(a * 10) / 10 }, data.withHtmlFor);
  });

export const getLeadMedia = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { loadLeadMedia } = await import("./enquiry-groups.server");
    return loadLeadMedia(data.jobId);
  });

export const reviewLeadMediaFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ jobId: z.string().uuid(), outcome: z.enum(["below_r2", "over_r2", "unclear", "no_insulation"]) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { reviewLeadMedia } = await import("./enquiry-groups.server");
    return reviewLeadMedia(data.jobId, data.outcome, context.userId ?? null);
  });

/** Admin-only, ONE job: after an Office "no_insulation" review, sync Step 3 and run the normal guarded
 *  Save my spot sender (T1/T2). Every sender guard still applies; preview renders without sending; never forced. */
export const noInsulationSaveSpotFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ jobId: z.string().uuid(), preview: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { noInsulationSaveSpot } = await import("./enquiry-groups.server");
    return noInsulationSaveSpot(data.jobId, context.userId ?? null, data.preview);
  });

export const removeLeadsFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ ids: z.array(z.string().uuid()).min(1).max(500), reason: z.string().trim().min(2).max(200) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { removeLeads } = await import("./enquiry-groups.server");
    return removeLeads(data.ids, data.reason, context.userId ?? null);
  });

/** Explicit one-owner action, not Group B invitation or automatic sending. */
export const existingInsulationSaveSpotFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ jobId: z.string().uuid(), preview: z.boolean().default(false) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { sendExistingInsulationSaveSpot } = await import("./hot-leads-send.server");
    const r = await sendExistingInsulationSaveSpot(data.jobId, context.userId, data.preview);
    if (!data.preview) (await import("./enquiry-groups.server")).invalidateEnquirySnapshot();
    return r;
  });

/** Admin-only, ONE job: prepare/refresh the secure estimate link (Step 3). Never sends. */
export const prepareEstimateLinkFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { syncStep3 } = await import("./estimatelink.server");
    const r = await syncStep3(data.jobId, context.userId ?? null);
    (await import("./enquiry-groups.server")).invalidateEnquirySnapshot();
    return r;
  });
