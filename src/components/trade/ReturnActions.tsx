// Installer Job page bottom links (Task 5 kept them; Task 11 moved them out of the retired four-form booking card):
// "Can't do this one" (tradeHandBack) and "Owner cancelled" (tradeOwnerCancelled) through the guarded writers, and the
// in-house access read the Next step box and the Job page share. Nothing here books a visit.
import { useState } from 'react';
import { useQuery,useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { getInHouseBookingAccess,tradeHandBack,tradeOwnerCancelled } from '@/lib/trade-view.functions';
import { markOfficeChanged } from '@/lib/office-list-refresh';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
// Seeded by the job page's one-call bundle (trade-job-bundle, join 4 Nov 2026): staleTime keeps the seeded answer on first paint, as the other cards do.
export function useInHouseBookingAccess(jobId:string){const load=useServerFn(getInHouseBookingAccess);return useQuery({queryKey:['in-house-booking-access',jobId],queryFn:()=>load({data:{jobId}}),retry:false,staleTime:20_000});}

export function ReturnActions({jobId}:{jobId:string}){
 const back=useServerFn(tradeHandBack),cancel=useServerFn(tradeOwnerCancelled),qc=useQueryClient();const [action,setAction]=useState<'back'|'cancel'|null>(null),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 return <div className="space-y-2 py-3"><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={()=>setAction('back')}>Can't do this one</Button><Button variant="outline" onClick={()=>setAction('cancel')}>Owner cancelled</Button></div>{action&&<><label className="block text-sm">Reason<Input value={reason} onChange={e=>setReason(e.target.value)}/></label>{reason.trim().length<3&&<p className="text-sm text-sub">Enter the reason so Home Insulation Victoria knows why this job is being returned or cancelled.</p>}<Button disabled={busy||reason.trim().length<3} onClick={async()=>{setBusy(true);setError('');try{if(action==='back')await back({data:{jobId,reason}});else await cancel({data:{jobId,reason}});markOfficeChanged();await qc.invalidateQueries();setAction(null);}catch(e){setError(e instanceof Error?e.message:'Could not save.');}finally{setBusy(false);}}}>{busy?'Saving…':action==='back'?'Give back to Home Insulation Victoria':'Confirm owner cancelled'}</Button>{busy&&<p className="text-sm text-sub">Saving the reason; please wait.</p>}{error&&<p role="alert" className="text-sm text-rose">{error}</p>}</>}</div>;
}
