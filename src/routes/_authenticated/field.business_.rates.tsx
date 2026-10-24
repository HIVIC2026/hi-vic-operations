import { createFileRoute } from "@tanstack/react-router";
import { AskToChange, BizPage, aud2 } from "@/components/trade/business-pages";
import { ratesLine } from "@/lib/trade-view.core";

export const Route = createFileRoute("/_authenticated/field/business_/rates")({
  head: () => ({ meta: [{ title: "Your rates – Home Insulation Victoria" }, { name: "description", content: "The rates you've agreed with Home Insulation Victoria." }, { property: "og:title", content: "Your rates – Home Insulation Victoria" }, { property: "og:description", content: "The rates you've agreed with Home Insulation Victoria." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <BizPage title="Your rates" intro="What we pay you, as agreed. Inc GST.">
      {(d, refetch) => (<>
        {d.rates.length > 0 && <p className="rounded-[18px] bg-estimate-panel p-4 text-sm text-estimate-navy"><span className="block text-[11px] font-bold uppercase tracking-[1.3px] text-estimate-blue">Agreed</span><span className="mt-1 block">{ratesLine(d.ratesAgreedAt, true).replace(" · Request a change", "")} · changes only through the office</span></p>}
        {d.rates.length === 0 ? <p className="rounded-[18px] border border-line bg-paper p-[19px] shadow-card">Your rates are still being confirmed with the office.</p> : (
          <ul className="divide-y divide-line overflow-hidden rounded-[18px] border border-line bg-paper shadow-card">
            {d.rates.map((r, i) => <li key={r.label + i} className="flex items-center justify-between gap-3 p-4"><span className="font-bold">{r.label}</span><span className="shrink-0 text-right font-display font-extrabold">{aud2(r.inc_gst)}<span className="block text-xs font-semibold text-sub">per {r.unit.replace(/^per /, "")}</span></span></li>)}
          </ul>
        )}
        <AskToChange kind="rates" label="Request a rate change" placeholder="Which rate, and what you'd like it to be (inc GST)" open={d.openRequests} onSent={refetch} />
      </>)}
    </BizPage>
  ),
});
