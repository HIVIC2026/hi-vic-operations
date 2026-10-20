import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "./workflow.server";
import { ENQUIRY_VIEWS } from './enquiry-list-page.core';
import type { EnquiryPageView } from './enquiry-list-page.core';

export const getEnquiryGroups = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ view: z.string().default('all').refine(v => ENQUIRY_VIEWS.includes(v as EnquiryPageView)), search: z.string().max(300).default(''), page: z.number().int().min(1).default(1) }).parse(d ?? {}))
  .handler(async ({ context, data }) => {
    await requireAdmin(context.supabase);
    const { loadOfficeEnquiryPage } = await import("./office-enquiry-page.server");
    const r = await loadOfficeEnquiryPage(data.view as EnquiryPageView, data.search, data.page);
    return {
      rows: r.rows.map((x) => ({
        id: x.id, kind: x.kind, jobNumber: x.jobNumber, reference: x.reference, name: x.name, email: x.email, phone: x.phone, address: x.address, createdAt: x.createdAt, stage: x.stage,
        group: x.group, otherReason: x.otherReason, reason: x.reason, area: x.area, areaLabel: x.areaLabel, videoState: x.videoState, nextAction: x.nextAction, lastEmail: x.lastEmail, declaredInsulation: x.declaredInsulation,
        duplicate: x.kind === "job" && !x.isPrimaryForContact, status: x.status,
        attentionReason: x.attentionReason ?? (x.status === "needs_attention" ? x.reason : null), outcomeAt: x.outcomeAt, needsFirstResponse: x.needsFirstResponse,
        mediaCount: x.mediaCount, mediaChecked: x.mediaChecked, mediaOutcome: x.mediaOutcome, removed: !!x.removed,
        responseState: x.responseState, latestAttemptStatus: x.latestAttemptStatus, latestAttemptAt: x.latestAttemptAt, mediaToReview: x.mediaToReview, nextParty: x.nextParty,
      })),
      counts: r.counts, responses: r.responses, total: r.total, page: r.page, pageSize: r.pageSize, totalPages: r.totalPages,
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
  .inputValidator((d: unknown) => z.object({ jobId: z.string().uuid(), outcome: z.enum(["no_insulation", "below_r2", "over_r2", "unclear"]), reason: z.string().max(500).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { reviewLeadMedia } = await import("./enquiry-groups.server");
    return reviewLeadMedia(data.jobId, data.outcome, context.userId ?? null, data.reason);
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

/** Explicit one-owner no-insulation offer after a recorded "no insulation" photo review. */
export const noInsulationSaveSpotFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ jobId: z.string().uuid(), mode: z.enum(["preview", "prepare", "send"]).default("preview") }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { noInsulationOffer } = await import("./no-insulation-offer.server");
    return noInsulationOffer(data.jobId, context.userId, data.mode);
  });
