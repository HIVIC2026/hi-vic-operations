import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { getOfficeReadyCheckBooking, getOwnerReadyCheckBookingSetting, offerOwnerReadyCheckBooking, setOwnerReadyCheckBookingEnabled } from '@/lib/ready-check-booking-access.functions';

// The job-page "Offer Ready Check booking" button was removed 24 Oct 2026 (decision 53, audit removal 5).
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
