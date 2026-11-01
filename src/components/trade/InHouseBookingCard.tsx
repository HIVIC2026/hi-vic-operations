import { useState } from 'react';
import { useQuery,useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { toast } from 'sonner';
import { getInHouseBookingAccess,getInHouseBookingTeam,inHouseBookVisit,changeInHouseLeadInstaller } from '@/lib/trade-view.functions';
import { bookingWorkerBlocker,type BookingWorker } from '@/lib/in-house-booking.core';
import { installStartAt } from '@/lib/install-days.core';
import { markOfficeChanged } from '@/lib/office-list-refresh';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Group } from './installer-kit';
export function useInHouseBookingAccess(jobId:string){const load=useServerFn(getInHouseBookingAccess);return useQuery({queryKey:['in-house-booking-access',jobId],queryFn:()=>load({data:{jobId}}),retry:false});}
type Kind='ready_check'|'assessment'|'rectification'|'installation';
const visits=[{kind:'ready_check',label:'Ready Check'},{kind:'assessment',label:'Pre Insulation Electrical Safety Assessment (PIESA)'},{kind:'rectification',label:'Rectification'},{kind:'installation',label:'Install day'}] as const;
function VisitPicker({jobId,kind,label,workers,booked,selection}:{jobId:string;kind:Kind;label:string;workers:BookingWorker[];booked?:string|null;selection:string|null}){
 const book=useServerFn(inHouseBookVisit),swap=useServerFn(changeInHouseLeadInstaller),qc=useQueryClient();
 const [day,setDay]=useState(''),[arrival,setArrival]=useState(''),[who,setWho]=useState(selection??''),[crew,setCrew]=useState<string[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const choices=workers.filter(w=>kind==='installation'?bookingWorkerBlocker(kind,w)===null:kind==='assessment'||kind==='rectification'?w.tradeRole==='electrician':true);
 const reason=bookingWorkerBlocker(kind,workers.find(w=>w.id===who)??null)||(!day||!arrival?'Choose the day and arrival time so the owner knows when to expect you.':null);
 const refresh=async()=>{markOfficeChanged();await qc.invalidateQueries();};
 return <form className="space-y-2 border-b border-line py-4 last:border-b-0" onSubmit={async e=>{e.preventDefault();if(reason)return;setBusy(true);setError('');try{const r=await book({data:{jobId,kind,start:installStartAt(day,arrival).toISOString(),workerId:who,crewIds:crew}});if(!r.ok){setError(r.blockers.join(' '));return;}toast.success(`${label} booked`);await refresh();}catch(e){setError(e instanceof Error?e.message:'Could not book.');}finally{setBusy(false);}}}>
 <p className="font-semibold">{label}</p>{booked&&<p className="text-sm text-sub">{new Date(booked).toLocaleString('en-AU',{timeZone:'Australia/Melbourne'})}</p>}
 <div className="grid gap-2 sm:grid-cols-3"><label className="min-w-0 text-sm">Day<Input aria-label={`${label} day`} type="date" className="h-12" value={day} onChange={e=>setDay(e.target.value)}/></label><label className="min-w-0 text-sm">Arrival<Input aria-label={`${label} arrival`} type="time" className="h-12" value={arrival} onChange={e=>setArrival(e.target.value)}/></label><label className="min-w-0 text-sm">Who's going<select aria-label={`${label} who's going`} className="h-12 w-full rounded border border-line bg-paper px-2 text-ink" value={who} onChange={e=>setWho(e.target.value)}><option value="">{kind==='installation'?'Choose the Lead Installer':'Choose the person going'}</option>{choices.map(w=><option key={w.id} value={w.id} disabled={!!bookingWorkerBlocker(kind,w)}>{w.name}{bookingWorkerBlocker(kind,w)?` — ${bookingWorkerBlocker(kind,w)}`:''}</option>)}</select></label></div>
 {kind==='installation'&&<fieldset><legend className="text-sm">Crew</legend>{workers.filter(w=>w.id!==who&&w.tradeRole==='installer'&&w.cleared&&!w.reason).map(w=><label key={w.id} className="mr-4 inline-flex min-h-12 items-center gap-2 text-sm"><input type="checkbox" checked={crew.includes(w.id)} onChange={e=>setCrew(e.target.checked?[...crew,w.id].slice(0,2):crew.filter(x=>x!==w.id))}/>{w.name}</label>)}</fieldset>}
 {reason&&<p className="text-sm text-sub">{reason}</p>}{error&&<p role="alert" className="text-sm text-rose">{error}</p>}
 <Button type="submit" size="field" className="w-full" disabled={busy||!!reason}>{busy?'Saving…':'Book'}</Button>{busy&&<p className="text-sm text-sub">Saving this booking; please wait before booking again.</p>}
 {kind==='installation'&&booked&&<Button type="button" variant="outline" size="field" disabled={busy||!who||!!bookingWorkerBlocker(kind,workers.find(w=>w.id===who)??null)} onClick={async()=>{setBusy(true);try{await swap({data:{jobId,workerId:who}});await refresh();toast.success('Lead Installer changed');}catch(e){setError(e instanceof Error?e.message:'Could not change the Lead Installer.');}finally{setBusy(false);}}}>Change Lead Installer</Button>}
 </form>;
}
export function InHouseBookingCard({jobId}:{jobId:string}){
 const access=useInHouseBookingAccess(jobId),load=useServerFn(getInHouseBookingTeam);
 const team=useQuery({queryKey:['in-house-booking-team',jobId],queryFn:()=>load({data:{jobId}}),enabled:access.data?.allowed===true,retry:false});
 if(access.data?.allowed!==true)return null;
 if(team.isError)return <p role="alert" className="text-sm text-rose">Could not check your Team or deposit. Booking stays unavailable until those records can be checked.</p>;
 if(!team.data)return <p className="text-sm text-sub">Checking your Team and deposit before booking.</p>;
 const selection=typeof team.data.selection?.lead==='string'?team.data.selection.lead:null;
 return <Group title="Visit bookings">{visits.filter(v=>v.kind!=='installation'||team.data.depositPaid).map(v=><VisitPicker key={v.kind} jobId={jobId} {...v} workers={team.data.workers} selection={v.kind==='installation'?selection:null} booked={access.data.bookings?.find(b=>b.kind===v.kind)?.scheduled_start}/>)}</Group>;
}
