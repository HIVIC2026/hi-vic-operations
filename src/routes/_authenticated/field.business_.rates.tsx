import { createFileRoute } from "@tanstack/react-router";
import { AskToChange, BizPage, aud2 } from "@/components/trade/business-pages";

export const Route = createFileRoute("/_authenticated/field/business_/rates")({
  head: () => ({ meta: [{ title: "Your rates – Home Insulation Victoria" }, { name: "description", content: "The rates you've agreed with Home Insulation Victoria." }, { property: "og:title", content: "Your rates – Home Insulation Victoria" }, { property: "og:description", content: "The rates you've agreed with Home Insulation Victoria." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <BizPage title="Your rates" intro="What we pay you, as agreed. Inc GST.">
      {(d, refetch) => (<>
        {d.rates.length === 0 ? <p className="rounded-[22px] bg-card p-5 shadow-sm">Your rates are still being confirmed with the office.</p> : (
          <ul className="divide-y divide-estimate-line overflow-hidden rounded-[22px] bg-card shadow-sm">
            {d.rates.map((r, i) => <li key={r.label + i} className="flex items-center justify-between gap-3 p-4"><span className="font-bold">{r.label}</span><span className="shrink-0 text-right font-display font-extrabold">{aud2(r.inc_gst)}<span className="block text-xs font-semibold text-estimate-navy/60">per {r.unit.replace(/^per /, "")}</span></span></li>)}
          </ul>
        )}
        <AskToChange kind="rates" label="Request a rate change" placeholder="Which rate, and what you'd like it to be (inc GST)" open={d.openRequests} onSent={refetch} />
      </>)}
    </BizPage>
  ),
});
