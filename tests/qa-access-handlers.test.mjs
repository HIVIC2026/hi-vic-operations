import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {fixture,id,email} from './helpers/qa-fixture.mjs';
const data={jobId:id(1)};
const tradeEmails=[email.installer,'qa.installer.bravo@hivic-test.example','qa.installer.charlie@hivic-test.example',email.electrician,'qa.rec.echo@hivic-test.example','qa.rec.foxtrot@hivic-test.example'];

test('actual account creator: existing identities are skipped with byte-for-byte state preservation',async t=>{
 const io=await fixture(t,{seed:false});
 for(let i=0;i<tradeEmails.length;i++)await io.user(50+i,tradeEmails[i],null,i<3?'installer':'electrician');
 // Deliberately incomplete/restricted fixtures must not be rewritten by the repeated creator.
 await io.db.query("UPDATE user_roles SET role='owner' WHERE user_id=$1",[id(50)]);
 io.users.get(id(51)).banned_until=new Date(Date.now()+86_400_000).toISOString();
 const before=await io.snapshot();const result=await io.handlers.createTestTradeAccounts({data:{}});
 assert.equal(result.results.length,6);assert.ok(result.results.every(r=>r.status==='already existed'));
 assert.deepEqual(await io.snapshot(),before);assert.equal(io.issued.length,0);
 assert.ok(!io.calls.some(c=>c.includes(':insert')||c.includes(':update')||c==='auth:createUser'));
});

test('actual account creator: Auth-only existing identities are skipped and directory errors never create users',async t=>{
 const io=await fixture(t,{seed:false});
 for(let i=0;i<tradeEmails.length;i++)io.users.set(id(50+i),{id:id(50+i),email:tradeEmails[i],user_metadata:{qa_test:true},password:'existing'});
 const before=await io.snapshot();const result=await io.handlers.createTestTradeAccounts({data:{}});
 assert.ok(result.results.every(r=>r.status==='already existed'));assert.deepEqual(await io.snapshot(),before);
 io.fail.set('auth:listUsers','Auth directory unavailable');
 await assert.rejects(io.handlers.createTestTradeAccounts({data:{}}),/Auth directory unavailable/);assert.deepEqual(await io.snapshot(),before);
});

test('actual account creator: fresh accounts are explicit, then repeated creation changes no existing record',async t=>{
 const io=await fixture(t,{seed:false});const first=await io.handlers.createTestTradeAccounts({data:{}});
 assert.equal(first.results.filter(r=>r.status==='created').length,6);
 const before=await io.snapshot();assert.equal(before.auth.length,6);assert.equal(before.business_members.length,6);assert.equal(before.rate_cards.length,6);
 const second=await io.handlers.createTestTradeAccounts({data:{}});
 assert.ok(second.results.every(r=>r.status==='already existed'));assert.deepEqual(await io.snapshot(),before);
});

test('actual role issuers: opening owner, installer and electrician only issues access to existing verified identities',async t=>{
 const io=await fixture(t);const before=await io.snapshot();
 for(const persona of ['owner','installer_boss','electrician']){
  const link=await io.handlers.issueQaPersonaLink({data:{...data,persona}});assert.equal(link.type,'magiclink');assert.equal(link.next,'/home');assert.ok(link.tokenHash.length>20);
 }
 assert.deepEqual(await io.snapshot(),before);assert.deepEqual(io.issued.map(i=>i.email),[email.owner,email.installer,email.electrician]);
 assert.ok(!io.calls.some(c=>c.includes(':insert')||c.includes(':update')||c==='auth:createUser'));
});

test('actual access handlers: missing administrator authority or unreadable checks fail before issuing access',async t=>{
 const io=await fixture(t);const before=await io.snapshot();
 io.isAdmin=false;await assert.rejects(io.handlers.issueQaPersonaLink({data:{...data,persona:'owner'}}),/Admin only/);
 io.isAdmin=true;io.fail.set('admin:has_role','role check unavailable');
 await assert.rejects(io.handlers.issueQaWorkerLink({data}),/role check unavailable/);
 assert.deepEqual(await io.snapshot(),before);assert.equal(io.issued.length,0);
});

