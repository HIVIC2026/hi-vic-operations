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
        group: x.group, otherReason: x.otherReason, reason: x.reason, area: x.area, areaLabel: x.areaLabel, videoState: x.videoState, nextAction: x.nextAction, lastEmail: x.lastEmail, declaredInsulation: x.declaredInsulation, insulationDetail: x.insulationDetail ?? null,
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
  .inputValidator((d: unknown) => z.object({ jobId: z.string().uuid(), preview: z.boolean().default(false), mode: z.enum(['preview', 'prepare', 'send']).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    if (data.mode) {
      const { reviewedInsulationOffer } = await import('./reviewed-insulation-offer.server');
      return reviewedInsulationOffer(data.jobId, context.userId, 'below_r2', data.mode);
    }
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

/** Preview and explicit Office submit only; saving an unclear review never calls this sender. Jo 22 Oct 2026:
 *  the office may send edited wording (customText) — the server still runs every guard and appends the
 *  owner's upload link automatically. */
export const morePhotosRequestFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ jobId: z.string().uuid(), mode: z.enum(["preview", "send"]), reviewId: z.string().uuid().optional(), customText: z.string().trim().max(4000).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { sendMorePhotosRequest } = await import("./hot-leads-send.server");
    return sendMorePhotosRequest(data.jobId, context.userId, data.mode === "preview", data.reviewId, data.customText);
  });


/** Explicit one-owner ineligible email after a recorded "R2 or above" photo review and Office ineligible decision.
 *  Jo 22 Oct 2026: the office may send edited wording (customText) — every guard still runs and the
 *  "Review my result" link is appended automatically. */
export const reviewedIneligibleEmailFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ jobId: z.string().uuid(), mode: z.enum(["preview", "prepare", "send"]).default("preview"), customText: z.string().trim().max(4000).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { data: rev } = await admin.from("customer_engagement_events").select("metadata").eq("job_id", data.jobId).eq("event_type", "intake_media_reviewed").eq("source", "office").order("occurred_at", { ascending: false }).limit(1);
    if ((rev?.[0]?.metadata as { outcome?: string } | undefined)?.outcome !== "over_r2") return { outcome: "blocked", detail: "The latest photo review is not R2 or above." };
    const f = await import("./followups.server");
    if (data.mode !== "send") {
      const { customerCommsEnabled } = await import("./comms.server");
      if (!(await customerCommsEnabled())) return { outcome: "blocked", detail: "Customer emails are switched off." };
      const p = await f.prepareIneligibleEmailForOffice(data.jobId);
      return p.ok ? { outcome: "preview", detail: "Preview only", preview: { subject: p.subject, html: p.html, plainText: p.plainText } } : { outcome: "blocked", detail: p.reason };
    }
    const r = await f.sendPreliminaryIneligibleEmail(data.jobId, context.userId ?? null, undefined, { ...(data.customText ? { customText: data.customText } : {}) });
    return r.sent ? { outcome: "sent", detail: "Sent" } : { outcome: r.reason === "delivered_unrecorded" ? "uncertain" : "blocked", detail: r.reason };
  });

export const getOwnerEmailsToReview = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase);
    const { listOwnerEmailsToReview } = await import("./owner-email-review.server");
    return listOwnerEmailsToReview();
  });

export const markOwnerEmailReviewedFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { markOwnerEmailReviewed } = await import("./owner-email-review.server");
    return markOwnerEmailReviewed(data.jobId, context.userId ?? null);
  });

/** Jo 23 Oct 2026: "Needs onsite assessment" holding group (not a to-do list). */
export const onsiteAssessmentListFn = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase);
    const { listOnsiteAssessment } = await import("./onsite-assessment.server");
    return listOnsiteAssessment();
  });

/** Explicit Office press only: normal Save my spot email with every usual check. */
export const onsiteAssessmentOfferFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ jobIds: z.array(z.string().uuid()).min(1).max(100) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { offerOnsiteSaveSpot } = await import("./onsite-assessment.server");
    return offerOnsiteSaveSpot(data.jobIds, context.userId ?? null);
  });
