import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { INSTALLER_BULK_UPLOAD_ENABLED } from "@/lib/bulk-upload-switch.core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ChevronRight } from "lucide-react";
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
  const pill = (label: string, warn: boolean) => <span className={`rounded-[18px] px-2.5 py-0.5 text-[11px] font-semibold ${warn ? "bg-owner-house-pink" : "bg-estimate-green-soft text-estimate-green"}`}>{label}</span>;
  const signOut = async () => { await qc.cancelQueries(); qc.clear(); await supabase.auth.signOut(); navigate({ to: "/auth", replace: true }); };
  return (
    <TradeShell installer={installer} boss={data.boss}>
      <div className="flex items-start justify-between gap-3"><div><h1 className="font-display text-[26px] font-bold leading-tight">My business</h1><p className="text-sm text-sub">{data.name}</p></div><span className="mt-2 shrink-0 rounded-[18px] bg-estimate-green-soft px-2.5 py-0.5 text-[11px] font-semibold text-estimate-green">Approved partner</span></div>
      <section className={`${card} flex items-center justify-between gap-3`}>
        <span><span className="block font-bold">Taking new jobs</span><span className="block text-sm text-sub">{data.taking ? "On. New job offers come straight to you." : "Paused, no new offers until you switch back on"}</span></span>
        <button type="button" role="switch" aria-checked={data.taking} aria-label="Taking new jobs" disabled={busy || !data.boss} onClick={async () => { setBusy(true); try { await setTaking({ data: { taking: !data.taking } }); await refetch(); } finally { setBusy(false); } }} className={`relative h-8 w-14 shrink-0 rounded-full ${data.taking ? "bg-estimate-green" : "bg-estimate-line"}`}><span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${data.taking ? "left-7" : "left-1"}`} /></button>
      </section>
      {data.boss && <section className={`${card} space-y-3`} data-boss-actions>
        <h2 className="font-bold">Grow your business</h2>
        <Link to="/partner/workers" className="flex h-12 w-full items-center justify-center rounded-[10px] bg-action px-4 text-[13px] font-bold text-action-foreground">Add team members</Link>
        {installer && INSTALLER_BULK_UPLOAD_ENABLED && <Link to="/partner/bulk-import" className="flex h-12 w-full items-center justify-center rounded-[10px] border-2 border-estimate-blue px-4 text-[13px] font-bold text-estimate-blue">Upload multiple jobs</Link>}
      </section>}
      {alert && <section className="rounded-[18px] bg-owner-house-pink p-5"><p className="font-bold">{alert.doc} runs out in {alert.d} days. Upload the renewed certificate to keep receiving job offers</p><Link to="/field/business/insurance" className="mt-3 flex h-12 w-full items-center justify-center rounded-[10px] bg-estimate-navy font-bold text-estimate-canvas">Upload</Link></section>}
      <section>
        <h2 className="sr-only">Your business file</h2>
        <ul className="divide-y divide-line overflow-hidden rounded-[18px] border border-line bg-paper shadow-card">
          {([
            ["/field/business/details", "Business details", data.area],
            ["/field/business/rates", "Your rates", installer || data.rate != null ? "Agreed" : "To confirm"],
            ["/field/business/bank", "Bank details", data.bankSaved ? "Saved" : "Add where we pay you"],
            ["/field/business/insurance", "Insurance & licences", "Current documents and expiry dates", !installer ? lic : liab],
            ["/field/business/agreement", "Your agreement", data.agreementSigned ? "Signed" : "To sign"],
            ["/field/business/team", "Team", `${data.team.length} ${data.team.length === 1 ? "person" : "people"}`],
          ] as [string, string, string | null, ReturnType<typeof expiryPill>?][]).map(([to, label, sub, p]) => (
            <li key={to}><Link to={to as never} className="flex min-h-14 items-center justify-between gap-3 p-4"><span><span className="block font-bold">{label}</span>{sub && <span className="block text-sm text-sub">{sub}</span>}</span><span className="flex items-center gap-2">{p && pill(p.label, p.warn)}<ChevronRight className="h-5 w-5 text-estimate-navy/50" /></span></Link></li>
          ))}
        </ul>
      </section>
      <p className="pt-2 text-center text-sm font-bold text-estimate-blue"><button type="button" onClick={() => void signOut()}>Sign out</button></p>
    </TradeShell>
  );
}
