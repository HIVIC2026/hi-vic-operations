import {expect,test} from 'bun:test';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
const id=(n:number)=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
test('private birth dates: own business admin and HIV office only; two users isolated; worker creation atomic',async()=>{
 const db=new PGlite();try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE TYPE app_role AS ENUM('admin','qa_office');CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT current_setting('test.uid',true)::uuid$$;CREATE FUNCTION is_admin() RETURNS boolean LANGUAGE sql AS $$SELECT auth.uid()='${id(1)}'::uuid$$;CREATE FUNCTION has_role(u uuid,r app_role) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;CREATE TABLE user_roles(user_id uuid,role text);CREATE TABLE business_members(business_id uuid,user_id uuid,active boolean,member_role text);CREATE TABLE partner_workers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid,full_legal_name text,trade_role text,worker_role text,mobile text,email text,approval_status text,declarations_due boolean,added_by uuid,qualification text,certification_status text,removed_at timestamptz);INSERT INTO business_members VALUES('${id(10)}','${id(2)}',true,'business_admin'),('${id(20)}','${id(3)}',true,'business_admin');GRANT USAGE ON SCHEMA public,auth TO authenticated;GRANT SELECT ON partner_workers,business_members TO authenticated;`);
 await db.exec(readFileSync('drizzle/migrations/0186_private_worker_birth_dates.sql','utf8'));
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
test('live-schema Team insert constraints: service-only creation and second-record rollback',async()=>{
 const db=new PGlite();try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
 CREATE SCHEMA auth;CREATE TYPE app_role AS ENUM('admin','qa_office');CREATE TYPE assignment_role AS ENUM('electrician','installer','property_manager');
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT current_setting('test.uid',true)::uuid$$;
 CREATE FUNCTION is_admin() RETURNS boolean LANGUAGE sql AS $$SELECT false$$;CREATE FUNCTION has_role(u uuid,r app_role) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
 CREATE TABLE user_roles(user_id uuid,role text);CREATE TABLE business_members(business_id uuid,user_id uuid,active boolean,member_role text);
 CREATE TABLE businesses(id uuid PRIMARY KEY);CREATE TABLE profiles(id uuid PRIMARY KEY);
 CREATE TABLE partner_workers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid NOT NULL REFERENCES businesses(id),
 full_legal_name text NOT NULL,trade_role assignment_role NOT NULL,worker_role text CHECK(worker_role IN('lead','crew')),
 mobile text,email text CHECK(email IS NULL OR btrim(email)<>''),approval_status text NOT NULL DEFAULT 'pending' CHECK(approval_status IN('pending','approved','rejected')),
 declarations_due boolean NOT NULL DEFAULT false,added_by uuid REFERENCES profiles(id),qualification text,certification_status text,
 removed_at timestamptz,account_status text NOT NULL DEFAULT 'awaiting_account' CHECK(account_status IN('awaiting_account','linked','disabled')),
 licence_number text,licence_verified_at timestamptz,licence_verified_by uuid,UNIQUE(business_id,email),
 CHECK((trade_role='electrician' AND licence_number IS NOT NULL) OR (trade_role='installer' AND qualification IS NOT NULL) OR trade_role='property_manager'));
 CREATE FUNCTION guard_installer_worker_certified() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
 IF NEW.trade_role::text='installer' AND NEW.approval_status='approved' AND NEW.certification_status IS DISTINCT FROM 'verified' THEN RAISE EXCEPTION 'worker_cert:unverified';END IF;RETURN NEW;END$$;
 CREATE TRIGGER partner_workers_installer_certified BEFORE INSERT ON partner_workers FOR EACH ROW EXECUTE FUNCTION guard_installer_worker_certified();
 CREATE FUNCTION guard_team_electrician_verification() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
 IF NEW.licence_verified_at IS NOT NULL OR NEW.licence_verified_by IS NOT NULL THEN IF current_setting('hivic.electrician_verification',true) IS DISTINCT FROM 'office_rpc' THEN RAISE EXCEPTION 'Office only';END IF;END IF;RETURN NEW;END$$;
 CREATE TRIGGER team_electrician_verification BEFORE INSERT ON partner_workers FOR EACH ROW EXECUTE FUNCTION guard_team_electrician_verification();
 INSERT INTO businesses VALUES('${id(10)}');INSERT INTO profiles VALUES('${id(2)}');INSERT INTO business_members VALUES('${id(10)}','${id(2)}',true,'business_admin');
 GRANT USAGE ON SCHEMA public,auth TO service_role,authenticated,anon;GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;`);
 await db.exec(readFileSync('drizzle/migrations/0186_private_worker_birth_dates.sql','utf8'));
 for(const role of ['anon','authenticated']){
 await db.exec(`SET ROLE ${role}`);
 await expect(db.query('SELECT add_team_installer_with_identity($1,$2,$3,$4,null,null,$5)',[id(10),id(2),'Pat Smith','lead','1990-05-12'])).rejects.toThrow('permission denied');
 await db.exec('RESET ROLE');
 }
 await db.exec('SET ROLE service_role');
 for(const [role,email] of [['lead',null],['crew','crew@hivic-test.example']]){
 const r=await db.query<{worker:string}>('SELECT add_team_installer_with_identity($1,$2,$3,$4,null,$5,$6) AS worker',[id(10),id(2),'Pat Smith',role,email,'1990-05-12']);
 expect(r.rows[0]?.worker).toBeDefined();
 }
 expect((await db.query('SELECT worker_id FROM partner_worker_identity')).rows).toHaveLength(2);
 await db.exec(`RESET ROLE;CREATE FUNCTION fail_identity_insert() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'identity write interrupted';END$$;CREATE TRIGGER practice_failure BEFORE INSERT ON partner_worker_identity FOR EACH ROW EXECUTE FUNCTION fail_identity_insert();SET ROLE service_role;`);
 await expect(db.query('SELECT add_team_installer_with_identity($1,$2,$3,$4,null,null,$5)',[id(10),id(2),'Interrupted Person','lead','1990-05-12'])).rejects.toThrow('identity write interrupted');
 expect((await db.query('SELECT id FROM partner_workers')).rows).toHaveLength(2);
 expect((await db.query('SELECT worker_id FROM partner_worker_identity')).rows).toHaveLength(2);
 }finally{await db.close();}
});