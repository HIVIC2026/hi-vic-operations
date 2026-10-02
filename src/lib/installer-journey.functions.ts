import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { evidenceFromRecords, installerNextAction, journeyStepFor, JOURNEY, piisaCarryOver, readyCheckCoverage, type ElectricianChoice } from "./installer-led.core";
import { readyCheckVariant } from "./mitti-forms.core";
import { readyCheckTemplateText } from "./ready-check-template.core";

/** Read-only installer journey for an installer-led job. RLS-scoped as the caller. */
export const getInstallerJourney = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { data: job, error } = await sb.from("jobs").select("id, stage, installer_led, electrician_choice, eligibility_outcome, channel, job_number").eq("id", data.jobId).maybeSingle();
    if (error) throw new Error("Could not load job");
    if (!job || !job.installer_led) return null;
    const [{ data: m }, { data: ev }, { data: asg }] = await Promise.all([
      sb.from("ceiling_measurements").select("measured_area_m2, supplied_area_m2, insulation_present, existing_r_value, removal_required, raw_snapshot").eq("job_id", data.jobId).eq("is_current", true).maybeSingle(),
      sb.from("evidence_requirements").select("category").eq("job_id", data.jobId).in("status", ["uploaded", "verified"]),
      sb.from("job_assignments").select("role").eq("job_id", data.jobId).eq("role", "electrician"),
    ]);
    const outcome = job.eligibility_outcome as string | null;
    const eligible = outcome === "does_not_appear_eligible" ? false : outcome ? true : null;
    const cats = (ev ?? []).map((e) => e.category as string);
    const coverage = readyCheckCoverage(evidenceFromRecords(m ? { ...m, raw_snapshot: (m.raw_snapshot as Record<string, unknown> | null) } : null, cats, eligible === true ? false : null));
    const assigned = (asg ?? []).length > 0;
    const choice = (job.electrician_choice as ElectricianChoice | null) ?? null;
    const step = journeyStepFor(job.stage);
    const jobNumber = typeof job.job_number === "string" ? job.job_number : null;
    return {
      steps: JOURNEY, currentIndex: JOURNEY.findIndex((s) => s.key === step),
      eligible, coverage, electricianAssigned: assigned,
      next: installerNextAction({ eligible, coverage, electrician: choice, electricianApproved: assigned }),
      // C02: gaps the installer didn't supply are brought with the PIISA; anything that decides
      // eligibility or price has to be settled first.
      carryOver: piisaCarryOver(coverage.missing),
      template: readyCheckTemplateText(readyCheckVariant(job.channel as string | null), { jobNumber }),
      templateFileName: `ready-check-${(jobNumber ?? "sheet").replace(/[^A-Za-z0-9._-]/g, "-")}.txt`,
    };
  });
