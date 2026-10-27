import { expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { offerPairBlocker } from "../src/lib/test-send.core";
import { recEligibilityBlocker, type RecCandidate } from "../src/lib/allocation.core";

const ids = ["62956b54-2e44-4c96-a156-33949b20fa82","820cf08a-504c-4016-b07e-635b54742d1a","a7f317a7-0450-47d0-8ddd-b4426cdc8aa5","02ce14a9-6e48-441e-80b7-edd0c729b3cc","1edd44a4-0cc5-41d6-8ed4-e94d375835a6","3d84ca8e-091a-4257-8b20-15e2b3889a72","17e9b9ea-abc4-40e4-9588-c9e7c504d30a","46a9e02a-94f1-4d1c-a89e-74f1cafdacc7","17793408-bf5c-4ddd-9bec-64199f64f9fb","9f84440c-d075-4f7e-8cb3-169aa2e19ccd","39347df9-b8e7-48ae-949d-6e408671b812","6a1cfe8a-9314-4f41-bcd9-4b6d15b25a0f","4beba4a5-e03b-4af8-9d24-3196249f8632"];
const protectedIds = ["a8304d2d-339b-4cbf-bcf1-fb09ce7935b0","e7efa7b8-8f5a-486e-b439-de1b39b911b5","08f2b75d-c9f9-4dfe-8d02-e903c53830b0","7de267da-1fac-4151-a65f-d0662877c528"];
const sql = readFileSync("docs/pending-migrations/jo-27oct-pause-test-trades.sql", "utf8");
test("Jo's thirteen TEST trades paused and audited; four protected businesses and identities unchanged; repeat is inert", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create table businesses(id uuid primary key,name text,onboarding_notes text,accepting_new_jobs boolean,receives_hivic_leads boolean,is_active boolean default true,onboarding_status text default 'approved'); create table admin_config_events(event_type text,summary text,details jsonb);`);
    for (const [i,id] of ids.entries()) await db.query("insert into businesses(id,name,onboarding_notes,accepting_new_jobs,receives_hivic_leads) values($1,$2,'[TEST PARTNER]', $3,$3)",[id,`TEST ${i}`,i%2===0 ? true : null]);
    for (const id of protectedIds) await db.query("insert into businesses(id,name,accepting_new_jobs,receives_hivic_leads) values($1,'REAL',true,true)",[id]);
    const before = (await db.query("select * from businesses where name='REAL' order by id")).rows;
    await db.exec(sql);
    const rows = (await db.query<{id:string;onboarding_notes:string;accepting_new_jobs:boolean;receives_hivic_leads:boolean;is_active:boolean;onboarding_status:string}>("select * from businesses where name<>'REAL'")).rows;
    expect(rows).toHaveLength(13);
    for (const b of rows) {
      expect(b.accepting_new_jobs).toBe(false); expect(b.receives_hivic_leads).toBe(false);
      expect(b.is_active).toBe(true); expect(b.onboarding_status).toBe("approved");
      expect(offerPairBlocker(b,"base44")).toBe("a real job can never be offered to a TEST partner");
      expect(offerPairBlocker(b,"qa_test")).toBeNull();
    }
    expect((await db.query("select * from businesses where name='REAL' order by id")).rows).toEqual(before);
    expect((await db.query("select * from admin_config_events")).rows).toHaveLength(13);
    await db.exec(sql);
    expect((await db.query("select * from admin_config_events")).rows).toHaveLength(13);
  } finally { await db.close(); }
});
test("normal offer flags refuse new electrician offers while a TEST journey can prepare its marked partner", () => {
  const c: RecCandidate = { business_id:ids[3],name:"TEST Delta",is_active:true,onboarding_status:"approved",accepting_new_jobs:true,receives_hivic_leads:true,coverage_verified:true,covers_postcode:true,exact_postcode:true,has_valid_licence:true,approved_workers:1,weekly_capacity:null,open_jobs:0,recent_offers_30d:0,acceptance_rate:null };
  expect(recEligibilityBlocker(c)).toBeNull();
  expect(recEligibilityBlocker({...c,accepting_new_jobs:false})).toBe("Partner is not accepting new jobs.");
  expect(recEligibilityBlocker({...c,receives_hivic_leads:false})).toBe("Partner does not receive Home Insulation Victoria jobs.");
});