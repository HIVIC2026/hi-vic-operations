import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "./workflow.server";

// Admin-only: fills the official DEECA PIESA/PIISA from completed answers and files it in the Job File.
// Records only — never sends the copy to anyone.
export const fillOfficialForm = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    jobId: z.string().uuid(), form: z.enum(["piesa", "piisa"]),
    answers: z.record(z.string().max(400), z.union([z.string().max(4000), z.number(), z.boolean(), z.array(z.string().max(400)).max(20), z.null()])),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { fileOfficialPdf } = await import("./official-pdf.server");
    return fileOfficialPdf(data.jobId, context.userId, data.form, data.answers);
  });
