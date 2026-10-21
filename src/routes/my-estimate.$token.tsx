import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getPersonalEstimateFn } from "@/lib/personal-estimate.functions";
import { SPOT_HELD_MESSAGE } from '@/lib/ready-check-booking-access.core';

/**
 * P1-R3-COM-09 (DEP-1) — public, no-login, READ-ONLY saved personal estimate.
 * The personal-estimate token is the only credential. This page renders the customer's FROZEN saved pricing
 * exactly as captured at Save My Spot. It never recalculates, never calls the public calculator, never allows
 * editing, and never creates a booking. The only action is a link into the EXISTING Ready Check booking workflow.
 */
export const Route = createFileRoute("/my-estimate/$token")({
  head: () => ({
    meta: [
      { title: "Your saved estimate – Home Insulation Victoria" },
      { name: "description", content: "Your saved preliminary ceiling insulation estimate from Home Insulation Victoria." },
      { property: "og:title", content: "Your saved estimate – Home Insulation Victoria" },
      { property: "og:description", content: "Your saved preliminary ceiling insulation estimate." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PersonalEstimatePage,
});

const money = (n: number) => `$${Math.round(n).toLocaleString("en-AU")}`;

function PersonalEstimatePage() {
  const { token } = Route.useParams();
  const get = useServerFn(getPersonalEstimateFn);
  const q = useQuery({ queryKey: ["personal_estimate", token], queryFn: () => get({ data: { token } }) as Promise<Record<string, unknown> | null>, retry: false, refetchOnWindowFocus: false, staleTime: Infinity });
  const d = q.data as null | {
    job: { job_number: string | null; address: string | null };
    savedAt: string;
    veuRebate: number; customerTotal: number; totalBeforeRebate: number;
    ceilingAreaM2: number | null; insulation: string | null; areaEstimated: boolean;
    piesaFee?: number; apFee?: number; installation?: number;
    readyCheckBookingUrl: string;
    bookingAllowed: boolean;
  };
  return (
    <main className="min-h-screen bg-estimate-canvas px-4 py-8 text-estimate-navy">
      <div className="mx-auto max-w-lg rounded-[22px] bg-card p-6 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-wide text-estimate-navy/60">Home Insulation Victoria</p>
        {q.isLoading ? <p className="mt-3">Loading…</p> : !d ? (
          <p className="mt-3">This estimate link is not available. Please contact Home Insulation Victoria.</p>
        ) : (
          <>
            <h1 className="mt-1 font-display text-2xl font-extrabold">Your saved estimate</h1>
            {d.job?.address && <p className="mt-1 text-sm">Property: {d.job.address}</p>}
            <p className="mt-4 text-lg font-extrabold">You could save {money(d.veuRebate)}</p>
            <p className="mt-1">Your estimated cost after rebate: {money(d.customerTotal)} including GST</p>
            <p>Before rebate: {money(d.totalBeforeRebate)} including GST</p>
            {d.ceilingAreaM2 !== null && d.ceilingAreaM2 !== undefined && (
              <p className="mt-1 text-sm">Ceiling size used in your quote: {d.ceilingAreaM2} m²{d.areaEstimated ? " — estimated, not measured" : ""}</p>
            )}
            {d.piesaFee !== undefined && d.apFee !== undefined && d.installation !== undefined && (
              <table className="mt-4 w-full text-sm">
                <thead><tr><th className="text-left">Item</th><th className="text-right">Including GST</th></tr></thead>
                <tbody>
                  <tr><td>Ready Check</td><td className="text-right">Free</td></tr>
                  <tr><td>R5.0 ceiling insulation — supply and installation</td><td className="text-right">{money(d.installation)}</td></tr>
                  <tr><td>Pre Insulation Electrical Safety Assessment (PIESA)</td><td className="text-right">{money(d.piesaFee)}</td></tr>
                  <tr><td>Accredited Person management</td><td className="text-right">{money(d.apFee)}</td></tr>
                </tbody>
              </table>
            )}
            <p className="mt-4 text-sm">These are the figures you saved. We have retained this pricing; your Ready Check will confirm the measurements and work required.</p>
            {d.bookingAllowed ? <><a href={d.readyCheckBookingUrl} className="mt-4 inline-block rounded-xl bg-estimate-green px-5 py-3 font-extrabold text-estimate-white no-underline">
              Book my Ready Check
            </a>
            <p className="mt-2 text-xs text-estimate-navy/70">Opening the booking page will not book anything — you confirm your request on the next page. No payment required.</p></> : <p role="status" className="mt-4 font-bold">{SPOT_HELD_MESSAGE}</p>}
          </>
        )}
      </div>
    </main>
  );
}
