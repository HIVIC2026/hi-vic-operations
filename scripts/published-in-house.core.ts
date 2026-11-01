/** Import-safe orchestration. A local boolean or mock never attests a deployed server. */
export type PublishedProof={version:string;origin:string;runId:string;checkedAt:number;deployment:string;authenticatedTestActors:boolean;setupScoped:boolean;snapshotRestore:boolean;messagesCaptured:boolean;mittiIncludingMediaSimulated:boolean;stripeTestOnly:boolean;xeroDemoOnly:boolean;escCaptured:boolean;launchHoldUnchanged:boolean};
export type Checkpoint={scenario:string;key:string;role:string};
const roles=['owner','HIV office','installer office','electrician','Lead Installer'] as const;
const common=['intake','save_spot','quick_taps','handoff','ready_check_booked','ready_check_complete','quote_signed','piesa_paid','piesa_booked'];
const flow:Record<string,string[]>={complete:[...common,'piesa_pass','deposit_paid','install_booked','installation_complete','coes','balance_paid','ap_review','veec','close'],owner_cancelled:[...common,'owner_cancelled','old_access_denied'],handback:[...common,'cant_do_this_one','forms_closed','old_access_denied'],lead_swap:[...common,'piesa_pass','deposit_paid','install_booked','notice_lodged','lead_swapped','old_access_denied','prestart_held','notice_updated','prestart_allowed'],rectification:[...common,'rectification_required','rectification_approved','rectification_payment','rectification_booked','rectification_complete','deposit_paid','install_booked','installation_complete','coes','balance_paid','ap_review','veec','close']};
export const scenarioSteps:Checkpoint[]=Object.entries(flow).flatMap(([scenario,steps])=>steps.flatMap(key=>roles.map(role=>({scenario,key,role}))));
const origins=new Set(['https://portal.homeinsulationvictoria.com.au','https://hi-vic-operations.lovable.app']);
export function publishedPreflightBlockers(proof:PublishedProof|null,origin:string,runId:string,now=Date.now()):string[]{
 const reasons:string[]=[];
 if(!origins.has(origin))reasons.push('Target is not an approved published portal origin.');
 if(!proof)return [...reasons,'Published server safety attestation is unavailable; no setup or page action permitted.'];
 if(proof.version!=='in-house-published-v1'||proof.origin!==origin||proof.runId!==runId||!proof.deployment)reasons.push('Published deployment/run identity is not verified.');
 if(!Number.isFinite(proof.checkedAt)||now-proof.checkedAt>60000||proof.checkedAt>now+5000)reasons.push('Published safety proof is stale or invalid.');
 for(const key of ['authenticatedTestActors','setupScoped','snapshotRestore','messagesCaptured','mittiIncludingMediaSimulated','stripeTestOnly','xeroDemoOnly','escCaptured','launchHoldUnchanged'] as const)if(proof[key]!==true)reasons.push(`${key} is not independently proven by the published server.`);
 return reasons;
}
export type StepEvidence={executed:boolean;readback:boolean;screenshots:string[];detail:string};
export type EvidenceRow=Checkpoint&{status:'PASS'|'FAIL'|'NOT RUN';detail:string;screenshots:string[]};
export type JourneyAdapter={preflight:(origin:string,runId:string)=>Promise<PublishedProof|null>;setup:(runId:string)=>Promise<{protected:boolean}>;step:(checkpoint:Checkpoint,runId:string)=>Promise<StepEvidence>;restore:(runId:string)=>Promise<boolean>};
export async function runPublishedJourney(origin:string,runId:string,io:JourneyAdapter){
 const rows:EvidenceRow[]=scenarioSteps.map(s=>({...s,status:'NOT RUN',detail:'Prerequisites not reached.',screenshots:[]}));
 const blockers=publishedPreflightBlockers(await io.preflight(origin,runId),origin,runId);
 let restored:boolean|null=null,setupStarted=false;
 if(blockers.length)return{origin,runId,blockers,rows,restored};
 try{
   setupStarted=true;
   if(!(await io.setup(runId)).protected)throw Error('Run-owned TEST fixtures are not protected.');
   const stopped=new Set<string>();
   for(const row of rows){
     if(stopped.has(row.scenario))continue;
     const fresh=publishedPreflightBlockers(await io.preflight(origin,runId),origin,runId);
     if(fresh.length){blockers.push(...fresh);break;}
     try{
       const result=await io.step(row,runId);
       row.screenshots=result.screenshots;row.detail=result.detail;
       row.status=result.executed&&result.readback&&result.screenshots.length>0?'PASS':'FAIL';
       if(row.status==='FAIL')stopped.add(row.scenario);
     }catch(e){row.status='FAIL';row.detail=e instanceof Error?e.message:'Page action failed.';stopped.add(row.scenario);}
   }
 }catch(e){blockers.push(e instanceof Error?e.message:'Preparation failed.');}
 finally{if(setupStarted){try{restored=await io.restore(runId);}catch{restored=false;}if(!restored)blockers.push('TEST setup restoration failed; review the recovery journal before another run.');}}
 return{origin,runId,blockers,rows,restored};
}