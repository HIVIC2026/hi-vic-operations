// RPC surface for Mitti membership: office checks one person or sweeps every trade, and the job
// page reads who is actually in Mitti. Admin-only; nothing here progresses a job or sends a form.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "./workflow.server";
import { checkAllTradeMittiAccess, verifyMittiMember } from "./mitti-membership.server";
import { MITTI_ACCESS_LABEL, mittiAccessOf, mittiCheckedLabel } from "./mitti-membership.core";

const uuid = z.string().uuid();

export const checkMittiAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ userId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const r = await verifyMittiMember(data.userId, context.userId);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    await admin.from("admin_config_events").insert({
      actor_id: context.userId,
      event_type: "mitti_membership_checked",
      summary: `Mitti access checked for ${r.email}: ${MITTI_ACCESS_LABEL[r.access]}`,
      details: { user_id: r.userId, access: r.access, mitti_user_id: r.access === "member" ? r.email : null },
    });
    return r;
  });

export const checkAllTrades = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase);
    const r = await checkAllTradeMittiAccess();
    const inMitti = r.results.filter((x) => x.access === "member").length;
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    await admin.from("admin_config_events").insert({
      actor_id: context.userId,
      event_type: "mitti_membership_sweep",
      summary: `Mitti access checked for ${r.checked} trades: ${inMitti} in Mitti, ${r.checked - inMitti} not`,
      details: { checked: r.checked, in_mitti: inMitti, remaining: r.remaining },
    });
    return r;
  });
