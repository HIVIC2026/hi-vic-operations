import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "./workflow.server";

export const getEnquiryGroups = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({}).passthrough().parse(d ?? {}))
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase);
    const { loadEnquiryGroups } = await import("./enquiry-groups.server");
    const r = await loadEnquiryGroups();
    return {
      rows: r.rows.map((x) => ({
        id: x.id, kind: x.kind, jobNumber: x.jobNumber, name: x.name, email: x.email, address: x.address, createdAt: x.createdAt, stage: x.stage,
        group: x.group, otherReason: x.otherReason, reason: x.reason, area: x.area, areaLabel: x.areaLabel, videoState: x.videoState, nextAction: x.nextAction, lastEmail: x.lastEmail,
        duplicate: x.kind === "job" && !x.isPrimaryForContact, status: x.status,
        attentionReason: x.attentionReason ?? (x.status === "needs_attention" ? x.reason : null), outcomeAt: x.outcomeAt,
        mediaCount: x.mediaCount, mediaChecked: x.mediaChecked, mediaOutcome: x.mediaOutcome, removed: !!x.removed, manual: x.manual,
      })),
      scope: r.scope,
    };
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
  .inputValidator((d: unknown) => z.object({ jobId: z.string().uuid(), outcome: z.enum(["below_r2", "over_r2", "unclear"]) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { reviewLeadMedia } = await import("./enquiry-groups.server");
    return reviewLeadMedia(data.jobId, data.outcome, context.userId ?? null);
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
    return sendExistingInsulationSaveSpot(data.jobId, context.userId, data.preview);
  });
