import { expect,mock,test } from 'bun:test';
const ids=Array.from({length:50},(_,i)=>`job-${i}`);
let received:string[]=[];
mock.module('@/integrations/supabase/client.server',()=>({supabaseAdmin:{rpc:async()=>({data:{ids,total:643,page:1,pageSize:50,totalPages:13,counts:{new:643}},error:null})}}));
mock.module('../src/lib/enquiry-groups.server',()=>({loadEnquiryGroups:async(v:string[])=>{received=v;return{rows:v.map(id=>({id}))}}}));
const {loadOfficeEnquiryPage}=await import('../src/lib/office-enquiry-page.server');
test('643 matching enquiries enrich exactly the 50 RPC page IDs',async()=>{
 const result=await loadOfficeEnquiryPage('new','',1);
 expect(received).toEqual(ids);expect(result.rows).toHaveLength(50);expect(result.total).toBe(result.counts.new);
});
