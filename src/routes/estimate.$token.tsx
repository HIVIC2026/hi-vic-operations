import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getPublicEstimate } from "@/lib/estimate.functions";
import { CustomerEstimate, type CustomerData } from "@/components/portal/estimate";
import { LINK_UNAVAILABLE } from "@/lib/estimatelink.core";

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
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card"><div className="mx-auto flex max-w-[840px] flex-wrap items-center justify-between gap-x-5 gap-y-2 px-5 py-4 sm:px-8"><div className="flex items-center gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-md bg-primary text-sm font-extrabold text-primary-foreground">HI</span><div><div className="font-bold leading-tight text-primary">Home Insulation Victoria</div><div className="text-xs text-muted-foreground">DC Construction Solutions · Accredited Person</div></div></div><span className="text-xs font-semibold text-muted-foreground">Indicative estimate</span></div></header>
      <main className="mx-auto max-w-[840px] px-5 py-7 sm:px-8 sm:py-10">
        {isLoading ? <p className="text-sm text-muted-foreground">Loading your estimate…</p>
          : isError || !data || !data.estimate?.visible ? <div className="rounded-xl border bg-card p-6 text-center"><h1 className="text-xl font-semibold">Estimate unavailable</h1><p className="mt-2 text-sm text-muted-foreground">{LINK_UNAVAILABLE}</p></div>
          : <>
            {(data.job.address || data.job.job_number) && <p className="mb-6 text-sm text-muted-foreground">{data.job.address}{data.job.address && data.job.job_number ? " · " : ""}{data.job.job_number}</p>}
            <CustomerEstimate data={data.estimate} publicPage />
          </>}
      </main>
    </div>
  );
}
