import {supabaseAdmin as admin} from '@/integrations/supabase/client.server';
/** Existing tick owns retries; only completion-era jobs, no historical backlog. No new schedule.
 *  Keeps the completed-balance due date on the installation invoice (invoice-dates.server) for jobs completed in the last 9 days.
 *  Part 4 Task 14 (Jo 2 Nov 2026, touchpoint 53): the day-5 "due in 2 days" and day-7 "due today" owner emails are gone —
 *  they said the balance was due a week after the install, but it is due on install day. The after-install reminders
 *  (after-install-reminders.server.ts, behind AFTER_INSTALL_REMINDERS_APPROVED) are the only balance reminders. */
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
   }catch(error){console.error('Balance due date not set',job.id,error instanceof Error?error.message:'read failed');}
  }
  if((data?.length??0)<200)break;
 }
 return{checked};
}
