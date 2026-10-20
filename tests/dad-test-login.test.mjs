import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule, testRequire } from './helpers/qa-actual-source.mjs';
const core=loadModule('src/lib/dad-test-login.core.ts');
const workflow={WorkflowError:class extends Error{}};
const setCore=loadModule('src/lib/set-password-link.core.ts');
const workers=loadModule('src/lib/worker-links.core.ts');
const marks=loadModule('src/lib/test-send.core.ts');
const links=loadModule('src/lib/qa-role-link.core.ts');
const activation=loadModule('src/lib/partner-activation.core.ts',{'./installer-onboarding.core':{},'./rec-onboarding.core':{}});
function fixture(){
 const uid=core.DAD_TEST_USER_ID,bid=core.DAD_TEST_BUSINESS_ID,email=core.DAD_TEST_EMAIL;
 const io={calls:[],helperCalls:[],auth:{id:uid,email,user_metadata:{qa_test:true}},allowed:true,authenticated:true,fail:null,truncate:false,context:{userId:'authenticated-office-actor'},tables:{
 profiles:[{id:uid,email,business_id:bid}],user_roles:[{user_id:uid,role:'installer'}],
 businesses:[{id:bid,onboarding_notes:'[TEST PARTNER]',business_type:'eec_installer',is_active:true,onboarding_status:'approved'}],
 business_members:[{user_id:uid,business_id:bid,member_role:'business_admin',active:true}], owners:[],
 jobs:[{id:'own-job',source:'qa_test',originating_installer_business_id:bid}],
 job_assignments:[{job_id:'own-job',user_id:uid,business_id:bid,active:true}],partner_login_links:[]}};
 io.context.supabase={rpc:async(name,args)=>{io.calls.push('office:'+name);assert.equal(args._user_id,io.context.userId);return {data:io.allowed,error:null};}};
 class Query{
  constructor(table){this.table=table;this.filters=[];this.payload=null;this.count=false;this.singleRow=false;}
  select(fields,opts={}){this.count=opts.count==='exact';return this;}
  eq(k,v){this.filters.push(r=>r[k]===v);return this;}
  in(k,vs){this.filters.push(r=>vs.includes(r[k]));return this;}
  or(expr){const options=expr.split(',').map(x=>{const [key,,...rest]=x.split('.');return r=>r[key]===rest.join('.');});this.filters.push(r=>options.some(fn=>fn(r)));return this;}
  insert(payload){this.payload=payload;return this;}
  single(){this.singleRow=true;return this.run();}
  maybeSingle(){this.singleRow=true;return this.run();}
  then(resolve,reject){return this.run().then(resolve,reject);}
  async run(){io.calls.push(this.table+':'+(this.payload?'insert':'select'));if(io.fail===this.table)return {data:null,error:{message:'injected read failure'},count:null};
   if(this.payload){assert.equal(this.table,'partner_login_links');io.tables[this.table].push({...this.payload,expires_at:new Date(Date.now()+86400000).toISOString(),used_at:null});return {data:null,error:null};}
   let rows=io.tables[this.table].filter(r=>this.filters.every(fn=>fn(r)));const count=rows.length;if(io.truncate)rows=[];
   return {data:this.singleRow?rows[0]??null:rows,error:null,count:this.count?count:null};
  }
 }
 const admin={from:table=>new Query(table),auth:{admin:{getUserById:async(id)=>{io.calls.push('auth:read');assert.equal(id,uid);return {data:{user:io.auth},error:null};}}}};
 const qa=loadModule('src/lib/qa-access.server.ts',{'./workflow.server':workflow,'./test-send.core':marks,'./worker-links.core':workers,'./qa-role-link.core':links,'./partner-activation.core':activation,'./dad-test-login.core':core});
 const actualHelper=loadModule('src/lib/set-password-link.server.ts',{'@/integrations/supabase/client.server':{supabaseAdmin:admin},'./workflow.server':workflow,'./set-password-link.core':setCore,'./worker-links.core':workers});
 const helper={issuePartnerLoginLink:async(...args)=>{io.helperCalls.push(args);return actualHelper.issuePartnerLoginLink(...args);}};
 const server=loadModule('src/lib/dad-test-login.server.ts',{'@/integrations/supabase/client.server':{supabaseAdmin:admin},'./qa-access.server':qa,'./set-password-link.server':helper,'./worker-links.core':workers,'./dad-test-login.core':core});
 const middleware=()=>{if(!io.authenticated)throw new Error('Unauthorized');};
 const createServerFn=()=>({middleware(ms){this.ms=ms;return this;},inputValidator(fn){this.validate=fn;return this;},handler(fn){return async(args={})=>{for(const m of this.ms)m();const data=this.validate(args.data);return fn({data,context:io.context});};}});
 io.action=loadModule('src/lib/dad-test-login.functions.ts',{'@tanstack/react-start':{createServerFn},zod:{z:testRequire('zod').z},'@/integrations/supabase/auth-middleware':{requireSupabaseAuth:middleware},'./dad-test-login.server':server}).downloadDadTestLogin;
 return io;
}
const badCases={
 'unauthenticated':io=>{io.authenticated=false;},'non-Office':io=>{io.allowed=false;},
 'missing qa_test':io=>{io.auth.user_metadata.qa_test=false;},'wrong Auth identity':io=>{io.auth.id='wrong';},
 'wrong email':io=>{io.auth.email='another@hivic-test.example';},'mismatched profile':io=>{io.tables.profiles[0].email='another@hivic-test.example';},
 'banned identity':io=>{io.auth.banned_until=new Date(Date.now()+60000).toISOString();},
 'missing installer role':io=>{io.tables.user_roles=[];},'admin role expansion':io=>{io.tables.user_roles.push({user_id:core.DAD_TEST_USER_ID,role:'admin'});},
 'wrong profile business':io=>{io.tables.profiles[0].business_id='other';},'missing TEST mark':io=>{io.tables.businesses[0].onboarding_notes='real';},
 'wrong business type':io=>{io.tables.businesses[0].business_type='rec';},'inactive business':io=>{io.tables.businesses[0].is_active=false;},'unapproved business':io=>{io.tables.businesses[0].onboarding_status='draft';},
 'wrong membership':io=>{io.tables.business_members[0].member_role='field_worker';},'inactive membership':io=>{io.tables.business_members[0].active=false;},
 'other membership':io=>{io.tables.business_members.push({user_id:core.DAD_TEST_USER_ID,business_id:'other',member_role:'business_admin',active:true});},
 'owner access':io=>{io.tables.owners.push({id:'owner',user_id:core.DAD_TEST_USER_ID});},
 'non-test owned job':io=>{io.tables.jobs[0].source='base44';},'other business assignment':io=>{io.tables.job_assignments[0].business_id='other';},
 'foreign assigned job':io=>{io.tables.jobs[0].originating_installer_business_id='other';},'truncated scope':io=>{io.truncate=true;},'unreadable scope':io=>{io.fail='job_assignments';},
};
for(const [name,alter] of Object.entries(badCases))test(name+' refuses before token insertion',async()=>{const io=fixture();alter(io);await assert.rejects(io.action({data:{}}));assert.equal(io.helperCalls.length,0);assert.equal(io.tables.partner_login_links.length,0);assert.ok(io.calls.every(c=>!c.endsWith(':insert')));});
for(const data of [{userId:'other'},{email:'other@hivic-test.example'},{actorId:'invented'},{businessId:'other'}])test('reject caller-selected '+Object.keys(data)[0],async()=>{const io=fixture();await assert.rejects(io.action({data}));assert.equal(io.helperCalls.length,0);});
test('actual action and existing issuer add only one hashed 24h token for exact identity and authenticated actor',async()=>{
 const io=fixture();const before=structuredClone(io.tables);const started=Date.now();const file=await io.action({data:{}});
 assert.deepEqual(io.helperCalls,[[core.DAD_TEST_EMAIL,io.context.userId,null]]);
 assert.equal(file.filename,'Dad-TEST-installer-login.txt');assert.equal(file.mimeType,'text/plain;charset=utf-8');
 const setup=new URL(file.content.split('\n').find(x=>x.startsWith('Set your password: ')).slice(19));
 assert.equal(setup.origin,'https://estimate.homeinsulationvictoria.com.au');assert.equal(setup.pathname,'/reset-password');assert.equal(setup.searchParams.get('next'),'/portal');
 const row=io.tables.partner_login_links[0];assert.equal(row.token_hash,await workers.hashToken(setup.searchParams.get('link')));assert.equal(row.used_at,null);assert.equal(row.application_id,null);assert.equal(row.created_by,io.context.userId);
 assert.ok(Date.parse(row.expires_at)>=started+86400000&&Date.parse(row.expires_at)<=Date.now()+86400000);
 assert.ok(file.content.includes(row.expires_at)&&file.content.includes('Australia/Sydney')&&file.content.includes('Dummy jobs only')&&file.content.includes('not an inbox')&&file.content.includes(core.DAD_TEST_PORTAL));
 delete before.partner_login_links;const after={...io.tables};delete after.partner_login_links;assert.deepEqual(after,before);
 assert.deepEqual(io.calls.filter(c=>c.endsWith(':insert')),['partner_login_links:insert']);assert.ok(!io.calls.some(c=>/update|generateLink|email|invoice|mitti|outbound/.test(c)));
});
