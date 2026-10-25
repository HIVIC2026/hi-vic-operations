// Decision 364: one crew member's own safety plan (SWMS) link from the install texts. Shows the plan and signs ONLY that
// person's line (tick + typed full name). Logic in swms-link.server.ts; wording from swms.core.ts.
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { TradePublicShell, card, greenBtn, inputCls } from "@/components/trade/TradeShell";
import { getSwmsLinkView, signSwmsByLink } from "@/lib/swms-link.functions";
import { SWMS_HOW_IN_PLACE, SWMS_SIGN_STATEMENT, swmsDate, swmsDateTime } from "@/lib/swms.core";

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

function SafetyPlanLink() {
  const { token } = Route.useParams();
  const q = useQuery({ queryKey: ["swms-link", token], queryFn: () => getSwmsLinkView({ data: { token } }), retry: false });
  const [ok, setOk] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const d = q.data;
  if (q.error) return <TradePublicShell><section className="rounded-[18px] border border-rose bg-pink p-5 text-ink" data-swms-link-invalid><h1 className="font-display text-2xl font-bold">This safety plan link is unavailable.</h1><p className="mt-1 text-sm">{(q.error as Error).message}</p></section></TradePublicShell>;
  if (!d) return <TradePublicShell><p className="text-sm text-sub">Loading your safety plan…</p></TradePublicShell>;
  return (
    <TradePublicShell>
      <div>
        <p className="text-sm text-sub">Hi {d.signer.name}{d.businessName ? ` · ${d.businessName}` : ""}</p>
        <h1 className="font-display text-[26px] font-bold leading-tight">Safety plan — {d.address ?? d.jobNumber}</h1>
        <p className="text-xs font-bold text-sub">{d.jobNumber} · Install {swmsDate(d.installDate)} · Your own link — only you can sign with it</p>
      </div>
      <section className={`${card} space-y-3 text-sm`} data-swms-link-plan>
        <div><p className="font-medium">High-risk work on this job</p><ul className="list-disc pl-5">{d.highRiskWork.map((h) => <li key={h}>{h}</li>)}</ul></div>
        <div><p className="font-medium">Hazards and the controls you use</p><ul className="space-y-1.5">{d.hazards.map((h) => <li key={h.name}><span className="font-medium">{h.name}:</span> {h.control}.</li>)}</ul><p className="mt-2">{SWMS_HOW_IN_PLACE}</p></div>
        <div><p className="font-medium">Specific to this house</p><p>{d.siteNote ?? "None recorded"}</p></div>
      </section>
      {d.signedAt ? (
        <section className="rounded-[18px] border border-line bg-mint p-5 text-ink" data-swms-link-signed><p className="font-display text-2xl font-bold">You've signed the safety plan.</p><p className="mt-1">Signed {swmsDateTime(d.signedAt)} (Melbourne time).</p></section>
      ) : !d.open ? (
        <section className={card}><p>The installation is recorded; the safety plan can't be signed now.</p></section>
      ) : (
        <section className={`${card} space-y-3`} data-swms-link-sign>
          <h2 className="font-display text-xl font-bold">Sign: {SWMS_SIGN_STATEMENT}</h2>
          <label className="flex items-start gap-3"><input type="checkbox" className="mt-1 h-5 w-5" checked={ok} onChange={(e) => setOk(e.target.checked)} aria-label="I have read the safety plan" /><span>I am {d.signer.name}. {SWMS_SIGN_STATEMENT}.</span></label>
          <input className={inputCls} placeholder={`Type ${d.signer.name}'s full name to sign`} aria-label="Your full name" value={typed} onChange={(e) => setTyped(e.target.value)} />
          <button type="button" className={greenBtn} disabled={busy || !ok || typed.trim().length < 2}
            onClick={async () => { setBusy(true); setErr(null); try { await signSwmsByLink({ data: { token, typedName: typed } }); await q.refetch(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } }}>Sign the safety plan</button>
          {err && <p role="alert" className="rounded-[18px] bg-owner-house-pink p-4 font-semibold">{err}</p>}
        </section>
      )}
    </TradePublicShell>
  );
}
