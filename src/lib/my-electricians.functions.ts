import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Jo 4 Nov 2026 19:35 (G6): the installer "My electricians" page is gone — Team (/field/business/team) is the only way an
// installer adds an electrician. The installer-side functions (list / upload URL / add / details / resubmit) went with the
// page; the office approve / reject / review card on the Partners page stays, and so do the data tables.

// ---- Office (admin only): approve / reject an installer-added electrician; the business page's review card ----
const uuid = z.string().uuid();

export const getInstallerElectricianReview = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ businessId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    const { installerElectricianReview } = await import("./my-electricians.server");
    return installerElectricianReview(data.businessId);
  });

export const approveInstallerElectrician = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ businessId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    const { officeApproveInstallerElectrician } = await import("./my-electricians.server");
    await officeApproveInstallerElectrician(context.userId, data.businessId);
    return { ok: true };
  });

export const rejectInstallerElectrician = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ businessId: uuid, reason: z.string().trim().min(3, "Give a reason for not approving them.").max(500) }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    const { officeRejectInstallerElectrician } = await import("./my-electricians.server");
    await officeRejectInstallerElectrician(context.userId, data.businessId, data.reason);
    return { ok: true };
  });