test('actual persona issuer: unsafe identity, business, role and assignment states fail without repairing them',async t=>{
 const io=await fixture(t);
 const cases=[
  ["UPDATE jobs SET source='base44'",/active TEST journey/],
  ["UPDATE jobs SET qa_archived_at=now()",/active TEST journey/],
  ["UPDATE jobs SET deleted_at=now()",/active TEST journey/],
  ["UPDATE profiles SET email='unsafe@example.com' WHERE id='"+id(11)+"'",/safely isolated|do not match/],
  ["INSERT INTO user_roles(user_id,role) VALUES('"+id(11)+"','admin')",/conflicting role/],
  ["UPDATE businesses SET onboarding_notes='real business' WHERE id='"+id(20)+"'",/expected TEST business/],
  ["UPDATE businesses SET onboarding_status='rejected' WHERE id='"+id(20)+"'",/not currently approved/],
  ["UPDATE businesses SET is_active=false WHERE id='"+id(20)+"'",/not currently approved/],
  ["UPDATE business_members SET active=false WHERE user_id='"+id(11)+"'",/membership is missing, inactive or conflicting/],
  ["UPDATE profiles SET business_id='"+id(21)+"' WHERE id='"+id(11)+"'",/another business/],
  ["UPDATE job_assignments SET active=false WHERE role='installer'",/no active TEST installer boss assigned/],
  ["INSERT INTO job_assignments(job_id,user_id,business_id,role,active) VALUES('"+id(1)+"','"+id(11)+"','"+id(20)+"','installer',true)",/no active TEST installer boss assigned/],
 ];
 for(const [sql,error]of cases){await io.db.exec('BEGIN');try{await io.db.exec(sql);const before=await io.snapshot();await assert.rejects(io.handlers.issueQaPersonaLink({data:{...data,persona:'installer_boss'}}),error);assert.deepEqual(await io.snapshot(),before);}finally{await io.db.exec('ROLLBACK');}}
 for(const alter of [user=>{user.user_metadata.qa_test=false;},user=>{user.email='qa.someone-else@hivic-test.example';},user=>{user.banned_until=new Date(Date.now()+60_000).toISOString();}]){
  const original=structuredClone(io.users.get(id(11)));alter(io.users.get(id(11)));const before=await io.snapshot();
  await assert.rejects(io.handlers.issueQaPersonaLink({data:{...data,persona:'installer_boss'}}),/TEST identity|do not match|sign-in is blocked/);
  assert.deepEqual(await io.snapshot(),before);io.users.set(id(11),original);
 }
 assert.equal(io.issued.length,0);
});

test('actual worker issuer: removed, pending, unverified and revoked fixtures remain blocked and unchanged',async t=>{
 const io=await fixture(t);
 for(const sql of ["UPDATE partner_workers SET removed_at=now()","UPDATE partner_workers SET approval_status='pending'","UPDATE partner_workers SET approval_status='rejected'", "UPDATE partner_workers SET certification_status='pending'", "UPDATE worker_job_links SET revoked_at=now()", "UPDATE business_members SET active=false WHERE member_role='field_worker'", "UPDATE businesses SET onboarding_status='revoked' WHERE id='"+id(20)+"'"]){
  await io.db.exec('BEGIN');try{await io.db.exec(sql);const before=await io.snapshot();await assert.rejects(io.handlers.issueQaWorkerLink({data}));assert.deepEqual(await io.snapshot(),before);}finally{await io.db.exec('ROLLBACK');}
 }
});

test('actual worker issuer: repeated opens add only hashed 15-minute links and preserve all prior access',async t=>{
 const io=await fixture(t);const before=await io.snapshot();const started=Date.now();const links=[];
 for(let n=0;n<2;n++)links.push(await io.handlers.issueQaWorkerLink({data}));
 const after=await io.snapshot();assert.equal(after.worker_job_links.length,before.worker_job_links.length+2);
 const added=after.worker_job_links.filter(row=>!before.worker_job_links.some(old=>old.id===row.id));
 for(const link of links){const token=link.path.slice(3);const stored=added.find(r=>r.token_hash===createHash('sha256').update(token).digest('hex'));assert.ok(stored);assert.ok(Date.parse(stored.expires_at)>=started+14*60_000);assert.ok(Date.parse(stored.expires_at)<=Date.now()+15*60_000);assert.ok(!JSON.stringify(after).includes(token));}
 after.worker_job_links=after.worker_job_links.filter(row=>before.worker_job_links.some(old=>old.id===row.id));assert.deepEqual(after,before);
 assert.ok(!io.calls.some(c=>c==='auth:createUser'||c==='auth:generateLink'||c.endsWith(':update')));
});

