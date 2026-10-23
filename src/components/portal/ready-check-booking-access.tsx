import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { getOfficeReadyCheckBooking, getOwnerReadyCheckBookingSetting, offerOwnerReadyCheckBooking, setOwnerReadyCheckBookingEnabled } from '@/lib/ready-check-booking-access.functions';

/** Per job: offer this owner the Ready Check booking. The global on/off is on Settings, never here. */
export function OfficeReadyCheckBooking({ jobId }: { jobId: string }) {
  const get = useServerFn(getOfficeReadyCheckBooking);
  const offer = useServerFn(offerOwnerReadyCheckBooking);
  const q = useQuery({ queryKey: ['office-ready-check-booking', jobId], queryFn: () => get({ data: { jobId } }), retry: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await action(); await q.refetch(); } catch (e) { setError(e instanceof Error ? e.message : 'Booking control could not be saved.'); }
    finally { setBusy(false); }
  };
  return <section className="mb-4 border-b border-line pb-4" aria-label="Owner Ready Check booking">
    <Button variant="outline" disabled={busy || !q.data?.enabled || !!q.data.offeredAt} onClick={() => void run(() => offer({ data: { jobId } }))}>
      {q.data?.offeredAt ? 'Ready Check booking offered' : 'Offer Ready Check booking'}
    </Button>
    {q.data && !q.data.enabled && <p className="mt-2 text-sm text-muted-foreground">Owner booking is switched off for everyone (Settings → Automatic sending rules).</p>}
    {(error || q.error) && <p role="alert" className="mt-2 text-sm text-danger">{error ?? 'Booking controls could not load.'}</p>}
  </section>;
}

/** Settings only: the one global switch for owner Ready Check booking (affects every owner). */
export function OwnerReadyCheckBookingSetting() {
  const get = useServerFn(getOwnerReadyCheckBookingSetting);
  const setEnabled = useServerFn(setOwnerReadyCheckBookingEnabled);
  const q = useQuery({ queryKey: ['owner-ready-check-booking-setting'], queryFn: () => get(), retry: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <section className="mb-6 rounded-md border bg-card p-4" aria-label="Owner Ready Check booking (all owners)">
    <label className="flex min-h-12 items-center gap-3 text-sm font-semibold">
      <Switch checked={q.data?.enabled === true} disabled={busy || !q.data} onCheckedChange={async (enabled) => {
        setBusy(true); setError(null);
        try { await setEnabled({ data: { enabled } }); await q.refetch(); } catch (e) { setError(e instanceof Error ? e.message : 'The setting could not be saved.'); } finally { setBusy(false); }
      }} />
      Owner Ready Check booking: {q.data?.enabled ? 'on' : 'off'} (all owners)
    </label>
    <p className="text-sm text-muted-foreground">When on, the office can offer an owner their Ready Check booking from the job page. It never sends anything by itself.</p>
    {(error || q.error) && <p role="alert" className="mt-2 text-sm text-danger">{error ?? 'The setting could not load.'}</p>}
  </section>;
}
