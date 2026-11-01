/** Capability inventory, deliberately false until integration proofs exist. Never infer safety from launch holds. */
export function publishedHarnessCapabilities(origin:string,runId:string,now=Date.now()){
 return {version:'in-house-published-v1',origin,runId,checkedAt:now,deployment:'preflight-v1-incomplete',authenticatedTestActors:false,setupScoped:false,snapshotRestore:false,messagesCaptured:false,mittiIncludingMediaSimulated:false,stripeTestOnly:false,xeroDemoOnly:false,escCaptured:false,launchHoldUnchanged:false,
 reasons:['Run-owned TEST setup/restore writer is not implemented.','Exact-message capture is not implemented across all provider boundaries.','Mitti binary media boundary is not job-bound.','Published TEST actor/Stripe/Demo/ESC integration probes are not implemented.']};
}