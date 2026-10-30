import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { testRequire,loadHandlers } from './qa-actual-source.mjs';
const {PGlite}=testRequire('@electric-sql/pglite');
export const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const email={owner:'qa.owner.journey@hivic-test.example',installer:'qa.installer.alpha@hivic-test.example',electrician:'qa.rec.delta@hivic-test.example',worker:'qa.worker.alpha@hivic-test.example'};
const clone=value=>JSON.parse(JSON.stringify(value));
const schema=`
 CREATE TABLE jobs(id uuid PRIMARY KEY,owner_id uuid,source text,qa_archived_at timestamptz,deleted_at timestamptz);
 CREATE TABLE owners(id uuid PRIMARY KEY,user_id uuid,full_name text,email text);
 CREATE TABLE profiles(id uuid PRIMARY KEY,email text UNIQUE,full_name text,business_id uuid,phone text);
 CREATE TABLE user_roles(user_id uuid,role text,PRIMARY KEY(user_id,role));
 CREATE TABLE businesses(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text UNIQUE,legal_name text,trading_name text,business_type text,email text,phone text,
 commercial_route text,default_comms_owner text,onboarding_status text,is_active boolean,approved_by uuid,approved_at timestamptz,gst_registered boolean,onboarding_notes text);
 CREATE TABLE business_members(business_id uuid,user_id uuid,member_role text CONSTRAINT business_members_member_role_check CHECK (member_role IN ('business_admin','member')),active boolean,added_by uuid,PRIMARY KEY(business_id,user_id));
 CREATE TABLE job_assignments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),job_id uuid,user_id uuid,business_id uuid,role text,active boolean,assigned_by uuid,ended_at timestamptz,end_reason text);
 CREATE TABLE partner_workers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid,profile_id uuid,full_legal_name text,email text,mobile text,trade_role text,
 qualification text,licence_number text,approval_status text,approved_by uuid,approved_at timestamptz,certification_status text DEFAULT 'unverified',removed_at timestamptz,added_by uuid,
 CONSTRAINT partner_workers_check CHECK ((trade_role = 'electrician' AND licence_number IS NOT NULL) OR (trade_role = 'installer' AND qualification IS NOT NULL) OR trade_role = 'property_manager'));
 CREATE TABLE worker_job_links(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),worker_id uuid,business_id uuid,job_id uuid,token_hash text,created_by uuid,created_at timestamptz DEFAULT now(),expires_at timestamptz,revoked_at timestamptz,revoked_by uuid);
 CREATE TABLE rate_cards(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),kind text,business_id uuid,name text,version integer,is_active boolean);
 CREATE TABLE rate_card_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),rate_card_id uuid,code text,description text,category text,unit text,display_unit text,r_value numeric,sort integer,unit_price_ex_gst numeric);`;
const tables=['jobs','owners','profiles','user_roles','businesses','business_members','job_assignments','partner_workers','worker_job_links','rate_cards','rate_card_items'];
const identifier=x=>{assert.match(x,/^[a-z_]+$/);return '"'+x+'"';};

