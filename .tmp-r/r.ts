import { supabaseAdmin as a } from "@/integrations/supabase/client.server";
for (const id of ["1c904265-c37f-4534-9009-18d4f06e10eb","007739d7-073d-4d69-a0fc-9d3a53dbdeee"]) {
  const { data: ev } = await a.from("workflow_events").select("to_stage, created_at").eq("job_id", id).not("to_stage","is",null).order("created_at",{ascending:false}).limit(2);
  const { data: as } = await a.from("job_assignments").select("id, role, ended_at, end_reason").eq("job_id", id).eq("end_reason","TEST journey archived");
  const { data: of } = await a.from("partner_offers").select("id, kind, status, updated_at").eq("job_id", id).eq("status","withdrawn").gte("updated_at","2026-10-26T20:19:00Z");
  console.log(id, JSON.stringify({ev, as, of}));
}
