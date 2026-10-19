import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AppShell } from "@/components/portal/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useAction, useMe } from "@/hooks/use-me";
import { useReasonDialog } from "@/components/portal/reason-dialog";
import { activateElectricianRate, createElectricianRate, discardElectricianRate, expireElectricianRate, listElectricianRates } from "@/lib/electrician-rates.functions";
import { ELECTRICIAN_RATE_SERVICES, officeSpread, type ElectricianRateService } from "@/lib/allocation.core";
import { melbourneToday } from "@/lib/melbourne-time.core";

const TITLE = "Electrician Rates – Home Insulation Victoria Portal";
const DESC = "Office-only agreed electrician rates used for PIESA and rectification offers.";
export const Route = createFileRoute("/_authenticated/admin/electrician-rates")({
  head: () => ({ meta: [{ title: TITLE }, { name: "description", content: DESC }, { property: "og:title", content: TITLE }, { property: "og:description", content: DESC }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: RatesPage,
});

type Rate = { id: string; business_id: string; service_type: ElectricianRateService; rate_inc_gst: string | number; status: string; effective_from: string; effective_to: string | null; approved_at: string | null; source_note: string };

function RatesPage() {
  const me = useMe();
  if (me.isLoading) return <AppShell><p className="text-sm text-muted-foreground">Loading…</p></AppShell>;
  if (!me.data?.roles.includes("admin")) return <AppShell><h1 className="text-2xl font-bold">Not available</h1><p className="text-sm text-muted-foreground">This page is for office staff only.</p></AppShell>;
  return <RatesOffice />;
}

function RatesOffice() {
  const load = useServerFn(listElectricianRates);
  const q = useQuery({ queryKey: ["electrician-rates"], queryFn: () => load() });
  const create = useAction(createElectricianRate);
  const activate = useAction(activateElectricianRate);
  const expire = useAction(expireElectricianRate);
  const discard = useAction(discardElectricianRate);
  const reason = useReasonDialog();
  const [showDiscarded, setShowDiscarded] = useState(false);
  const today = melbourneToday();
  const [f, setF] = useState({ businessId: "", serviceType: "piesa" as ElectricianRateService, rate: "", from: today, to: "", note: "" });
  const d = q.data;
  const allRates = (d?.rates ?? []) as Rate[];
  const rates = showDiscarded ? allRates : allRates.filter((r) => r.status !== "discarded");
  const discardedCount = allRates.length - allRates.filter((r) => r.status !== "discarded").length;
  const name = (id: string) => d?.businesses.find((b) => b.id === id)?.name ?? "Unknown business";
  const valid = f.businessId && f.rate !== "" && Number(f.rate) >= 0 && f.note.trim().length >= 3;
  return (
    <AppShell wide>
      <h1 className="text-2xl font-bold">Electrician rates</h1>
      <p className="mb-4 text-sm text-muted-foreground">Office only. Offers use the electrician's current active rate and keep a copy of it. Electricians see only their own agreed rate — never the customer price or spread. All amounts include GST.</p>
      {d && !d.available && <div role="alert" className="mb-4 rounded-md border border-warning bg-warning-soft p-3 text-sm">The rate card is not switched on yet. It needs the pending database change approved first; until then every electrician is skipped as "rate missing".</div>}
      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        <div className="space-y-2 rounded-xl border bg-card p-4 text-sm">
          <div className="font-semibold">New rate (starts as draft)</div>
          <select aria-label="Electrician business" className="h-10 w-full rounded border bg-background px-2" value={f.businessId} onChange={(e) => setF({ ...f, businessId: e.target.value })}>
            <option value="">Choose electrician / REC…</option>
            {d?.businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select aria-label="Service" className="h-10 w-full rounded border bg-background px-2" value={f.serviceType} onChange={(e) => setF({ ...f, serviceType: e.target.value as ElectricianRateService })}>
            {Object.entries(ELECTRICIAN_RATE_SERVICES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <label className="block">Rate including GST ($)<Input type="number" min={0} step="0.01" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} /></label>
          <label className="block">Effective from<Input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
          <label className="block">Effective to (optional)<Input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
          <label className="block">Source / note<Input placeholder="e.g. REC agreement 2.4, office-approved" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
          <Button disabled={!valid} onClick={async () => { const r = await create({ businessId: f.businessId, serviceType: f.serviceType, rateIncGst: Number(f.rate), effectiveFrom: f.from, effectiveTo: f.to || null, sourceNote: f.note }, "Draft rate saved"); if (r) setF({ ...f, rate: "", note: "" }); }}>Save draft</Button>
        </div>
        <div>
        <label className="mb-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={showDiscarded} onChange={(e) => setShowDiscarded(e.target.checked)} />Show discarded drafts ({discardedCount})</label>
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground"><tr><th className="p-2">Electrician</th><th className="p-2">Service</th><th className="p-2">Rate</th><th className="p-2">Effective</th><th className="p-2">Status</th><th className="p-2">Office spread (PIESA)</th><th className="p-2" /></tr></thead>
            <tbody>
              {rates.length === 0 && <tr><td colSpan={7} className="p-4 text-muted-foreground">No rates recorded yet.</td></tr>}
              {rates.map((r) => {
                const discarded = r.status === "discarded";
                return (
                <tr key={r.id} className={`border-t align-top${discarded ? " bg-muted/40 text-muted-foreground" : ""}`}>
                  <td className="p-2 font-medium">{name(r.business_id)}<div className="text-xs text-muted-foreground">{r.source_note}</div></td>
                  <td className="p-2">{ELECTRICIAN_RATE_SERVICES[r.service_type] ?? r.service_type}</td>
                  <td className={`p-2${discarded ? " line-through" : ""}`}>${Number(r.rate_inc_gst).toFixed(2)}</td>
                  <td className="p-2 text-xs">{r.effective_from}{r.effective_to ? ` → ${r.effective_to}` : " → open"}</td>
                  <td className="p-2"><Badge variant={discarded ? "secondary" : "outline"} className="capitalize">{discarded ? "Discarded draft" : r.status}</Badge></td>
                  <td className="p-2 text-xs">{discarded ? "Discarded draft - not used for offers." : r.service_type === "piesa" ? officeSpread(d!.customerPiesaIncGst, Number(r.rate_inc_gst)).text : "—"}</td>
                  <td className="p-2 whitespace-nowrap">
                    {r.status === "draft" && <Button size="sm" onClick={() => { if (window.confirm("Activate this rate? Any current active rate for the same service is superseded.")) void activate({ id: r.id }, "Rate active"); }}>Approve & activate</Button>}
                    {r.status === "draft" && <Button size="sm" variant="outline" className="ml-2" onClick={async () => { const r2 = await reason.ask({ title: "Discard draft", description: "A short reason is required and audited.", placeholder: "Reason for discarding this draft?", minLength: 3 }); if (r2) void discard({ id: r.id, reason: r2 }, "Draft discarded"); }}>Discard draft</Button>}
                    {r.status === "active" && <Button size="sm" variant="outline" onClick={async () => { const r2 = await reason.ask({ title: "Expire rate", description: "A short reason is required and audited.", placeholder: "Reason for expiring this rate?", minLength: 3 }); if (r2) void expire({ id: r.id, reason: r2 }, "Rate expired"); }}>Expire</Button>}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </div>
      </div>
      {reason.dialog}
    </AppShell>
  );
}
