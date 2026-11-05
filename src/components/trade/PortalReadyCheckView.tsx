import {useState} from 'react';
import {useServerFn} from '@tanstack/react-start';
import {getOwnCustomerReadyCheck} from '@/lib/own-customer-portal-ready-check.functions';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogHeader,DialogTitle} from '@/components/ui/dialog';

export function PortalReadyCheckView({jobId}:{jobId:string}) {
 const read=useServerFn(getOwnCustomerReadyCheck);
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [details,setDetails]=useState<Awaited<ReturnType<typeof read>>|null>(null);
 return <>
  <Button variant="link" className="h-auto px-0" disabled={busy} onClick={async()=>{
   setOpen(true);setBusy(true);setError('');
   try{setDetails(await read({data:{jobId}}));}catch(e){setError(e instanceof Error?e.message:'The Ready Check could not be opened.');}finally{setBusy(false);}
  }}>View</Button>
  <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[85dvh] overflow-y-auto"><DialogHeader><DialogTitle>Ready Check details</DialogTitle></DialogHeader>
   {busy&&<p role="status">Loading…</p>}{error&&<p role="alert" className="text-sm text-rose">{error}</p>}
   {!busy&&!error&&details&&<dl className="space-y-3">{details.entries.map((e,i)=><div key={i} className="border-b border-line pb-2"><dt className="text-sm text-sub">{e.label}</dt><dd className="break-words text-[15px]">{e.value}</dd></div>)}</dl>}
  </DialogContent></Dialog>
 </>;
}