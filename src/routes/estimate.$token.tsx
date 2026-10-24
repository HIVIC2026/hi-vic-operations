import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { acceptReadyCheckFn as acceptPreAssessment, getPublicEstimate } from "@/lib/estimate.functions";
import { useEffect, useState } from "react";
import { ConfirmQuote, CustomerEstimate, type CustomerData } from "@/components/portal/estimate";
import { LINK_UNAVAILABLE } from "@/lib/estimatelink.core";
import { ReferralShare } from "@/components/portal/ReferralShare";
import { EstimateHeader } from "@/components/portal/EstimateHeader";
import type { ReadyCheckAcceptanceState as AssessmentAcceptanceState } from "@/lib/readycheck.core";
// Jo 24 Oct 2026 (decision 53): no Ready Check time picker here — the installer the office picks offers the times.
import { OwnerReadyCheckTimes } from "@/components/owner/OwnerReadyCheckTimes";
import { ReadyCheckVisitChange } from "@/components/portal/visit-changes";
import { SPOT_HELD_MESSAGE } from '@/lib/ready-check-booking-access.core';

// Public no-login Step 3 estimate. The token is the only credential; nothing is fetched during SSR.
export const Route = createFileRoute("/estimate/$token")({
  ssr: false,
  headers: () => ({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" }),
  head: () => ({
    meta: [
      { title: "Your indicative insulation estimate — Home Insulation Victoria" },
      { name: "description", content: "Your personal indicative ceiling insulation estimate from Home Insulation Victoria." },
      { property: "og:title", content: "Your indicative insulation estimate — Home Insulation Victoria" },
      { property: "og:description", content: "Personal indicative ceiling insulation estimate." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: PublicEstimatePage,
});

type Payload = { job: { job_number: string | null; address: string | null }; estimate: CustomerData; referralShareUrl: string | null; assessment: AssessmentAcceptanceState | null; assessmentTestMode: boolean; bookingAllowed: boolean; spotHeld: boolean } | null;

function PublicEstimatePage() {
  const { token } = Route.useParams();
  const fn = useServerFn(getPublicEstimate);
  const accept = useServerFn(acceptPreAssessment);
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["public_estimate", token], queryFn: () => fn({ data: { token } }) as Promise<Payload>, retry: false, refetchOnWindowFocus: false, staleTime: Infinity });
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  useEffect(() => {
    const sync = () => setConfirming(window.location.hash === "#confirm");
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  const standard = data?.estimate?.estimate?.scenarios.find((scenario) => scenario.key === "can_remain")?.by_access.standard ?? data?.estimate?.estimate?.scenarios[0]?.by_access.standard;
  const fee = data?.estimate?.fees?.piesa;
  const showConfirm = data?.bookingAllowed && confirming && standard && typeof fee === "number";
  const run = async (action: () => Promise<unknown>) => { setBusy(true); setActionError(null); try { await action(); await refetch(); } catch (e) { setActionError(e instanceof Error ? e.message : "This action could not be completed."); } finally { setBusy(false); } };
  const acceptCurrent = () => run(() => accept({ data: { token } }));
  const openReadyCheck = () => {
    window.history.pushState(null, "", `${window.location.pathname}${window.location.search}#confirm`);
    setConfirming(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  return (
    <div className="estimate-brand min-h-screen bg-estimate-canvas">
       <EstimateHeader />
       <main className="mx-auto max-w-[760px] px-4 pb-14 sm:px-8">
        {isLoading ? <p className="text-sm text-muted-foreground">Loading your estimate…</p>
          : isError || !data || !data.estimate?.visible ? <div className="estimate-offset rounded-2xl border border-estimate-blue-soft bg-estimate-white p-8 text-center"><h1 className="text-xl font-bold">Estimate unavailable</h1><p className="mt-2 text-sm text-estimate-navy">{LINK_UNAVAILABLE}</p></div>
          : <>
             {data.job.job_number && <p className="mb-4 px-1 text-xs font-medium text-estimate-navy/70">Reference {data.job.job_number}</p>}
             {showConfirm
                ? <ConfirmQuote estimatedPrice={standard.estimated_customer_total} assessmentFee={fee} state={data.assessment} testMode={data.assessmentTestMode} busy={busy} error={actionError} onAccept={acceptCurrent} after={<><OwnerReadyCheckTimes token={token} /><ReadyCheckVisitChange token={token} /></>} onBack={() => { window.history.replaceState(null, "", window.location.pathname); setConfirming(false); }} />
                 : <div className="estimate-offset overflow-hidden rounded-2xl border border-estimate-blue-soft bg-estimate-white px-5 py-7 sm:px-10 sm:py-11"><CustomerEstimate data={data.estimate} publicPage onReadyCheck={data.bookingAllowed ? openReadyCheck : undefined} readyCheckClose={data.bookingAllowed ? undefined : data.spotHeld ? <p role="status" className="mt-6 border-t border-estimate-blue-soft pt-6 font-bold">{SPOT_HELD_MESSAGE}</p> : <a className="estimate-action-button mt-6 flex min-h-12 items-center justify-center rounded-md px-4 py-3 font-extrabold" href={`/estimate/${token}/campaign`}>Save my spot</a>} /></div>}
             {!showConfirm && data.referralShareUrl && <ReferralShare url={data.referralShareUrl} />}
          </>}
      </main>
    </div>
  );
}
