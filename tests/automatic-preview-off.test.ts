import {mock,test,expect} from 'bun:test';
const touched:string[]=[];
mock.module('@/integrations/supabase/client.server',()=>({supabaseAdmin:{from:(t:string)=>{touched.push(t);throw new Error('OFF must stop before job/queue access')}}}));
mock.module('../src/lib/save-spot-rules.server',()=>({readAutomaticRules:async()=>({state:'ok',config:{enabled:true,activatedAt:null}})}));
const {maybeAutoRouteLeadEmail}=await import('../src/lib/lead-email-routing.server');
test('real router OFF stops before lookup, estimate writes, queues or delivery',async()=>{
 const r=await maybeAutoRouteLeadEmail('TEST');expect(r.sent).toBe(false);expect(r.route).toBe('none');expect(r.reason).toContain('Not activated');expect(touched).toEqual([]);
});
