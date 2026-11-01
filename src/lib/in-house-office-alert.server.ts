// Internal office email only: master and TEST delivery guards still apply; never a trade/owner notice.
import { OFFICE_REPLY_TO } from './office-email.core';
import { RESEND_FETCH_TIMEOUT_MS, timeoutSignal } from './network-timeout.core';
export async function sendInHouseOfficeAlert(p:{jobId:string;jobSource:string|null;actorId:string;to:string;subject:string;html:string;text:string;idempotencyKey:string}) {
  if(await (await import('./qa-inbox.server')).qaDeliveryHeld(p.jobId))return {status:'blocked',detail:'TEST delivery held'};
  if(p.jobSource==='qa_test')return (await import('./test-send.server')).sendTestEmail({jobId:p.jobId,jobSource:p.jobSource,partnerIsTest:false,label:p.idempotencyKey,actorId:p.actorId},p.to,p.subject,p.html,p.text);
  if(!(await (await import('./comms.server')).customerCommsEnabled()))return {status:'blocked',detail:'Messages paused'};
  const key=process.env['RESEND_API_KEY'],gateway=process.env['LOVABLE_API_KEY'];
  if(!key||!gateway)return {status:'blocked',detail:'Email is not connected'};
  // A thrown/ambiguous transport result retains the claim; only explicit rejection can retry.
  const response=await fetch('https://connector-gateway.lovable.dev/resend/emails',{
    method:'POST',headers:{Authorization:`Bearer ${gateway}`,'X-Connection-Api-Key':key,'Content-Type':'application/json','Idempotency-Key':p.idempotencyKey},
    body:JSON.stringify({from:'Home Insulation Victoria <jobs@homeinsulationvictoria.com.au>',to:[p.to],reply_to:OFFICE_REPLY_TO,subject:p.subject,html:p.html,text:p.text}),signal:timeoutSignal(RESEND_FETCH_TIMEOUT_MS),
  });
  await response.text();
  return response.ok?{status:'sent',detail:'Accepted by the email service'}:{status:'failed',detail:`The email service didn't accept it (error ${response.status}).`};
}