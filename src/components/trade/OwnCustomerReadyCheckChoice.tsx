import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { getInstallerPriceFn, setInstallerPriceFn } from '@/lib/installer-price.functions';
import { PRICE_INCLUDED_OPTIONS, validateInstallerPrice } from '@/lib/installer-price.core';
import { OWN_READY_CHECK_COPY as W } from '@/lib/own-customer-ready-check-copy.core';
import { useAction } from '@/hooks/use-me';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { MittiFormLink } from '@/components/portal/MittiFormLink';
import { OwnCustomerReadyCheck } from './OwnCustomerReadyCheck';
import { OwnerQuoteCard } from './OwnerQuoteCard';
import { card } from './TradeShell';
import { getOwnMittiStatus, requestOwnMittiForm } from '@/lib/own-customer-mitti-choice.functions';
import { SavedPriceLine } from './PriceSavedConfirmation';

export function OwnCustomerReadyCheckChoice({ jobId, auditId, address, jobNumber }: { jobId: string; auditId: string | null; address: string; jobNumber: string }) {
  const load = useServerFn(getInstallerPriceFn);
  const q = useQuery({ queryKey: ['installer-price', jobId], queryFn: () => load({ data: { jobId } }), staleTime: 20_000 });
  const save = useAction(setInstallerPriceFn);
  const loadMitti = useServerFn(getOwnMittiStatus);
  const requestMitti = useAction(requestOwnMittiForm);
  const mitti = useQuery({queryKey:['own-mitti-choice',jobId],queryFn:()=>loadMitti({data:{jobId}}),staleTime:20_000,refetchInterval:15_000});
  const [portalOpen, setPortalOpen] = useState(false);
  const [mittiOpen, setMittiOpen] = useState(false);
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [editing, setEditing] = useState(false);
  const [savedPrice, setSavedPrice] = useState<NonNullable<NonNullable<typeof q.data>['current']> | null>(null);
  const [error, setError] = useState('');
  const v = q.data;
  const linkedAuditId = mitti.data?.auditId ?? auditId;
  const mittiChosen = mittiOpen || mitti.data?.requested === true || !!linkedAuditId;
  const current = savedPrice ?? v?.current;
  const confirmation = current ? <SavedPriceLine amount={current.record.price_inc_gst} at={current.setAt} submitted={current.sendToQuote === true} onChange={!v?.locked ? () => {setPrice(String(current.record.price_inc_gst));setEditing(true);setSubmitted(false);} : undefined} /> : null;
  if (!v?.canSet) return null;
  if (v.locked) return <section className={`${card} space-y-3`} aria-label="Next step">{confirmation}<OwnerQuoteCard jobId={jobId} ownCustomerStatus /></section>;
  if (!editing && (submitted || current)) return <section className={`${card} space-y-3`} aria-label="Next step">{confirmation}<p role="status" className="text-[15px] font-semibold text-ink">{W.preparing}</p></section>;
  const included = [PRICE_INCLUDED_OPTIONS[0], ...(v.removalRequired === true ? [PRICE_INCLUDED_OPTIONS[1]] : [])];
  const valid = validateInstallerPrice({ priceIncGst: price, included });
  return <section aria-label="Next step" className={`${card} min-w-0 space-y-4`}>
    <h2 className="font-display text-[22px] font-semibold">{W.choiceTitle}</h2>
    <p className="text-[15px] text-ink">{W.choiceIntro}</p>
    {!portalOpen && <div className="space-y-3">
      <Button type="button" variant="outline" className="h-auto min-h-12 w-full flex-col items-start gap-2 whitespace-normal py-4 text-left" aria-expanded={mittiChosen} disabled={busy || mitti.data?.portalSaved === true} onClick={async () => {
        if(busy) return;
        setBusy(true); setError('');
        try { const result=await requestMitti({jobId}); if(result) {setMittiOpen(true); void mitti.refetch();} }
        catch(e) {setError(e instanceof Error ? e.message : 'The Ready Check could not start. Try again.');}
        finally {setBusy(false);}
      }}><span className="font-semibold">{W.onsiteOption}</span><span className="text-sm font-normal text-sub">{W.onsiteIntro(address, jobNumber)}</span></Button>
      {mittiChosen && <p role="status" className="text-sm text-sub">{linkedAuditId ? W.onsiteReady : W.onsiteWaiting(address,jobNumber)}</p>}
      {mittiChosen && linkedAuditId && <MittiFormLink auditId={linkedAuditId}>{W.onsiteOption}</MittiFormLink>}
      {error && <p role="alert" className="text-sm text-rose">{error}</p>}
    </div>}
    <OwnCustomerReadyCheck jobId={jobId} onOpenChange={setPortalOpen} />
    {!portalOpen && v.quoteCore.ready && <form className="space-y-3" onSubmit={async e => {
      e.preventDefault(); if (!valid.ok || busy) return;
      setBusy(true); setError('');
      try {
        const r = await save({ jobId, priceIncGst: price, included, productOption: null, send: false, sendToQuote: true });
        if (r && valid.record) { setSavedPrice({record: valid.record, setAt: r.setAt, setBy: null, sendToQuote: true}); setEditing(false); setSubmitted(true); void q.refetch(); }
      } catch (e) { setError(e instanceof Error ? e.message : 'The price could not be saved. Try again.'); }
      finally { setBusy(false); }
    }}>
      <Label htmlFor={`mitti-price-${jobId}`}>Your price inc GST</Label>
      <Input id={`mitti-price-${jobId}`} inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} />
      <p className="text-sm text-sub">{W.mitti}</p>
      {error && <p role="alert" className="text-sm text-rose">{error}</p>}
      <Button type="submit" className="min-h-12 w-full" disabled={busy || !valid.ok}>{busy ? 'Saving…' : W.submit}</Button>
      <p className="text-sm text-sub">{W.locked}</p>
      {v.quoteCore.information.length > 0 && <p className="text-sm text-sub">Still blank in Mitti: {v.quoteCore.information.join(' · ')}</p>}
    </form>}
  </section>;
}