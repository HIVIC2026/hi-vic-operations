import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Check, MapPin, Phone } from "lucide-react";
import { TradeShell, card, ghostBtn, greenBtn } from "@/components/trade/TradeShell";
import { TradePrestart } from "@/components/trade/TradePrestart";
import { getTradeDayView, tradeCouldntGetInFn } from "@/lib/trade-view.functions";
import { COULDNT_GET_IN, couldntGetInMessage, dayTile } from "@/lib/trade-view.core";

export const Route = createFileRoute("/_authenticated/field/day/$jobId")({
  head: () => ({ meta: [{ title: "Today's job – Home Insulation Victoria" }, { name: "description", content: "Before you start, then open the form in Mitti." }, { property: "og:title", content: "Today's job – Home Insulation Victoria" }, { property: "og:description", content: "Before you start, then open the form in Mitti." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" }] }),
  component: DayPage,
});

const WHAT = { safety_check: "Safety check", ready_check: "Ready Check", install: "Install" } as const;

function DayPage() {
  const { jobId } = Route.useParams();
  const load = useServerFn(getTradeDayView);
  const cgi = useServerFn(tradeCouldntGetInFn);
  const { data, error, refetch } = useQuery({ queryKey: ["trade-day", jobId], queryFn: () => load({ data: { jobId } }), refetchInterval: 30_000 });
  const [started, setStarted] = useState(false);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const installer = data ? data.kind !== "safety_check" : false;
  if (error) return <TradeShell installer={installer}><p role="alert" className={card}>{(error as Error).message}</p></TradeShell>;
  if (!data) return <TradeShell installer={false}><p className="text-sm">Loading your day…</p></TradeShell>;
  const t = data.start ? dayTile(data.start) : null;
  const isToday = data.start ? new Date(data.start).toDateString() === new Date().toDateString() : false;
  const pill = data.kind === "install" ? `Install ${isToday ? "today" : t?.day ?? ""} · ${t?.window ?? ""}` : `${isToday ? "Today" : t?.day ?? ""} · ${t?.window ?? ""}`;
  const o = data.outcome;
  const back = <Link to="/field" className={ghostBtn}>Back to my work</Link>;
  return (
    <TradeShell installer={installer}>
      <section className="rounded-[22px] bg-estimate-navy p-5 text-estimate-canvas">
        {t && <span className="inline-block rounded-full bg-owner-house-pink px-3 py-1 text-sm font-bold text-estimate-navy">{pill}</span>}
        <h1 className="mt-3 font-display text-2xl font-extrabold">{WHAT[data.kind]} · {data.surname}</h1>
        <p className="mt-1 text-sm text-estimate-canvas/85">{data.address}</p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <a className="flex h-12 items-center justify-center gap-2 rounded-full bg-estimate-canvas font-bold text-estimate-navy" href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(data.address)}`} target="_blank" rel="noreferrer"><MapPin className="h-5 w-5" />Directions</a>
          {data.phone ? <a className="flex h-12 items-center justify-center gap-2 rounded-full bg-estimate-canvas font-bold text-estimate-navy" href={`tel:${data.phone}`}><Phone className="h-5 w-5" />Call owner</a> : <span />}
        </div>
      </section>

      {o ? (
        <>
          {o.kind === "all_clear" && <Result tone="mint" title="All clear. Done and dusted." body="No fixes needed, so the install's good to go." />}
          {o.kind === "fixes" && <Result tone="blush" title={`${o.items.length} fix${o.items.length === 1 ? "" : "es"} found. We'll take it from here.`} body="We'll price these from your rates and send the owner the quote. If they say yes, it comes straight back to you." items={o.items} />}
          {o.kind === "quoted" && <Result tone="mint" title="Quote's in. Done and dusted." body="We'll send the owner your quote. When they say yes, the install comes straight back to you." />}
          {o.kind === "not_eligible" && <Result tone="blush" title="Not eligible this time." body="Thanks for checking. We'll let the owner know, so you don't have to." items={o.reason ? [o.reason] : []} />}
          {o.kind === "wrap" && <Result tone="mint" title="That's a wrap. Done and dusted." body="We'll check the photos and sign it off." />}
          {o.kind === "missing" && <Result tone="blush" title={`Nearly there. ${o.items.length} photo${o.items.length === 1 ? "" : "s"} missing.`} body="Add these in Mitti and this page updates itself." items={o.items} />}
          {o.kind === "couldnt_get_in" && <Result tone="blush" title="No worries. We'll sort it." body={couldntGetInMessage(o.reason)} />}
          {back}
        </>
      ) : started ? (
        <>
          <section className={card}><h2 className="font-display text-xl font-extrabold">Over to Mitti</h2><p className="mt-1 text-sm">Submit the form and this page updates itself.</p>
            {data.mittiId && <a className={`${greenBtn} mt-4`} href={`https://app.au.mitti.com/inspections/${data.mittiId}`} target="_blank" rel="noreferrer">Open it in Mitti</a>}
          </section>
          {back}
        </>
      ) : asking ? (
        <section className={card}>
          <h2 className="font-display text-xl font-extrabold">Couldn't get in?</h2>
          <p className="mt-1 text-sm">Pick what happened. We'll take it from here.</p>
          <div className="mt-3 space-y-2">{COULDNT_GET_IN.map((r) => <button key={r} type="button" disabled={busy} className={ghostBtn} onClick={async () => { setBusy(true); try { await cgi({ data: { jobId, reason: r } }); await refetch(); } finally { setBusy(false); setAsking(false); } }}>{r}</button>)}</div>
          <button type="button" className="mt-3 w-full text-center text-sm font-bold text-estimate-blue" onClick={() => setAsking(false)}>Go back</button>
        </section>
      ) : (
        <>
          <section className={card}>
            <h2 className="font-display text-xl font-extrabold">Ready when you are</h2>
            <p className="mt-1 text-sm">{data.kind === "safety_check" ? "Tap below to open the safety check in Mitti. We'll pick it up from there." : data.kind === "ready_check" ? "Tap below to open the Ready Check form in Mitti. Measure, photos and your quote all go in there." : "Tap below to open the install form in Mitti. PIISA, photos and bag labels are all in there."}</p>
            {data.kind === "ready_check" && <button type="button" className={`${ghostBtn} mt-4`} onClick={() => setAsking(true)}>Couldn't get in?</button>}
          </section>
          <TradePrestart jobId={jobId} kind={data.kind} onStart={() => setStarted(true)} disabledReason={data.kind === "safety_check" && !data.mittiReady && !data.mittiId ? "The office is still setting up the Mitti form. Your result will show here once it's in." : null} />
        </>
      )}
    </TradeShell>
  );
}

function Result({ tone, title, body, items }: { tone: "mint" | "blush"; title: string; body: string; items?: string[] }) {
  return (
    <section className={`rounded-[22px] p-5 ${tone === "mint" ? "bg-estimate-green-soft" : "bg-estimate-blush"}`}>
      {tone === "mint" && <span className="flex h-10 w-10 items-center justify-center rounded-full bg-estimate-green text-white"><Check className="h-6 w-6" /></span>}
      <h2 className="mt-2 font-display text-xl font-extrabold">{title}</h2>
      <p className="mt-1 text-sm">{body}</p>
      {!!items?.length && <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">{items.map((i) => <li key={i}>{i}</li>)}</ul>}
    </section>
  );
}
