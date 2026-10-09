import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
const { data } = await admin.from("customer_email_sends").select("*").gte("created_at","2026-10-09T02:00:00Z");
for (const r of data ?? []) { const { data: j } = await admin.from("jobs").select("job_number,source").eq("id", (r as any).job_id).single();
  const keys = Object.fromEntries(Object.entries(r as any).filter(([k,v]) => typeof v === "string" && !/email|html|body|token|address|name/i.test(k) && String(v).length < 80));
  console.log(j?.job_number, j?.source, JSON.stringify(keys)); }
