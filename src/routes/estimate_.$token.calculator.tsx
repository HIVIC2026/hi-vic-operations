import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { PublicCalculator } from "@/components/portal/public-calculator";
import { Button } from "@/components/ui/button";
import { getLaunchCampaignPage, saveMySpot } from "@/lib/launch-campaign.functions";
import type { CustomerData } from "@/components/portal/estimate";
import type { InsulationDeclared } from "@/lib/estimate.core";
import { SPOT_SAVED_BODY, SPOT_SAVED_HEADING, type SpotChoice } from "@/lib/save-spot-offer.core";

// Owner-specific calculator opened from campaign emails. Never registers interest or creates a job/enquiry:
// the only action is the same idempotent Save my spot as the email.
export const Route = createFileRoute("/estimate_/$token/calculator")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>): { keep?: "original" } => (s.keep === "original" ? { keep: "original" } : {}),
  headers: () => ({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" }),
  head: () => ({ meta: [{ title: "Your insulation calculator — Home Insulation Victoria" }, { name: "description", content: "Try a different ceiling size and see your updated insulation savings." }, { property: "og:title", content: "Your insulation calculator — Home Insulation Victoria" }, { property: "og:description", content: "Try a different ceiling size and see your updated savings." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex, nofollow" }, { name: "referrer", content: "no-referrer" }] }),
  component: OwnerCalculatorPage,
});

type PageData = { pricing?: { total: number; discount: number; gross: number; areaM2: number; areaAssumed: boolean } | null; estimate: { estimate: CustomerData }; response: { spot_saved_at: string | null; opted_out_at: string | null } | null; owner: { firstName: string | null }; initialValues: { address: string; areaM2: number | null; insulation: InsulationDeclared } } | null;

function OwnerCalculatorPage() {
  const { token } = Route.useParams();
  const getPage = useServerFn(getLaunchCampaignPage);
  const save = useServerFn(saveMySpot);
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["owner_calculator", token], queryFn: async () => {
    const json = await getPage({ data: { token } });
    return json ? JSON.parse(json) as PageData : null;
  }, retry: false, refetchOnWindowFocus: false });
  const { keep } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ choice: SpotChoice; areaM2: number } | null>(keep === "original" ? { choice: "original", areaM2: 0 } : null);
  const [savedChoice, setSavedChoice] = useState<SpotChoice | null>(null);

  // Viewing never saves: a spot is saved only after the owner confirms one of the two choices.
  const confirm = async () => {
    if (!pending) return;
    setBusy(true); setError(null);
    try {
      await save({ data: pending.choice === "original" ? { token, choice: "original" } : { token, choice: "updated", calc: { areaM2: pending.areaM2, insulation: null } } });
      setSavedChoice(pending.choice); setPending(null); await refetch();
    } catch (e) { setError(e instanceof Error ? e.message : "That didn't work. Please try again."); }
    finally { setBusy(false); }
  };
  const money = (n: number) => n.toLocaleString("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 });

  if (isLoading) return <div className="estimate-brand min-h-screen bg-estimate-canvas"><p role="status" className="py-16 text-center text-sm text-muted-foreground">Loading your calculator…</p></div>;
  if (isError || !data || !data.estimate.estimate.calc) return <div className="estimate-brand min-h-screen bg-estimate-canvas"><section className="estimate-offset mx-auto max-w-[760px] rounded-2xl border bg-white p-8 text-center"><h1 className="font-display text-2xl font-bold">This link isn't available</h1><p className="mt-2 text-sm">Please contact Home Insulation Victoria and we'll help.</p></section></div>;
  if (data.response?.opted_out_at) return <div className="estimate-brand min-h-screen bg-estimate-canvas"><section className="estimate-offset mx-auto max-w-[760px] rounded-[22px] border bg-white p-8 text-center"><h1 className="font-display text-3xl font-extrabold text-estimate-navy">You're off the list</h1></section></div>;

  const saved = !!data.response?.spot_saved_at;
  const orig = data.pricing ?? null;
  const confirmBox = pending && <div role="dialog" aria-label="Confirm your choice" className="rounded-xl border-2 border-estimate-green bg-white p-4 text-center">
    <p className="font-extrabold text-estimate-navy">{pending.choice === "original"
      ? (orig ? `Save your spot using the original estimate: ${money(orig.total)} after an estimated ${money(orig.discount)} rebate (${Math.round(orig.areaM2)} m²${orig.areaAssumed ? ", assumed" : ""})?` : "Save your spot using the original estimate from your email?")
      : `Save your spot using the updated estimate for ${Math.round(pending.areaM2)} m²?`}</p>
    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
      <Button type="button" disabled={busy} onClick={() => void confirm()} className="min-h-12 flex-1 bg-estimate-green text-estimate-white hover:bg-estimate-accent">{busy ? "Saving…" : "Yes, save my spot"}</Button>
      <Button type="button" variant="outline" disabled={busy} onClick={() => setPending(null)} className="min-h-12 flex-1">Not yet</Button>
    </div>
  </div>;
  const savedBox = <div className="rounded-xl border border-estimate-green bg-estimate-mint p-4 text-center" data-testid="spot-saved">
    <h2 className="inline-flex items-center gap-2 font-display text-xl font-extrabold text-estimate-navy"><CheckCircle2 aria-hidden="true" className="size-5 text-estimate-green" />{SPOT_SAVED_HEADING}</h2>
    <p className="mt-2 text-sm text-estimate-navy">{SPOT_SAVED_BODY}</p>
    {savedChoice && <p className="mt-2 text-xs text-estimate-navy/75">Saved with the {savedChoice} estimate.</p>}
  </div>;
  return <>
    {keep === "original" && <section className="estimate-offset mx-auto max-w-[760px] px-4 pt-6">{saved && !pending ? savedBox : confirmBox}{error && <p role="alert" className="mt-2 text-center text-sm text-danger">{error}</p>}</section>}
    <PublicCalculator
    settings={data.estimate.estimate.calc.settings}
    initialValues={data.initialValues}
    heading={`${data.owner.firstName ? `${data.owner.firstName}, try` : "Try"} a different ceiling size`}
    hideRegistration
    resultAction={({ ceilingM2 }) => <div className="mt-4 space-y-2" data-testid="owner-calc-action">
      {saved && !pending && keep !== "original" && savedBox}
      {pending && keep !== "original" ? confirmBox : <>
        <Button type="button" disabled={busy || ceilingM2 <= 0} onClick={() => setPending({ choice: "updated", areaM2: ceilingM2 })} className="min-h-12 w-full bg-estimate-green text-estimate-white hover:bg-estimate-accent">Save My Spot — Updated Estimate</Button>
        <Button type="button" variant="outline" disabled={busy || !orig} onClick={() => setPending({ choice: "original", areaM2: 0 })} className="min-h-12 w-full border-estimate-green text-estimate-navy">Save My Spot — Original Estimate{orig ? ` (${money(orig.total)})` : ""}</Button>
      </>}
      <p className="text-center text-xs text-estimate-navy/75">No payment, no obligation. Changing the size here doesn't change your recorded insulation details.</p>
      {error && keep !== "original" && <p role="alert" className="text-center text-sm text-danger">{error}</p>}
    </div>}
  /></>;
}
