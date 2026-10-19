// STEP 17: manual outcome rows against the REAL job_communications DDL (drizzle 0020) on isolated PGlite, written by the
// real recordCommunication. Proves: no migration needed, rows are immutable, only "Sent manually" reads as owner contact,
// and Office-only visibility is hidden from the homeowner. Never touches a live database.
import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";
import { MANUAL_OUTCOME_ORDER, MANUAL_SENDER, manualRecordContent, planManualRecord, type ManualOutcome } from "../src/lib/manual-communication.core";

const JOB = "00000000-0000-4000-8000-0000000000d1", OFFICE = "00000000-0000-4000-8000-0000000000a1", OWNER = "00000000-0000-4000-8000-0000000000e1";
const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE TABLE public.jobs (id uuid primary key);
  CREATE TABLE public.admins (user_id uuid primary key);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT exists(SELECT 1 FROM public.admins WHERE user_id = auth.uid()) $$;
  CREATE FUNCTION public.is_job_owner(j uuid, u uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT u = '${OWNER}'::uuid $$;
  CREATE FUNCTION public.job_assignment_role(j uuid, u uuid) RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULL::text $$;
  GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
  GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public, auth TO authenticated, service_role;
  INSERT INTO public.jobs(id) VALUES ('${JOB}'); INSERT INTO public.admins(user_id) VALUES ('${OFFICE}');
`);
await db.exec(readFileSync("drizzle/migrations/0020_job_communications.sql", "utf8"));
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: postgrestShim(db) }));
mock.module("../src/lib/workflow.server", () => ({ WorkflowError: class WorkflowError extends Error {} }));
const { recordCommunication } = await import("../src/lib/comms.server");

/** Exactly the fields recordManualCommunication passes (asserted separately in manual-communication.server.test.ts). */
async function record(outcome: ManualOutcome) {
  const input = outcome === "sent_manually"
    ? { outcome, template: "save_my_spot" as const, subject: "Save your spot", body: "Hi Sam,\n\nYour preliminary price and link: https://estimate.example/abc\n" }
    : { outcome, note: `Office note for ${outcome}` };
  const plan = planManualRecord(outcome), content = manualRecordContent(input);
  return recordCommunication({
    jobId: JOB, direction: plan.direction, channel: plan.channel, senderText: MANUAL_SENDER, senderUserId: OFFICE,
    recipients: plan.channel === "email" ? ["owner@home.test.au"] : [], subject: content.subject, body: content.body,
    provider: plan.provider, deliveryStatus: plan.deliveryStatus, visibility: plan.visibility,
    sourceEvent: plan.sourceEvent, sourceReference: content.sourceReference, createdBy: OFFICE,
  });
}

describe("manual outcomes on the real job_communications table", () => {
  test("all four outcomes satisfy the existing CHECK constraints (no migration) with actor + timestamp", async () => {
    for (const o of MANUAL_OUTCOME_ORDER) expect(typeof (await record(o))).toBe("string");
    const rows = (await db.query<{ source_event: string; direction: string; channel: string; provider: string; delivery_status: string; visibility: string; created_by: string; sent_at: Date | null; created_at: Date }>(
      `SELECT source_event, direction, channel, provider, delivery_status, visibility, created_by, sent_at, created_at FROM public.job_communications WHERE job_id = $1 ORDER BY created_at, id`, [JOB])).rows;
    expect(rows.length).toBe(4);
    for (const r of rows) { expect(r).toMatchObject({ provider: "manual", delivery_status: "recorded", visibility: "internal", created_by: OFFICE }); expect(r.created_at).toBeTruthy(); }
    expect(new Set(rows.map((r) => r.source_event))).toEqual(new Set(MANUAL_OUTCOME_ORDER.map((o) => `manual_office_communication:${o}`)));
  });
  test("only 'Sent manually' matches the Office owner-contact read (outbound + sent_at)", async () => {
    const contact = (await db.query<{ source_event: string }>(`SELECT source_event FROM public.job_communications WHERE job_id = $1 AND direction = 'outbound' AND sent_at IS NOT NULL`, [JOB])).rows;
    expect(contact.map((r) => r.source_event)).toEqual(["manual_office_communication:sent_manually"]);
  });
  test("records are permanent: content can't be edited or deleted", async () => {
    await expect(db.query(`UPDATE public.job_communications SET body = 'changed' WHERE job_id = $1`, [JOB])).rejects.toThrow("immutable");
    await expect(db.query(`DELETE FROM public.job_communications WHERE job_id = $1`, [JOB])).rejects.toThrow("permanent");
  });
  test("Office-only: the homeowner can't read them; Office can", async () => {
    const asUser = async (uid: string) => {
      await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${uid}', false);`);
      try { return (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.job_communications WHERE job_id = $1`, [JOB])).rows[0]?.n; }
      finally { await db.exec(`RESET ROLE;`); }
    };
    expect(await asUser(OWNER)).toBe(0);
    expect(await asUser(OFFICE)).toBe(4);
  });
});
