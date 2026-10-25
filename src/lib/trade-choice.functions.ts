// Office "Choose a trade": list eligible trades nearest first, offer to ONE, or widen back to everyone.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin, WorkflowError, logEvent } from "./workflow.server";

const kind = z.enum(["ready_check", "piesa", "rectification"]);

export const listTradeChoices = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid(), kind }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { rankChoices, areaLabel } = await import("./trade-choice.core");
    const isRc = data.kind === "ready_check";
    const r = isRc
      ? await (await import("./readycheck-booking.server")).installerCandidatesFor(data.jobId)
      : await (await import("./allocation.server")).recCandidatesFor(data.jobId);
    const ids = r.candidates.map((c) => c.business_id);
    const none = ["00000000-0000-0000-0000-000000000000"];
    const [{ data: biz }, { data: asg }] = await Promise.all([
      admin.from("businesses").select("id, service_postcodes").in("id", ids.length ? ids : none),
      admin.from("job_assignments").select("business_id").eq("role", isRc ? "installer" : "electrician").eq("active", true).in("business_id", ids.length ? ids : none),
    ]);
    const pcs = new Map((biz ?? []).map((b) => [b.id, (b.service_postcodes ?? []) as string[]]));
    const load = new Map<string, number>();
    for (const a of asg ?? []) if (a.business_id) load.set(a.business_id, (load.get(a.business_id) ?? 0) + 1);
    const ranked = rankChoices(r.candidates.map((c) => ({
      business_id: c.business_id, name: c.name, blocker: c.blocker, exact_postcode: !!c.exact_postcode,
      service_postcodes: pcs.get(c.business_id) ?? [], open_jobs: load.get(c.business_id) ?? 0,
    })), r.postcode);
    return {
      postcode: r.postcode,
      trades: ranked.map((c) => ({ id: c.business_id, name: c.name, area: areaLabel(c.service_postcodes), covers: c.exact_postcode, load: c.open_jobs })),
      notEligible: r.candidates.filter((c) => c.blocker).length,
    };
  });

export const chooseTrade = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid(), kind, businessId: z.string().uuid(), rateToConfirm: z.boolean().optional(), reason: z.string().max(500).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    // Decision 389: the office Releases the spot; the installer offer runs only once the owner confirms.
    if (data.kind === "ready_check") { const r = await (await import("./spot-release.server")).releaseSpot(data.jobId, context.userId, data.businessId); return { offered: r.mode === "offered" ? 1 : 0, exhausted: false, released: r.mode === "released" }; }
    const { rateToConfirmReasonBlocker } = await import("./allocation.core");
    const b = rateToConfirmReasonBlocker(!!data.rateToConfirm, data.reason);
    if (b) throw new WorkflowError(b);
    if (data.rateToConfirm) await logEvent(data.jobId, context.userId, "rec_offer_rate_to_confirm", "Office chose to offer with the electrician rate to be confirmed", { reason: data.reason!.trim() }, { internal: true });
    return (await import("./allocation.server")).startPiesaAllocation(data.jobId, context.userId, data.kind, { rateToConfirm: !!data.rateToConfirm, onlyBusiness: data.businessId });
  });

/** After an office pick said no / ran out: go back to the normal "offer to all eligible" path. */
export const sendOfferToAll = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid(), kind }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    // Jo 24 Oct 2026 (decision 49): Ready Check offers go to ONE office-picked installer — never to everyone.
    if (data.kind === "ready_check") throw new WorkflowError("Ready Check offers go to one installer. Choose another installer on the job.");
    await logEvent(data.jobId, context.userId, "trade_choice_widened", "Office sent the offer to all eligible trades after their pick didn't take it", { kind: data.kind }, { internal: true });
    return (await import("./allocation.server")).startPiesaAllocation(data.jobId, context.userId, data.kind);
  });
