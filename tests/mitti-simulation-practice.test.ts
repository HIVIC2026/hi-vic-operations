import { afterAll, expect, mock, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
const db = new PGlite();
await db.exec("CREATE TABLE workflow_events (id serial PRIMARY KEY,job_id text,event_type text,summary text,details jsonb,created_at timestamptz DEFAULT clock_timestamp());");
const jobSources: Record<string, string> = { test1: "qa_test", test2: "qa_test", real: "base44" };
function from(table: string) {
  const filters: Record<string, unknown> = {}; let inserted: Record<string, unknown> | undefined;
  const execute = async () => {
    if (table === "jobs") return { data: jobSources[String(filters.id)] ? { source: jobSources[String(filters.id)] } : null, error: null };
    if (table === "workflow_settings") return { data: { mitti_ready_check_template_id: "tpl" }, error: null };
    if (inserted) { await db.query("INSERT INTO workflow_events(job_id,event_type,summary,details) VALUES ($1,$2,$3,$4::jsonb)", [inserted.job_id, inserted.event_type, inserted.summary, JSON.stringify(inserted.details)]); return { data: null, error: null }; }
    const out = await db.query("SELECT details FROM workflow_events WHERE job_id=$1 AND event_type=$2 AND details @> $3::jsonb ORDER BY id DESC LIMIT 1", [filters.job_id, filters.event_type, JSON.stringify(filters.details)]);
    return { data: out.rows[0] ?? null, error: null };
  };
  const builder = { select: () => builder, eq: (k: string, v: unknown) => { filters[k] = v; return builder; }, contains: (k: string, v: unknown) => { filters[k] = v; return builder; }, order: () => builder, limit: () => builder, single: execute, maybeSingle: execute, insert: (row: Record<string, unknown>) => { inserted = row; return builder; }, then: (resolve: (x: unknown) => unknown, reject: (e: unknown) => unknown) => execute().then(resolve, reject) };
  return builder;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from } }));
const { simulatedJobMitti } = await import("../src/lib/mitti-simulated.server");
afterAll(() => db.close());
test("practice database: form survives separate page/tick requests and remains job-isolated", async () => {
  const first = await simulatedJobMitti("test1");
  const created = await first("POST", "/audits", { template_id: "tpl" }) as { audit_id: string };
  const second = await simulatedJobMitti("test1");
  expect((await second("GET", `/audits/${created.audit_id}`) as { completed: boolean }).completed).toBe(false);
  await second("PUT", `/audits/${created.audit_id}`, { items: [{ item_id: "answer", label: "Measured area", type: "textsingle", responses: { text: "150" } }], completed: true });
  const third = await simulatedJobMitti("test1");
  const audit = await third("GET", `/audits/${created.audit_id}`) as { completed: boolean; items: { item_id: string }[] };
  expect(audit.completed).toBe(true); expect(audit.items.some(i => i.item_id === "answer")).toBe(true);
  const other = await simulatedJobMitti("test2");
  await expect(other("GET", `/audits/${created.audit_id}`)).rejects.toThrow("SAFETY STOP");
  await expect(simulatedJobMitti("real")).rejects.toThrow("qa_test");
});
test("legacy real form, report and media operations never fall back to real Mitti", async () => {
  const call = await simulatedJobMitti("test1");
  await expect(call("GET", "/audits/real-audit")).rejects.toThrow("real form untouched");
  await expect(call("POST", "/unrecognised")).rejects.toThrow("SAFETY STOP");
});