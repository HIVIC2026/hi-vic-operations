import {expect,test} from 'bun:test';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
const id=(n:number)=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
test('private birth dates: own business admin and HIV office only; two users isolated; worker creation atomic',async()=>{
 const db=new PGlite();try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE TYPE app_role AS ENUM('admin','qa_office');CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT current_setting('test.uid',true)::uuid$$;CREATE FUNCTION is_admin() RETURNS boolean LANGUAGE sql AS $$SELECT auth.uid()='${id(1)}'::uuid$$;CREATE FUNCTION has_role(u uuid,r app_role) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;CREATE TABLE user_roles(user_id uuid,role text);CREATE TABLE business_members(business_id uuid,user_id uuid,active boolean,member_role text);CREATE TABLE partner_workers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid,full_legal_name text,trade_role text,worker_role text,mobile text,email text,approval_status text,declarations_due boolean,added_by uuid,qualification text,certification_status text,removed_at timestamptz);INSERT INTO business_members VALUES('${id(10)}','${id(2)}',true,'business_admin'),('${id(20)}','${id(3)}',true,'business_admin');GRANT USAGE ON SCHEMA public,auth TO authenticated;GRANT SELECT ON partner_workers,business_members TO authenticated;`);
 await db.exec(readFileSync('docs/pending-migrations/2026-11-02_private_worker_birth_dates.sql','utf8'));
 const r=await db.query<{worker:string}>('SELECT add_team_installer_with_identity($1,$2,$3,$4,null,null,$5) AS worker',[id(10),id(2),'Pat Smith','lead','1990-05-12']);
 await expect(db.query('SELECT add_team_installer_with_identity($1,$2,$3,$4,null,null,$5)',[id(10),id(3),'Other','lead','1990-05-12'])).rejects.toThrow('Only the business admin');
 await expect(db.query('SELECT add_team_installer_with_identity($1,$2,$3,$4,null,null,null)',[id(10),id(2),'Missing','lead'])).rejects.toThrow('Date of birth');
 expect((await db.query('SELECT id FROM partner_workers')).rows).toHaveLength(1);
 for(const [user,count] of [[2,1],[3,0],[4,0],[1,1]]){
  await db.exec(`SET ROLE authenticated;SELECT set_config('test.uid','${id(user)}',false);`);
  expect((await db.query('SELECT worker_id FROM partner_worker_identity')).rows).toHaveLength(count);
  await expect(db.exec(`UPDATE partner_worker_identity SET date_of_birth='1980-01-01'`)).rejects.toThrow();
  await db.exec('RESET ROLE');
 }
 expect(r.rows[0]?.worker).toBeDefined();
 }finally{await db.close();}
});