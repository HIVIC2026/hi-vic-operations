import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "./workflow.server";
import { canonicalMittiTemplateId, sameMittiTemplateId } from "./mitti-identity.core";

const COL = { ready_check: "mitti_ready_check_template_id", ready_check_priced: "mitti_ready_check_priced_template_id", piesa: "mitti_piesa_template_id", piisa: "mitti_piisa_template_id" } as const;

export const getMittiForms = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  await requireAdmin(context.supabase);
  const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await admin.from("workflow_settings").select("mitti_ready_check_template_id,mitti_ready_check_priced_template_id,mitti_piesa_template_id,mitti_piisa_template_id").eq("id", 1).maybeSingle();
  if (error || !data) throw new Error(`Mitti form settings could not be loaded: ${error?.message ?? "configuration record missing"}`);
  return { ready_check: data?.mitti_ready_check_template_id ?? null, ready_check_priced: data?.mitti_ready_check_priced_template_id ?? null, piesa: data?.mitti_piesa_template_id ?? null, piisa: data?.mitti_piisa_template_id ?? null };
});

/** Fetches the Mitti form, checks it against the required list, and saves the ID only if every check passes. */
export const connectMittiForm = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ key: z.enum(["ready_check", "ready_check_priced", "piesa", "piisa"]), templateId: z.string().trim().refine(id => canonicalMittiTemplateId(id) !== null, "Use a Mitti template ID or the UUID shown in its form link.") }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    if (data.key === "piesa" || data.key === "piisa") {
      const { officialFormUseBlocker } = await import("./official-forms.core");
      const blocked = officialFormUseBlocker(data.key);
      if (blocked) return { ok: false, issues: [blocked] };
    }
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { checkMittiFormHealth } = await import("./mitti-form-health.server");
    const health = await checkMittiFormHealth(data.key, data.templateId);
    const issues = [
      ...(health.connection !== "reachable" ? [health.connectionMessage] : []),
      ...health.schemaIssues,
      ...(health.approvalBlocker ? [health.approvalBlocker] : []),
    ];
    if (!health.ok) return { ok: false, issues: issues.length ? issues : ["This form could not be verified. Check its saved ID."] };
    const result = { ok: true, issues: [] as string[], templateName: health.templateName, templateId: health.returnedId };
    const patch = data.key === "ready_check" ? { mitti_ready_check_template_id: data.templateId }
      : data.key === "ready_check_priced" ? { mitti_ready_check_priced_template_id: data.templateId }
      : data.key === "piesa" ? { mitti_piesa_template_id: data.templateId }
      : { mitti_piisa_template_id: data.templateId };
    const { data: saved, error } = await admin.from("workflow_settings").update(patch).eq("id", 1)
      .select("id,mitti_ready_check_template_id,mitti_ready_check_priced_template_id,mitti_piesa_template_id,mitti_piisa_template_id");
    if (error) throw new Error(`Could not save the form: ${error.message}`);
    if (saved?.length !== 1 || saved[0]!.id !== 1 || !sameMittiTemplateId(saved[0]![COL[data.key]], data.templateId))
      throw new Error("The form save could not be confirmed. Reload the saved forms before trying again.");
    const { error: auditError } = await admin.from("admin_config_events").insert({ actor_id: context.userId, event_type: "mitti_form_connected", summary: `${data.key} Mitti form connected after validation`, details: { column: COL[data.key], template_id: saved[0]![COL[data.key]], verified_template_id: health.returnedId } });
    if (auditError) throw new Error("The form ID was saved, but its audit entry could not be recorded. Check configuration history before repeating the connection.");
    return result;
  });

/** Checks the saved form only. The ID comes from settings, and checking never writes or approves anything. */
export const checkSavedMittiForm = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ key: z.enum(["ready_check", "ready_check_priced", "piesa", "piisa"]) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { data: settings, error } = await admin.from("workflow_settings")
      .select("mitti_ready_check_template_id,mitti_ready_check_priced_template_id,mitti_piesa_template_id,mitti_piisa_template_id")
      .eq("id", 1).maybeSingle();
    if (error || !settings) throw new Error("Mitti form settings could not be read. Try again; no form was changed.");
    const { checkMittiFormHealth } = await import("./mitti-form-health.server");
    return checkMittiFormHealth(data.key, settings[COL[data.key]] ?? null);
  });