test('actual access handlers: every database and Auth failure used by opening is propagated with no successful access',async t=>{
 const io=await fixture(t);
 for(const operation of ['jobs:select','owners:select','profiles:select','auth:getUserById','user_roles:select','auth:generateLink']){
  const before=await io.snapshot();io.fail.set(operation,'injected '+operation);
  await assert.rejects(io.handlers.issueQaPersonaLink({data:{...data,persona:'owner'}}),new RegExp('injected '+operation));
  assert.deepEqual(await io.snapshot(),before);io.fail.clear();
 }
 for(const operation of ['job_assignments:select','businesses:select','business_members:select','partner_workers:select','worker_job_links:select','worker_job_links:insert']){
  const before=await io.snapshot();io.fail.set(operation,'injected '+operation);
  await assert.rejects(io.handlers.issueQaWorkerLink({data}),new RegExp('injected '+operation));assert.deepEqual(await io.snapshot(),before);io.fail.clear();
 }
 assert.equal(io.issued.length,0);
});

test('actual explicit preparation: already prepared fixtures have no writes or new access tokens',async t=>{
 const io=await fixture(t);const before=await io.snapshot();const result=await io.handlers.prepareQaJourneyAccess({data});
 assert.match(result.message,/retained/);assert.deepEqual(await io.snapshot(),before);
 assert.ok(!io.calls.some(c=>c.endsWith(':insert')||c.endsWith(':update')||c==='auth:createUser'||c==='auth:generateLink'));
});

test('actual explicit preparation: blocked/revoked and intentionally ended states are never repaired',async t=>{
 const io=await fixture(t);
 for(const sql of ["UPDATE job_assignments SET active=false WHERE role='installer'","UPDATE business_members SET active=false WHERE member_role='field_worker'","UPDATE partner_workers SET approval_status='rejected',certification_status='rejected'","UPDATE worker_job_links SET revoked_at=now()","UPDATE businesses SET onboarding_status='rejected' WHERE id='"+id(20)+"'"]){
  await io.db.exec('BEGIN');try{await io.db.exec(sql);const before=await io.snapshot();await assert.rejects(io.handlers.prepareQaJourneyAccess({data}));assert.deepEqual(await io.snapshot(),before);}finally{await io.db.exec('ROLLBACK');}
 }
 assert.equal(io.issued.length,0);
});

test('actual explicit preparation: only missing safe links are added; a new worker starts pending and unverified',async t=>{
 const io=await fixture(t);
 await io.db.exec("DELETE FROM worker_job_links; DELETE FROM partner_workers; DELETE FROM business_members WHERE member_role='field_worker'; DELETE FROM user_roles WHERE user_id='"+id(13)+"'; DELETE FROM profiles WHERE id='"+id(13)+"'; DELETE FROM job_assignments; UPDATE owners SET user_id=NULL;");
 io.users.delete(id(13));const before=await io.snapshot();const result=await io.handlers.prepareQaJourneyAccess({data});
 assert.match(result.message,/still needs Office approval/);const after=await io.snapshot();
 assert.equal(after.job_assignments.length,2);assert.equal(after.partner_workers.length,1);assert.equal(after.partner_workers[0].approval_status,'pending');assert.equal(after.partner_workers[0].certification_status,'unverified');assert.equal(after.partner_workers[0].qualification,'EEC CII not stated (declared, not verified)');
 assert.deepEqual(after.worker_job_links,[]);assert.equal(io.issued.length,0);
 assert.deepEqual(after.businesses,before.businesses);assert.deepEqual(after.rate_cards,before.rate_cards);
 for(const user of before.auth)assert.deepEqual(after.auth.find(row=>row.id===user.id),user);
 // A repeated preparation reports the pending fixture; it does not approve it to make opening succeed.
 const pending=await io.snapshot();await assert.rejects(io.handlers.prepareQaJourneyAccess({data}),/waiting for.*approval/);assert.deepEqual(await io.snapshot(),pending);
});

