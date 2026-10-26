import { supabaseAdmin as a } from "@/integrations/supabase/client.server";
for (const [id, asg] of [["1c904265-c37f-4534-9009-18d4f06e10eb","018e811b-2d9f-4825-a473-7655b0f5ed98"],["007739d7-073d-4d69-a0fc-9d3a53dbdeee","3f6bb9cc-e796-42ce-8fcb-cc7920e72066"]]) {
  const r1 = await a.from("jobs").update({ qa_archived_at: null, stage: "measured_quote_accepted", cancelled_reason: null }).eq("id", id).eq("source","qa_test").select("job_number, stage, qa_archived_at");
  const r2 = await a.from("job_assignments").update({ active: true, ended_at: null, end_reason: null }).eq("id", asg).select("active");
  console.log(JSON.stringify(r1.data), r1.error?.message, JSON.stringify(r2.data), r2.error?.message);
}
