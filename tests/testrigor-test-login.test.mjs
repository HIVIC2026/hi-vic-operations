import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule, testRequire } from './helpers/qa-actual-source.mjs';
const core=loadModule('src/lib/testrigor-test-login.core.ts');
const dadCore=loadModule('src/lib/dad-test-login.core.ts');
const workflow={WorkflowError:class extends Error{}};
const setCore=loadModule('src/lib/set-password-link.core.ts');
const workers=loadModule('src/lib/worker-links.core.ts');
const marks=loadModule('src/lib/test-send.core.ts');
const links=loadModule('src/lib/qa-role-link.core.ts');
const activation=loadModule('src/lib/partner-activation.core.ts',{'./installer-onboarding.core':{},'./rec-onboarding.core':{}});
const INST='alpha-user',ELEC='delta-user',BI='alpha-biz',BE='delta-biz';
function fixture(){
 const io={calls:[],helperCalls:[],allowed:true,authenticated:true,fail:null,truncate:false,context:{userId:'authenticated-office-actor'},
 auth:{[INST]:{id:INST,email:core.TESTRIGOR_INSTALLER_EMAIL,user_metadata:{qa_test:true}},[ELEC]:{id:ELEC,email:core.TESTRIGOR_ELECTRICIAN_EMAIL,user_metadata:{qa_test:true}}},
 tables:{
 profiles:[{id:INST,email:core.TESTRIGOR_INSTALLER_EMAIL,business_id:BI},{id:ELEC,email:core.TESTRIGOR_ELECTRICIAN_EMAIL,business_id:BE}],
 user_roles:[{user_id:INST,role:'installer'},{user_id:ELEC,role:'electrician'}],
 businesses:[{id:BI,onboarding_notes:'[TEST PARTNER]',business_type:'eec_installer',is_active:true,onboarding_status:'approved'},{id:BE,onboarding_notes:'[TEST PARTNER]',business_type:'rec',is_active:true,onboarding_status:'approved'}],
 business_members:[{user_id:INST,business_id:BI,member_role:'business_admin',active:true},{user_id:ELEC,business_id:BE,member_role:'business_admin',active:true}],owners:[],
 jobs:[{id:'qa-job',source:'qa_test',originating_installer_business_id:null}],
 job_assignments:[{job_id:'qa-job',user_id:INST,business_id:BI,active:true},{job_id:'qa-job',user_id:ELEC,business_id:BE,active:true}],partner_login_links:[]}};
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
   if(this.payload){assert.equal(this.table,'partner_login_links');io.tables[this.table].push({...this.payload,expires_at:new Date(Date.now()+86400000).toISOString(),used_at:null,...(io.tamper??{})});return {data:null,error:null};}
   let rows=io.tables[this.table].filter(r=>this.filters.every(fn=>fn(r)));const count=rows.length;if(io.truncate)rows=[];
   return {data:this.singleRow?rows[0]??null:rows,error:null,count:this.count?count:null};
  }
 }
 const admin={from:table=>new Query(table),auth:{admin:{
  getUserById:async(id)=>{io.calls.push('auth:read');return {data:{user:io.auth[id]??null},error:null};},
  listUsers:async()=>{io.calls.push('auth:list');return {data:{users:Object.values(io.auth)},error:null};}}}};
 const qa=loadModule('src/lib/qa-access.server.ts',{'./workflow.server':workflow,'./test-send.core':marks,'./worker-links.core':workers,'./qa-role-link.core':links,'./partner-activation.core':activation,'./dad-test-login.core':dadCore});
 const actualHelper=loadModule('src/lib/set-password-link.server.ts',{'@/integrations/supabase/client.server':{supabaseAdmin:admin},'./workflow.server':workflow,'./set-password-link.core':setCore,'./worker-links.core':workers});
 const helper={issuePartnerLoginLink:async(...args)=>{io.helperCalls.push(args);return actualHelper.issuePartnerLoginLink(...args);}};
 const server=loadModule('src/lib/testrigor-test-login.server.ts',{'@/integrations/supabase/client.server':{supabaseAdmin:admin},'./qa-access.server':qa,'./set-password-link.server':helper,'./worker-links.core':workers,'./testrigor-test-login.core':core});
 const middleware=()=>{if(!io.authenticated)throw new Error('Unauthorized');};
 const createServerFn=()=>({middleware(ms){this.ms=ms;return this;},inputValidator(fn){this.validate=fn;return this;},handler(fn){return async(args={})=>{for(const m of this.ms)m();const data=this.validate(args.data);return fn({data,context:io.context});};}});
 io.action=loadModule('src/lib/testrigor-test-login.functions.ts',{'@tanstack/react-start':{createServerFn},zod:{z:testRequire('zod').z},'@/integrations/supabase/auth-middleware':{requireSupabaseAuth:middleware},'./testrigor-test-login.server':server}).downloadTestRigorLogins;
 return io;
}

