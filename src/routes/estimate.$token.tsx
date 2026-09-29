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
      <header className="border-b bg-card"><div className="mx-auto max-w-3xl px-4 py-4"><div className="text-lg font-bold text-primary">Home Insulation Victoria</div><div className="text-xs text-muted-foreground">Accredited Person: DC Construction Solutions Pty Ltd</div></div></header>
      <main className="mx-auto max-w-3xl space-y-4 px-4 py-6">
        {isLoading ? <p className="text-sm text-muted-foreground">Loading your estimate…</p>
          : isError || !data || !data.estimate?.visible ? <div className="rounded-xl border bg-card p-6 text-center"><h1 className="text-xl font-semibold">Estimate unavailable</h1><p className="mt-2 text-sm text-muted-foreground">{LINK_UNAVAILABLE}</p></div>
          : <>
            <div><h1 className="text-2xl font-bold">Your indicative estimate</h1>{data.job.address && <p className="text-sm text-muted-foreground">{data.job.address}{data.job.job_number ? ` · ${data.job.job_number}` : ""}</p>}</div>
            <CustomerEstimate data={data.estimate} />
          </>}
      </main>
    </div>
  );
}
