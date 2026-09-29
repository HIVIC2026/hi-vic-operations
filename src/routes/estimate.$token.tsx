import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getPublicEstimate } from "@/lib/estimate.functions";
import { trackCalculatorUse } from "@/lib/engagement.functions";
import { useCallback, useEffect, useState } from "react";
import { ConfirmQuote, CustomerEstimate, type CustomerData } from "@/components/portal/estimate";
import { LINK_UNAVAILABLE } from "@/lib/estimatelink.core";
import { ReferralShare } from "@/components/portal/ReferralShare";
import { EstimateHeader } from "@/components/portal/EstimateHeader";

// Public no-login Step 3 estimate. The token is the only credential; nothing is fetched during SSR.
export const Route = createFileRoute("/estimate/$token")({
  ssr: false,
  headers: () => ({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" }),
  head: () => ({
    meta: [
      { title: "Your indicative insulation estimate — Home Insulation Victoria" },
      { name: "description", content: "Your personal indicative ceiling insulation estimate from Home Insulation Victoria." },
      { property: "og:title", content: "Your indicative insulation estimate — HI VIC" },
      { property: "og:description", content: "Personal indicative ceiling insulation estimate." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: PublicEstimatePage,
});

type Payload = { job: { job_number: string | null; address: string | null }; estimate: CustomerData; referralShareUrl: string | null } | null;

function PublicEstimatePage() {
  const { token } = Route.useParams();
  const fn = useServerFn(getPublicEstimate);
  const track = useServerFn(trackCalculatorUse);
  const onCalculatorUse = useCallback((m2: number) => { track({ data: { token, m2 } }).catch(() => {}); }, [track, token]);
  const { data, isLoading, isError } = useQuery({ queryKey: ["public_estimate", token], queryFn: () => fn({ data: { token } }) as Promise<Payload>, retry: false, refetchOnWindowFocus: false, staleTime: Infinity });
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    const sync = () => setConfirming(window.location.hash === "#confirm");
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  const standard = data?.estimate?.estimate?.scenarios.find((scenario) => scenario.key === "can_remain")?.by_access.standard ?? data?.estimate?.estimate?.scenarios[0]?.by_access.standard;
  const fee = data?.estimate?.fees?.piesa;
  const showConfirm = confirming && standard && typeof fee === "number";
  return (
    <div className="estimate-brand min-h-screen bg-estimate-canvas">
       <EstimateHeader />
       <main className="mx-auto max-w-[760px] px-4 pb-14 sm:px-8">
        {isLoading ? <p className="text-sm text-muted-foreground">Loading your estimate…</p>
          : isError || !data || !data.estimate?.visible ? <div className="estimate-offset rounded-2xl border border-estimate-blue-soft bg-estimate-white p-8 text-center"><h1 className="text-xl font-bold">Estimate unavailable</h1><p className="mt-2 text-sm text-estimate-navy">{LINK_UNAVAILABLE}</p></div>
          : <>
             {(data.job.address || data.job.job_number) && <p className="mb-4 px-1 text-xs font-medium text-estimate-navy/70">{data.job.address}{data.job.address && data.job.job_number ? " · " : ""}{data.job.job_number}</p>}
             {showConfirm
               ? <ConfirmQuote estimatedPrice={standard.estimated_customer_total} assessmentFee={fee} onBack={() => { window.history.replaceState(null, "", window.location.pathname); setConfirming(false); }} />
                : <div className="estimate-offset overflow-hidden rounded-2xl border border-estimate-blue-soft bg-estimate-white px-5 py-7 sm:px-10 sm:py-11"><CustomerEstimate data={data.estimate} publicPage propertyAddress={data.job.address} onCalculatorUse={onCalculatorUse} /></div>}
             {!showConfirm && data.referralShareUrl && <ReferralShare url={data.referralShareUrl} />}
          </>}
      </main>
    </div>
  );
}
