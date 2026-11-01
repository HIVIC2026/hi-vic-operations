import {expect,mock,test} from 'bun:test';
const sent:any[]=[];const records:any[]=[];
mock.module('../src/integrations/supabase/client.server',()=>({supabaseAdmin:{from:(table:string)=>{let event='';const q:any={select:()=>q,eq:(k:string,v:string)=>{if(k==='event_type')event=v;return q;},contains:()=>q,limit:()=>q,maybeSingle:async()=>({data:table==='jobs'?{source:'real',owners:{email:'owner@example.invalid'},deleted_at:null}:null}),insert:async(p:any)=>{records.push({table,p});return {error:null};},then:(resolve:any)=>resolve({data:event==='coes_owner_copy_delivered'?[]:[{id:'record'}]})};return q;},storage:{from:()=>({download:async()=>({data:new Blob(['certificate'])})})}}}));
mock.module('../src/lib/comms.server',()=>({assertCustomerDeliveryAllowed:async()=>{}}));
mock.module('../src/lib/owner-email-send.server',()=>({sendGuardedOwnerEmail:async(p:any)=>{sent.push(p);return 'sent';}}));
mock.module('../src/lib/workflow.server',()=>({logEvent:async()=>{}}));
const {sendCoesOwnerCopy}=await import('../src/lib/coes-owner-copy.server');
test('recorded CoES sends its attachment and records pre-install consumer delivery',async()=>{
 await sendCoesOwnerCopy('job',{key:'certificate1',files:[{storagePath:'job/certificate.pdf',mimeType:'application/pdf'}]});
 expect(sent).toHaveLength(1);expect(sent[0].build(null).attachments[0].contentType).toBe('application/pdf');
 expect(records.find(r=>r.table==='job_compliance_records').p.record_key).toBe('pre_install_consumer_docs');
});