test('actual explicit preparation: a failed assignment insert is reported and existing associations are not replaced',async t=>{
 const io=await fixture(t);await io.db.exec("DELETE FROM job_assignments WHERE role='electrician'");const before=await io.snapshot();
 io.fail.set('job_assignments:insert','assignment write failed');await assert.rejects(io.handlers.prepareQaJourneyAccess({data}),/assignment write failed/);assert.deepEqual(await io.snapshot(),before);
});

test('actual owner access and preparation: an owner shared with real work is rejected without changes',async t=>{
 const io=await fixture(t);
 await io.db.query('INSERT INTO jobs(id,owner_id,source) VALUES($1,$2,$3)',[id(71),id(2),'base44']);
 const before=await io.snapshot();
 await assert.rejects(io.handlers.issueQaPersonaLink({data:{...data,persona:'owner'}}),/also associated with non-TEST work/);
 await assert.rejects(io.handlers.prepareQaJourneyAccess({data}),/also associated with non-TEST work/);
 assert.deepEqual(await io.snapshot(),before);assert.equal(io.issued.length,0);
 await io.db.exec('UPDATE owners SET user_id=NULL');
 const unlinked=await io.snapshot();
 await assert.rejects(io.handlers.prepareQaJourneyAccess({data}),/also associated with non-TEST work/);
 assert.deepEqual(await io.snapshot(),unlinked);assert.equal(io.issued.length,0);
 assert.ok(!io.calls.some(c=>c.endsWith(':insert')||c.endsWith(':update')||c==='auth:createUser'||c==='auth:generateLink'));
});

test('actual owner access: every owner record reachable by the identity must contain only TEST work',async t=>{
 const io=await fixture(t);
 await io.db.query('INSERT INTO owners(id,user_id,full_name,email) VALUES($1,$2,$3,$4)',[id(72),id(10),'Shared owner',email.owner]);
 await io.db.query('INSERT INTO jobs(id,owner_id,source) VALUES($1,$2,$3)',[id(73),id(72),'hivic']);
 const before=await io.snapshot();
 await assert.rejects(io.handlers.issueQaPersonaLink({data:{...data,persona:'owner'}}),/also associated with non-TEST work/);
 await assert.rejects(io.handlers.prepareQaJourneyAccess({data}),/also associated with non-TEST work/);
 assert.deepEqual(await io.snapshot(),before);assert.equal(io.issued.length,0);
});

test('actual owner isolation: null source and capped owner/job results fail closed before access or preparation',async t=>{
 const io=await fixture(t);io.rowCap=1000;
 const rejected=async pattern=>{const before=await io.snapshot();await assert.rejects(io.handlers.issueQaPersonaLink({data:{...data,persona:'owner'}}),pattern);await assert.rejects(io.handlers.prepareQaJourneyAccess({data}),pattern);assert.deepEqual(await io.snapshot(),before);assert.equal(io.issued.length,0);};
 await io.db.exec('BEGIN');
 await io.db.query('INSERT INTO jobs(id,owner_id,source) VALUES($1,$2,NULL)',[id(75),id(2)]);
 await rejected(/also associated with non-TEST work/);await io.db.exec('ROLLBACK');
 await io.db.exec('BEGIN');
 await io.db.query("INSERT INTO jobs(id,owner_id,source) SELECT gen_random_uuid(),$1,CASE WHEN n=1001 THEN 'base44' ELSE 'qa_test' END FROM generate_series(1,1001) n",[id(2)]);
 await rejected(/complete TEST owner journey scope/);await io.db.exec('ROLLBACK');
 await io.db.query("INSERT INTO owners(id,user_id,full_name,email) SELECT gen_random_uuid(),$1,'TEST owner','qa.owner.scope@hivic-test.example' FROM generate_series(1,1001)",[id(10)]);
 await rejected(/complete TEST owner access scope/);
 assert.ok(!io.calls.some(c=>c.endsWith(':insert')||c.endsWith(':update')||c==='auth:createUser'||c==='auth:generateLink'));
});
