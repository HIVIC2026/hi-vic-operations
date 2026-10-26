import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { TradePublicShell, card, greenBtn, ghostBtn, inputCls } from "@/components/trade/TradeShell";
import { acceptRateOffer, declineRateOffer, loadRateOffer } from "@/lib/rate-offer.functions";
import { readableError } from "@/lib/readable-error.core";

export const Route = createFileRoute("/rate-offer/$token")({
  ssr: false,
  head: () => ({ meta: [
    { title: "Review our rate offer – Home Insulation Victoria" },
    { name: "description", content: "Review and respond to the rate offer from Home Insulation Victoria." },
    { property: "og:title", content: "Review our rate offer – Home Insulation Victoria" },
    { property: "og:description", content: "Review and respond to the rate offer from Home Insulation Victoria." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" },
  ] }),
  component: RateOfferPage,
});

const money = (n: number) => `$${n.toFixed(2)}`;

function RateOfferPage() {
  const { token } = Route.useParams();
  const q = useQuery({ queryKey: ["rate-offer", token], queryFn: () => loadRateOffer({ data: { token } }), retry: false });
  const [mode, setMode] = useState<"view" | "accept" | "decline">("view");
  const [name, setName] = useState(""); const [code, setCode] = useState(""); const [position, setPosition] = useState(""); const [tick, setTick] = useState(false);
  const [proposed, setProposed] = useState<Record<string, string>>({}); const [message, setMessage] = useState("");
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const o = q.data;
  const act = async (fn: () => Promise<unknown>) => { setBusy(true); setErr(null); try { await fn(); await q.refetch(); setMode("view"); } catch (e) { setErr(readableError(e, "That didn't go through. Check your answers and connection, then try again.")); } finally { setBusy(false); } };
  return (
    <TradePublicShell>
      <h1 className="font-display text-[26px] font-bold leading-tight">Review our rate offer</h1>
      {q.isLoading && <p className="text-sm">Loading…</p>}
      {q.error && <p role="alert" className={card}>{readableError(q.error, "We couldn't open this rate offer. Check you have the whole link from the email, or ask our office for a new link.")}</p>}
      {o && <>
        <div className="flex flex-wrap items-center gap-2"><p className="text-sm text-sub">{o.partner}</p><span className="rounded-[18px] bg-mist px-2.5 py-0.5 text-[11px] font-semibold text-hiv-blue">All prices inc GST</span></div>
        <p>Thanks for your application, {o.partner}. Here are the rates you proposed next to our offer. All figures include GST.</p>
        {o.status === "sent" && o.expires_at && <p className="text-sm">This link works until {new Date(o.expires_at).toLocaleDateString("en-AU", { timeZone: "Australia/Melbourne", day: "numeric", month: "long", year: "numeric" })}.</p>}
        {o.note && <section className={card}><p className="font-bold">Note from our office</p><p className="mt-1">{o.note}</p></section>}
        <section className="overflow-hidden rounded-[18px] border border-line bg-paper shadow-card">
          <table className="w-full text-left">
            <thead className="bg-estimate-navy text-estimate-canvas"><tr><th scope="col" className="p-3 text-sm font-bold">Item</th><th scope="col" className="p-3 text-right text-sm font-bold">Your rate</th><th scope="col" className="p-3 text-right text-sm font-bold">Our offer</th></tr></thead>
            <tbody className="divide-y divide-line">
              {o.items.map((i) => (
                <tr key={i.code}>
                  <td className="p-3"><span className="block font-semibold">{i.description}</span><span className="block text-sm text-sub">per {i.display_unit ?? i.unit}</span></td>
                  <td className="p-3 text-right">{money(i.partner_inc_gst)}</td>
                  <td className={`p-3 text-right ${i.offer_inc_gst !== i.partner_inc_gst ? "font-extrabold text-estimate-blue" : "font-semibold"}`}>{money(i.offer_inc_gst)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-line p-3 text-xs text-sub">The matching rates in your agreement change only when the offer is accepted.</p>
        </section>
        {o.status === "accepted" && <section className="rounded-[18px] border border-line bg-mint p-5 text-ink" data-rate-receipt><p className="font-display text-2xl font-bold">Your rate update is signed.</p><p className="mt-1">The accepted rates and signature record stay attached to your participation agreement.</p></section>}
        {o.status === "declined" && <section className="rounded-[18px] border border-line bg-mist p-5 text-ink" data-rate-receipt><p className="font-display text-2xl font-bold">Your response is with the office.</p><p className="mt-1">Your proposed changes have been recorded. Current agreed rates stay in place while the office reviews them.</p></section>}
        {o.status === "superseded" && <section className="rounded-[18px] border border-rose bg-pink p-5 text-ink" data-rate-receipt><p className="font-display text-2xl font-bold">This offer has been replaced.</p><p className="mt-1">Open the latest rate-offer link from Home Insulation Victoria.</p></section>}
        {o.status === "sent" && mode === "view" && (
          <div className="space-y-3">
            <button type="button" className={greenBtn} onClick={() => setMode("accept")}>Accept these rates</button>
            <button type="button" className={ghostBtn} onClick={() => setMode("decline")}>Decline or propose new rates</button>
          </div>
        )}
        {o.status === "sent" && mode === "accept" && (
          <section className={`${card} space-y-4`}>
            <h2 className="font-display text-xl font-bold">Sign the rate update</h2>
            <div className="space-y-3 whitespace-pre-wrap text-base leading-relaxed">{o.text}</div>
            <label className="flex items-start gap-3 rounded-2xl border border-estimate-line p-3"><input type="checkbox" className="mt-1 h-5 w-5" checked={tick} onChange={(e) => setTick(e.target.checked)} aria-label="I agree to these rates" /><span>I agree that these rates replace the rates in our signed partner agreement, and all other terms stay the same.</span></label>
            <label className="block font-bold" htmlFor="ro-name">Your full name</label>
            <input id="ro-name" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
            <label className="block font-bold" htmlFor="ro-pos">Your position</label>
            <input id="ro-pos" className={inputCls} placeholder="e.g. Director" value={position} onChange={(e) => setPosition(e.target.value)} />
            <label className="block font-bold" htmlFor="ro-code">6-digit signing code</label>
            <p className="text-sm">Ask our office for your code. It lasts 15 minutes.</p>
            <input id="ro-code" className={`${inputCls} text-center font-mono text-lg tracking-widest`} inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} />
            <button type="button" className={greenBtn} disabled={busy || code.length !== 6 || !tick || name.trim().length < 2 || position.trim().length < 2}
              onClick={() => act(() => acceptRateOffer({ data: { token, code, signer_name: name.trim(), signer_position: position.trim(), agreed: true, terms_sha256: o.sha256 } }))}>Sign and accept</button>
            <button type="button" className="w-full text-center text-sm font-bold text-estimate-blue" onClick={() => setMode("view")}>Back</button>
          </section>
        )}
        {o.status === "sent" && mode === "decline" && (
          <section className={`${card} space-y-3`}>
            <h2 className="font-display text-xl font-bold">Propose different rates</h2>
            <p>Leave a rate blank to keep your original figure. Our office will review and reply.</p>
            {o.items.map((i) => (
              <label key={i.code} className="flex items-center justify-between gap-3"><span>{i.description}</span>
                <input className={`${inputCls} w-28`} type="number" min={0} step="0.01" aria-label={`Your new rate for ${i.description}`} value={proposed[i.code] ?? ""} onChange={(e) => setProposed((p) => ({ ...p, [i.code]: e.target.value }))} /></label>
            ))}
            <textarea rows={3} className="w-full rounded-2xl border border-estimate-line bg-paper p-3 text-base" placeholder="Anything you want to tell our office" aria-label="Message to our office" value={message} onChange={(e) => setMessage(e.target.value)} />
            <button type="button" className={greenBtn} disabled={busy} onClick={() => act(() => declineRateOffer({ data: { token, proposed: Object.fromEntries(Object.entries(proposed).filter(([, v]) => v.trim() !== "" && Number.isFinite(Number(v))).map(([k, v]) => [k, Number(v)])), message: message.trim() || undefined } }))}>Send back to the office</button>
            <button type="button" className="w-full text-center text-sm font-bold text-estimate-blue" onClick={() => setMode("view")}>Back</button>
          </section>
        )}
        {err && <p role="alert" className="rounded-[18px] bg-owner-house-pink p-4 font-semibold">{err}</p>}
      </>}
    </TradePublicShell>
  );
}
