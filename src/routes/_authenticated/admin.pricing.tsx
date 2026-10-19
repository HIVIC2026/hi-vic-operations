import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/portal/AppShell";
import { Section } from "@/components/portal/panels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useAction, useMe } from "@/hooks/use-me";
import { getMargins, getOwnerPrices, setOwnerPrices } from "@/lib/owner-prices.functions";
import { setCurrentVeecPrice } from "@/lib/profit.functions";
import { PRICING_MISSING_DESC, PRICING_MISSING_TITLE, pricingLoadState } from "@/lib/uxfix-state.core";

const TITLE = "Prices & Margins – Home Insulation Victoria Portal";
const DESC = "Office-only owner prices, VEEC prices and each trade's margin at current prices.";
export const Route = createFileRoute("/_authenticated/admin/pricing")({
  head: () => ({ meta: [{ title: TITLE }, { name: "description", content: DESC }, { property: "og:title", content: TITLE }, { property: "og:description", content: DESC }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: PricingPage,
});

const money = (n: number | null) => (n == null ? "—" : `$${n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

function PricingPage() {
  const me = useMe();
  if (me.isLoading) return <AppShell><p className="text-sm text-muted-foreground">Loading…</p></AppShell>;
  if (!me.data?.roles.includes("admin")) return <AppShell><h1 className="text-2xl font-bold">Not available</h1><p className="text-sm text-muted-foreground">This page is for office staff only.</p></AppShell>;
  return <AppShell><h1 className="mb-1 text-2xl font-bold">Prices & margins</h1><p className="mb-4 text-sm text-muted-foreground">Office only. Price changes apply to new quotes and estimates only; quotes already issued or accepted keep their prices.</p><Prices /><Margins /></AppShell>;
}

const FIELDS = [
  ["r5", "Owner installation price per m² (inc GST)"], ["removal", "Owner removal price per m² (inc GST)"],
  ["moderate", "Moderate access loading (× installation price)"], ["difficult", "Difficult access loading (× installation price)"],
  ["piesa", "Owner PIESA price (inc GST)"], ["apFee", "Accredited Provider fee (inc GST)"], ["veecBuy", "VEEC buy price"],
] as const;
type Key = (typeof FIELDS)[number][0];

function Prices() {
  const load = useServerFn(getOwnerPrices);
  const q = useQuery({ queryKey: ["owner-prices"], queryFn: () => load() });
  const save = useAction(setOwnerPrices);
  const saveVeec = useAction(setCurrentVeecPrice);
  const [f, setF] = useState<Record<Key, string>>({ r5: "", removal: "", moderate: "", difficult: "", piesa: "", apFee: "", veecBuy: "" });
  const [reason, setReason] = useState("");
  const [sale, setSale] = useState("");
  const c = q.data?.current;
  useEffect(() => { if (c) { setF({ r5: String(c.r5), removal: String(c.removal), moderate: String(c.moderate), difficult: String(c.difficult), piesa: String(c.piesa), apFee: String(c.apFee), veecBuy: String(c.veecBuy) }); setSale(String(c.veecSale)); } }, [c]);
  const loadState = pricingLoadState({ error: q.error, isLoading: q.isLoading, hasCurrent: !!c });
  if (loadState === "error") return <p className="text-sm text-destructive">{(q.error as Error).message}</p>;
  if (loadState === "loading") return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (loadState === "missing") return (
    <div className="rounded-lg border border-dashed p-4 text-sm" data-testid="pricing-missing-config">
      <p className="font-semibold">{PRICING_MISSING_TITLE}</p>
      <p className="mt-1 text-muted-foreground">{PRICING_MISSING_DESC}</p>
    </div>
  );
  // loadState === "ready" guarantees a current price row exists; narrow for TS.
  if (!c) return null;
  const nums = Object.fromEntries(FIELDS.map(([k]) => [k, Number(f[k])])) as Record<Key, number>;
  const valid = FIELDS.every(([k]) => Number.isFinite(nums[k]) && nums[k] > 0) && nums.moderate >= 1 && nums.difficult >= 1 && reason.trim().length >= 3;
  return (
    <>
      <Section title={`Owner prices (version ${c.version})`}>
        <div className="grid gap-3 sm:grid-cols-2">
          {FIELDS.map(([k, label]) => (
            <label key={k} className="text-sm">{label}
              <Input inputMode="decimal" value={f[k]} disabled={k === "apFee" && !q.data!.canChangeApFee} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
              {k === "apFee" && !q.data!.canChangeApFee && <span className="text-xs text-muted-foreground">Only the Home Insulation Victoria owner can change this.</span>}
            </label>
          ))}
        </div>
        <label className="mt-3 block text-sm">Reason for the change (required)<Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. new installer rates agreed" /></label>
        <Button className="mt-3" disabled={!valid} onClick={async () => { await save({ ...nums, reason }, "Prices saved for new quotes"); setReason(""); await q.refetch(); }}>Save prices</Button>
      </Section>
      <Section title="Current VEEC sale price">
        <div className="flex gap-2"><Input aria-label="Current VEEC sale price" inputMode="decimal" value={sale} onChange={(e) => setSale(e.target.value)} />
          <Button disabled={!(Number(sale) > 0) || Number(sale) === c.veecSale} onClick={async () => { await saveVeec({ price: Number(sale) }, "VEEC sale price saved"); await q.refetch(); }}>Save</Button></div>
        <p className="mt-1 text-xs text-muted-foreground">Used for expected profit until a job's VEECs are actually sold.</p>
      </Section>
      <Section title="Price history">
        {q.data!.history.length === 0 ? <p className="text-sm text-muted-foreground">No changes yet.</p> : (
          <ul className="space-y-1 text-sm">{q.data!.history.map((h) => {
            const d = (h.details ?? {}) as { changes?: Record<string, number>; reason?: string; from?: number; to?: number };
            const what = d.changes ? Object.entries(d.changes).map(([k, v]) => `${k.replace(/_/g, " ")} → ${v}`).join(", ") : `VEEC sale price ${d.from ?? "—"} → ${d.to ?? "—"}`;
            return <li key={h.id} className="border-t pt-1"><span className="font-medium">{new Date(h.created_at).toLocaleString("en-AU", { timeZone: "Australia/Melbourne" })}</span> · {h.who} · {what}{d.reason ? ` · “${d.reason}”` : ""}</li>;
          })}</ul>
        )}
      </Section>
    </>
  );
}

function Margins() {
  const load = useServerFn(getMargins);
  const q = useQuery({ queryKey: ["margins"], queryFn: () => load() });
  if (q.error) return <p className="text-sm text-destructive">{(q.error as Error).message}</p>;
  if (!q.data) return null;
  return (
    <Section title="Margins at current prices (approved trades)">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1">Trade</th><th>Item</th><th className="text-right">Owner price</th><th className="text-right">Agreed rate</th><th className="text-right">Our markup</th></tr></thead>
        <tbody>
          {q.data.trades.flatMap((t) => t.lines.map((l, i) => (
            <tr key={t.id + l.item} className={i === 0 ? "border-t" : ""}>
              <td className="py-1">{i === 0 && <><span className="font-medium">{t.name}</span> <Badge variant="outline">{t.kind}</Badge></>}</td>
              <td>{l.item}</td><td className="text-right">{money(l.ownerInc)}</td>
              <td className="text-right">{l.missing ? <span className="text-muted-foreground">No agreed rate</span> : money(l.rateInc)}</td>
              <td className="text-right">{l.negative ? <Badge variant="destructive">{money(l.markupInc)} – rate above owner price</Badge> : money(l.markupInc)}</td>
            </tr>
          )))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-muted-foreground">All amounts inc GST. Installer markup applies on Home Insulation Victoria jobs only; installer-supplied jobs have none. Never shown to owners or trades.</p>
    </Section>
  );
}
