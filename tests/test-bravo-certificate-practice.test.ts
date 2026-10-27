import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { journeyDb } from "./helpers/pglite-journey-db";

test("Jo's Bravo preparation is current Full, retry-safe and leaves Alpha and offer flags untouched", async () => {
  const j = await journeyDb();
  try {
    await j.db.exec("ALTER TABLE partner_workers ADD COLUMN IF NOT EXISTS worker_role text;");
    await j.q(`insert into profiles (id,email) values ('36b849de-1cde-425c-a05d-623f8985bbd6','admin@hivic.test'),('c1a8f7d0-d425-47e5-b050-6f79194729b5','qa.installer.bravo@hivic-test.example')`);
    await j.q(`insert into businesses (id,name,email,onboarding_notes,business_type,accepting_new_jobs,receives_hivic_leads) values ('820cf08a-504c-4016-b07e-635b54742d1a','TEST Bravo Insulation','qa.installer.bravo@hivic-test.example','[TEST PARTNER]','eec_installer',false,false),('62956b54-2e44-4c96-a156-33949b20fa82','TEST Alpha Insulation','qa.installer.alpha@hivic-test.example','[TEST PARTNER]','eec_installer',false,false)`);
    const alpha = await j.q("select * from businesses where name='TEST Alpha Insulation'");
    const sql = readFileSync("docs/pending-migrations/jo-27oct-test-bravo-certificate.sql", "utf8");
    await j.db.exec(sql); await j.db.exec(sql);
    expect(await j.q("select * from businesses where name='TEST Alpha Insulation'")).toEqual(alpha);
    const [b] = await j.q<{ service_postcodes: string[]; accepting_new_jobs: boolean; receives_hivic_leads: boolean }>("select service_postcodes,accepting_new_jobs,receives_hivic_leads from businesses where name='TEST Bravo Insulation'");
    expect(b?.service_postcodes).toEqual(["3199"]);
    expect(b?.accepting_new_jobs).toBe(false); expect(b?.receives_hivic_leads).toBe(false);
    expect(await j.q("select level,expires_on::text from worker_certification_levels")).toEqual([{ level: "full", expires_on: "2028-10-27" }]);
    expect(await j.q("select approval_status from partner_workers")).toEqual([{ approval_status: "pending" }]);
    expect((await j.q("select id from partner_worker_certifications")).length).toBe(1);
    expect((await j.q("select id from business_credentials")).length).toBe(2);
  } finally { await j.db.close(); }
});