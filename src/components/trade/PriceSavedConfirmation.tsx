import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { getInstallerPriceFn } from '@/lib/installer-price.functions';
import { Button } from '@/components/ui/button';

export function SavedPriceLine({ amount, at, submitted, onChange }: { amount: number; at: string; submitted: boolean; onChange?: (() => void) | undefined }) {
  const time = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Melbourne', hour: 'numeric', minute: '2-digit' }).format(new Date(at));
  const price = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 2 }).format(amount).replace(/\.00$/, '');
  return <div className="space-y-2"><p role="status" className="break-words text-sm font-semibold text-ink">Price saved: {price} inc GST{submitted ? ` · Sent to Home Insulation Victoria ${time}` : ''}</p>{onChange && <Button type="button" variant="ghost" className="min-h-12" onClick={onChange}>Change</Button>}</div>;
}

export function PriceSavedConfirmation({ jobId }: { jobId: string }) {
  const load = useServerFn(getInstallerPriceFn);
  const q = useQuery({ queryKey: ['installer-price', jobId], queryFn: () => load({ data: { jobId } }), staleTime: 20_000 });
  const current = q.data?.current;
  if (!q.data?.canSet || !current) return null;
  return <SavedPriceLine amount={current.record.price_inc_gst} at={current.setAt} submitted={current.sendToQuote === true} />;
}