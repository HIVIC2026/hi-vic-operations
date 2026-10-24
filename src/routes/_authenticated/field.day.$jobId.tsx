import { toast } from "sonner";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ArrowUpRight, Check, MapPin, Phone } from "lucide-react";
import { TradeShell, card, navyCard, ghostBtn, greenBtn } from "@/components/trade/TradeShell";
import { TradePrestart } from "@/components/trade/TradePrestart";
import { PiisaCrewPicker } from "@/components/trade/PiisaCrewPicker";
import { onsiteFormStatus } from "@/lib/onsite-ready-check.functions";
import { confirmHivicReadyCheckPricingFn, getTradeDayView, tradeCouldntGetInFn } from "@/lib/trade-view.functions";
import { COULDNT_GET_IN, couldntGetInMessage, dayTile } from "@/lib/trade-view.core";
import { MittiFormLink } from "@/components/portal/MittiFormLink";

export const Route = createFileRoute("/_authenticated/field/day/$jobId")({
  head: () => ({ meta: [{ title: "Today's job – Home Insulation Victoria" }, { name: "description", content: "Before you start, then open the onsite form." }, { property: "og:title", content: "Today's job – Home Insulation Victoria" }, { property: "og:description", content: "Before you start, then open the onsite form." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" }] }),
  component: DayPage,
});

const WHAT = { safety_check: "Pre Insulation Electrical Safety Assessment (PIESA)", ready_check: "Ready Check", install: "Install" } as const;

function DayPage() {
  const { jobId } = Route.useParams();
  const load = useServerFn(getTradeDayView);
  const cgi = useServerFn(tradeCouldntGetInFn);
  const confirmPricing = useServerFn(confirmHivicReadyCheckPricingFn);
  const { data, error, refetch } = useQuery({ queryKey: ["trade-day", jobId], queryFn: () => load({ data: { jobId } }), refetchInterval: 30_000 });
  const [started, setStarted] = useState(false);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const installer = data ? data.kind !== "safety_check" : false;
  if (error) return <TradeShell installer={installer}><p role="alert" className={card}>{(error as Error).message}</p></TradeShell>;
  if (!data) return <TradeShell installer={false}><p className="text-sm">Loading your day…</p></TradeShell>;
  const t = data.start ? dayTile(data.start) : null;
  const isToday = data.start ? dayTile(data.start).day === dayTile(new Date().toISOString()).day : false;
  const pill = data.kind === "install" ? `Install ${isToday ? "today" : t?.day ?? ""} · ${t?.time ?? ""}` : `${isToday ? "Today" : t?.day ?? ""} · ${t?.time ?? ""}`;
  const o = data.outcome;
  const back = <Link to="/field" className={ghostBtn}>Back to my work</Link>;
  return (
    <TradeShell installer={installer}>
      <section className="rounded-[19px] border border-mist-line bg-mist p-5 text-ink md:p-[23px]">
        {t && <span className="inline-block rounded-[18px] bg-pink px-2.5 py-0.5 text-[11px] font-semibold text-rose">{pill}</span>}
        <h1 className="mt-3 font-display text-2xl font-bold">{WHAT[data.kind]} · {data.surname}</h1>
        <p className="mt-1 text-sm text-sub">{data.address}</p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <a className="flex h-12 items-center justify-center gap-2 rounded-[10px] border border-line bg-paper font-bold text-hiv-blue" href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(data.address ?? "")}`} target="_blank" rel="noreferrer"><MapPin className="h-5 w-5" />Directions</a>
          {data.phone ? <a className="flex h-12 items-center justify-center gap-2 rounded-[10px] border border-line bg-paper font-bold text-hiv-blue" href={`tel:${data.phone}`}><Phone className="h-5 w-5" />Call owner</a> : <span />}
        </div>
      </section>

      {o ? (
        <>
          {o.kind === "all_clear" && <Result tone="mint" title="All clear. Done and dusted." body="No fixes needed, so the install's good to go." />}
          {o.kind === "fixes" && <Result tone="blush" title={`${o.items.length} fix${o.items.length === 1 ? "" : "es"} found. We'll take it from here.`} body="We'll price these from your rates and send the owner the quote. If they say yes, it comes straight back to you." items={o.items} />}
          {o.kind === "quoted" && <Result tone="mint" title="Quote's in. Done and dusted." body={data.channel === "hivic_sourced" ? "We'll send the owner their quote. When they say yes, the install comes straight back to you." : "We'll send the owner your quote. When they say yes, the install comes straight back to you."} />}
          {o.kind === "not_eligible" && <Result tone="blush" title="Not eligible this time." body="Thanks for checking. We'll let the owner know, so you don't have to." items={o.reason ? [o.reason] : []} />}
          {o.kind === "wrap" && <Result tone="mint" title="That's a wrap. Done and dusted." body="We'll check the photos and sign it off." />}
          {o.kind === "missing" && <Result tone="blush" title={`Nearly there. ${o.items.length} photo${o.items.length === 1 ? "" : "s"} missing.`} body="Add these in the onsite form and this page updates itself." items={o.items} />}
          {o.kind === "couldnt_get_in" && <Result tone="blush" title="Thanks. The office will rebook it." body={couldntGetInMessage(o.reason)} />}
          {back}
        </>
      ) : started ? (
        <>
          {data.mittiId ? (
            <div className="grid gap-3 md:grid-cols-[1.4fr_1fr]" data-mitti-handoff>
              <section className={navyCard}>
                <p className="text-xs font-bold uppercase tracking-wide opacity-80">{data.kind === "safety_check" ? "Pre Insulation Electrical Safety Assessment (PIESA)" : data.kind === "ready_check" ? "Ready Check" : "Install"} · Mitti</p>
                <h2 className="mt-1 font-display text-xl font-bold">Over to your onsite form</h2>
                <p className="mt-1 text-sm opacity-90">Complete it onsite, in order. Your answers and required evidence come back to this job, and this page updates itself.</p>
                <MittiFormLink auditId={data.mittiId} className={`${greenBtn} mt-4`}>Open form in Mitti<ArrowUpRight className="h-4 w-4" /></MittiFormLink>
              </section>
              <aside className={card}>
                <h3 className="font-display text-base font-bold">What comes back here</h3>
                <ul className="mt-2 space-y-2 text-sm">{["Submitted form and result", data.kind === "safety_check" ? "Electrical findings" : "Measurements", "Required photo and document status", "The next step for this job"].map((t) => <li key={t} className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-hiv-green" />{t}</li>)}</ul>
              </aside>
            </div>
          ) : (
            <section className={`${card} border-rose bg-pink`} data-mitti-setup>
              <h2 className="font-display text-xl font-bold">Your form is being set up.</h2>
              <p className="mt-1 text-sm">Home Insulation Victoria is preparing the onsite form. It will appear on this job when ready.</p>
              {data.kind === "ready_check" && data.channel === "installer_sourced" && <PrepareForm jobId={jobId} onDone={() => refetch()} />}
            </section>
          )}
          {back}
        </>
      ) : asking ? (
        <section className={card}>
          <h2 className="font-display text-xl font-bold">Couldn't get in?</h2>
          <p className="mt-1 text-sm">Pick what happened. We'll take it from here.</p>
          <div className="mt-3 space-y-2">{COULDNT_GET_IN.map((r) => <button key={r} type="button" disabled={busy} className={ghostBtn} onClick={async () => { setBusy(true); try { await cgi({ data: { jobId, reason: r } }); await refetch(); } finally { setBusy(false); setAsking(false); } }}>{r}</button>)}</div>
          <button type="button" className="mt-3 w-full text-center text-sm font-bold text-estimate-blue" onClick={() => setAsking(false)}>Go back</button>
        </section>
      ) : (
        <>
          <section className={card}>
            <h2 className="font-display text-xl font-bold">Ready when you are</h2>
            <p className="mt-1 text-sm">{data.kind === "safety_check" ? "Tap below to open the Pre Insulation Electrical Safety Assessment (PIESA) form. We'll pick it up from there." : data.kind === "ready_check" ? (data.channel === "hivic_sourced" ? "Tap below to open the Ready Check form. Measure and photos go in there; we price the owner's quote from your agreed rates." : "Tap below to open the Ready Check form. Measure, photos and your quote all go in there.") : "Tap below to open the install form. PIISA, photos and bag labels are all in there."}</p>
            {data.kind === "ready_check" && <button type="button" className={`${ghostBtn} mt-4`} onClick={() => setAsking(true)}>Couldn't get in?</button>}
          </section>
          {data.kind !== "ready_check" && data.kind !== "safety_check" && <PiisaCrewPicker jobId={jobId} />}
          <TradePrestart jobId={jobId} kind={data.kind} channel={data.channel} onStart={async () => { if (data.kind === "ready_check" && data.channel === "hivic_sourced") { try { await confirmPricing({ data: { jobId } }); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not start the Ready Check."); return; } } setStarted(true); }} disabledReason={data.kind === "safety_check" && !data.mittiReady && !data.mittiId ? "The office is still setting up the onsite form. Your result will show here once it's in." : null} />
        </>
      )}
    </TradeShell>
  );
}

function Result({ tone, title, body, items }: { tone: "mint" | "blush"; title: string; body: string; items?: string[] }) {
  return (
    <section className={`rounded-[18px] p-5 ${tone === "mint" ? "bg-estimate-green-soft" : "bg-estimate-blush"}`}>
      {tone === "mint" && <span className="flex h-10 w-10 items-center justify-center rounded-full bg-estimate-green text-white"><Check className="h-6 w-6" /></span>}
      <h2 className="mt-2 font-display text-xl font-bold">{title}</h2>
      <p className="mt-1 text-sm">{body}</p>
      {!!items?.length && <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">{items.map((i) => <li key={i}>{i}</li>)}</ul>}
    </section>
  );
}

/** Uses the existing guarded onsite-form action (membership, booking and paperwork checks stay server-side). */
function PrepareForm({ jobId, onDone }: { jobId: string; onDone: () => void }) {
  const get = useServerFn(onsiteFormStatus);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="mt-3" data-prepare-form>
      <button type="button" disabled={busy} className={greenBtn} onClick={async () => {
        setBusy(true); setMsg(null);
        try { const s = await get({ data: { jobId, retry: true } }); if (s.kind === "open") { window.location.href = s.url; return; } setMsg(s.kind === "preparing" ? "Still getting it ready — try again in a minute." : s.message); onDone(); }
        catch { setMsg("Couldn't check the form just now. Try again in a minute."); }
        finally { setBusy(false); }
      }}>{busy ? "Checking…" : "Get my Ready Check form"}</button>
      {msg && <p className="mt-2 text-sm font-semibold" data-prepare-msg>{msg}</p>}
    </div>
  );
}
