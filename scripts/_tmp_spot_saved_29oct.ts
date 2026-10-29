import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { sendSpotSavedConfirmation } from "@/lib/spot-saved-send.server";
const nums = ["HV-3575","HV-3272","HV-3502","HV-3110","HV-3565","HV-1269","HV-3373","HV-2522","HV-1160","HV-1263","HV-3310"];
const dry = process.argv[2] !== "send";
const { data } = await admin.from("jobs").select("id, job_number").in("job_number", nums);
for (const n of nums) { const j = data?.find((x) => x.job_number === n); if (!j) { console.log(n, "NOT FOUND"); continue; }
  const r = await sendSpotSavedConfirmation(j.id, { emailOnly: true, dry }); console.log(n, JSON.stringify(r.email)); }
