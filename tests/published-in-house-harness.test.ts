import {expect,test} from 'bun:test';
import {publishedPreflightBlockers,runPublishedJourney,scenarioSteps,type PublishedProof,type JourneyAdapter} from '../scripts/published-in-house.core';
const proof=():PublishedProof=>({version:'in-house-published-v1',origin:'https://portal.homeinsulationvictoria.com.au',runId:'run-test',checkedAt:Date.now(),deployment:'deployed-test-build',authenticatedTestActors:true,setupScoped:true,snapshotRestore:true,messagesCaptured:true,mittiIncludingMediaSimulated:true,stripeTestOnly:true,xeroDemoOnly:true,escCaptured:true,launchHoldUnchanged:true});
test('missing deployed proof stops before setup, pages or cleanup',async()=>{
 let effects=0;const adapter:JourneyAdapter={preflight:async()=>null,setup:async()=>{effects++;throw Error('unsafe');},step:async()=>{effects++;throw Error('unsafe');},restore:async()=>{effects++;return true;}};
 const report=await runPublishedJourney(proof().origin,'run-test',adapter);
 expect(effects).toBe(0);expect(report.blockers.length).toBeGreaterThan(0);expect(report.rows.every(r=>r.status==='NOT RUN')).toBe(true);
});
test('every provider boundary, run, origin and freshness is mandatory',()=>{
 expect(publishedPreflightBlockers(proof(),proof().origin,'run-test')).toEqual([]);
 for(const key of ['messagesCaptured','mittiIncludingMediaSimulated','stripeTestOnly','xeroDemoOnly','escCaptured','setupScoped','snapshotRestore','authenticatedTestActors','launchHoldUnchanged'] as const){expect(publishedPreflightBlockers({...proof(),[key]:false},proof().origin,'run-test').length).toBeGreaterThan(0);}
 expect(publishedPreflightBlockers({...proof(),checkedAt:Date.now()-60001},proof().origin,'run-test').length).toBeGreaterThan(0);
 expect(publishedPreflightBlockers(proof(),'https://evil.example','run-test').length).toBeGreaterThan(0);
 expect(publishedPreflightBlockers(proof(),proof().origin,'another-run').length).toBeGreaterThan(0);
});
test('all five scenarios and role checkpoints are enumerated',()=>{
 expect([...new Set(scenarioSteps.map(s=>s.scenario))]).toEqual(['complete','owner_cancelled','handback','lead_swap','rectification']);
 expect(scenarioSteps.some(s=>s.key==='close'&&s.scenario==='complete')).toBe(true);
 expect(scenarioSteps.some(s=>s.key==='notice_updated'&&s.scenario==='lead_swap')).toBe(true);
 expect(scenarioSteps.some(s=>s.key==='rectification_complete'&&s.scenario==='rectification')).toBe(true);
});
test('page click alone cannot pass; cleanup verified even after a failed action',async()=>{
 let restores=0;const adapter:JourneyAdapter={preflight:async()=>proof(),setup:async()=>({protected:true}),step:async()=>({executed:true,readback:false,screenshots:['shot.png'],detail:'wrong state'}),restore:async()=>{restores++;return false;}};
 const report=await runPublishedJourney(proof().origin,'run-test',adapter);
 expect(report.rows[0]?.status).toBe('FAIL');expect(report.rows.some(r=>r.status==='PASS')).toBe(false);expect(restores).toBe(1);expect(report.restored).toBe(false);
});
test('setup failure still invokes recovery; failed fresh preflight never opens a page',async()=>{
 let restores=0,pages=0,probes=0;const adapter:JourneyAdapter={preflight:async()=>++probes===1?proof():null,setup:async()=>({protected:true}),step:async()=>{pages++;throw Error('unsafe');},restore:async()=>{restores++;return true;}};
 await runPublishedJourney(proof().origin,'run-test',adapter);expect(pages).toBe(0);expect(restores).toBe(1);
 adapter.preflight=async()=>proof();adapter.setup=async()=>{throw Error('partial preparation');};
 await runPublishedJourney(proof().origin,'run-test',adapter);expect(restores).toBe(2);
});