export async function fixture(t,{seed=true}={}) {
 const db=new PGlite();t.after(()=>db.close());await db.exec(schema);
 const io={db,users:new Map(),calls:[],issued:[],fail:new Map(),isAdmin:true,rowCap:null};
 class Query {
  operation='select';filters=[];ordering=[];values=[];returning=false;rowMode=null;cap=null;payload=null;countExact=false;
  constructor(table){assert.ok(tables.includes(table));this.table=table;}
  select(_fields,opts={}){if(this.operation!=='select')this.returning=true;this.countExact=opts.count==='exact';return this;}
  insert(payload){this.operation='insert';this.payload=payload;return this;}
  update(payload){this.operation='update';this.payload=payload;return this;}
  upsert(){throw new Error('Unexpected upsert: launcher must preserve existing attributes.');}
  eq(key,value){this.filters.push([key,'=',value]);return this;}
  neq(key,value){this.filters.push([key,'<>',value]);return this;}
  is(key,value){this.filters.push([key,'IS',value]);return this;}
  in(key,value){this.filters.push([key,'IN',value]);return this;}
  order(key,opts={}){this.ordering.push(identifier(key)+(opts.ascending===false?' DESC':' ASC'));return this;}
  limit(n){this.cap=n;return this;}
  maybeSingle(){this.rowMode='maybe';return this.run();}
  single(){this.rowMode='single';return this.run();}
  then(resolve,reject){return this.run().then(resolve,reject);}
  async run(){
   const operation=this.table+':'+this.operation;io.calls.push(operation);
   try {
    if(io.fail.has(operation))throw new Error(io.fail.get(operation));
    const params=[];const param=value=>{params.push(value);return '$'+params.length;};
    const where=this.filters.length?' WHERE '+this.filters.map(([key,op,value])=>
      op==='IS'?identifier(key)+' IS '+(value===null?'NULL':value===true?'TRUE':'FALSE'):
      op==='IN'?identifier(key)+' IN ('+value.map(param).join(',')+')':identifier(key)+' '+op+' '+param(value)).join(' AND '):'';
    let sql;
    if(this.operation==='select')sql='SELECT * FROM '+identifier(this.table)+where+(this.ordering.length?' ORDER BY '+this.ordering.join(','):'')+(this.cap!==null?' LIMIT '+param(this.cap):'');
    else if(this.operation==='insert'){
      const rows=Array.isArray(this.payload)?this.payload:[this.payload];const keys=Object.keys(rows[0]);
      sql='INSERT INTO '+identifier(this.table)+' ('+keys.map(identifier).join(',')+') VALUES '+rows.map(row=>'('+keys.map(key=>param(row[key]??null)).join(',')+')').join(',')+' RETURNING *';
    }else{
      sql='UPDATE '+identifier(this.table)+' SET '+Object.entries(this.payload).map(([key,value])=>identifier(key)+'='+param(value)).join(',')+where+' RETURNING *';
    }
    let rows=(await db.query(sql,params)).rows;
    const count=this.countExact?rows.length:null;
    if(this.operation==='select'&&io.rowCap!=null)rows=rows.slice(0,io.rowCap);
    if(this.rowMode==='single'&&rows.length!==1)throw new Error('Expected exactly one row');
    if(this.rowMode==='maybe'&&rows.length>1)throw new Error('Expected at most one row');
    const data=this.operation!=='select'&&!this.returning?null:this.rowMode?rows[0]??null:rows;
    return {data:clone(data),error:null,count};
   }catch(error){return {data:null,error:{message:error.message}};}
  }
 }
 const authCall=async(name,fn)=>{io.calls.push('auth:'+name);try{if(io.fail.has('auth:'+name))throw new Error(io.fail.get('auth:'+name));return {data:await fn(),error:null};}catch(error){return{data:null,error:{message:error.message}};}};
 const admin={from:table=>new Query(table),auth:{admin:{
  getUserById:userId=>authCall('getUserById',async()=>({user:clone(io.users.get(userId)??null)})),
  listUsers:({page,perPage})=>authCall('listUsers',async()=>({users:clone([...io.users.values()].slice((page-1)*perPage,page*perPage))})),
  createUser:details=>authCall('createUser',async()=>{
   if(typeof details.password!=='string'||details.password.length>72||!/[a-z]/.test(details.password)||!/[A-Z]/.test(details.password)||!/[0-9]/.test(details.password)||!/[!]/.test(details.password))throw new Error('Generated TEST password violates the Auth boundary requirements');
   if([...io.users.values()].some(u=>u.email===details.email))throw new Error('Existing email');
   const user={id:randomUUID(),...clone(details)};
   await db.query('INSERT INTO profiles(id,email,full_name) VALUES($1,$2,$3)',[user.id,user.email,user.user_metadata.full_name]);io.users.set(user.id,user);return {user};
  }),
  updateUserById:()=>{throw new Error('Unexpected Auth update or password reset.');},
  generateLink:({email:to})=>authCall('generateLink',async()=>{
   const user=[...io.users.values()].find(u=>u.email===to);if(!user)throw new Error('Cannot issue access for missing Auth user');
   const token=randomUUID()+randomUUID();io.issued.push({email:to,token});return{user:clone(user),properties:{hashed_token:token}};
  })
 }}};
 io.context={userId:id(999),supabase:{rpc:async(_fn,args)=>{const role=args?._role??'admin';if(role!=='admin'){io.calls.push(role+':has_role');return {data:io.isQaOffice===true&&role==='qa_office',error:null};}io.calls.push('admin:has_role');return io.fail.has('admin:has_role')?{data:null,error:{message:io.fail.get('admin:has_role')}}:{data:io.isAdmin,error:null};}}};
 io.handlers=loadHandlers(admin,io.context);
 io.user=async(n,address,businessId=null,role=null)=>{
  io.users.set(id(n),{id:id(n),email:address,password:'unchanged-secret-'+n,user_metadata:{qa_test:true,full_name:'Existing TEST name '+n}});
  await db.query('INSERT INTO profiles(id,email,full_name,business_id) VALUES($1,$2,$3,$4)',[id(n),address,'Existing TEST name '+n,businessId]);
  if(role)await db.query('INSERT INTO user_roles(user_id,role) VALUES($1,$2)',[id(n),role]);
 };
 io.snapshot=async()=>{
  const result={auth:[...io.users.values()].map(clone).sort((a,b)=>a.id.localeCompare(b.id))};
  for(const table of tables)result[table]=clone((await db.query('SELECT * FROM '+identifier(table))).rows).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return result;
 };
 if(seed){
  await db.query('INSERT INTO jobs(id,owner_id,source) VALUES($1,$2,$3)',[id(1),id(2),'qa_test']);
  await db.query('INSERT INTO owners(id,user_id,full_name,email) VALUES($1,$2,$3,$4)',[id(2),id(10),'TEST homeowner',email.owner]);
  await db.query("INSERT INTO businesses(id,name,email,business_type,onboarding_notes,onboarding_status,is_active) VALUES($1,'TEST Alpha Insulation',$2,'eec_installer','[TEST PARTNER] fixture','approved',true),($3,'TEST Delta Electrical',$4,'rec','[TEST PARTNER] fixture','approved',true)",[id(20),email.installer,id(21),email.electrician]);
  await io.user(10,email.owner,null,'owner');await io.user(11,email.installer,id(20),'installer');await io.user(12,email.electrician,id(21),'electrician');await io.user(13,email.worker,id(20),'installer');
  await db.query("INSERT INTO business_members(business_id,user_id,member_role,active) VALUES($1,$2,'business_admin',true),($3,$4,'business_admin',true),($1,$5,'member',true)",[id(20),id(11),id(21),id(12),id(13)]);
  await db.query("INSERT INTO job_assignments(job_id,user_id,business_id,role,active) VALUES($1,$2,$3,'installer',true),($1,$4,$5,'electrician',true)",[id(1),id(11),id(20),id(12),id(21)]);
  await db.query("INSERT INTO partner_workers(id,business_id,profile_id,full_legal_name,email,trade_role,approval_status,certification_status,qualification) VALUES($1,$2,$3,'Existing TEST worker',$4,'installer','approved','verified','Existing verified qualification')",[id(30),id(20),id(13),email.worker]);
  await db.query("INSERT INTO worker_job_links(id,worker_id,business_id,job_id,token_hash,created_at,expires_at) VALUES($1,$2,$3,$4,'original-hash',now()-interval '1 day',now()+interval '1 day')",[id(40),id(30),id(20),id(1)]);
 }
 return io;
}
