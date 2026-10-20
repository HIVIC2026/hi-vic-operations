// TEMPORARY read-only checks. Deleted after this run. No writes.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { checkMittiFormHealth } from "../../src/lib/mitti-form-health.server";
import { realMittiCall } from "../../src/lib/mitti.server";
import { checkOutlookConnection } from "../../src/lib/outlook-sync.server";
import { xeroConnectionStatus } from "../../src/lib/xero.server";
const out: Record<string, unknown> = {};
const { data: s, error } = await admin.from("workflow_settings").select("mitti_ready_check_template_id,mitti_ready_check_priced_template_id,mitti_piesa_template_id,mitti_piisa_template_id").eq("id", 1).maybeSingle();
if (error || !s) { console.log("settings unreadable"); process.exit(1); }
const map = { ready_check: s.mitti_ready_check_template_id, ready_check_priced: s.mitti_ready_check_priced_template_id, piesa: s.mitti_piesa_template_id, piisa: s.mitti_piisa_template_id } as const;
for (const [k, id] of Object.entries(map)) {
  try { const h = await checkMittiFormHealth(k as never, id ?? null); out["mitti_" + k] = { savedId: id, connection: h.connection, identity: h.identity, returnedId: h.returnedId, templateName: h.templateName, schema: h.schema, schemaIssueCount: h.schemaIssues.length, schemaIssues: h.schemaIssues.slice(0, 6), approvalBlocker: h.approvalBlocker, ok: h.ok }; }
  catch (e) { out["mitti_" + k] = { error: e instanceof Error ? e.message.slice(0, 200) : "error" }; }
}
try {
  const r = await realMittiCall("GET", "/templates/search?field=template_id&field=name&field=modified_at&limit=1000&archived=false") as unknown;
  const top = r && typeof r === "object" ? Object.keys(r as object) : [];
  const list: Record<string, unknown>[] = Array.isArray(r) ? r : (Object.values(r as object).find(Array.isArray) as Record<string, unknown>[] | undefined) ?? [];
  out.search = { topKeys: Array.isArray(r) ? "array" : top, count: list.length, sampleKeys: list[0] ? Object.keys(list[0]) : [],
    candidates: list.filter(t => /piesa|electrical|safety|piisa|ready|insulation|measure/i.test(String(t["name"] ?? ""))).map(t => ({ id: t["template_id"] ?? t["id"], name: t["name"], modified: t["modified_at"] })) };
} catch (e) { const x = e as { status?: number; code?: string }; out.search = { failed: true, status: x.status ?? null, code: x.code ?? null }; }
try { const o = await checkOutlookConnection(); out.outlook = o; } catch (e) { out.outlook = { error: e instanceof Error ? e.message.slice(0, 200) : "error" }; }
try { const x = await xeroConnectionStatus(); out.xero = x; } catch (e) { out.xero = { error: e instanceof Error ? e.message.slice(0, 200) : "error" }; }
console.log(JSON.stringify(out, null, 1));
