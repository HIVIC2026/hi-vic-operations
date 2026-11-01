import {supabaseAdmin as admin} from '@/integrations/supabase/client.server';
import {balanceDueAt,balanceReminderDue} from './balance-q21.core';
import {isStepPaid} from './payments.core';
/** Existing tick owns retries; only completion-era jobs, no historical backlog. No new schedule. */
export async function sweepBalanceQ21(now=new Date()){
 let checked=0;
 for(let from=0;;from+=200){
  const {data,error}=await admin.from('jobs').select('id,installation_completed_at').is('deleted_at',null).not('stage','in','(cancelled,on_hold)').gte('installation_completed_at',new Date(now.getTime()-9*86400000).toISOString()).order('id').range(from,from+199);
  if(error)throw Error('Could not read balance reminder jobs.');
  for(const job of data??[]){
   try{
    const v=await (await import('./payments.server')).jobPaymentView(job.id,now);if(!v)continue;
    const inv=v.invoices.install;if(!inv)continue;checked++;
    await (await import('./invoice-dates.server')).setCompletedBalanceDueDate(job.id,job.installation_completed_at??'',null);
    const reminder=balanceReminderDue(job.installation_completed_at,isStepPaid(v.steps,'balance'),now);if(!reminder)continue;
    const due=balanceDueAt(job.installation_completed_at);if(!due)continue;
    const dueLabel=new Date(due).toLocaleDateString('en-AU',{timeZone:'Australia/Melbourne',day:'numeric',month:'long',year:'numeric'});
    await (await import('./owner-template-send.server')).sendOwnerTemplateEmail({jobId:job.id,purpose:'balance_reminder',key:`balance-q21:${inv.id}:${due}:${reminder}`,approved:true,label:'Balance reminder',notSentEvent:'balance_reminder_not_sent',retryAfterDefiniteFailure:true,render:f=>{
     const subject=reminder==='day5'?'Your balance is due in 2 days':'Your balance is due today';
     const lines=[`Your remaining balance is due ${dueLabel}. Pay by card or bank transfer on My job.`];
     return {subject,text:`${subject}\n\n${lines.join('\n\n')}\n\nPay my balance: ${f.myJobUrl}?screen=payment`,html:(requireMail)(subject,lines,`${f.myJobUrl}?screen=payment`,f.unsubscribeUrl)};
    }});
   }catch(error){console.error('Balance reminder held',job.id,error instanceof Error?error.message:'read failed');}
  }
  if((data?.length??0)<200)break;
 }
 return{checked};
}
import {genericMail} from './mail-mjml.core';
const requireMail=(subject:string,lines:string[],url:string,unsubscribe?:string|null)=>genericMail({subject,heading:subject,lines,button:{url,label:'Pay my balance'},unsubscribe:unsubscribe??null});