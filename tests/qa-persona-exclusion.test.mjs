// Executes the actual QA bootstrap/control flow with in-memory I/O. No accounts, network or child processes are used.
// node --experimental-vm-modules --test --test-isolation=none tests/qa-persona-exclusion.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { stripTypeScriptTypes } from "node:module";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root=process.env.HIVIC_QA_PERSONA_SOURCE_ROOT ?? fileURLToPath(new URL("..", import.meta.url));
const source=p=>readFileSync(path.join(root,p),"utf8");
const officeEmail="admin@hivic.test", installerEmail="deep-test@hivic.test", recEmail="qa.rec.delta@hivic-test.example", ownerEmail="qa.owner@hivic-test.example";

async function officeBootstrap(personas, missing=[]) {
  const text=source("scripts/qa-office-writes.ts");
  const start=text.indexOf("const sessions: Record");
  const end=text.indexOf("// ---- deployed server function calls",start);
  assert.ok(start>=0&&end>start,"actual session bootstrap must be found");
  const code=stripTypeScriptTypes(text.slice(start,end),{mode:"transform"});
  const calls={lookups:[],signins:[],ownerReads:0,rows:[]};
  const roleMap={[officeEmail]:["admin"],[installerEmail]:["installer"],[recEmail]:["electrician"],[ownerEmail]:["owner"]};
  const ownersQuery={select(){return this;},ilike(){return this;},not(){return this;},async limit(){return {data:[{email:ownerEmail}]};}};
  const context={PERSONAS:new Set(personas.split(",").map(s=>s.trim())),roles:async email=>{calls.lookups.push(email);return missing.includes(email)?null:roleMap[email];},sessionFor:async email=>{calls.signins.push(email);return {user:{id:email},access_token:"isolated"};},admin:{from(table){assert.equal(table,"owners");calls.ownerReads++;return ownersQuery;}},add:row=>calls.rows.push(row)};
  await vm.runInNewContext("(async()=>{"+code+"})()",context);
  return calls;
}

async function portalRun(personas) {
  const files=new Map(), calls={lookups:[],tokens:[],verifications:[],ownerReads:0,children:[],exit:null};
  const rowsFor=(table,filters,single)=>{
    if(table==="profiles")return {data:{id:filters.email},error:null};
    if(table==="user_roles")return {data:{id:"test-role"},error:null};
    if(table==="owners")return {data:[{id:"test-owner",user_id:"test-owner-user",email:ownerEmail}],error:null};
    if(table==="jobs")return {data:single?{id:"qa-test-job"}:[],error:null};
    if(table==="customer_email_sends")return {data:[],error:null};
    throw new Error("Unexpected read table "+table);
  };
  const admin={from(table){if(table==="owners")calls.ownerReads++;const filters={};const q={select(){return q;},eq(k,v){filters[k]=v;if(table==="profiles"&&k==="email")calls.lookups.push(v);return q;},is(){return q;},not(){return q;},ilike(){return q;},gte(){return q;},limit(){return q;},maybeSingle:async()=>rowsFor(table,filters,true),then(resolve,reject){return Promise.resolve(rowsFor(table,filters,false)).then(resolve,reject);}};return q;},auth:{admin:{generateLink:async({email})=>{calls.tokens.push(email);return {data:{properties:{hashed_token:email}},error:null};}}}};
  const sdk={createClient:()=>({auth:{verifyOtp:async({token_hash})=>{calls.verifications.push(token_hash);return {data:{session:{user:{id:token_hash},access_token:"isolated"}},error:null};}}})};
  const fs={mkdirSync(){},writeFileSync(p,v){files.set(String(p),String(v));},readFileSync(p){if(!files.has(String(p)))throw new Error("Unexpected file read "+p);return files.get(String(p));},existsSync:p=>files.has(String(p))||String(p).startsWith("tests/"),rmSync:p=>files.delete(String(p))};
  const spawnSync=(cmd,args)=>{
    if(cmd==="git")return {status:0,stdout:"isolated-source-check\n",stderr:""};
    calls.children.push([cmd,...args]);
    if(cmd==="python3"){const m=JSON.parse(files.get(args[1]));files.set(m.outDir+"/.browser.json",JSON.stringify(m.screens.map(s=>({step:s.step,ok:true,detail:"isolated desktop control-flow fixture",shots:[]}))));}
    if(cmd==="bun"&&args[0]==="scripts/qa-office-writes.ts"){const out=args[args.indexOf("--out")+1];files.set(out+"/office-writes.json","[]");}
    return {status:0,stdout:cmd==="bun"&&args[0]==="test"?"1 pass\n0 fail\n":args[0]==="scripts/installer-test.ts"?"PASS isolated-control-flow  —  mocked child\n":"",stderr:""};
  };
  const exitSignal={exit:true};
  const processMock={argv:["node","scripts/portal-qa.ts",...(personas===undefined?[]:["--personas",personas])],pid:912345,env:{SUPABASE_URL:"https://isolated.supabase.test",SUPABASE_PUBLISHABLE_KEY:"sb_isolated",SUPABASE_PROJECT_ID:"isolated"},on(){},kill(){throw new Error("No real processes");},exit(code){calls.exit=code;throw exitSignal;}};
  const context=vm.createContext({process:processMock,console:{log(){},error(){}},Date,URL,Headers,Buffer,AbortSignal,fetch:async()=>{throw new Error("Network prohibited");}});
  const mocks={"node:fs":fs,"node:child_process":{spawnSync},"node:crypto":{createHash},"@/integrations/supabase/client.server":{supabaseAdmin:admin},"@supabase/supabase-js":sdk};
  const mods=new Map();
  function make(spec){if(mods.has(spec))return mods.get(spec);assert.ok(mocks[spec],"Unexpected import "+spec);const vals=mocks[spec];const mod=new vm.SyntheticModule(Object.keys(vals),function(){for(const[k,v]of Object.entries(vals))this.setExport(k,v);},{context,identifier:spec});mods.set(spec,mod);return mod;}
  const mod=new vm.SourceTextModule(stripTypeScriptTypes(source("scripts/portal-qa.ts"),{mode:"transform"}),{context,identifier:"portal-qa",importModuleDynamically:async spec=>{const dep=make(spec);if(dep.status==="unlinked")await dep.link(()=>{});if(dep.status==="linked")await dep.evaluate();return dep;}});
  await mod.link(spec=>make(spec));
  try{await mod.evaluate();}catch(e){if(e!==exitSignal)throw e;}
  const report=JSON.parse(files.get("/mnt/documents/portal-qa/latest.json"));
  assert.ok(!report.results.some(r=>r.route_or_action==="runner error"),"control-flow fixture must complete without a runner error");
  return {...calls,report};
}

