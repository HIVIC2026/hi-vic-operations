import { expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

test("portal indexes preserve customer-email and photo-request results and are usable", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE public.job_communications (job_id uuid, direction text, channel text, visibility text, source_event text, source_reference text, sent_at timestamptz, delivery_status text);
      INSERT INTO public.job_communications VALUES
      ('00000000-0000-0000-0000-000000000001','outbound','email','customer','office_more_photos_requested','review:1',now(),'sent'),
      ('00000000-0000-0000-0000-000000000002','outbound','email','customer',null,null,now(),'blocked'),
      ('00000000-0000-0000-0000-000000000003','outbound','email','trade',null,null,now(),'sent'),
      ('00000000-0000-0000-0000-000000000004','inbound','email','customer',null,null,now(),'received');`);
    const queries = [
      `SELECT job_id FROM public.job_communications WHERE direction='outbound' AND channel='email' AND visibility='customer' ORDER BY job_id`,
      `SELECT job_id FROM public.job_communications WHERE direction='outbound' AND channel='email' AND visibility='customer' AND source_event='office_more_photos_requested' AND delivery_status IN ('recorded','sent','delivered') ORDER BY job_id`,
    ];
    const before = await Promise.all(queries.map(q => db.query(q)));
    const sql = readFileSync(new URL('../drizzle/migrations/0189_portal_read_indexes_5nov.sql', import.meta.url), 'utf8');
    await db.exec(sql); await db.exec(sql);
    for (let i=0;i<queries.length;i++) {
      const query = queries[i]; if (!query) continue;
      expect((await db.query(query)).rows).toEqual(before[i]?.rows);
    }
    expect(before[0]?.rows.length).toBe(2);
    expect(before[1]?.rows.length).toBe(1);
    await db.exec('SET enable_seqscan=off');
    const plan = await db.query<{ "QUERY PLAN": string }>(`EXPLAIN ${queries[0]}`);
    expect(plan.rows.map(r=>r['QUERY PLAN']).join('\n')).toContain('job_comms_customer_email_perf1105_idx');
  } finally { await db.close(); }
});