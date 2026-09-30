import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "./workflow.server";

const COL = { ready_check: "mitti_ready_check_template_id", ready_check_priced: "mitti_ready_check_priced_template_id", piesa: "mitti_piesa_template_id", piisa: "mitti_piisa_template_id" } as const;

export const getMittiForms = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  await requireAdmin(context.supabase);
  const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await admin.from("workflow_settings").select("mitti_ready_check_template_id,mitti_ready_check_priced_template_id,mitti_piesa_template_id,mitti_piisa_template_id").eq("id", 1).maybeSingle();
  if (error) throw new Error(`Mitti form settings could not be loaded: ${error.message}`);
  return { ready_check: data?.mitti_ready_check_template_id ?? null, ready_check_priced: data?.mitti_ready_check_priced_template_id ?? null, piesa: data?.mitti_piesa_template_id ?? null, piisa: data?.mitti_piisa_template_id ?? null };
});

/** Fetches the Mitti form, checks it against the required list, and saves the ID only if every check passes. */
export const connectMittiForm = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ key: z.enum(["ready_check", "ready_check_priced", "piesa", "piisa"]), templateId: z.string().trim().regex(/^template_[a-f0-9]{32}$/, "Mitti form IDs look like template_ followed by 32 letters/numbers.") }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { realMittiCall } = await import("./mitti.server");
    const { mittiApi } = await import("./mitti.core");
    const { validateTemplate, flattenDefinition } = await import("./mitti-forms.core");
    let def: unknown;
    try { def = await mittiApi(realMittiCall).getTemplateDefinition(data.templateId); }
    catch (e) { return { ok: false, issues: [e instanceof Error ? e.message : "Mitti could not be reached."] }; }
    const result = validateTemplate(data.key, flattenDefinition(def));
    if (!result.ok) return result;
    const { error } = await admin.from("workflow_settings").update({ [COL[data.key]]: data.templateId } as Record<string, string>).eq("id", 1);
    if (error) throw new Error(`Could not save the form: ${error.message}`);
    await admin.from("admin_config_events").insert({ actor_id: context.userId, event_type: "mitti_form_connected", summary: `${data.key} Mitti form connected after validation`, details: { column: COL[data.key], template_id: data.templateId } });
    return result;
  });
