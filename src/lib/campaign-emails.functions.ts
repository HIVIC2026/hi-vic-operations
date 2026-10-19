// Office "Campaign emails" review page: hot-list leads per group + draft wording. Never sends anything.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const DRAFT_EVENT = "campaign_email_draft";
const RETIRED = true as boolean;
const group = z.enum(["likely", "onsite"]);
const copy = z.object({
  subject: z.string().max(200), previewText: z.string().max(300), headline: z.string().max(200), intro: z.string().max(1000),
  video: z.string().max(1000), nextTitle: z.string().max(200), urgency: z.string().max(500), button: z.string().max(80),
}).partial();

export const getCampaignEmailReview = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    const { loadHotLeads } = await import("./hot-leads.server");
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const [a, b, { data: drafts, error }] = await Promise.all([
      loadHotLeads("likely"), loadHotLeads("onsite"),
      admin.from("admin_config_events").select("details, created_at").eq("event_type", DRAFT_EVENT).order("created_at", { ascending: false }).limit(50),
    ]);
    if (error) throw new Error(`Couldn't load saved drafts: ${error.message}`);
    const lead = (r: (typeof a.covered)[number]) => ({ id: r.id, jobNumber: r.jobNumber, name: r.name, suburb: r.suburb, address: r.address ?? null, area: r.area, price: r.price, discount: r.discount });
    const latest = (g: string) => {
      const d = (drafts ?? []).find((x) => (x.details as { group?: string } | null)?.group === g);
      return d ? { copy: ((d.details as { copy?: Record<string, string> }).copy ?? {}), savedAt: d.created_at } : { copy: {}, savedAt: null };
    };
    return {
      likely: { leads: a.covered.filter((r) => r.price && r.discount).map(lead), draft: latest("likely") },
      onsite: { leads: b.covered.filter((r) => r.price && r.discount).map(lead), draft: latest("onsite") },
      sendingLocked: true,
    };
  });

/** Save the office's draft wording for one group. Drafts only — nothing is sent or approved by saving. */
export const saveCampaignEmailDraft = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ group, copy }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    // P1-S77: superseded campaign copy can no longer be edited (Jo's approved templates replace it).
    if (RETIRED) throw new Error("Campaign email copy was replaced by Jo’s approved templates (Templates › Email). Nothing was saved.");
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { error } = await admin.from("admin_config_events").insert({ actor_id: context.userId, event_type: DRAFT_EVENT, summary: `Campaign email draft saved (${data.group === "likely" ? "Group A" : "Group B"})`, details: { group: data.group, copy: data.copy } });
    if (error) throw new Error(`Couldn't save the draft: ${error.message}`);
    return { ok: true, savedAt: new Date().toISOString() };
  });
