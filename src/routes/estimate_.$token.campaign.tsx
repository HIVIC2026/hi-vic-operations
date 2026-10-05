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
  type CampaignData = { group: "likely" | "onsite"; estimate: { estimate: CustomerData }; response: { spot_saved_at: string | null; opted_out_at: string | null; queue_priority: string } | null; bookingAvailable: boolean; owner: { firstName: string | null }; initialValues: { address: string; areaM2: number | null; insulation: InsulationDeclared } } | null;
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
      : data.response?.spot_saved_at ? <div className="mx-auto max-w-[760px] px-4 sm:px-8"><Result group={data.group} videoPriority={data.response.queue_priority === "video"} token={token} /></div>
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

function Result({ group, videoPriority, token }: { group: "likely" | "onsite"; videoPriority: boolean; token: string }) {
  return <section className="estimate-offset rounded-[22px] border border-estimate-blue-soft bg-white p-8 text-center shadow-[0_18px_50px_rgba(34,55,107,0.09)]"><OwnerHouse level={0} className="mx-auto" /><h1 className="mt-4 font-display text-3xl font-extrabold text-estimate-navy">You're on the list!</h1><p className="mt-3 text-estimate-navy/75">No payment and no obligation. We'll be in touch as soon as an installer is free in your area.</p>{group === "onsite" && !videoPriority && <div className="mt-5 rounded-xl bg-estimate-mint p-4"><h2 className="font-display text-lg font-bold text-estimate-navy">Want to jump the queue?</h2><Button asChild className="mt-3 bg-estimate-green text-estimate-white hover:bg-estimate-accent"><Link to="/estimate/$token/video" params={{ token }}>Send a quick video</Link></Button></div>}</section>;
}