test("Office excludes installer before profile lookup and session issuance",async()=>{
  const c=await officeBootstrap("rec,owner");
  assert.deepEqual(c.signins,[officeEmail,recEmail,ownerEmail]);
  assert.ok(!c.lookups.includes(installerEmail));
});
test("Office excludes unselected REC and owner before any lookup or sign-in",async()=>{
  const c=await officeBootstrap("");
  assert.deepEqual(c.signins,[officeEmail]);assert.deepEqual(c.lookups,[officeEmail]);assert.equal(c.ownerReads,0);
});
test("Office preserves selected roles and fails closed on a missing selected role",async()=>{
  const c=await officeBootstrap("installer,rec", [recEmail]);
  assert.deepEqual(c.signins,[officeEmail,installerEmail]);assert.equal(c.ownerReads,0);
  assert.ok(c.rows.some(r=>r.persona==="rec"&&r.status==="blocked"));
});
test("Portal excludes installer everywhere and passes the exact list to Office child",async()=>{
  const selected=" rec , owner ";const c=await portalRun(selected);
  assert.ok(!c.lookups.includes(installerEmail));assert.ok(!c.tokens.includes(installerEmail));assert.ok(!c.verifications.includes(installerEmail));
  assert.ok(!c.children.some(a=>a.includes("scripts/installer-test.ts")));
  const office=c.children.find(a=>a.includes("scripts/qa-office-writes.ts"));assert.ok(office);
  assert.equal(office[office.indexOf("--personas")+1],selected);
  assert.equal(c.report.personas,selected);
  assert.ok(c.report.results.some(r=>r.area==="installer journey"&&r.status==="not_run"));
  assert.ok(c.report.results.filter(r=>r.area==="screens"&&r.persona==="installer").every(r=>r.status==="not_run"));
  assert.notEqual(c.report.overall,"passed");
});
test("Portal excludes owner before discovery and records NOT_RUN",async()=>{
  const c=await portalRun("rec");
  assert.equal(c.ownerReads,0);assert.ok(!c.tokens.includes(ownerEmail));assert.ok(!c.tokens.includes(installerEmail));
  assert.ok(c.report.results.some(r=>r.route_or_action==="TEST sign-in owner"&&r.status==="not_run"));
});
test("Portal default retains the existing selected installer flow",async()=>{
  const c=await portalRun(undefined);
  assert.ok(c.tokens.includes(installerEmail));assert.ok(c.children.some(a=>a.includes("scripts/installer-test.ts")));
  const office=c.children.find(a=>a.includes("scripts/qa-office-writes.ts"));
  assert.equal(office[office.indexOf("--personas")+1],"installer,rec,owner");
});
