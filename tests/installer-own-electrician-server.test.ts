import { describe, expect, it, mock } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";

const db = new PGlite();
await db.exec(`
CREATE TABLE jobs(id uuid primary key, channel text, electrician_choice text, next_action text);
CREATE TABLE partner_relationships(installer_business_id uuid,electrician_business_id uuid,active boolean);
CREATE TABLE businesses(id uuid,name text,trading_name text,email text,phone text);
CREATE TABLE electrician_nominations(id uuid default gen_random_uuid(),job_id uuid,business_id uuid,nominating_business_id uuid,nominated_by uuid,nominated_for text,contact_name text,business_name text,email text,phone text,status text,ended_at timestamptz,created_at timestamptz default now());
CREATE TABLE workflow_events(job_id uuid, actor_id uuid,event_type text,summary text,details jsonb);
`);
const admin = postgrestShim(db);
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: admin }));
mock.module("../src/lib/workflow.server", () => ({ WorkflowError: Error,
  logEvent: async (job: string, actor: string, event: string, summary: string, details: unknown) => {
    await db.query("insert into workflow_events values ($1,$2,$3,$4,$5)", [job,actor,event,summary,JSON.stringify(details)]);
  },
}));
const { recordJobElectricianChoice } = await import("../src/lib/job-electrician.server");
const j1="00000000-0000-0000-0000-000000000001", j2="00000000-0000-0000-0000-000000000002";
const b1="00000000-0000-0000-0000-000000000011", b2="00000000-0000-0000-0000-000000000012";
const e1="00000000-0000-0000-0000-000000000021", e2="00000000-0000-0000-0000-000000000022";
const u1="00000000-0000-0000-0000-000000000031", u2="00000000-0000-0000-0000-000000000032";
await db.query("insert into jobs values ($1,'installer_sourced',null,null),($2,'installer_sourced',null,null)",[j1,j2]);
await db.query("insert into partner_relationships values ($1,$2,true),($3,$4,true)",[b1,e1,b2,e2]);
await db.query("insert into businesses values ($1,'ORLANDO POWERED',null,null,null),($2,'Second electrician',null,null,null)",[e1,e2]);

describe("installer electrician server boundary (practice only)", () => {
  it("rejects the retired arrangement before any job or nomination write", async () => {
    await expect(recordJobElectricianChoice(j1,b1,{mode:"hivic"},u1)).rejects.toThrow("own electricians");
    expect((await db.query("select electrician_choice from jobs where id=$1",[j1])).rows[0]?.electrician_choice).toBeNull();
    expect((await db.query("select * from electrician_nominations")).rows).toHaveLength(0);
  });
  it("two businesses cannot choose each other's electrician; each records only their own", async () => {
    await expect(recordJobElectricianChoice(j1,b1,{mode:"mine",business_id:e2},u1)).rejects.toThrow("approved electricians");
    await expect(recordJobElectricianChoice(j2,b2,{mode:"mine",business_id:e1},u2)).rejects.toThrow("approved electricians");
    await recordJobElectricianChoice(j1,b1,{mode:"mine",business_id:e1},u1);
    await recordJobElectricianChoice(j2,b2,{mode:"mine",business_id:e2},u2);
    const rows=(await db.query("select job_id,business_id,nominated_by from electrician_nominations order by job_id")).rows;
    expect(rows).toEqual([{job_id:j1,business_id:e1,nominated_by:u1},{job_id:j2,business_id:e2,nominated_by:u2}]);
    expect((await db.query("select * from workflow_events")).rows).toHaveLength(2);
  });
});