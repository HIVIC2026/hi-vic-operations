import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { getOfficeReadyCheckBooking, offerOwnerReadyCheckBooking, setOwnerReadyCheckBookingEnabled } from '@/lib/ready-check-booking-access.functions';

export function OfficeReadyCheckBooking({ jobId }: { jobId: string }) {
  const get = useServerFn(getOfficeReadyCheckBooking);
  const offer = useServerFn(offerOwnerReadyCheckBooking);
  const setEnabled = useServerFn(setOwnerReadyCheckBookingEnabled);
  const q = useQuery({ queryKey: ['office-ready-check-booking', jobId], queryFn: () => get({ data: { jobId } }), retry: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await action(); await q.refetch(); } catch (e) { setError(e instanceof Error ? e.message : 'Booking control could not be saved.'); }
    finally { setBusy(false); }
  };
  return <section className="mb-4 border-b border-line pb-4" aria-label="Owner Ready Check booking">
    <label className="flex min-h-12 items-center gap-3 text-sm font-semibold">
      <Switch checked={q.data?.enabled === true} disabled={busy || !q.data} onCheckedChange={enabled => void run(() => setEnabled({ data: { enabled } }))} />
      Owner Ready Check booking {q.data?.enabled ? 'on' : 'off'}
    </label>
    <Button variant="outline" disabled={busy || !q.data?.enabled || !!q.data.offeredAt} onClick={() => void run(() => offer({ data: { jobId } }))}>
      {q.data?.offeredAt ? 'Ready Check booking offered' : 'Offer Ready Check booking'}
    </Button>
    {(error || q.error) && <p role="alert" className="mt-2 text-sm text-danger">{error ?? 'Booking controls could not load.'}</p>}
  </section>;
}