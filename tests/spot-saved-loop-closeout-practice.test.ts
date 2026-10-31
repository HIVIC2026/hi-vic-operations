import { expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

test('close-out is additive, terminal-only, once per job, retaining history and settings', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE jobs(id uuid PRIMARY KEY, source text, stage text DEFAULT 'ready_check_ready_to_schedule', deleted_at timestamptz, qa_archived_at timestamptz);
      CREATE TABLE lead_campaign_responses(job_id uuid REFERENCES jobs, spot_saved_at timestamptz, opted_out_at timestamptz);
      CREATE TABLE workflow_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid REFERENCES jobs, event_type text, summary text, details jsonb, internal boolean, created_at timestamptz DEFAULT now());
      CREATE TABLE workflow_settings(id int, customer_comms_enabled boolean);
      INSERT INTO workflow_settings VALUES(1,true);
    `);
    const ids: string[] = [];
    const cases = [
      ['already','blocked','Too late to send – the trigger was 25h ago (limit 24h)','base44',true],
      ['sent','already','Already handled','base44',true],
      ['already','skipped','No valid mobile','base44',true],
      ['already','sent','Accepted','base44',true],
      ['already','blocked',"It's after 8pm in Melbourne — the text waits until 7am",'base44',false],
      ['failed','blocked','Too late to send – the trigger was 25h ago (limit 24h)','base44',false],
      ['already','skipped','Spot saved texts are switched off','base44',false],
      ['already','already','Already handled','qa_test',false],
    ] as const;
    for (const [email,sms,detail,source] of cases) {
      const id = crypto.randomUUID(); ids.push(id);
      await db.query('INSERT INTO jobs(id,source) VALUES($1,$2)',[id,source]);
      await db.query("INSERT INTO lead_campaign_responses VALUES($1,now()-interval '25 hours',null)",[id]);
      await db.query("INSERT INTO workflow_events(job_id,event_type,details) VALUES($1,'spot_saved_confirmation_recovery_attempted','{}'),($1,'spot_saved_confirmation_sent',$2)",[id,JSON.stringify({email:{status:email},sms:{status:sms,detail}})]);
    }
    const before = await db.query('SELECT * FROM workflow_events ORDER BY id');
    const sql = readFileSync(new URL('../docs/spot-saved-confirmation-loop-closeout.sql',import.meta.url),'utf8');
    await db.exec(sql); await db.exec(sql);
    const completed = (await db.query<{job_id:string}>("SELECT job_id FROM workflow_events WHERE event_type='spot_saved_confirmation_completed'")).rows;
    expect(completed.map(r=>r.job_id).sort()).toEqual(ids.filter((_,i)=>cases[i]?.[4]).sort());
    expect(completed).toHaveLength(4);
    expect((await db.query("SELECT * FROM workflow_events WHERE event_type<>'spot_saved_confirmation_completed' ORDER BY id")).rows).toEqual(before.rows);
    expect((await db.query('SELECT * FROM workflow_settings')).rows).toEqual([{id:1,customer_comms_enabled:true}]);
  } finally { await db.close(); }
});