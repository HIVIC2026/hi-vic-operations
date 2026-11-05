import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { getInstallerPriceFn, setInstallerPriceFn } from '@/lib/installer-price.functions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useState } from 'react';
import { useAction } from '@/hooks/use-me';
import { PRICE_CHANGE_WAITING, validatePriceChangeReason } from '@/lib/installer-price-change.core';
import { OWN_READY_CHECK_COPY } from '@/lib/own-customer-ready-check-copy.core';

export function SavedPriceLine({ amount, at, submitted, onChange }: { amount: number; at: string; submitted: boolean; onChange?: (() => void) | undefined }) {
  const time = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Melbourne', hour: 'numeric', minute: '2-digit' }).format(new Date(at));
  const price = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 2 }).format(amount).replace(/\.00$/, '');
  return <div className="space-y-2"><p role="status" className="break-words text-sm font-semibold text-ink">Price saved: {price} inc GST{submitted ? ` · Sent to Home Insulation Victoria ${time}` : ''}</p>{onChange && <Button type="button" variant="ghost" className="min-h-12" onClick={onChange}>Change</Button>}</div>;
}

export function PriceSavedConfirmation({ jobId }: { jobId: string }) {
  const load = useServerFn(getInstallerPriceFn);
  const q = useQuery({ queryKey: ['installer-price', jobId], queryFn: () => load({ data: { jobId } }), staleTime: 20_000 });
  const save = useAction(setInstallerPriceFn);
  const [editing,setEditing]=useState(false),[price,setPrice]=useState(''),[reason,setReason]=useState(''),[busy,setBusy]=useState(false);
  const current = q.data?.current;
  if (!q.data?.canSet || !current) return null;
  const locked=q.data.locked;
  const pending=locked && !!current.change?.replacesQuoteId && current.setAt > (q.data.quoteSentAt ?? '');
  return <div className="space-y-3">
    <SavedPriceLine amount={current.record.price_inc_gst} at={current.setAt} submitted={current.sendToQuote === true}/>
    {pending && <p role="status" className="text-sm font-semibold text-ink">{PRICE_CHANGE_WAITING}</p>}
    {!editing ? <Button type="button" variant="ghost" className="min-h-12" onClick={()=>{setPrice(String(current.record.price_inc_gst));setEditing(true);}}>{locked?'Change price':'Change'}</Button> : <form className="space-y-3" onSubmit={async e=>{e.preventDefault();if(busy || Number(price)<=0 || !Number.isFinite(Number(price)) || validatePriceChangeReason(locked,reason))return;setBusy(true);try{const r=await save({jobId,priceIncGst:price,included:current.record.included,includedOther:current.record.included_other,productOption:current.record.product_option,notes:current.record.notes,send:false,sendToQuote:true,changeReason:reason});if(r){setEditing(false);void q.refetch();}}finally{setBusy(false);}}}>
      <label className="block text-sm font-medium">New price inc GST<Input required inputMode="decimal" value={price} onChange={e=>setPrice(e.target.value)}/></label>
      {locked && <label className="block text-sm font-medium">Reason<Textarea required maxLength={300} value={reason} onChange={e=>setReason(e.target.value)}/></label>}
      <Button type="submit" className="min-h-12" disabled={busy || !price.trim() || Number(price)<=0 || !Number.isFinite(Number(price)) || !!validatePriceChangeReason(locked,reason)}>{busy?'Saving…':'Save'}</Button>
      <Button type="button" variant="ghost" onClick={()=>setEditing(false)}>Cancel</Button>
      <p className="text-sm text-sub">{OWN_READY_CHECK_COPY.locked}</p>
    </form>}
  </div>;
}