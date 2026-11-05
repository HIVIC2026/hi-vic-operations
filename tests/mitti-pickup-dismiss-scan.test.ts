import { describe, expect, mock, test } from "bun:test";

// Fake database: each table answers with fixed rows; every query method just returns the same chain.
const tables: Record<string, unknown> = {
  workflow_settings: { mitti_ready_check_template_id: "tpl_rc", mitti_ready_check_priced_template_id: null },
  admin_config_events: [{ details: { audit_id: "dismissed_1" } }],
  workflow_events: [],
  ceiling_measurements: [],
  jobs: [],
  businesses: [],
};
function chain(table: string) {
  const result = () => ({ data: tables[table] ?? [], error: null });
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "is", "order", "range", "limit", "contains", "ilike", "not"]) c[m] = () => c;
  c["maybeSingle"] = async () => ({ data: tables[table], error: null });
  c["then"] = (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res);
  return c;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: (t: string) => chain(t) } }));

const { scanMittiReadyCheckPickups } = await import("../src/lib/mitti-pickup.server");

describe("the scan skips a dismissed id", () => {
  test("a dismissed form is never read from Mitti; a new one is", async () => {
    const read: string[] = [];
    const call = async (_method: string, path: string) => {
      if (path.includes("/audits/search")) return { audits: [{ audit_id: "dismissed_1", template_id: "tpl_rc" }, { audit_id: "new_1", template_id: "tpl_rc" }], total: 2 };
      const id = decodeURIComponent(path.split("/audits/")[1] ?? "");
      read.push(id);
      return { audit_id: id, template_id: "tpl_rc", archived: false, header_items: [] };
    };
    const out = await scanMittiReadyCheckPickups(null, call as never);
    expect(read).toEqual(["new_1"]);
    expect(out.rows).toEqual([]);
  });
});
