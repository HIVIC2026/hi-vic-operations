import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
const input = z.object({ jobId: z.string().uuid(), auditId: z.string().startsWith("sim_") });
export const readPracticeForm = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator(d => input.parse(d)).handler(async ({ data, context }) => {
  return (await import("./mitti-practice.server")).practiceForm(context.userId, data.jobId, data.auditId);
});
export const completePracticeForm = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator(d => input.extend({ values: z.record(z.string(), z.string().max(200)) }).parse(d)).handler(async ({ data, context }) => {
  return (await import("./mitti-practice.server")).practiceForm(context.userId, data.jobId, data.auditId, data.values);
});