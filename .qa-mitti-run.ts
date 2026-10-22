import { startOnsiteReadyCheckFor, onsiteFormFor } from "./src/lib/onsite-ready-check.server";
const U="fa05a642-77da-4d09-9c3d-b2d5ef8e448a", B="a8304d2d-339b-4cbf-bcf1-fb09ce7935b0";
const t0=Date.now();
const r:any = await startOnsiteReadyCheckFor(U,B,{ full_name:"TEST Jo Reinsulate check", address_line:"1 Test Street", suburb:"Mulgrave", postcode:"3170", phone:"0491 570 006", email:"jolowexo@hotmail.com", contact_permission:true, consent_by:"installer" },{ mode:"hivic" } as never);
console.log("saved", r.jobNumber, r.jobId, r.booking, JSON.stringify(r.state), (Date.now()-t0)+"ms");
for (let i=0;i<40;i++){ await new Promise(s=>setTimeout(s,3000)); const s:any=await onsiteFormFor(r.jobId,U); if (s.kind!=="pending"&&s.kind!=="preparing"){ console.log("form state", JSON.stringify(s).replace(/[\w.+-]+@[\w.-]+/g,"<e>"), (Date.now()-t0)+"ms"); break;} if(i%5==0) console.log("wait",s.kind);}
process.exit(0);
