// Decision 364: one crew member's own safety plan (SWMS) link from the install texts; signs ONLY that person's line.
// Part 7 Task 3 (Jo 2 Nov 2026, approved order): "Specific to this house" → the 9 standard controls folded away → tick
// "I am {name}. I have read the safety plan and will follow it." → typed full name → "Sign the safety plan". Must load
// fast on a weak phone signal: one server read, no icon packs, the full PDF only when tapped. Words from
// swms-sign-page.core (page) and the plan's own wording rule (view); logic in swms-link.server.ts.
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { TradePublicShell, inputCls } from "@/components/trade/TradeShell";
import { getSwmsLinkPdf, getSwmsLinkView, signSwmsByLink } from "@/lib/swms-link.functions";
import { readableError } from "@/lib/readable-error.core";
import { SWMS_SIGN_STATEMENT, swmsDateTime } from "@/lib/swms.core";
import { SIGN_PAGE_TEXT as T, signBlocker, signPageTitle, signPageWhen } from "@/lib/swms-sign-page.core";

const SP_LINK_PROBLEM = "We couldn't open this safety plan. Check you have the whole link from the text, or ask your business owner to send it again.";
/** Website look (approved sample): light boxes and the green button. */
const box = "rounded-[14px] bg-[#eef0fc] p-4 text-sm";
const signBtn = "flex h-12 w-full items-center justify-center rounded-[10px] bg-[#07bf61] px-[15px] text-[15px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-45";
const pdfBtn = "flex h-12 w-full items-center justify-center rounded-[10px] border border-[#3c51c4] bg-paper px-[15px] text-[14px] font-bold text-[#3c51c4] disabled:opacity-60";

export const Route = createFileRoute("/sp/$token")({
  ssr: false,
  head: () => ({ meta: [
    { title: "Your safety plan – Home Insulation Victoria" },
    { name: "description", content: "Read and sign the safety plan for your install." },
    { name: "robots", content: "noindex, nofollow" }, { name: "referrer", content: "no-referrer" },
    { property: "og:title", content: "Your safety plan – Home Insulation Victoria" },
    { property: "og:description", content: "Read and sign the safety plan for your install." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: SafetyPlanLink,
});

/** Opens the PDF the server just built (download on Android/desktop; Safari shows it). */
function openPdf(filename: string, base64: string) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.rel = "noopener";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function SafetyPlanLink() {
  const { token } = Route.useParams();
  const q = useQuery({ queryKey: ["swms-link", token], queryFn: () => getSwmsLinkView({ data: { token } }), retry: false });
  const [ok, setOk] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfErr, setPdfErr] = useState<string | null>(null);
  const d = q.data;
  if (q.error) return <TradePublicShell><section className="rounded-[18px] border border-rose bg-pink p-5 text-ink" data-swms-link-invalid><h1 className="font-display text-2xl font-bold">This safety plan link is unavailable.</h1><p className="mt-1 text-sm">{readableError(q.error, SP_LINK_PROBLEM)}</p></section></TradePublicShell>;
  if (!d) return <TradePublicShell><p className="text-sm text-sub">Loading your safety plan…</p></TradePublicShell>;
  const blocker = signBlocker(ok, typed);
  return (
    <TradePublicShell>
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-[#3c51c4]">{T.header}</p>
        <h1 className="mt-1 font-display text-[26px] font-bold leading-tight">{signPageTitle(d.installStart, Date.now())}</h1>
        <p className="mt-1 text-sm text-sub">{signPageWhen(d.installStart, d.address)}</p>
        <p className="mt-1 text-xs text-sub">{d.jobNumber}{d.businessName ? ` · ${d.businessName}` : ""} · {T.ownLink(d.signer.name)}</p>
      </div>

      <section className={box} data-swms-house>
        <h2 className="font-display text-lg font-bold">{T.house}</h2>
        {d.house.length ? <ul className="mt-2 list-disc space-y-1 pl-5">{d.house.map((h, i) => <li key={i} className={h.startsWith("Safety step:") ? "font-semibold" : undefined}>{h}</li>)}</ul> : <p className="mt-2">{T.houseNone}</p>}
      </section>

      <details className={box} data-swms-controls>
        <summary className="cursor-pointer font-display text-lg font-bold">{T.controlsSummary}</summary>
        <div className="mt-3 space-y-3">
          <div><p className="font-semibold">{T.highRisk}</p><ul className="list-disc pl-5">{d.highRiskWork.map((h) => <li key={h}>{h}</li>)}</ul></div>
          <ol className="list-decimal space-y-2 pl-5">{d.hazards.map((h) => <li key={h.name}><span className="font-semibold">{h.name}</span><br />{h.control}.</li>)}</ol>
          <p>{d.howInPlace}</p>
        </div>
      </details>

      <div>
        <button type="button" className={pdfBtn} disabled={pdfBusy} data-swms-pdf-btn
          onClick={async () => { setPdfBusy(true); setPdfErr(null); try { const r = await getSwmsLinkPdf({ data: { token } }); openPdf(r.filename, r.base64); } catch (e) { setPdfErr(readableError(e, T.pdfFailed)); } finally { setPdfBusy(false); } }}>
          {pdfBusy ? T.pdfBusy : T.readPdf}
        </button>
        {pdfErr && <p role="alert" className="mt-2 rounded-[14px] bg-owner-house-pink p-3 text-sm font-semibold">{pdfErr}</p>}
      </div>

      {d.signedAt ? (
        <section className="rounded-[18px] border border-line bg-mint p-5 text-ink" data-swms-link-signed><p className="font-display text-2xl font-bold">{T.signed}</p><p className="mt-1">Signed {swmsDateTime(d.signedAt)} (Melbourne time).</p></section>
      ) : !d.open ? (
        <section className={box}><p>{T.closed}</p></section>
      ) : (
        <section className="space-y-3" data-swms-link-sign>
          <label className="flex items-start gap-3 text-base"><input type="checkbox" className="mt-1 h-6 w-6 shrink-0" checked={ok} onChange={(e) => setOk(e.target.checked)} data-swms-tick aria-label="I have read the safety plan" /><span>{T.tick(d.signer.name, SWMS_SIGN_STATEMENT)}</span></label>
          <input className={inputCls} placeholder={T.namePlaceholder} aria-label="Your full name" autoComplete="name" value={typed} onChange={(e) => setTyped(e.target.value)} data-swms-name />
          <button type="button" className={signBtn} disabled={busy || !!blocker} data-swms-sign-btn
            onClick={async () => { setBusy(true); setErr(null); try { await signSwmsByLink({ data: { token, typedName: typed } }); await q.refetch(); } catch (e) { setErr(readableError(e, T.signFailed)); } finally { setBusy(false); } }}>{busy ? T.signing : T.sign}</button>
          {blocker && !busy && <p className="text-sm text-sub" data-swms-sign-why>{blocker}</p>}
          {err && <p role="alert" className="rounded-[14px] bg-owner-house-pink p-3 text-sm font-semibold">{err}</p>}
        </section>
      )}
    </TradePublicShell>
  );
}
