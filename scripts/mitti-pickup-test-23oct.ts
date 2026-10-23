// TEST ONLY (Jo 23 Oct): one TEST A1 form adopted for [TEST PARTNER] Reinsulate through the real pickup sweep. Sends nothing.
import { mittiApi, norm } from "../src/lib/mitti.core";
import { realMittiCall } from "../src/lib/mitti.server";
import { sweepMittiPickupAuto } from "../src/lib/mitti-pickup-auto.server";
import { supabaseAdmin as admin } from "../src/integrations/supabase/client.server";
const TEST_BIZ = { id: "17793408-bf5c-4ddd-9bec-64199f64f9fb", name: "[TEST PARTNER] Reinsulate", userId: "16f7dd86-f4df-4ae0-a1af-d18e8d3a2635" };
const api = mittiApi(realMittiCall);
const { data: ws } = await admin.from("workflow_settings").select("mitti_ready_check_priced_template_id").eq("id", 1).single();
let auditId = process.argv[2];
if (!auditId) {
  const a = await api.createAudit({ template_id: ws!.mitti_ready_check_priced_template_id! });
  auditId = String(a.audit_id);
  const full = await api.getAudit(auditId);
  const hi = (full.header_items ?? []) as any[];
  const pick = (l: string) => hi.find((i) => norm(i.label).startsWith(norm(l)));
  const items = [[pick("Homeowner name"), "TEST Pickup Owner"], [pick("Site address"), "1 Test Street, Testville, Victoria, 3999"]]
    .filter(([i]) => i).map(([i, v]: any) => ({ item_id: i.item_id, type: i.type, responses: i.type === "address" ? { location_text: v } : { text: v } }));
  try { await api.updateAuditHeader(auditId, items); } catch { await api.updateAuditText(auditId, items); }
}
const au = await api.getAudit(auditId);
const author = String(au?.audit_data?.authorship?.owner_id ?? "");
console.log("TEST form", auditId, "author", author);
const r = await sweepMittiPickupAuto({ force: true, onlyAuditIds: [auditId], businessOverride: new Map([[author, TEST_BIZ]]) });
console.log(JSON.stringify(r, null, 1));
const again = await sweepMittiPickupAuto({ force: true, onlyAuditIds: [auditId], businessOverride: new Map([[author, TEST_BIZ]]) });
console.log("second run (must be empty):", JSON.stringify(again.results));
process.exit(0);
