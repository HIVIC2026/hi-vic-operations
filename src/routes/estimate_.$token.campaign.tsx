import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { EstimateHeader } from "@/components/portal/EstimateHeader";
import { CustomerEstimate } from "@/components/portal/estimate";
import { getLaunchCampaignPage, saveMySpot, takeMeOffList } from "@/lib/launch-campaign.functions";
import type { CustomerData } from "@/components/portal/estimate";

export const Route = createFileRoute("/estimate_/$token/campaign")({
  ssr: false,
  headers: () => ({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" }),
  head: () => ({ meta: [{ title: "Your insulation estimate — Home Insulation Victoria" }, { name: "robots", content: "noindex, nofollow" }, { name: "referrer", content: "no-referrer" }] }),
  component: CampaignPage,
});

function CampaignPage() {
  const { token } = Route.useParams();
  const getPage = useServerFn(getLaunchCampaignPage);
  const save = useServerFn(saveMySpot);
  const optOut = useServerFn(takeMeOffList);
  type CampaignData = { group: "likely" | "onsite"; estimate: { estimate: CustomerData }; response: { spot_saved_at: string | null; opted_out_at: string | null } | null } | null;
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["launch_campaign", token], queryFn: async () => {
    const json = await getPage({ data: { token } });
    return json ? JSON.parse(json) as CampaignData : null;
  }, retry: false, refetchOnWindowFocus: false });
  const [busy, setBusy] = useState<"save" | "optout" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const act = async (kind: "save" | "optout") => {
    setBusy(kind); setError(null);
    try { await (kind === "save" ? save({ data: { token } }) : optOut({ data: { token } })); await refetch(); }
    catch (e) { setError(e instanceof Error ? e.message : "That didn't work. Please try again."); }
    finally { setBusy(null); }
  };

  return <div className="estimate-brand min-h-screen bg-estimate-canvas">
    <EstimateHeader />
    <main className="mx-auto max-w-[760px] px-4 pb-14 sm:px-8">
      {isLoading ? <p role="status" className="py-16 text-center text-sm text-muted-foreground">Loading your estimate…</p>
      : isError || !data ? <section className="estimate-offset rounded-2xl border bg-white p-8 text-center"><h1 className="font-display text-2xl font-bold">This link isn't available</h1><p className="mt-2 text-sm">Please contact Home Insulation Victoria and we'll help.</p></section>
      : data.response?.opted_out_at ? <Result title="You're off the list" body="We won't send any more campaign messages about this enquiry." />
      : data.response?.spot_saved_at ? <Result title="You're on the list" body="We'll be in touch within 2 business days to book your free Ready Check." />
      : <div className="space-y-5">
          <section className="estimate-offset overflow-hidden rounded-[22px] border border-estimate-blue-soft bg-white px-5 py-7 shadow-[0_18px_50px_rgba(34,55,107,0.09)] sm:px-10 sm:py-10">
            <p className="text-sm font-semibold text-estimate-blue">Your preliminary estimate</p>
            <h1 className="mt-1 font-display text-3xl font-extrabold text-estimate-navy">See what your insulation upgrade may cost</h1>
            <p className="mt-3 text-sm text-estimate-navy/75">This is an estimate only. Your final price is worked out after your free Ready Check.</p>
            <div className="mt-6"><CustomerEstimate data={data.estimate.estimate} publicPage /></div>
            <a href="/calculator" className="mt-4 inline-block font-semibold text-estimate-blue underline">Try another size</a>
          </section>
          {data.group === "onsite" && <section className="rounded-[22px] border border-estimate-blue-soft bg-estimate-mist p-6">
            <h2 className="font-display text-xl font-bold text-estimate-navy">Help us check from the desk</h2>
            <p className="mt-2 text-sm text-estimate-navy/75">Send a short video from the manhole. You can also add photos. This desk check does not replace the onsite Ready Check.</p>
            <Link to="/estimate/$token/video" params={{ token }} className="mt-4 inline-flex h-11 items-center rounded-xl border border-estimate-blue px-4 font-bold text-estimate-blue">Upload a video or photos</Link>
          </section>}
          <section className="rounded-[22px] border border-estimate-blue-soft bg-white p-6 text-center shadow-[0_18px_50px_rgba(34,55,107,0.09)]">
            <h2 className="font-display text-2xl font-bold text-estimate-navy">Would you like to stay in line?</h2>
            <p className="mt-2 text-sm text-estimate-navy/75">Saving your spot does not book a visit.</p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <button disabled={!!busy} onClick={() => void act("save")} className="h-12 rounded-xl bg-[#07BF61] px-5 font-bold text-white disabled:opacity-50">{busy === "save" ? "Saving…" : "Save my spot"}</button>
              <button disabled={!!busy} onClick={() => void act("optout")} className="h-12 rounded-xl border border-estimate-blue-soft px-5 font-bold text-estimate-navy disabled:opacity-50">{busy === "optout" ? "Updating…" : "Take me off the list"}</button>
            </div>
            {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
          </section>
        </div>}
    </main>
  </div>;
}

function Result({ title, body }: { title: string; body: string }) {
  return <section className="estimate-offset rounded-[22px] border border-estimate-blue-soft bg-white p-8 text-center shadow-[0_18px_50px_rgba(34,55,107,0.09)]"><h1 className="font-display text-3xl font-extrabold text-estimate-navy">{title}</h1><p className="mt-3 text-estimate-navy/75">{body}</p></section>;
}
