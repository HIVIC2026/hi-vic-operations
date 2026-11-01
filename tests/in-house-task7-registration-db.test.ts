import { expect,test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
const id=(n:number)=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
test('pending ESC registration is office-only and audited; two trade users cannot forge it',async()=>{const db=new PGlite();try{
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE TABLE user_roles(user_id uuid,role text); INSERT INTO user_roles VALUES ('${id(1)}','admin'); CREATE TABLE partner_workers(id uuid PRIMARY KEY,trade_role text,removed_at timestamptz); INSERT INTO partner_workers VALUES('${id(4)}','installer',null); CREATE TABLE admin_config_events(actor_id uuid,event_type text,summary text,details jsonb);`);
await db.exec(readFileSync('docs/pending-migrations/2026-11-01_task7_esc_registered.sql','utf8'));
for(const actor of [2,3]){await expect(db.query('SELECT record_worker_esc_registration($1,true,$2,$3)',[id(4),'2026-10-01',id(actor)])).rejects.toThrow('Office only');await expect(db.query('UPDATE partner_workers SET esc_registered=true,esc_registered_at=$1,esc_registered_by=$2',[ '2026-10-01',id(actor)])).rejects.toThrow('Office only');}
await db.query('SELECT record_worker_esc_registration($1,true,$2,$3)',[id(4),'2026-10-01',id(1)]);
expect((await db.query('SELECT esc_registered,esc_registered_at::text,esc_registered_by::text FROM partner_workers')).rows).toEqual([{esc_registered:true,esc_registered_at:'2026-10-01',esc_registered_by:id(1)}]);
expect((await db.query('SELECT event_type FROM admin_config_events')).rows).toEqual([{event_type:'worker_esc_registration_recorded'}]);
}finally{await db.close();}});