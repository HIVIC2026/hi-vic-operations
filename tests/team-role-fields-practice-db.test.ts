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
await db.exec('alter table partner_workers add column certification jsonb, add column licence_verified_at timestamptz');
await db.exec(readFileSync('drizzle/migrations/0191_team_role_fields_atomic.sql','utf8'));
await db.exec(readFileSync('drizzle/migrations/0192_team_certificate_number_only.sql','utf8'));
afterAll(()=>db.close());
const a='00000000-0000-4000-8000-000000000001', b='00000000-0000-4000-8000-000000000002', u='00000000-0000-4000-8000-000000000003', v='00000000-0000-4000-8000-000000000004';
await db.query("insert into business_members(business_id,user_id,member_role) values ($1,$2,'business_admin'),($3,$4,'business_admin')",[a,u,b,v]);
const cert={number:'CII-123'};
const save=(biz:string,actor:string,role:string,dob:string|null,email:string|null='test@hivic-test.example',certificate:unknown=cert,worker:string|null=null)=>db.query<{id:string}>("select save_team_person_details($1,$2,$3,'TEST person',$4,'0412345678',$5,$6,'A63151','30614',$7) id",[biz,actor,worker,role,email,dob,certificate]);
test('Office needs only contact and stores no DOB',async()=>{await save(a,u,'office',null,'office@hivic-test.example',null);expect((await db.query('select * from partner_worker_identity')).rows).toHaveLength(0);await expect(save(a,u,'office',null,null,null)).rejects.toThrow('Email required');});
test('Lead and Crew each require DOB and certificate before writing',async()=>{for(const role of ['lead','crew']){await expect(save(a,u,role,null)).rejects.toThrow('Date of birth');await expect(save(a,u,role,'1990-01-01',null,null)).rejects.toThrow('Certificate');}});
test('Lead and Crew allow no email and persist private DOB',async()=>{for(const role of ['lead','crew'])await save(a,u,role,'1990-01-01',null);expect((await db.query('select * from partner_worker_identity')).rows).toHaveLength(2);});
test('Electrician requires email and never manufactures DOB',async()=>{await expect(save(a,u,'electrician',null,null,null)).rejects.toThrow('Email');await save(a,u,'electrician',null,'electrician@hivic-test.example',null);expect((await db.query('select * from partner_worker_identity')).rows).toHaveLength(2);});
test('both business admins are refused cross-business add/edit',async()=>{await expect(save(a,v,'crew','1990-01-01')).rejects.toThrow('business admin');await expect(save(b,u,'crew','1990-01-01')).rejects.toThrow('business admin');const worker=(await save(a,u,'crew','1990-01-01')).rows[0]?.id;if(!worker)throw Error('missing worker');await expect(save(b,v,'crew','1990-01-01',null,cert,worker)).rejects.toThrow('Team member not found');});
test('edit retains DOB privately, cannot change role, and clears changed electrician verification',async()=>{const worker=(await save(a,u,'crew','1990-01-01')).rows[0]?.id;if(!worker)throw Error('missing worker');await save(a,u,'crew',null,null,null,worker);await expect(save(a,u,'office',null,'office@hivic-test.example',null,worker)).rejects.toThrow('role change');const elec=(await save(a,u,'electrician',null,'electrician2@hivic-test.example',null)).rows[0]?.id;await db.query("update partner_workers set licence_verified_at=now(),licence_number='OLD' where id=$1",[elec]);await save(a,u,'electrician',null,'electrician2@hivic-test.example',null,elec);expect((await db.query('select licence_verified_at from partner_workers where id=$1',[elec])).rows[0]).toEqual({licence_verified_at:null});});
test('private DOB RLS permits own admin and denies other admin',async()=>{await db.exec("create or replace function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$; grant select on partner_workers,business_members to authenticated");await db.exec(`set role authenticated; set test.uid='${v}'`);expect((await db.query('select * from partner_worker_identity')).rows).toHaveLength(0);await db.exec(`set test.uid='${u}'`);expect((await db.query('select * from partner_worker_identity')).rows.length).toBeGreaterThan(0);await db.exec('reset role');});
test('RPC is service-only and history contains no birth dates',async()=>{expect((await db.query("select has_function_privilege('authenticated','save_team_person_details(uuid,uuid,uuid,text,text,text,text,date,text,text,jsonb)','execute') a,has_function_privilege('service_role','save_team_person_details(uuid,uuid,uuid,text,text,text,text,date,text,text,jsonb)','execute') s")).rows[0]).toEqual({a:false,s:true});expect(JSON.stringify((await db.query('select details from admin_config_events')).rows)).not.toContain('1990-01-01');});

test('number-only edits preserve prior certificate files',async()=>{const worker=(await save(a,u,'crew','1990-01-01')).rows[0]?.id; if(!worker)throw Error('missing worker');await db.query("update partner_workers set certification=jsonb_build_object('eec_upload',jsonb_build_object('number','CII-123','path','existing/private.jpg')) where id=$1",[worker]);await save(a,u,'crew',null,null,{number:'CII-456'},worker);const rows=(await db.query<{certification:{eec_upload:{path:string;number:string}}}>('select certification from partner_workers where id=$1',[worker])).rows;expect(rows[0]?.certification.eec_upload).toEqual({path:'existing/private.jpg',number:'CII-456'});});
