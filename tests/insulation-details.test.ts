import {afterAll,beforeAll,expect,test} from 'bun:test';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {insulationDraftSaveAllowed,insulationTapRoute,ownerInsulationAnswers,type InsulationTapAnswers} from '../src/lib/insulation-details.core';
const db=new PGlite();const job='00000000-0000-4000-8000-000000000001', prop='00000000-0000-4000-8000-000000000002',link='00000000-0000-4000-8000-000000000003';const token='T'.repeat(43);
const read=(n:string)=>readFileSync(new URL('../docs/pending-migrations/'+n,import.meta.url),'utf8');
beforeAll(async()=>{
 await db.exec(`CREATE ROLE service_role;CREATE ROLE anon;CREATE ROLE authenticated;
 CREATE TYPE booking_status AS ENUM('confirmed','completed','cancelled');CREATE TYPE quote_status AS ENUM('draft','issued','accepted');
 CREATE TABLE owners(id uuid,full_name text,email text,phone text);
 CREATE TABLE properties(id uuid primary key,address_line text,suburb text,state text,postcode text,enrichment jsonb);
 CREATE TABLE jobs(id uuid primary key,job_number text,external_enquiry_id text,stage text,source text,channel text,created_at timestamptz default now(),eligibility_set_at timestamptz,eligibility_outcome text,deleted_at timestamptz,qa_archived_at timestamptz,owner_id uuid,property_id uuid,eligibility_review_required boolean default false,next_action text);
 CREATE TABLE workflow_events(id uuid default gen_random_uuid(),job_id uuid,actor_id uuid,event_type text,summary text,details jsonb,internal boolean,created_at timestamptz default now());
 CREATE TABLE customer_email_sends(id uuid default gen_random_uuid(),job_id uuid,status text,purpose text,idempotency_key text,created_at timestamptz default now(),sent_at timestamptz);
 CREATE TABLE lead_campaign_responses(job_id uuid primary key,estimate_link_id uuid,campaign text,spot_saved_at timestamptz,opted_out_at timestamptz,desk_check_status text,desk_check_reason text,desk_checked_at timestamptz,updated_at timestamptz);
 CREATE TABLE customer_engagement_events(id uuid default gen_random_uuid(),job_id uuid,event_type text,source text,metadata jsonb,occurred_at timestamptz);
 CREATE TABLE documents(job_id uuid,kind text,storage_path text,created_at timestamptz default now());CREATE TABLE evidence_files(job_id uuid,storage_path text,uploaded_at timestamptz default now());
 CREATE TABLE ready_check_acceptances(job_id uuid);CREATE TABLE ready_check_windows(job_id uuid,status text);CREATE TABLE bookings(job_id uuid,status booking_status);CREATE TABLE quotes(job_id uuid,status quote_status);
 CREATE TABLE job_communications(job_id uuid,direction text,channel text,visibility text,source_event text,source_reference text,delivery_status text,sent_at timestamptz);
 CREATE TABLE customer_estimate_links(id uuid,job_id uuid,token text,purpose text,status text,expires_at timestamptz);
 CREATE TABLE owner_contact_consents(job_id uuid,consent_status text,created_at timestamptz default now());CREATE TABLE customer_email_optouts(job_id uuid,opted_out_at timestamptz);
 INSERT INTO properties(id,enrichment) VALUES('${prop}','{"base44":{"raw":{"answers":{"existing_insulation":"present","unrelated":"keep"}}}}');
 INSERT INTO jobs(id,property_id,source,channel,stage,eligibility_outcome,job_number) VALUES('${job}','${prop}','base44','hivic_sourced','preliminary_estimate_ready','needs_onsite_confirmation','HV-TEST');
 INSERT INTO customer_estimate_links VALUES('${link}','${job}','${token}','step3_estimate','active',now()+interval '1 day');INSERT INTO owner_contact_consents(job_id,consent_status) VALUES('${job}','granted');`);
 await db.exec(read('0210_photo_request_facts.sql'));await db.exec(read('0218_enquiry_new_pile_exclusive.sql'));await db.exec(read('0222_owner_insulation_details.sql'));await db.exec(read('0222_owner_insulation_details.sql'));
});
afterAll(()=>db.close());
const save=(a:InsulationTapAnswers)=>db.query('SELECT save_owner_insulation_details($1,$2) result',[token,JSON.stringify(a)]);
test('preview draft cannot save real owners or activate on a published host',()=>{
 expect(insulationDraftSaveAllowed(true,'qa_test')).toBe(true);
 expect(insulationDraftSaveAllowed(true,'base44')).toBe(false);
 expect(insulationDraftSaveAllowed(false,'qa_test')).toBe(false);
 expect(insulationDraftSaveAllowed(false,'base44')).toBe(false);
});
test('loose fill wins over every thickness; thin wins over every type',()=>{
 for(const thickness of ['thin','hand','thicker','unknown'] as const)expect(insulationTapRoute({insulation_type:'loose_fill',insulation_thickness:thickness})).toBe('thin_patchy');
 for(const type of ['batts','loose_fill','unknown'] as const)expect(insulationTapRoute({insulation_type:type,insulation_thickness:'thin'})).toBe('thin_patchy');
});
// Jo 23 Oct 08:14 UTC: everyone who answers gets Save my spot; nobody is parked onsite or sent to photo review.
test('hand, thicker and cannot tell get the standard existing-insulation Save my spot',()=>{for(const t of ['hand','thicker','unknown'] as const)expect(insulationTapRoute({insulation_type:'batts',insulation_thickness:t})).toBe('existing_save_spot');});
test('house age never changes the wording (rank only)',()=>{
 for(const age of ['1990_or_earlier','1991_1999','2000_2009','2010_or_later','unknown'] as const){
  for(const thickness of ['hand','thicker','unknown'] as const)expect(insulationTapRoute({insulation_type:'batts',insulation_thickness:thickness,house_built_period:age})).toBe('existing_save_spot');
  expect(insulationTapRoute({insulation_type:'batts',insulation_thickness:'thin',house_built_period:age})).toBe('thin_patchy');
  expect(insulationTapRoute({insulation_type:'loose_fill',insulation_thickness:'thicker',house_built_period:age})).toBe('thin_patchy');
 }
});
test('wording route ignores photos (photo owners are held by the office review, not this route)',()=>{
 for(const type of ['loose_fill','batts','unknown'] as const)for(const thickness of ['thin','hand','thicker','unknown'] as const)
  expect(insulationTapRoute({insulation_type:type,insulation_thickness:thickness},true)).not.toBe('photo_review' as never);
});
test('practice persisted answers retain original website facts and repeat is idempotent',async()=>{
 const a:InsulationTapAnswers={insulation_type:'loose_fill',insulation_thickness:'thicker',house_built_period:'1990_or_earlier'};await save(a);await save(a);
 const enrichment=(await db.query<{enrichment:Record<string,unknown>}>('SELECT enrichment FROM properties')).rows[0]?.enrichment;expect(ownerInsulationAnswers(enrichment)).toMatchObject({...a,unrelated:'keep',existing_insulation:'present'});
 expect((await db.query<{n:number}>("SELECT count(*)::int n FROM workflow_events WHERE event_type='owner_insulation_details_answered'")).rows[0]?.n).toBe(1);
 expect((await db.query('SELECT eligibility_outcome FROM jobs')).rows[0]?.eligibility_outcome).toBe('needs_onsite_confirmation');
 expect((await db.query('SELECT desk_checked_at FROM lead_campaign_responses')).rows[0]?.desk_checked_at).toBeNull();
});
test('practice: non-thin answers qualify for the standard Save my spot, no parking, no office pile change',async()=>{
 for(const thickness of ['hand','thicker','unknown'] as const){
  const result=await save({insulation_type:'batts',insulation_thickness:thickness,house_built_period:'2000_2009'});
  expect(result.rows[0]?.result).toMatchObject({route:'existing_save_spot'});
 }
 expect((await db.query<{n:number}>("SELECT count(*)::int n FROM workflow_events WHERE event_type='owner_insulation_present_auto_offer'")).rows[0]?.n).toBeGreaterThan(0);
 expect((await db.query('SELECT next_action FROM jobs')).rows[0]?.next_action).not.toBe('Needs onsite assessment');
 expect((await db.query('SELECT count(*)::int n FROM customer_email_sends')).rows[0]?.n).toBe(0);
});
test('practice: owners with photos stay in office photo review (Jo 08:23) — answering is refused, media kept, nothing sent',async()=>{
 await db.query("INSERT INTO documents(job_id,kind,storage_path) VALUES($1,'intake_media','private/photo.jpg')",[job]);
 await expect(save({insulation_type:'batts',insulation_thickness:'thin',house_built_period:'1990_or_earlier'})).rejects.toThrow('Photos require existing review');
 expect((await db.query('SELECT count(*)::int n FROM documents')).rows[0]?.n).toBe(1);
 expect((await db.query('SELECT count(*)::int n FROM customer_email_sends')).rows[0]?.n).toBe(0);
});
test('RPC denies public/client execution and expired links',async()=>{
 expect((await db.query("SELECT has_function_privilege('anon','save_owner_insulation_details(text,jsonb)','EXECUTE') allowed")).rows[0]?.allowed).toBe(false);
 await db.exec("UPDATE customer_estimate_links SET expires_at=now()-interval '1 day'");await expect(save({insulation_type:'batts',insulation_thickness:'thin',house_built_period:'2000_2009'})).rejects.toThrow('Link unavailable');
});
test('Jo 08:14: no onsite parking — "not sure" owners stay ordinary enquiries',async()=>{
 const j2='00000000-0000-4000-8000-0000000000a1',p2='00000000-0000-4000-8000-0000000000a2';
 await db.exec(`INSERT INTO properties(id,enrichment) VALUES('${p2}','{"base44":{"raw":{"answers":{"existing_insulation":"Not sure"}}}}');
 INSERT INTO jobs(id,property_id,source,channel,stage,eligibility_outcome,job_number) VALUES('${j2}','${p2}','base44','hivic_sourced','preliminary_estimate_ready','needs_onsite_confirmation','HV-TEST2');`);
 expect((await db.query<{b:string}>(`SELECT office_bucket b FROM office_enquiry_index WHERE id='${j2}'`)).rows[0]?.b).toBe('enquiry');
 await db.exec(`INSERT INTO documents(job_id,kind,storage_path) VALUES('${j2}','intake_media','${j2}/intake/a.jpg')`);
 expect((await db.query<{b:string}>(`SELECT office_bucket b FROM office_enquiry_index WHERE id='${j2}'`)).rows[0]?.b).toBe('enquiry');
});
