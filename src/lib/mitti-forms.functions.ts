import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "./workflow.server";
import { canonicalMittiTemplateId, sameMittiTemplateId } from "./mitti-identity.core";

const COL = { ready_check: "mitti_ready_check_template_id", ready_check_priced: "mitti_ready_check_priced_template_id", piesa: "mitti_piesa_template_id", piisa: "mitti_piisa_template_id", fixes: "mitti_fixes_template_id" } as const;
const KEYS = ["ready_check", "ready_check_priced", "piesa", "piisa", "fixes"] as const;
// Decision 293: the fixes column arrives with a pending migration; the row is read whole so a missing column reads as
// "not set up" instead of failing every form read, and a save into it fails closed with the migration named.
const SETTINGS_COLUMNS = "*";
const isMissingColumn = (e: { code?: string; message?: string } | null | undefined) => !!e && (e.code === "42703" || e.code === "PGRST204" || /mitti_fixes_template_id/.test(e.message ?? ""));

export const getMittiForms = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  await requireAdmin(context.supabase);
  const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await admin.from("workflow_settings").select(SETTINGS_COLUMNS).eq("id", 1).maybeSingle();
  if (error || !data) throw new Error(`Mitti form settings could not be loaded: ${error?.message ?? "configuration record missing"}`);
  const row = data as unknown as Record<string, string | null | undefined>;
  return { ready_check: row["mitti_ready_check_template_id"] ?? null, ready_check_priced: row["mitti_ready_check_priced_template_id"] ?? null, piesa: row["mitti_piesa_template_id"] ?? null, piisa: row["mitti_piisa_template_id"] ?? null,
    fixes: row["mitti_fixes_template_id"] ?? null, fixesPendingMigration: !("mitti_fixes_template_id" in row) };
});

/** Fetches the Mitti form, checks it against the required list, and saves the ID only if every check passes. */
export const connectMittiForm = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ key: z.enum(KEYS), templateId: z.string().trim().refine(id => canonicalMittiTemplateId(id) !== null, "Use a Mitti template ID or the UUID shown in its form link.") }).parse(d))
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
      : data.key === "piisa" ? { mitti_piisa_template_id: data.templateId }
      : { mitti_fixes_template_id: data.templateId };
    const { data: saved, error } = await admin.from("workflow_settings").update(patch as never).eq("id", 1).select(SETTINGS_COLUMNS);
    if (error && data.key === "fixes" && isMissingColumn(error)) { const { FIXES_TEMPLATE_PENDING_DB } = await import("./fixes-day.core"); return { ok: false, issues: [FIXES_TEMPLATE_PENDING_DB] }; }
    if (error) throw new Error(`Could not save the form: ${error.message}`);
    const savedRow = (saved?.[0] ?? null) as unknown as Record<string, unknown> | null;
    if (saved?.length !== 1 || savedRow?.["id"] !== 1 || !sameMittiTemplateId(String(savedRow?.[COL[data.key]] ?? ""), data.templateId))
      throw new Error("The form save could not be confirmed. Reload the saved forms before trying again.");
    const { error: auditError } = await admin.from("admin_config_events").insert({ actor_id: context.userId, event_type: "mitti_form_connected", summary: `${data.key} Mitti form connected after validation`, details: { column: COL[data.key], template_id: String(savedRow?.[COL[data.key]] ?? ""), verified_template_id: health.returnedId } });
    if (auditError) throw new Error("The form ID was saved, but its audit entry could not be recorded. Check configuration history before repeating the connection.");
    return result;
  });

/** Checks the saved form only. The ID comes from settings, and checking never writes or approves anything. */
export const checkSavedMittiForm = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ key: z.enum(KEYS) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { data: settings, error } = await admin.from("workflow_settings").select(SETTINGS_COLUMNS).eq("id", 1).maybeSingle();
    if (error || !settings) throw new Error("Mitti form settings could not be read. Try again; no form was changed.");
    const { checkMittiFormHealth } = await import("./mitti-form-health.server");
    const row = settings as unknown as Record<string, string | null | undefined>;
    return checkMittiFormHealth(data.key, row[COL[data.key]] ?? null);
  });
