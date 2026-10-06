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

// Owner-specific calculator opened from campaign emails. Never registers interest or creates a job/enquiry:
// the only action is the same idempotent Save my spot as the email.
export const Route = createFileRoute("/estimate_/$token/calculator")({
  ssr: false,
  headers: () => ({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" }),
  head: () => ({ meta: [{ title: "Your insulation calculator — Home Insulation Victoria" }, { name: "description", content: "Try a different ceiling size and see your updated insulation savings." }, { property: "og:title", content: "Your insulation calculator — Home Insulation Victoria" }, { property: "og:description", content: "Try a different ceiling size and see your updated savings." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex, nofollow" }, { name: "referrer", content: "no-referrer" }] }),
  component: OwnerCalculatorPage,
});

type PageData = { estimate: { estimate: CustomerData }; response: { spot_saved_at: string | null; opted_out_at: string | null } | null; owner: { firstName: string | null }; initialValues: { address: string; areaM2: number | null; insulation: InsulationDeclared } } | null;

function OwnerCalculatorPage() {
  const { token } = Route.useParams();
  const getPage = useServerFn(getLaunchCampaignPage);
  const save = useServerFn(saveMySpot);
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["owner_calculator", token], queryFn: async () => {
    const json = await getPage({ data: { token } });
    return json ? JSON.parse(json) as PageData : null;
  }, retry: false, refetchOnWindowFocus: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keptArea, setKeptArea] = useState<number | null>(null);

  const doSave = async (areaM2: number, insulation: InsulationDeclared) => {
    setBusy(true); setError(null);
    try { await save({ data: { token, calc: { areaM2, insulation } } }); setKeptArea(areaM2); await refetch(); }
    catch (e) { setError(e instanceof Error ? e.message : "That didn't work. Please try again."); }
    finally { setBusy(false); }
  };

  if (isLoading) return <div className="estimate-brand min-h-screen bg-estimate-canvas"><p role="status" className="py-16 text-center text-sm text-muted-foreground">Loading your calculator…</p></div>;
  if (isError || !data || !data.estimate.estimate.calc) return <div className="estimate-brand min-h-screen bg-estimate-canvas"><section className="estimate-offset mx-auto max-w-[760px] rounded-2xl border bg-white p-8 text-center"><h1 className="font-display text-2xl font-bold">This link isn't available</h1><p className="mt-2 text-sm">Please contact Home Insulation Victoria and we'll help.</p></section></div>;
  if (data.response?.opted_out_at) return <div className="estimate-brand min-h-screen bg-estimate-canvas"><section className="estimate-offset mx-auto max-w-[760px] rounded-[22px] border bg-white p-8 text-center"><h1 className="font-display text-3xl font-extrabold text-estimate-navy">You're off the list</h1></section></div>;

  const saved = !!data.response?.spot_saved_at;
  const savedArea = keptArea ?? data.initialValues.areaM2;
  return <PublicCalculator
    settings={data.estimate.estimate.calc.settings}
    initialValues={data.initialValues}
    heading={`${data.owner.firstName ? `${data.owner.firstName}, try` : "Try"} a different ceiling size`}
    hideRegistration
    resultAction={({ ceilingM2, insulation }) => <div className="mt-4" data-testid="owner-calc-action">
      {saved
        ? <div className="rounded-xl border border-estimate-green bg-estimate-mint p-4 text-center">
            <p className="inline-flex items-center gap-2 font-extrabold text-estimate-navy"><CheckCircle2 aria-hidden="true" className="size-5 text-estimate-green" />Your spot is saved</p>
            {ceilingM2 > 0 && savedArea != null && Math.round(ceilingM2) !== Math.round(savedArea) && <Button type="button" variant="outline" disabled={busy} onClick={() => void doSave(ceilingM2, insulation)} className="mt-3 min-h-12 w-full border-estimate-green text-estimate-navy">{busy ? "Saving…" : `Use ${Math.round(ceilingM2)} m² for my enquiry`}</Button>}
          </div>
        : <Button type="button" disabled={busy || ceilingM2 <= 0} onClick={() => void doSave(ceilingM2, insulation)} className="min-h-12 w-full bg-estimate-green text-estimate-white hover:bg-estimate-accent">{busy ? "Saving…" : "Save my spot"}</Button>}
      <p className="mt-2 text-center text-xs text-estimate-navy/75">No payment, no obligation. Saving your spot does not book a visit.</p>
      {error && <p role="alert" className="mt-2 text-center text-sm text-danger">{error}</p>}
    </div>}
  />;
}
