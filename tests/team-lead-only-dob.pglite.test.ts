import {expect,test,afterAll} from 'bun:test';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
const db=new PGlite();
await db.exec(`
  create schema auth; create function auth.uid() returns uuid language sql as 'select null::uuid';
  create role anon; create role authenticated; create role service_role;
  create type public.app_role as enum ('admin','qa_office');
  create function public.has_role(_u uuid, _r public.app_role) returns boolean language sql as 'select false';
  create function public.is_admin() returns boolean language sql as 'select false';
  create type public.assignment_role as enum ('electrician','installer','property_manager');
  create table public.business_members(id uuid primary key default gen_random_uuid(), business_id uuid not null, user_id uuid not null, active boolean not null default true,
    member_role text not null default 'member' constraint business_members_member_role_check check (member_role in ('business_admin','member')), unique(business_id, user_id));
  create table public.user_roles(user_id uuid not null, role text not null);
  create table public.partner_workers(id uuid primary key default gen_random_uuid(), business_id uuid not null, profile_id uuid, trade_role public.assignment_role not null,
    full_legal_name text not null, email text, mobile text, licence_number text, rec_number text, qualification text, worker_role text, approval_status text not null default 'pending',
    declarations_due boolean not null default false, added_by uuid, certification_status text, removed_at timestamptz,
    check ((trade_role = 'electrician' and licence_number is not null) or (trade_role = 'installer' and qualification is not null) or trade_role = 'property_manager'));
  create table public.admin_config_events(id uuid primary key default gen_random_uuid(), actor_id uuid, event_type text not null, summary text not null, details jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());
`);
await db.exec(readFileSync("drizzle/migrations/0186_private_worker_birth_dates.sql", "utf8"));
await db.exec(readFileSync("docs/pending-migrations/installer-portal-roles.sql", "utf8"));
await db.exec(readFileSync('drizzle/migrations/0190_team_lead_only_birth_date.sql','utf8'));
afterAll(()=>db.close());
const a='00000000-0000-4000-8000-000000000001', b='00000000-0000-4000-8000-000000000002', u='00000000-0000-4000-8000-000000000003', v='00000000-0000-4000-8000-000000000004';
await db.query("insert into business_members(business_id,user_id,member_role) values ($1,$2,'business_admin'),($3,$4,'business_admin')",[a,u,b,v]);
const add=(biz:string,actor:string,role:string,dob:string|null)=>db.query<{id:string}>("select add_team_person_with_identity($1,$2,'TEST person',$3,'0412345678','test@hivic-test.example',$4,'A12345','12345') id",[biz,actor,role,dob]);
test('Lead requires DOB before any worker is added',async()=>{await expect(add(a,u,'lead',null)).rejects.toThrow('Date of birth');expect((await db.query('select * from partner_workers')).rows).toHaveLength(0);});
test('Crew and electrician save without DOB and no identity row',async()=>{await add(a,u,'crew',null);await add(a,u,'electrician',null);expect((await db.query('select * from partner_worker_identity')).rows).toHaveLength(0);});
test('Lead stores private DOB',async()=>{await add(a,u,'lead','1990-01-01');expect((await db.query('select * from partner_worker_identity')).rows).toHaveLength(1);});
test('two business admins cannot add to each others business',async()=>{await expect(add(a,v,'crew',null)).rejects.toThrow('business admin');await expect(add(b,u,'crew',null)).rejects.toThrow('business admin');expect((await db.query('select * from partner_workers')).rows).toHaveLength(3);});
test('identity RLS still denies another business and permits its own admin',async()=>{
 await db.exec("create or replace function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$; grant select on partner_workers,business_members to authenticated");
 await db.exec(`set role authenticated; set test.uid='${v}'`);expect((await db.query('select * from partner_worker_identity')).rows).toHaveLength(0);
 await db.exec(`set test.uid='${u}'`);expect((await db.query('select * from partner_worker_identity')).rows).toHaveLength(1);await db.exec('reset role');
});
test('both Team add functions remain service-only',async()=>{const rows=(await db.query("select has_function_privilege('authenticated','add_team_person_with_identity(uuid,uuid,text,text,text,text,date,text,text)','execute') a, has_function_privilege('service_role','add_team_person_with_identity(uuid,uuid,text,text,text,text,date,text,text)','execute') s")).rows;expect(rows[0]).toEqual({a:false,s:true});});
