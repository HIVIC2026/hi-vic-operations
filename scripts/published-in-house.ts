/** Read-only published capability probe. Never imports local domain/admin writers. */
import {mkdirSync,writeFileSync} from 'node:fs';
import {publishedPreflightBlockers,scenarioSteps,type PublishedProof} from './published-in-house.core';
export async function publishedInHousePreflight(args:string[]){
 const at=args.indexOf('--base'),origin=at<0?'https://portal.homeinsulationvictoria.com.au':args[at+1]??'';
 const runId=`run-${crypto.randomUUID()}`;
 const stamp=new Date().toISOString().replace(/[:.]/g,'-');
 const out=`/mnt/documents/published-in-house/${stamp}`;mkdirSync(out,{recursive:true});
 let proof:PublishedProof|null=null,probeDetail='';
 // Validate the target BEFORE attaching any token. Never accept an arbitrary origin from arguments.
 if(publishedPreflightBlockers(null,origin,runId).length===1){
   let token:string|undefined;
   try{const session=JSON.parse(process.env['LOVABLE_BROWSER_SUPABASE_SESSION_JSON']??'null') as {access_token?:string}|null;token=session?.access_token;}catch{/* no usable session */}
   try{
     const response=await fetch(`${origin}/api/public/qa-in-house-preflight?run=${runId}`,{headers:token?{Authorization:`Bearer ${token}`}:{},redirect:'error',signal:AbortSignal.timeout(20000)});
     probeDetail=`Published safety endpoint HTTP ${response.status}.`;
     if(response.ok&&response.headers.get('content-type')?.includes('application/json')){
       const body=await response.json();if(body&&typeof body==='object'&&body.version==='in-house-published-v1')proof=body as PublishedProof;
     }
   }catch{probeDetail='Published safety endpoint unreachable or redirected; no credentials forwarded.';}
 }
 const blockers=publishedPreflightBlockers(proof,origin,runId);
 const rows=scenarioSteps.map(s=>({...s,status:'NOT RUN',detail:'Safety preflight refused before setup/page action.',screenshots:[]}));
 const report={origin,runId,probeDetail,blockers,rows,setupStarted:false,restoration:'NOT NEEDED — no setup',pageActions:0,providerCalls:0};
 writeFileSync(`${out}/results.json`,JSON.stringify(report,null,2));
 writeFileSync(`${out}/report.md`,`# Published in-house TEST journey\n\nTarget: ${origin}\n\n${probeDetail}\n\n## Safety preflight: ${blockers.length?'FAIL':'PASS'}\n${blockers.map(b=>`- ${b}`).join('\n')}\n\nNo TEST setup or page actions occurred. No screenshots exist because provider boundaries were not proven before any page action.\n\n| Scenario | Checkpoint | Role | Result |\n|---|---|---|---|\n${rows.map(r=>`| ${r.scenario} | ${r.key} | ${r.role} | NOT RUN |`).join('\n')}\n`);
 console.log(`Published safety probe: ${blockers.length?'BLOCKED':'PASS'}; ${rows.length} checkpoints NOT RUN. Report: ${out}/report.md`);
 return report;
}
if(import.meta.main)await publishedInHousePreflight(process.argv.slice(2));