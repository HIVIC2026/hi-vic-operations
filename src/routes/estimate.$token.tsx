import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getPublicEstimate } from "@/lib/estimate.functions";
import { CustomerEstimate, type CustomerData } from "@/components/portal/estimate";
import { LINK_UNAVAILABLE } from "@/lib/estimatelink.core";
import logo from "@/assets/home-insulation-victoria-logo.png.asset.json";

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

type Payload = { job: { job_number: string | null; address: string | null }; estimate: CustomerData } | null;

function PublicEstimatePage() {
  const { token } = Route.useParams();
  const fn = useServerFn(getPublicEstimate);
  const { data, isLoading, isError } = useQuery({ queryKey: ["public_estimate", token], queryFn: () => fn({ data: { token } }) as Promise<Payload>, retry: false, refetchOnWindowFocus: false, staleTime: Infinity });
  return (
    <div className="estimate-brand min-h-screen bg-estimate-canvas">
      <header className="border-b border-estimate-blue/20 bg-estimate-white shadow-sm"><div className="mx-auto grid max-w-[840px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-5 py-3 sm:px-8 sm:py-4"><img src={logo.url} alt="Home Insulation Victoria" className="h-12 w-auto max-w-[142px] object-contain object-left sm:h-20 sm:max-w-60" /><span className="text-right text-[10px] font-extrabold uppercase tracking-widest text-estimate-navy sm:text-xs">Indicative estimate</span></div></header>
      <main className="mx-auto max-w-[840px] px-5 py-7 sm:px-8 sm:py-10">
        {isLoading ? <p className="text-sm text-muted-foreground">Loading your estimate…</p>
          : isError || !data || !data.estimate?.visible ? <div className="rounded-[1.3rem] border-2 border-estimate-blue bg-estimate-white p-6 text-center estimate-offset"><h1 className="text-xl font-bold">Estimate unavailable</h1><p className="mt-2 text-sm text-estimate-navy">{LINK_UNAVAILABLE}</p></div>
          : <>
            {(data.job.address || data.job.job_number) && <p className="mb-6 text-sm text-muted-foreground">{data.job.address}{data.job.address && data.job.job_number ? " · " : ""}{data.job.job_number}</p>}
            <CustomerEstimate data={data.estimate} publicPage />
          </>}
      </main>
    </div>
  );
}
