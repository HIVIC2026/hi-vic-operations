import { expect, mock, test } from "bun:test";
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
const { recordTestCentreConsent } = await import("../src/lib/test-centre-consent.server");
function fixture(source = "qa_test") {
  const rows: Record<string, unknown>[] = [];
  const db = { from(table: string) {
    const q = { select() { return q; }, eq() { return q; }, async maybeSingle() { return { data: table === "jobs" ? { source, owner_id: "owner" } : rows[0] ?? null, error: null }; }, async insert(row: Record<string, unknown>) { rows.push(row); return { error: null }; } };
    return q;
  } };
  return { db: db as never, rows };
}
test("checked TEST tick records granted consent with submitted timestamp and TEST provenance once", async () => {
  const f = fixture(); const input = { contact_consent: true, contact_consent_version: "website-v1", contact_consented_at: "2026-11-06T10:35:33.731Z" };
  await recordTestCentreConsent("test-job", input, f.db);
  await recordTestCentreConsent("test-job", input, f.db);
  expect(f.rows).toHaveLength(1);
  expect(f.rows[0]).toMatchObject({ source: "qa_test", consent_status: "granted", consented_at: input.contact_consented_at, job_id: "test-job", owner_id: "owner" });
});
test("unchecked TEST tick records not granted", async () => {
  const f = fixture(); await recordTestCentreConsent("test-job", { contact_consent: false }, f.db);
  expect(f.rows[0]?.consent_status).toBe("not_granted");
});
test("missing TEST tick never grants consent", async () => {
  const f = fixture(); await recordTestCentreConsent("test-job", {}, f.db);
  expect(f.rows[0]?.consent_status).toBe("unknown");
});
test("real job is refused without consent write", async () => {
  const f = fixture("base44"); await expect(recordTestCentreConsent("real-job", { contact_consent: true }, f.db)).rejects.toThrow("TEST job");
  expect(f.rows).toHaveLength(0);
});