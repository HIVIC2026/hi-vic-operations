// PGlite runs the actual core tables, constraints, RLS grants, and the candidate RPC migration.
// No remote database, storage, network, Auth mutation or migration application is used.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
export const testRequire = process.env.HIVIC_BULK_TEST_DEPS_ROOT
  ? createRequire(resolve(process.env.HIVIC_BULK_TEST_DEPS_ROOT,'package.json')) : createRequire(import.meta.url);
const {PGlite}=testRequire('@electric-sql/pglite');
export const source=path=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
export const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const ids={business:id(1),boss:id(2),office:id(3),member:id(4),other:id(5),batch:id(10),row:id(11),token:id(12),successor:id(13)};
export const permission={confirmed_by:ids.boss,confirmed_at:'2026-10-20T01:00:00.000Z',wording:'I have permission to share these customer details.'};
export const extracted={full_name:'TEST Upload Owner',email:'upload-owner@hivic-test.example',phone:'0400000000',address_line:'444 Mockup Lane',suburb:'Melbourne',postcode:'3000',site_check:'yes',quoted_answer:'yes',price_inc_gst:1000,area_m2:50,owner_consent:permission};
export const jobInput={stage:'ready_check_complete',source:'qa_test',installer_site_check:'yes',installer_site_check_date:null,installer_quoted:'yes',installer_quoted_price_inc_gst:1000,installer_price_includes:null,next_action:'Office review'};
export const ownerLink={token_hash:'a'.repeat(64),expires_at:'2026-11-20T01:00:00.000Z'};
export const stored=`partners/${ids.business}/imports/saved-444-mockup-lane-ceiling.jpg`;
export const file={originalPath:'444-mockup-lane-ceiling.jpg',storedPath:stored,name:'444-mockup-lane-ceiling.jpg',mime:'image/jpeg'};
export function quotePlan(overrides={}) {
 const line=(code,price,sort)=>({code,description:code,quantity:1,unit:'flat',unit_price_inc_gst:price,line_total_inc_gst:price,is_other:false,explanation:null,sort});
 return {header:{kind:'installation',option_label:'Installer quote',option_code:'INSTALLER_A1',status:'draft',subtotal_inc_gst:1549,gst_amount:140.82,veec_discount_inc_gst:500,customer_total_inc_gst:1049,partner_business_id:ids.business,release_state:'held',release_hold_reason:'Office review',...overrides},lines:[line('INSTALLER_PRICE',1000,0),line('PIESA',349,1),line('AP_FEE',200,2)]};
}
export const rpcTypes={
 claim_bulk_import_row:['uuid','uuid','uuid'],release_bulk_import_row:['uuid','uuid','uuid','text','boolean'],renew_bulk_import_row:['uuid','uuid','uuid'],
 prepare_bulk_import_job:['uuid','uuid','uuid','jsonb'],finish_bulk_import_row:['uuid','uuid','uuid','jsonb','jsonb','jsonb','jsonb'],
 edit_bulk_import_row:['uuid','uuid','jsonb','jsonb'],set_bulk_import_plan:['uuid','uuid','jsonb'],save_bulk_import_analysis:['uuid','uuid','jsonb','jsonb'],
 close_bulk_import_batch:['uuid','uuid'],bulk_import_batch_counts:['uuid[]','uuid'],repair_bulk_import_attachment:['uuid','uuid','jsonb'],
 _bulk_import_quote_complete:['uuid','uuid'],_bulk_import_document:['uuid','uuid','uuid','jsonb']
};
const sqlValue=(value,type)=>type==='jsonb'&&value!==null?JSON.stringify(value):value;

