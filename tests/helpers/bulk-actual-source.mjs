// Execute actual handlers, core and server helpers against the PGlite RPCs; isolate only framework/Auth/storage I/O.
import assert from 'node:assert/strict';
import {testRequire,source,fixture,ids,rpcTypes} from './bulk-fencing-fixture.mjs';
const ts=testRequire('typescript');
const clone=x=>x==null?x:JSON.parse(JSON.stringify(x));
const ident=x=>{assert.match(x,/^[a-z_]+$/);return '"'+x+'"';};
export async function actualFixture(t,options={}) {
 const f=await fixture(t,options);const io={...f,fail:new Map(),failAfter:new Map(),calls:[],signs:[],removed:[],fetchMode:'good',rowCap:null};
 class Query {
  filters=[];ordering=[];op='select';payload=null;oneMode=null;countExact=false;head=false;from=0;cap=null;returning=false;
  constructor(table){this.table=table;}
  select(columns='*',options={}){this.columns=columns;this.countExact=options.count==='exact';this.head=!!options.head;if(this.op!=='select')this.returning=true;return this;}
  eq(k,v){this.filters.push([k,'=',v]);return this;}neq(k,v){this.filters.push([k,'<>',v]);return this;}
  is(k,v){this.filters.push([k,'IS',v]);return this;}not(k,operator,v){assert.equal(operator,'is');this.filters.push([k,'IS NOT',v]);return this;}
  in(k,v){this.filters.push([k,'IN',v]);return this;}
  order(k,o={}){this.ordering.push(ident(k)+(o.ascending===false?' DESC':' ASC'));return this;}
  range(from,to){this.from=from;this.cap=to-from+1;return this;}limit(n){this.cap=n;return this;}
  insert(value){this.op='insert';this.payload=value;return this;}update(value){this.op='update';this.payload=value;return this;}
  delete(){this.op='delete';return this;}single(){this.oneMode='single';return this;}maybeSingle(){this.oneMode='maybe';return this;}
  then(a,b){return this.run().then(a,b);}
  async run(){
   const key=this.table+':'+this.op;io.calls.push(key);
   try{
    if(io.fail.has(key))throw Error(io.fail.get(key));
    const params=[];const p=value=>{params.push(typeof value==='object'&&value!==null?JSON.stringify(value):value);return '$'+params.length;};
    const where=this.filters.length?' WHERE '+this.filters.map(([k,op,v])=>op==='IS'||op==='IS NOT'?ident(k)+' '+op+' '+(v===null?'NULL':v===true?'TRUE':'FALSE'):op==='IN'?ident(k)+' IN ('+v.map(p).join(',')+')':ident(k)+' '+op+' '+p(v)).join(' AND '):'';
    let count=null;if(this.countExact)count=Number((await f.one('SELECT count(*) n FROM '+ident(this.table)+where,params)).n);
    let sql;if(this.op==='select')sql='SELECT * FROM '+ident(this.table)+where+(this.ordering.length?' ORDER BY '+this.ordering.join(','):'')+(this.cap!==null?' LIMIT '+Number(this.cap):'')+(this.from?' OFFSET '+Number(this.from):'');
    else if(this.op==='insert'){const rows=Array.isArray(this.payload)?this.payload:[this.payload];const keys=Object.keys(rows[0]);sql='INSERT INTO '+ident(this.table)+'('+keys.map(ident).join(',')+') VALUES '+rows.map(r=>'('+keys.map(k=>p(r[k]??null)).join(',')+')').join(',')+' RETURNING *';}
    else if(this.op==='update')sql='UPDATE '+ident(this.table)+' SET '+Object.entries(this.payload).map(([k,v])=>ident(k)+'='+p(v)).join(',')+where+' RETURNING *';
    else sql='DELETE FROM '+ident(this.table)+where+' RETURNING *';
    let rows=await f.query(sql,params);if(this.op==='select'&&this.table==='bulk_import_rows'&&io.rowCap!==null)rows=rows.slice(0,io.rowCap);
    if(this.columns?.includes('properties('))for(const row of rows)row.properties=await f.one('SELECT postcode FROM properties WHERE id=$1',[row.property_id]);
    if(this.oneMode==='single'&&rows.length!==1)throw Error('Expected exactly one '+this.table+' row');
    if(this.oneMode==='maybe'&&rows.length>1)throw Error('Expected at most one '+this.table+' row');
    return {data:clone(this.head?null:this.oneMode?rows[0]??null:rows),error:null,count};
   }catch(e){return {data:null,error:{message:e.message},count:null};}
  }
 }
 io.admin={from:table=>new Query(table),rpc:async(name,args)=>{
  io.calls.push('rpc:'+name);
  try{
   if(io.fail.has('rpc:'+name))throw Error(io.fail.get('rpc:'+name));
   const data=name==='has_role'?(await f.one('SELECT has_role($1,$2::app_role) value',[args._user_id,args._role])).value:await f.rpc(name,Object.values(args));
   if(io.failAfter.has(name)){const msg=io.failAfter.get(name);io.failAfter.delete(name);throw Error(msg);}
   return {data:clone(data),error:null};
  }catch(e){return{data:null,error:{message:e.message}};}
 },auth:{admin:{getUserById:async userId=>{
  io.calls.push('auth:getUserById');if(io.fail.has('auth:getUserById'))return{data:null,error:{message:io.fail.get('auth:getUserById')}};
  return {data:{user:{id:userId,email:'boss@hivic-test.example',user_metadata:{qa_test:true}}},error:null};
 }}},storage:{from:bucket=>({createSignedUrl:async(path,seconds)=>{
  io.signs.push({bucket,path,seconds});if(io.fail.has('storage:sign'))return{data:null,error:{message:io.fail.get('storage:sign')}};
  return{data:{signedUrl:'https://bulk-test.invalid/'+encodeURIComponent(path)},error:null};
 },remove:async paths=>{io.removed.push(...paths);return{data:{},error:null};}})}};
 const oldFetch=globalThis.fetch;t.after(()=>{globalThis.fetch=oldFetch;});globalThis.fetch=async()=>{
  io.calls.push('storage:bytes');if(io.fetchMode==='network')throw Error('Injected network failure');
  return new Response(io.fetchMode==='good'?new Uint8Array([255,216,255,225,0,0,0,0]):new Uint8Array([0,0,0,0]),{status:io.fetchMode==='unavailable'?503:200});
 };
 const z=new Proxy(()=>z,{get:()=>z,apply:()=>z});
 const workflow={WorkflowError:class WorkflowError extends Error{},logEvent:()=>{throw Error('Unexpected legacy writer');}};
 const noopModule=new Proxy({},{get:(_,key)=>()=>{throw Error('Unexpected unrelated helper '+String(key));}});
 const cache=new Map();
 const deps={
  '@/data/veu-location-variables-v25.json':JSON.parse(source('src/data/veu-location-variables-v25.json')),
  '@/integrations/supabase/client.server':{supabaseAdmin:io.admin},'@tanstack/react-start':{createServerFn:()=>({middleware(){return this;},inputValidator(){return this;},handler(fn){return args=>fn({...args,context:{userId:io.actor??ids.boss}});}})},
  '@/integrations/supabase/auth-middleware':{requireSupabaseAuth:()=>{}},zod:{z},'./workflow.server':workflow,
  './pilot.server':{logPartner:async()=>{io.calls.push('audit:partner');},requireMember:async()=>{}},'./measurement.core':noopModule,'./email-match':{exactLike:x=>x},'./mitti-forms.core':noopModule,
 };
 const allow=new Set(['bulk-import.functions','bulk-import.server','bulk-import.core','bulk-import-access.server','bulk-import-commit.server','upload-safety.server','upload-safety.core','worker-links.core','pilot.core','estimate.core','activity48.core','quote-release.core','installer-led.core']);
 io.load=name=>{
  if(cache.has(name))return cache.get(name).exports;assert.ok(allow.has(name),'Unexpected actual module '+name);
  const module={exports:{}};cache.set(name,module);
  const code=ts.transpileModule(source('src/lib/'+name+'.ts'),{fileName:name+'.ts',reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}});
  const errors=(code.diagnostics??[]).filter(x=>x.category===ts.DiagnosticCategory.Error);assert.equal(errors.length,0,errors.map(e=>ts.flattenDiagnosticMessageText(e.messageText,' ')).join('\n'));
  new Function('require','module','exports',code.outputText)(key=>Object.hasOwn(deps,key)?deps[key]:key.startsWith('./')?io.load(key.slice(2)):(()=>{throw Error('Unexpected dependency '+key);})(),module,module.exports);
  return module.exports;
 };
 io.handlers=io.load('bulk-import.functions');io.commit=io.load('bulk-import-commit.server');
 return io;
}
