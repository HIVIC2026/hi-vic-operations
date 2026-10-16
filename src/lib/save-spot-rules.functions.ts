// P1-R3-S103: Office server functions for the automatic Save-my-spot sending rules.
//
// PERMISSIONS: every function is admin-only, enforced SERVER-SIDE by the existing `requireAdmin`
// (`is_admin` RPC, workflow.server.ts) — the same boundary every other communications setting uses
// (`setDispatchMode`, `connectMittiForm`, `setOwnerPrices`). The client-side `useMe().roles` check in
// the page is presentation only and authorises nothing. There is no narrower "communications settings"
// role in this codebase; see the limitations section of the S103 report.
//
// AUDIT: rule changes are appended to `admin_config_events` (actor, timestamp, previous config, new
// config), exactly like `setDispatchMode` / `connectMittiForm`. An audit failure never blocks the save
// (`.then(() => null, () => null)`), matching the existing convention.
//
// SAVING NEVER SENDS. No function here imports a sender, reserves an idempotency key or touches
// customer_email_sends. Turning automatic selection ON only makes newly qualifying enquiries eligible;
// the COM-04 master switch and the Save-my-spot secondary switch still have to be on separately.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "./workflow.server";
import {
  ELIGIBILITY_LABEL,
  ELIGIBILITY_OUTCOMES,
  ENQUIRY_DATE_LABEL,
  ENQUIRY_DATE_WINDOWS,
  INSULATION_LABEL,
  INSULATION_VALUES,
  SELECTABLE_JOB_STATUSES,
  describeRules,
  jobStatusLabel,
  validateFilters,
} from "./save-spot-rules.core";

const auditEventType = "save_my_spot_auto_rules";

/** Everything the Office screen needs to render the form, whether or not a configuration exists yet. */
export const getAutomaticSaveSpotRules = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase);
    const { readAutomaticRules, PREVIEW_SCAN_LIMIT } = await import("./save-spot-rules.server");
    const read = await readAutomaticRules();
    return {
      state: read.state,
      reason: read.state === "ok" ? "Automatic sending rules are saved." : read.reason,
      previewScanLimit: PREVIEW_SCAN_LIMIT,
      enabled: read.state === "ok" ? read.config.enabled : false,
      activatedAt: read.state === "ok" ? read.config.activatedAt : null,
      updatedAt: read.state === "ok" ? read.config.updatedAt : null,
      rules: read.state === "ok" ? read.config.rules : null,
      summary: read.state === "ok" ? describeRules(read.config.rules) : [],
      options: {
        eligibility: ELIGIBILITY_OUTCOMES.map((value) => ({ value, label: ELIGIBILITY_LABEL[value] })),
        insulation: INSULATION_VALUES.map((value) => ({ value, label: INSULATION_LABEL[value] })),
        jobStatuses: SELECTABLE_JOB_STATUSES.map((value) => ({ value, label: jobStatusLabel(value) })),
        enquiryDateWindows: ENQUIRY_DATE_WINDOWS.map((value) => ({ value, label: ENQUIRY_DATE_LABEL[value] })),
      },
    };
  });

/**
 * Save the rules. `rules` is untrusted: it is validated by the pure validator and a rejected document
 * is never written. `previousEnabled`/`previousActivatedAt` come from the loaded configuration so the
 * activation stamp is only refreshed when automatic selection is actually switched on.
 */
export const saveAutomaticSaveSpotRules = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ rules: z.unknown(), enabled: z.boolean(), previousEnabled: z.boolean(), previousActivatedAt: z.string().nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { prepareRulesForSave, readAutomaticRules } = await import("./save-spot-rules.server");
    const before = await readAutomaticRules();
    const config = prepareRulesForSave({ rules: data.rules, enabled: data.enabled, previousEnabled: data.previousEnabled, previousActivatedAt: data.previousActivatedAt, actorId: context.userId });
    const { error } = await admin.from("workflow_settings").update({ save_my_spot_auto_rules: config as never }).eq("id", 1);
    if (error) throw new Error(error.message);
    const previousConfig = before.state === "ok" ? { enabled: before.config.enabled, rules: before.config.rules } : null;
    await admin
      .from("admin_config_events")
      .insert({
        actor_id: context.userId,
        event_type: auditEventType,
        summary: `Automatic Save my spot selection ${config.enabled ? "enabled" : "disabled"} (${describeRules(config.rules).join("; ")})`,
        details: { previous_config: previousConfig, new_config: { enabled: config.enabled, rules: config.rules }, activated_at: config.activatedAt } as never,
      })
      .then(() => null, () => null);
    return { ok: true, enabled: config.enabled, activatedAt: config.activatedAt, summary: describeRules(config.rules) };
  });

/** Validate without saving — used by the "Preview before saving" step. Never writes anything. */
export const validateAutomaticSaveSpotRules = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ rules: z.unknown() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const checked = validateFilters(data.rules);
    return checked.ok ? { ok: true as const, summary: describeRules(checked.value) } : { ok: false as const, errors: checked.errors };
  });

/**
 * READ-ONLY preview. Loads the same gate logic the automatic router uses and reports the matching /
 * mandatory-excluded / manual-review / eligible totals plus a paginated list. It never sends, never
 * reserves an idempotency key, never writes a delivery record, never changes a status and never
 * triggers a workflow.
 */
export const previewAutomaticSaveSpotMatching = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ page: z.number().int().min(1).max(500).default(1) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { previewAutomaticSaveSpotMatching: preview } = await import("./save-spot-rules.server");
    return preview(data.page);
  });