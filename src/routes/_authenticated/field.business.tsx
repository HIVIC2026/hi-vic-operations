import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { TradeShell, card } from "@/components/trade/TradeShell";
import { getTradeBusiness, setTradeTaking } from "@/lib/trade-view.functions";
import { expiryPill } from "@/lib/trade-view.core";

export const Route = createFileRoute("/_authenticated/field/business")({
  head: () => ({ meta: [{ title: "My business – Home Insulation Victoria" }, { name: "description", content: "Your paperwork, work area and team." }, { property: "og:title", content: "My business – Home Insulation Victoria" }, { property: "og:description", content: "Your paperwork, work area and team." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" }] }),
  component: Business,
});

function Business() {
  const load = useServerFn(getTradeBusiness);
  const setTaking = useServerFn(setTradeTaking);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data, error, refetch } = useQuery({ queryKey: ["trade-business"], queryFn: () => load() });
  const [busy, setBusy] = useState(false);
  if (error) return <TradeShell installer={false}><p role="alert" className={card}>{(error as Error).message}</p></TradeShell>;
  if (!data) return <TradeShell installer={false}><p className="text-sm">Loading…</p></TradeShell>;
  const installer = data.kind === "installer";
  const lic = expiryPill(data.licenceExpires), liab = expiryPill(data.liabilityExpires);
  const alert = [!installer && lic.days != null && lic.days <= 30 ? { doc: "Your electrical licence", d: lic.days } : null, liab.days != null && liab.days <= 30 ? { doc: "Your public liability", d: liab.days } : null].filter(Boolean)[0] as { doc: string; d: number } | undefined;
  const pill = (label: string, warn: boolean) => <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${warn ? "bg-owner-house-pink" : "bg-estimate-green-soft text-estimate-green"}`}>{label}</span>;
  const signOut = async () => { await qc.cancelQueries(); qc.clear(); await supabase.auth.signOut(); navigate({ to: "/auth", replace: true }); };
  return (
    <TradeShell installer={installer} boss={data.boss}>
      <div><h1 className="font-display text-3xl font-extrabold">My business</h1><p className="text-sm">{data.name}</p></div>
      <section className={`${card} flex items-center justify-between gap-3`}>
        <span><span className="block font-bold">Taking new jobs</span><span className="block text-sm text-estimate-navy/70">{data.taking ? "On. Fresh jobs come straight to you." : "Paused, no new offers until you switch back on"}</span></span>
        <button type="button" role="switch" aria-checked={data.taking} aria-label="Taking new jobs" disabled={busy || !data.boss} onClick={async () => { setBusy(true); try { await setTaking({ data: { taking: !data.taking } }); await refetch(); } finally { setBusy(false); } }} className={`relative h-8 w-14 shrink-0 rounded-full ${data.taking ? "bg-estimate-green" : "bg-estimate-line"}`}><span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${data.taking ? "left-7" : "left-1"}`} /></button>
      </section>
      {alert && <section className="rounded-[22px] bg-owner-house-pink p-5"><p className="font-bold">{alert.doc} runs out in {alert.d} days. Snap the new certificate so jobs keep coming</p><Link to="/partner/profile" className="mt-3 flex h-12 w-full items-center justify-center rounded-full bg-estimate-navy font-bold text-estimate-canvas">Upload</Link></section>}
      <section>
        <h2 className="mb-2 font-display text-lg font-extrabold">Paperwork</h2>
        <ul className="divide-y divide-estimate-line overflow-hidden rounded-[22px] bg-card shadow-sm">
          {!installer && <li className="flex items-center justify-between p-4"><span className="font-bold">Electrical licence</span>{pill(lic.label, lic.warn)}</li>}
          <li className="flex items-center justify-between p-4"><span className="font-bold">Public liability</span>{pill(liab.label, liab.warn)}</li>
          <li className="flex items-center justify-between p-4"><span className="font-bold">Your rates</span>{pill(installer || data.rate != null ? "Set" : "To confirm", !installer && data.rate == null)}</li>
          <li className="flex items-center justify-between p-4"><span className="font-bold">Agreement</span>{pill(data.agreementSigned ? "Signed" : "To sign", !data.agreementSigned)}</li>
        </ul>
      </section>
      <section className={card}><h2 className="font-display text-lg font-extrabold">Where you work</h2><p className="mt-1 text-sm">{data.area}</p><p className="mt-1 text-xs text-estimate-navy/70">This sets which fresh jobs you get. Ask us to change it.</p></section>
      <section>
        <h2 className="mb-2 font-display text-lg font-extrabold">The team</h2>
        <ul className="divide-y divide-estimate-line overflow-hidden rounded-[22px] bg-card shadow-sm">{data.team.map((t, i) => <li key={t.name + i} className="flex items-center justify-between p-4"><span className="font-bold">{t.name}</span><span className="text-sm text-estimate-navy/70">{t.role}</span></li>)}</ul>
        {data.boss && <Link to="/partner/workers" className="mt-2 block text-center text-sm font-bold text-estimate-blue">+ Add someone</Link>}
      </section>
      <p className="pt-2 text-center text-sm font-bold text-estimate-blue"><Link to="/partner/profile">Bank details</Link> · <Link to="/partner/profile">Your agreement</Link> · <button type="button" onClick={() => void signOut()}>Sign out</button></p>
    </TradeShell>
  );
}
