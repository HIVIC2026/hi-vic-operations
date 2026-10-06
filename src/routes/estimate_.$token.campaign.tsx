import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { PublicCalculator } from "@/components/portal/public-calculator";
import { OwnerHouse } from "@/components/owner/OwnerHouse";
import { Button } from "@/components/ui/button";
import { getLaunchCampaignPage, saveMySpot, takeMeOffList } from "@/lib/launch-campaign.functions";
import type { CustomerData } from "@/components/portal/estimate";
import type { InsulationDeclared } from "@/lib/estimate.core";

export const Route = createFileRoute("/estimate_/$token/campaign")({
  ssr: false,
  headers: () => ({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" }),
  head: () => ({ meta: [{ title: "Your insulation savings — Home Insulation Victoria" }, { name: "description", content: "Review your preliminary ceiling insulation savings and save your place for a free onsite Ready Check." }, { property: "og:title", content: "Your insulation savings — Home Insulation Victoria" }, { property: "og:description", content: "Review your preliminary ceiling insulation savings." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex, nofollow" }, { name: "referrer", content: "no-referrer" }] }),
  component: CampaignPage,
});

function CampaignPage() {
  const { token } = Route.useParams();
  const getPage = useServerFn(getLaunchCampaignPage);
  const save = useServerFn(saveMySpot);
  const optOut = useServerFn(takeMeOffList);
  type CampaignData = { group: "likely" | "onsite"; estimate: { estimate: CustomerData }; response: { spot_saved_at: string | null; opted_out_at: string | null; queue_priority: string; media_received_at?: string | null; saved_total?: number | null; saved_veu_discount?: number | null } | null; home?: { suburb: string | null; short: string | null }; bookingAvailable: boolean; owner: { firstName: string | null }; initialValues: { address: string; areaM2: number | null; insulation: InsulationDeclared } } | null;
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["launch_campaign", token], queryFn: async () => {
    const json = await getPage({ data: { token } });
    return json ? JSON.parse(json) as CampaignData : null;
  }, retry: false, refetchOnWindowFocus: false });
  const [busy, setBusy] = useState<"save" | "optout" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const oneTapStarted = useRef(false);
  const act = async (kind: "save" | "optout") => {
    setBusy(kind); setError(null);
    try { await (kind === "save" ? save({ data: { token } }) : optOut({ data: { token } })); await refetch(); }
    catch (e) { setError(e instanceof Error ? e.message : "That didn't work. Please try again."); }
    finally { setBusy(null); }
  };
  useEffect(() => {
    if (!data || data.response?.spot_saved_at || data.response?.opted_out_at || oneTapStarted.current) return;
    oneTapStarted.current = true;
    void act("save");
  }, [data]);

  return <div className="estimate-brand min-h-screen bg-estimate-canvas">
    <main className="pb-14">
      {isLoading ? <p role="status" className="py-16 text-center text-sm text-muted-foreground">Loading your estimate…</p>
      : isError || !data ? <section className="estimate-offset rounded-2xl border bg-white p-8 text-center"><h1 className="font-display text-2xl font-bold">This link isn't available</h1><p className="mt-2 text-sm">Please contact Home Insulation Victoria and we'll help.</p></section>
      : data.response?.opted_out_at ? <div className="mx-auto max-w-[760px] px-4 sm:px-8"><section className="estimate-offset rounded-[22px] border border-estimate-blue-soft bg-white p-8 text-center"><h1 className="font-display text-3xl font-extrabold text-estimate-navy">You're off the list</h1><p className="mt-3 text-estimate-navy/75">We won't send any more campaign messages about this enquiry.</p></section></div>
      : data.response?.spot_saved_at ? <div className="mx-auto max-w-[760px] px-4 sm:px-8"><Result group={data.group} videoPriority={data.response.queue_priority === "video"} token={token} rebate={data.response.saved_veu_discount ?? null} customer={data.response.saved_total ?? null} suburb={data.home?.suburb ?? null} home={data.home?.short ?? null} /></div>
      : <div>
          {data.group === "onsite" && <section className="mx-auto mb-5 max-w-[760px] rounded-[22px] border border-estimate-line bg-estimate-mint p-6">
            <h2 className="font-display text-xl font-bold text-estimate-navy">Help us check from the desk</h2>
            <p className="mt-2 text-sm text-estimate-navy/75">Send a short video from the manhole. You can also add photos. This desk check does not replace the onsite Ready Check.</p>
            <Button asChild variant="outline" className="mt-4 border-estimate-blue text-estimate-blue"><Link to="/estimate/$token/video" params={{ token }}>Upload a video or photos</Link></Button>
          </section>}
          {data.estimate.estimate.calc && <PublicCalculator
            settings={data.estimate.estimate.calc.settings}
            initialValues={data.initialValues}
            heading={`${data.owner.firstName ? `${data.owner.firstName}, here's` : "Here's"} how much you could save`}
            hideRegistration
            resultAction={() => <div className="mt-4"><Button type="button" disabled={!!busy} onClick={() => void act("save")} className="min-h-12 w-full bg-estimate-green text-estimate-white hover:bg-estimate-accent">{busy === "save" ? "Saving…" : "Save my spot"}</Button><p className="mt-2 text-center text-xs text-estimate-navy/75">Saving your spot does not book a visit.</p>{error && <p role="alert" className="mt-2 text-center text-sm text-danger">{error}</p>}</div>}
            footer={<footer className="mx-auto mt-6 max-w-[1080px] border-t border-estimate-line px-4 pb-6 pt-4 text-center text-xs text-estimate-navy/75"><Button type="button" variant="link" aria-label="Take me off the list" disabled={!!busy} onClick={() => void act("optout")} className="h-auto whitespace-normal p-0 text-xs font-normal text-estimate-navy/70 underline">I&apos;m no longer interested — remove my enquiry</Button></footer>}
          />}
        </div>}
    </main>
  </div>;
}

function Result({ group, videoPriority, token, rebate, customer, suburb, home }: { group: "likely" | "onsite"; videoPriority: boolean; token: string; rebate: number | null; customer: number | null; suburb: string | null; home: string | null }) {
  const $ = (n: number | null) => (n == null ? "—" : `$${Math.floor(Number(n)).toLocaleString("en-AU")}`);
  return <section className="estimate-offset rounded-[22px] border border-estimate-blue-soft bg-white p-6 shadow-[0_18px_50px_rgba(34,55,107,0.09)] sm:p-8">
    <OwnerHouse level={1} size="sm" className="mx-auto" />
    <h1 className="mt-4 text-center font-display text-3xl font-extrabold text-estimate-navy">Spot saved. Your <span className="text-estimate-logo-green">{$(rebate)}</span> rebate is waiting.</h1>
    <div className="mt-5 rounded-xl bg-estimate-heads-up p-4 text-estimate-navy">
      <p className="font-bold">Heads up: the waiting list is huge</p>
      <p className="mt-1 text-sm">Hundreds of homes have signed up since 1 October, and we book in order. It may be a while before it's your turn. We're teaming up with more installers and electricians across Victoria right now to get through it faster. Your spot is held, so you don't need to do anything.</p>
    </div>
    <p className="mt-4 text-estimate-navy">We'll text you the moment an installer is free in {suburb ?? "your area"} to book your free Ready Check.</p>
    <dl className="mt-4 grid gap-2 rounded-xl border border-estimate-line p-4 text-sm text-estimate-navy">
      <div className="flex justify-between gap-3"><dt>Your rebate</dt><dd className="font-bold text-estimate-logo-green">{$(rebate)}</dd></div>
      <div className="flex justify-between gap-3"><dt>You pay about</dt><dd className="font-bold">{$(customer)}</dd></div>
      {home && <div className="flex justify-between gap-3"><dt>Home</dt><dd className="text-right">{home}</dd></div>}
    </dl>
    <p className="mt-2 text-xs text-estimate-navy/70">Estimate only. Your final price is confirmed after the free Ready Check.</p>
    {group === "onsite" && !videoPriority && <div className="mt-5 rounded-xl bg-estimate-mint p-4 text-center"><h2 className="font-display text-lg font-bold text-estimate-navy">Want to jump the queue?</h2><Button asChild className="mt-3 bg-estimate-green text-estimate-white hover:bg-estimate-accent"><Link to="/estimate/$token/video" params={{ token }}>Send a quick video</Link></Button></div>}
  </section>;
}
