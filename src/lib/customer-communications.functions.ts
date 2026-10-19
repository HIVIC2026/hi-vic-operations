import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "./workflow.server";
import { isRetiredCommunicationKey } from "./template-catalog";

const RETIRED = "This email was replaced by Jo’s approved templates (Templates › Email). It can no longer be edited or approved here.";

const templateKey = z.enum(["likely_estimate", "onsite_estimate", "ineligible_result", "estimate_unopened_3d", "area_unavailable", "measured_quote", "booking_consent", "pre_install_pack", "assignment_signing", "completion_pack"]);
const draftInput = z.object({ id: z.string().uuid().optional(), templateKey, version: z.string().trim().min(1).max(40), subject: z.string().trim().min(3).max(200), bodyMarkdown: z.string().trim().min(10).max(30000), sourceNote: z.string().trim().max(500).optional() });

export const listCustomerCommunicationTemplates = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  await requireAdmin(context.supabase);
  const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await admin.from("customer_communication_templates").select("*").order("created_at", { ascending: false });
  if (error) throw new Error(`Customer communication drafts could not be loaded: ${error.message}`);
  return data ?? [];
});

export const saveCustomerCommunicationDraft = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((data) => draftInput.parse(data))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    if (isRetiredCommunicationKey(data.templateKey)) throw new Error(RETIRED);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    if (data.id) {
      const { data: existing, error: readError } = await admin.from("customer_communication_templates").select("status").eq("id", data.id).maybeSingle();
      if (readError) throw new Error(`Draft could not be checked: ${readError.message}`);
      if (!existing || existing.status !== "draft") throw new Error("Approved and superseded versions cannot be edited. Create a new version instead.");
      const { error } = await admin.from("customer_communication_templates").update({ template_key: data.templateKey, version: data.version, subject: data.subject, body_markdown: data.bodyMarkdown, source_note: data.sourceNote ?? null }).eq("id", data.id);
      if (error) throw new Error(`Draft could not be saved: ${error.message}`);
      return { id: data.id };
    }
    const { data: created, error } = await admin.from("customer_communication_templates").insert({ template_key: data.templateKey, version: data.version, subject: data.subject, body_markdown: data.bodyMarkdown, source_note: data.sourceNote ?? null, created_by: context.userId }).select("id").single();
    if (error || !created) throw new Error(`Draft could not be created: ${error?.message ?? "unknown error"}`);
    return created;
  });

export const approveCustomerCommunicationDraft = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { data: row, error: readError } = await admin.from("customer_communication_templates").select("template_key,status").eq("id", data.id).maybeSingle();
    if (readError) throw new Error(`Draft could not be checked: ${readError.message}`);
    if (!row || row.status !== "draft") throw new Error("Only a draft can be approved.");
    if (isRetiredCommunicationKey(row.template_key)) throw new Error(RETIRED);
    const now = new Date().toISOString();
    const { error: supersedeError } = await admin.from("customer_communication_templates").update({ status: "superseded" }).eq("template_key", row.template_key).eq("status", "approved");
    if (supersedeError) throw new Error(`Earlier version could not be superseded: ${supersedeError.message}`);
    const { error } = await admin.from("customer_communication_templates").update({ status: "approved", approved_by: context.userId, approved_at: now }).eq("id", data.id).eq("status", "draft");
    if (error) throw new Error(`Draft could not be approved: ${error.message}`);
    return { approved: true };
  });