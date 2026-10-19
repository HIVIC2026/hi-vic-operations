// Current RPC page loader contract; no database/network/provider calls.
import {expect,mock,test} from 'bun:test';
let pageIds=Array.from({length:50},(_,i)=>`TEST-${i}`);let hydrated:string[]=[];
mock.module('@/integrations/supabase/client.server',()=>({supabaseAdmin:{rpc:async()=>({data:{ids:pageIds,page:1,pageSize:50,total:774,totalPages:16,counts:{new:774}},error:null}),from:()=>({select:()=>({in:async()=>({data:pageIds.map(id=>({id,enquiry_status:'needs_attention',needs_first_response:true})),error:null})})})}}));
mock.module('../src/lib/enquiry-groups.server',()=>({loadEnquiryGroups:async(ids:string[])=>{if(!ids||ids.length>50)throw new Error('Full dataset hydration forbidden');hydrated=ids;return{rows:ids.map(id=>({id,status:'needs_attention',mediaOutcome:null}))}}}));
const {loadOfficeEnquiryPage}=await import('../src/lib/office-enquiry-page.server');
test('first useful page hydrates precisely 50 of 774 matches',async()=>{
 const r=await loadOfficeEnquiryPage('new','',1);expect(hydrated).toEqual(pageIds);expect(r.rows).toHaveLength(50);expect(r.total).toBe(r.counts.new);
});
test('RPC returning more than 50 IDs fails before hydration',async()=>{
 const before=hydrated;pageIds=Array.from({length:51},(_,i)=>`TEST-${i}`);
 await expect(loadOfficeEnquiryPage('new','',1)).rejects.toThrow('Invalid enquiry page');expect(hydrated).toBe(before);
});
