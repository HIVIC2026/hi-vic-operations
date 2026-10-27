import { beforeAll, afterAll, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { launchCampaignDb, LAUNCH_ID } from './helpers/pglite-launch-campaign';

const db = await launchCampaignDb();
const migration = readFileSync('docs/pending-migrations/campaign-spot-save-atomic.sql', 'utf8');
beforeAll(async () => {
  await db.exec(`
    CREATE TYPE public.job_stage AS ENUM ('new_enquiry','eligibility_review','preliminary_estimate_ready','ready_check_ready_to_schedule','on_hold','cancelled','complete','ready_check_scheduled');
    ALTER TABLE jobs ADD stage job_stage DEFAULT 'preliminary_estimate_ready', ADD deleted_at timestamptz, ADD qa_archived_at timestamptz,
      ADD next_action text, ADD last_activity_at timestamptz, ADD prior_stage job_stage, ADD hold_reason text, ADD cancelled_reason text;
    CREATE TABLE workflow_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),job_id uuid REFERENCES jobs(id),actor_id uuid,
      event_type text,summary text,details jsonb,from_stage job_stage,to_stage job_stage,internal boolean DEFAULT false,created_at timestamptz DEFAULT now());
    GRANT ALL ON jobs,workflow_events TO service_role;
  `);
  await db.exec(readFileSync('drizzle/migrations/0073_guarded_stage_commit.sql', 'utf8'));
  await db.exec(migration);
  await db.exec(migration);
});
afterAll(async () => db.close());

async function reset(stage = 'preliminary_estimate_ready') {
  await db.exec('DELETE FROM workflow_events; DELETE FROM lead_campaign_responses;');
  await db.query('UPDATE jobs SET stage=$1::job_stage,deleted_at=NULL,qa_archived_at=NULL WHERE id=$2',[stage,LAUNCH_ID.job]);
}
async function save(total = 3728) {
  return db.query<{first:boolean}>('SELECT save_campaign_spot_atomic($1,$2,$3::jsonb,false,$4,$5::jsonb) first',
    [LAUNCH_ID.job,LAUNCH_ID.link,JSON.stringify({saved_total:total,saved_area_m2:150}), 'Owner saved a place', '{}']);
}
async function state() {
  return (await db.query<{stage:string,saved_total:string,n:number}>(`SELECT j.stage,r.saved_total,
    (SELECT count(*)::int FROM workflow_events WHERE event_type='campaign_spot_saved') n
    FROM jobs j LEFT JOIN lead_campaign_responses r ON r.job_id=j.id WHERE j.id=$1`,[LAUNCH_ID.job])).rows[0];
}

test('save response, event and ready_check_ready_to_schedule commit together',async()=>{
  await reset(); expect((await save()).rows[0]?.first).toBe(true);
  expect(await state()).toMatchObject({stage:'ready_check_ready_to_schedule',n:1});
});
test('retry of recorded save repairs stage, preserves original snapshot and logs repair once',async()=>{
  await reset(); await save();
  await db.query("UPDATE jobs SET stage='preliminary_estimate_ready' WHERE id=$1",[LAUNCH_ID.job]);
  expect((await save(9999)).rows[0]?.first).toBe(false); await save(9999);
  const s=await state(); expect(s?.stage).toBe('ready_check_ready_to_schedule'); expect(Number(s?.saved_total)).toBe(3728); expect(s?.n).toBe(1);
  const e=await db.query<{n:number}>("SELECT count(*)::int n FROM workflow_events WHERE event_type='stage_changed' AND details->>'repaired'='true'");
  expect(e.rows[0]?.n).toBe(1);
});
test('failed stage write rolls back response AND save event',async()=>{
  await reset();
  await db.exec(`CREATE FUNCTION reject_test_stage() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.stage='ready_check_ready_to_schedule' THEN RAISE EXCEPTION 'test interruption'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_test_stage BEFORE UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION reject_test_stage();`);
  await expect(save()).rejects.toThrow('test interruption');
  expect(await state()).toMatchObject({stage:'preliminary_estimate_ready',n:0,saved_total:null});
  expect((await db.query<{n:number}>('SELECT count(*)::int n FROM lead_campaign_responses')).rows[0]?.n).toBe(0);
  await db.exec('DROP TRIGGER reject_test_stage ON jobs; DROP FUNCTION reject_test_stage();');
});
test('next-visit repair never changes unsaved, opted-out, deleted or progressed jobs',async()=>{
  await reset(); expect((await db.query<{r:boolean}>('SELECT repair_campaign_spot_stage($1) r',[LAUNCH_ID.job])).rows[0]?.r).toBe(false);
  await save();
  await db.query("UPDATE jobs SET stage='ready_check_scheduled' WHERE id=$1",[LAUNCH_ID.job]);
  expect((await db.query<{r:boolean}>('SELECT repair_campaign_spot_stage($1) r',[LAUNCH_ID.job])).rows[0]?.r).toBe(false);
  await db.query("UPDATE jobs SET stage='preliminary_estimate_ready',deleted_at=now() WHERE id=$1",[LAUNCH_ID.job]);
  expect((await db.query<{r:boolean}>('SELECT repair_campaign_spot_stage($1) r',[LAUNCH_ID.job])).rows[0]?.r).toBe(false);
  await db.query('UPDATE jobs SET deleted_at=NULL WHERE id=$1',[LAUNCH_ID.job]);
  await db.query('UPDATE lead_campaign_responses SET spot_saved_at=NULL,opted_out_at=now() WHERE job_id=$1',[LAUNCH_ID.job]);
  expect((await db.query<{r:boolean}>('SELECT repair_campaign_spot_stage($1) r',[LAUNCH_ID.job])).rows[0]?.r).toBe(false);
});
test('browser roles cannot invoke privileged save or repair functions',async()=>{
  for(const role of ['anon','authenticated']) {
    await db.exec(`SET ROLE ${role}`);
    await expect(save()).rejects.toThrow('permission denied');
    await expect(db.query('SELECT repair_campaign_spot_stage($1)',[LAUNCH_ID.job])).rejects.toThrow('permission denied');
    await db.exec('RESET ROLE');
  }
});