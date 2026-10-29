// Per-job pay detail = approved state M6-job-detail (Jo 24 Oct 2026, decision 235; payState rule decision 109): own pay
// only, business owner only. Facts come from the same business-scoped money rows as the Money screen; words from the
// pure `moneyJobDetail`. Never the owner's price or our margin.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { TradeShell } from "@/components/trade/TradeShell";
import { getTradeMoneyJob } from "@/lib/trade-view.functions";
import { heldPayPill, payPill } from "@/lib/trade-view.core";
import { moneyJobDetail } from "@/lib/installer-screens.core";
import { Group, LinkRow, Note, Pill, Row, Screen } from "@/components/trade/installer-kit";

export const Route = createFileRoute("/_authenticated/field/money_/$jobId")({
  head: () => ({ meta: [{ title: "Your pay for this job – Home Insulation Victoria" }, { name: "description", content: "What you're paid for this job and when." }, { property: "og:title", content: "Your pay for this job – Home Insulation Victoria" }, { property: "og:description", content: "What you're paid for this job and when." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" }] }),
  component: MoneyJob,
});

function MoneyJob() {
  const { jobId } = Route.useParams();
  const load = useServerFn(getTradeMoneyJob);
  const { data, error } = useQuery({ queryKey: ["trade-money-job", jobId], queryFn: () => load({ data: { jobId } }), retry: false });
  if (error) return <TradeShell installer><p role="alert" className="rounded-[18px] border border-line bg-paper p-4 text-sm">{(error as Error).message}</p></TradeShell>;
  if (!data) return <TradeShell installer><p className="text-sm">Loading…</p></TradeShell>;
  const v = moneyJobDetail(data);
  const pill = payPill(v.pill.kind === "paid" || v.pill.kind === "coming" ? ({ kind: v.pill.kind, on: v.pill.on ?? "" } as never) : { kind: "checking" });
  const heldPill = v.held.length ? heldPayPill(v.held) : null;
  const shownPill = heldPill ?? pill;
  return (
    <TradeShell installer boss>
      <Screen>
        <Link to="/field/money" className="inline-flex min-h-9 items-center text-sm font-medium text-hiv-blue">‹ Money</Link>
        <div><h1 className="font-display text-[21px] font-semibold leading-[1.25]">{v.heading || "This job"}</h1>{v.sub && <p className="mt-1 text-[13px] text-sub">{v.sub}</p>}</div>
        {!data.found ? <p className="rounded-[18px] bg-mist p-4 text-sm" data-money-job-none>No completed install on this job yet. Your pay appears here once the install is done.</p> : (
          <section className="rounded-[18px] bg-mist p-4" data-money-job-pay>
            <p className="text-[11px] font-bold uppercase tracking-[1.3px] text-hiv-blue">Your pay</p>
            <p className="mt-1.5 flex items-center justify-between gap-3"><span className="text-[26px] font-semibold">{v.pay}</span><Pill tone={shownPill.tone}>{shownPill.label}</Pill></p>
            <Note>{v.payNote}</Note>
            {v.held.length > 0 && <div className="mt-3" data-money-job-held-box><p className="text-[13px] font-semibold">Why your pay is held</p><ul className="mt-1 list-disc pl-5 text-[13px] text-rose" data-money-job-held>{v.held.map((h) => <li key={h}>{h}</li>)}</ul></div>}
          </section>
        )}
        <Group title="Work">{v.work.map(([k, val], i) => <Row key={k} label={k} value={val} last={i === v.work.length - 1} />)}</Group>
        {v.timeline.length > 0 && <Group title="Timeline">{v.timeline.map(([k, val], i) => <Row key={k} label={k} value={val} last={i === v.timeline.length - 1} />)}</Group>}
        <Note>{v.footnote}</Note>
        <LinkRow to="/field/$jobId" params={{ jobId }}>Open the job</LinkRow>
      </Screen>
    </TradeShell>
  );
}