test('content builder names lines with the testRigor stored values and holds links, never passwords',()=>{
 const text=core.testRigorHandoverText({installer:{setupUrl:'https://example.invalid/i',expiresAt:'2026-10-27T01:00:00.000Z'},electrician:{setupUrl:'https://example.invalid/e',expiresAt:'2026-10-27T02:00:00.000Z'}});
 for(const line of ['installerEmail: qa.installer.alpha@hivic-test.example','electricianEmail: qa.rec.delta@hivic-test.example','officeEmail: admin@hivic.test'])assert.ok(text.includes(line),line);
 assert.match(text,/^installerPassword: the password you choose/m);assert.match(text,/^electricianPassword: the password you choose/m);assert.match(text,/^officePassword: not in this file/m);
 const setLines=text.split('\n').filter(l=>l.startsWith('Set your password: '));assert.deepEqual(setLines,['Set your password: https://example.invalid/i','Set your password: https://example.invalid/e']);
 assert.ok(text.indexOf('https://example.invalid/i')<text.indexOf('electricianEmail'));
 assert.ok(text.includes('2026-10-27T01:00:00.000Z')&&text.includes('2026-10-27T02:00:00.000Z')&&text.includes('Australia/Sydney'));
 assert.ok(text.startsWith('PRIVATE')&&text.includes('Keep this file private')&&text.includes('not inboxes'));
 assert.equal(core.TESTRIGOR_FILENAME,'testRigor-TEST-logins.txt');
});

const badCases={
 'unauthenticated':io=>{io.authenticated=false;},'non-admin caller':io=>{io.allowed=false;},
 'non-TEST installer email (Auth)':io=>{io.auth[INST].email='real.person@gmail.com';},
 'non-TEST electrician email (profile)':io=>{io.tables.profiles[1].email='real.rec@example.com';},
 'missing qa_test':io=>{io.auth[ELEC].user_metadata.qa_test=false;},'missing account':io=>{io.tables.profiles.shift();delete io.auth[INST];},
 'banned identity':io=>{io.auth[INST].banned_until=new Date(Date.now()+60000).toISOString();},
 'admin role expansion':io=>{io.tables.user_roles.push({user_id:ELEC,role:'admin'});},'wrong role':io=>{io.tables.user_roles[1].role='installer';},
 'missing TEST mark':io=>{io.tables.businesses[1].onboarding_notes='real partner';},'wrong business type':io=>{io.tables.businesses[0].business_type='rec';},
 'inactive business':io=>{io.tables.businesses[0].is_active=false;},'inactive membership':io=>{io.tables.business_members[1].active=false;},
 'owner access':io=>{io.tables.owners.push({id:'owner',user_id:INST});},'non-test assigned job':io=>{io.tables.jobs[0].source='base44';},
 'other business assignment':io=>{io.tables.job_assignments.push({job_id:'qa-job',user_id:ELEC,business_id:'real-biz',active:true});},
 'truncated scope':io=>{io.truncate=true;},'unreadable scope':io=>{io.fail='job_assignments';},
};
for(const [name,alter] of Object.entries(badCases))test(name+' refuses before any link is issued',async()=>{const io=fixture();alter(io);await assert.rejects(io.action({data:{}}));assert.equal(io.helperCalls.length,0);assert.equal(io.tables.partner_login_links.length,0);});
for(const data of [{email:'other@hivic-test.example'},{userId:'other'},{actorId:'invented'},{businessId:'other'},{persona:'office'}])test('rejects caller-selected '+Object.keys(data)[0],async()=>{const io=fixture();await assert.rejects(io.action({data}));assert.equal(io.helperCalls.length,0);});
for(const [name,tamper] of Object.entries({'used':{used_at:new Date().toISOString()},'expired':{expires_at:new Date(Date.now()-1000).toISOString()},'other email':{email:'other@hivic-test.example'},'other creator':{created_by:'someone-else'}}))
 test('issued link row '+name+' means nothing is downloaded',async()=>{const io=fixture();io.tamper=tamper;await assert.rejects(io.action({data:{}}),/Nothing was downloaded/);});
test('issues one hashed 24h link per fixed TEST persona and returns one private file',async()=>{
 const io=fixture();const before=structuredClone(io.tables);const file=await io.action({data:{}});
 assert.deepEqual(io.helperCalls,[[core.TESTRIGOR_INSTALLER_EMAIL,io.context.userId,null],[core.TESTRIGOR_ELECTRICIAN_EMAIL,io.context.userId,null]]);
 assert.equal(file.filename,'testRigor-TEST-logins.txt');assert.equal(file.mimeType,'text/plain;charset=utf-8');
 const urls=file.content.split('\n').filter(x=>x.startsWith('Set your password: ')).map(x=>new URL(x.slice(19)));assert.equal(urls.length,2);
 for(const [i,url] of urls.entries()){
  assert.equal(url.pathname,'/reset-password');assert.equal(url.searchParams.get('next'),'/portal');
  const row=io.tables.partner_login_links[i];assert.equal(row.token_hash,await workers.hashToken(url.searchParams.get('link')));assert.equal(row.used_at,null);assert.equal(row.created_by,io.context.userId);
  assert.equal(row.email,[core.TESTRIGOR_INSTALLER_EMAIL,core.TESTRIGOR_ELECTRICIAN_EMAIL][i]);assert.ok(!('token' in row));assert.ok(file.content.includes(row.expires_at));
 }
 assert.ok(!/officePassword: .*http/.test(file.content));
 delete before.partner_login_links;const after={...io.tables};delete after.partner_login_links;assert.deepEqual(after,before);
 assert.deepEqual(io.calls.filter(c=>c.endsWith(':insert')),['partner_login_links:insert','partner_login_links:insert']);assert.ok(!io.calls.some(c=>/update|generateLink|email/.test(c)));
});
