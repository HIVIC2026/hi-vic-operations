import { supabaseAdmin as a } from "@/integrations/supabase/client.server";
import { loadOffice } from "@/lib/office.server";
const o = await loadOffice(a as never, {});
const t: Record<string, string[]> = {};
for (const j of o.jobs) { const k = j.status ? `${j.status.stage}/${j.status.key}` : "none"; (t[k] ??= []).push(j.jobNumber); }
for (const [k, v] of Object.entries(t).sort()) console.log(k, v.length, k.startsWith("ready_check") ? v.join(",") : "");
