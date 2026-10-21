import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route } from '../src/routes/estimate.$token';
import { OfficeReadyCheckBooking } from '../src/components/portal/ready-check-booking-access';
import { Button } from '../src/components/ui/button';
import '../src/styles.css';

let enabled = false, offered = false, held = false;
const scenario = { installation: 4500, pre_discount_total: 5198, applied_discount: 2000, estimated_customer_total: 3198 };
const g = globalThis as typeof globalThis & { __mockData: Record<string, unknown>; __mockCalls: string[] };
g.__mockCalls = [];
g.__mockData = {
  getPublicEstimate: () => ({ job: { job_number: 'TEST-ONLY', address: null }, assessment: null, assessmentTestMode: true,
    bookingAllowed: enabled && offered, spotHeld: held, referralShareUrl: null,
    estimate: { visible: true, mode: 'likely', fees: { piesa: 349, ap: 349, minCopay: 200 }, estimate: { area: { m2: 150 }, scenarios: [{ key: 'can_remain', by_access: { standard: scenario } }], access_adjustment: { moderate: 0, difficult: 0 } } } }),
  getOfficeReadyCheckBooking: () => ({ enabled, offeredAt: offered ? '2026-10-21T23:39:00Z' : null, allowed: enabled && offered }),
  offerOwnerReadyCheckBooking: () => { if (!enabled) throw new Error('OFF'); offered = true; return { ok: true }; },
  setOwnerReadyCheckBookingEnabled: ({ data }: { data: { enabled: boolean } }) => { enabled = data.enabled; return { ok: true }; },
  acceptReadyCheckFn: () => { throw new Error('Network and submission forbidden in browser fixture'); },
};
function Harness() {
  const [revision, update] = useState(0);
  const [query] = useState(() => new QueryClient());
  const Owner = Route.options.component;
  return <QueryClientProvider client={query}><div className="portal-theme border-b border-line p-4">
    <OfficeReadyCheckBooking jobId="00000000-0000-4000-8000-000000000001" />
    <Button onClick={() => { query.clear(); update(revision + 1); }}>Reload owner page</Button>
    <Button variant="outline" onClick={() => { held = true; enabled = false; query.clear(); update(revision + 1); }}>TEST held receipt</Button>
  </div><Owner key={revision} /></QueryClientProvider>;
}
const root = document.getElementById('root');
if (root) createRoot(root).render(<Harness />);