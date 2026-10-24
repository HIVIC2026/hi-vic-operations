// Jo 23 Oct (pending approval): the A1 contact-permission answer becomes an append-only owner_contact_consents row.
import { describe, expect, mock, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";

const db = new PGlite();
await db.exec(`
CREATE TABLE owner_contact_consents (id uuid primary key default gen_random_uuid(), job_id uuid, owner_id uuid, source text, consent_key text, consent_status text check (consent_status in ('granted','not_granted','unknown')), contact_consent boolean, consented_at timestamptz, snapshot jsonb, sha256 text, created_at timestamptz default clock_timestamp(), unique (job_id, source, consent_key));
CREATE TABLE workflow_events (id uuid primary key default gen_random_uuid(), job_id uuid, actor_id uuid, event_type text, summary text, details jsonb, created_at timestamptz default clock_timestamp());`);
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: postgrestShim(db) }));
const realWorkflow = await import("../src/lib/workflow.server");
mock.module("../src/lib/workflow.server", () => ({
  ...realWorkflow,
  logEvent: async (job: string, actor: string | null, type: string, summary: string, details?: unknown) => { await db.query("insert into workflow_events (job_id, actor_id, event_type, summary, details) values ($1,$2,$3,$4,$5)", [job, actor, type, summary, JSON.stringify(details ?? {})]); },
}));
const { recordMittiContactConsent, MITTI_CONSENT_SOURCE } = await import("../src/lib/mitti.server");
const JOB = "00000000-0000-0000-0000-0000000000a1", OWNER = "00000000-0000-0000-0000-0000000000a2";
const rows = async () => (await db.query<{ consent_status: string; source: string }>("select consent_status, source from owner_contact_consents order by created_at")).rows;

describe("Mitti contact permission → owner contact consent", () => {
  test("a No with no prior consent records nothing (missing already means no contact)", async () => {
    await recordMittiContactConsent(JOB, OWNER, null, false, "audit_1");
    expect(await rows()).toEqual([]);
  });
  test("Yes records one granted row from its own source; repeats add nothing", async () => {
    await recordMittiContactConsent(JOB, OWNER, null, true, "audit_1");
    await recordMittiContactConsent(JOB, OWNER, null, true, "audit_1");
    expect(await rows()).toEqual([{ consent_status: "granted", source: MITTI_CONSENT_SOURCE }]);
    expect(MITTI_CONSENT_SOURCE).not.toBe("onsite_ready_check"); // never counts as Gate A paperwork
  });
  test("a later No withdraws it by appending a not_granted row (history kept)", async () => {
    await recordMittiContactConsent(JOB, OWNER, null, false, "audit_1");
    expect((await rows()).map((r) => r.consent_status)).toEqual(["granted", "not_granted"]);
    const ev = await db.query<{ n: number }>("select count(*)::int n from workflow_events where event_type = 'mitti_contact_consent_recorded'");
    expect(ev.rows[0]!.n).toBe(2);
  });
});
