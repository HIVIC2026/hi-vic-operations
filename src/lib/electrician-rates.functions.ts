// Office-only electrician/REC rate card (migration 0089, electrician_rates). Trades can never write rates.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin, WorkflowError } from "./workflow.server";
import { melbourneToday } from "@/lib/melbourne-time.core";

const SERVICES = ["piesa", "rectification_visit", "section_c_signoff", "installation_attendance"] as const;
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = { from: (t: string) => any; rpc: (f: string, a: Record<string, unknown>) => any };
const MISSING = "The electrician rate card is not switched on yet.";

export const listElectricianRates = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as Loose;
    const [{ data: biz }, rates] = await Promise.all([
      supabaseAdmin.from("businesses").select("id, name, business_type, onboarding_status").eq("business_type", "rec").order("name"),
      db.from("electrician_rates").select("*").order("created_at", { ascending: false }),
    ]);
    const customerPiesa = 349; // customer-facing PIESA price inc GST (office view only)
    return { businesses: biz ?? [], rates: rates.error ? [] : (rates.data ?? []), available: !rates.error, customerPiesaIncGst: customerPiesa };
  });

export const createElectricianRate = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ businessId: z.string().uuid(), serviceType: z.enum(SERVICES), rateIncGst: z.number().min(0).max(100000),
    effectiveFrom: date, effectiveTo: date.nullable().optional(), sourceNote: z.string().trim().min(3).max(500) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    if (data.effectiveTo && data.effectiveTo < data.effectiveFrom) throw new WorkflowError("Effective to must be on or after effective from.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as Loose;
    const { data: row, error } = await db.from("electrician_rates").insert({ business_id: data.businessId, service_type: data.serviceType, rate_inc_gst: data.rateIncGst,
      effective_from: data.effectiveFrom, effective_to: data.effectiveTo ?? null, source_note: data.sourceNote, created_by: context.userId, status: "draft" }).select("id").single();
    if (error) throw new WorkflowError(error.code === "42P01" ? MISSING : error.message);
    await db.from("electrician_rate_events").insert({ rate_id: row.id, actor_id: context.userId, event_type: "created", details: { rate_inc_gst: data.rateIncGst, service_type: data.serviceType, source_note: data.sourceNote } });
    return { id: row.id as string };
  });

export const activateElectricianRate = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await (supabaseAdmin as unknown as Loose).rpc("activate_electrician_rate", { _rate_id: data.id, _actor: context.userId });
    if (error) throw new WorkflowError(error.message);
    // Decision 303: once the REC is approved AND has an active PIESA rate, link it to the installers who named that electrician (best-effort).
    const { data: rate } = await supabaseAdmin.from("electrician_rates").select("business_id, service_type").eq("id", data.id).maybeSingle();
    if (rate?.service_type === "piesa") await (await import("./rec-auto-link.server")).autoLinkApprovedRec(rate.business_id, context.userId).catch((e) => console.error("REC auto-link skipped", (e as Error).message));
    return { ok: true };
  });

export const discardElectricianRate = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid(), reason: z.string().trim().min(3).max(500) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await (supabaseAdmin as unknown as Loose).rpc("discard_electrician_rate", { _rate_id: data.id, _actor: context.userId, _reason: data.reason });
    if (error) throw new WorkflowError(error.message);
    return { ok: true };
  });

export const expireElectricianRate = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid(), reason: z.string().trim().min(3).max(500) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as Loose;
    const today = melbourneToday();
    const { data: row, error } = await db.from("electrician_rates").update({ status: "expired", effective_to: today }).eq("id", data.id).eq("status", "active").select("id").maybeSingle();
    if (error) throw new WorkflowError(error.message);
    if (!row) throw new WorkflowError("Only an active rate can be expired.");
    await db.from("electrician_rate_events").insert({ rate_id: data.id, actor_id: context.userId, event_type: "expired", details: { reason: data.reason } });
    return { ok: true };
  });