export async function fixture(t,{seed=true,migrate=true}={}) {
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
 CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role; GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated,service_role;`);
 await db.exec(source('drizzle/migrations/0000_hivic_core_schema.sql'));
 // The replaced job_overview in 0004 refers to unrelated invoice/authority migrations. Its source guards run intact.
 await db.exec(source('drizzle/migrations/0004_job_acquisition_channel.sql').split('CREATE OR REPLACE VIEW')[0]);
 for(const path of ['0009_job_business_unit_guard.sql','0011_ceiling_measurements_two_requirement_model.sql','0023_reinsulate_pilot_partner_network.sql','0026_provisional_installer_measurements.sql','0028_base44_full_intake_handoff.sql']) await db.exec(source('drizzle/migrations/'+path));
 // Only the exact enum additions are required from the large Ready Check feature migration.
 await db.exec(source('drizzle/migrations/0043_ready_check_workflow.sql').split('-- Versioned agreed REC')[0]);
 await db.exec(source('drizzle/migrations/0059_installer_led_jobs_and_mitti_form_ids.sql'));
 // The referenced application table is outside this test's scope; its exact FK is retained.
 await db.exec('CREATE TABLE public.rec_onboarding_applications(id uuid PRIMARY KEY)');
 await db.exec(source('drizzle/migrations/0061_preferred_electrician_team_up.sql'));
 for(const path of ['0104_bulk_import.sql','0105_bulk_import_sort_labels.sql','0108_owner_eligibility_links.sql','0110_quote_discount_note.sql','0113_qa_test_harness.sql','0114_auto_quote_release.sql','0118_bulk_import_review_plan.sql','0137_installer_job_facts.sql','0143_installer_quoted.sql','0209_bulk_import_confirm_lease.sql']) await db.exec(source('docs/pending-migrations/'+path));
 // Exact additive soft-delete fields, excluding unrelated Office deletion RPCs.
 await db.exec(source('docs/pending-migrations/0200_job_soft_delete.sql').match(/ALTER TABLE public\.jobs ADD COLUMN IF NOT EXISTS [^;]+;/g).join('\n'));
 if(migrate) await db.exec(source('docs/pending-migrations/0213_bulk_import_fencing.sql'));
 const f={db};
 f.query=async(sql,args=[])=> (await db.query(sql,args)).rows;
 f.one=async(sql,args=[])=> (await f.query(sql,args))[0];
 f.rpc=async(name,args)=>{assert.ok(rpcTypes[name],name);assert.equal(args.length,rpcTypes[name].length);return (await f.one(`SELECT public.${name}(${args.map((_,i)=>'$'+(i+1)+'::'+rpcTypes[name][i]).join(',')}) AS value`,args.map((v,i)=>sqlValue(v,rpcTypes[name][i])))).value;};
 f.claim=(actor=ids.boss,token=ids.token)=>f.rpc('claim_bulk_import_row',[ids.row,actor,token]);
 f.prepare=(actor=ids.boss,token=ids.token,input=jobInput)=>f.rpc('prepare_bulk_import_job',[ids.row,actor,token,input]);
 f.finish=(actor=ids.boss,token=ids.token,quote=quotePlan(),files=[])=>f.rpc('finish_bulk_import_row',[ids.row,actor,token,quote,files,ownerLink,{test:true}]);
 f.expire=async()=>db.exec(`BEGIN; SELECT set_config('app.bulk_import_row','${ids.row}',true); UPDATE bulk_import_rows SET confirm_lease_until=clock_timestamp()-interval '1 second' WHERE id='${ids.row}'; COMMIT;`);
 f.row=()=>f.one('SELECT * FROM bulk_import_rows WHERE id=$1',[ids.row]);
 f.snapshot=async()=>{
  const out={};for(const table of ['owners','properties','jobs','job_assignments','ceiling_measurements','quotes','quote_items','documents','owner_eligibility_links','workflow_events','bulk_import_batches','bulk_import_rows',...(migrate?['bulk_import_attachment_repairs']:[])])out[table]=await f.query(`SELECT * FROM ${table} ORDER BY id`);
  return JSON.parse(JSON.stringify(out));
 };
 f.setFiles=async()=>{
  await f.query('UPDATE bulk_import_batches SET file_manifest=$2 WHERE id=$1',[ids.batch,JSON.stringify([{path:file.originalPath,name:file.name,type:file.mime,stored_path:stored}])]);
  await f.rpc('edit_bulk_import_row',[ids.row,ids.boss,{matched_files:[]},{matched_files:[{path:file.originalPath,name:file.name,how:'folder'}]}]);
 };
 if(seed){
  await f.query("INSERT INTO businesses(id,name,business_type,onboarding_status,is_active) VALUES ($1,'TEST Installer','eec_installer','approved',true),($2,'TEST Other','eec_installer','approved',true)",[ids.business,ids.other]);
  await f.query("INSERT INTO profiles(id,full_name,email) VALUES ($1,'TEST Boss','boss@hivic-test.example'),($2,'TEST Office','office@hivic-test.example'),($3,'TEST Member','member@hivic-test.example')",[ids.boss,ids.office,ids.member]);
  await f.query("INSERT INTO user_roles(user_id,role) VALUES($1,'installer'),($2,'admin'),($3,'installer')",[ids.boss,ids.office,ids.member]);
  await f.query("INSERT INTO business_members(business_id,user_id,member_role,active) VALUES($1,$2,'business_admin',true),($1,$3,'member',true)",[ids.business,ids.boss,ids.member]);
  await f.query("INSERT INTO bulk_import_batches(id,business_id,created_by,status,summary) VALUES($1,$2,$3,'analysed',$4)",[ids.batch,ids.business,ids.boss,JSON.stringify({permission})]);
  await f.query("INSERT INTO bulk_import_rows(id,batch_id,row_index,extracted,import_stage,sort_result) VALUES($1,$2,0,$3,'quoted','covers_ready_check')",[ids.row,ids.batch,JSON.stringify(extracted)]);
 }
 return f;
}
