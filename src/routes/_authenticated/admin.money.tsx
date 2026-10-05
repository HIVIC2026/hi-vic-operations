import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/portal/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getMoneyOverview, markPayoutPaid } from "@/lib/office.functions";
import { aud, fmtDate } from "@/lib/workflow";

export const Route = createFileRoute("/_authenticated/admin/money")({
  head: () => ({ meta: [{ title: "Money – Home Insulation Victoria" }, { name: "description", content: "Margin, VEECs, what owners owe and what we owe trades." }, { property: "og:title", content: "Money – Home Insulation Victoria" }, { property: "og:description", content: "Margin, VEECs, what owners owe and what we owe trades." }] }),
  validateSearch: (s: Record<string, unknown>): { tab?: "payouts" } => (s["tab"] === "payouts" ? { tab: "payouts" } : {}),
  component: Money,
});

function MarkPaid({ jobId }: { jobId: string }) {
  const [ref, setRef] = useState("");
  const [open, setOpen] = useState(false);
  const fn = useServerFn(markPayoutPaid);
  const qc = useQueryClient();
  if (!open) return <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Mark paid</Button>;
  return <div className="flex gap-1"><Input aria-label="Payment reference" className="h-9 w-36" placeholder="Bank reference" value={ref} onChange={(e) => setRef(e.target.value)} /><Button size="sm" disabled={ref.trim().length < 2} onClick={async () => { try { await fn({ data: { jobId, reference: ref } }); toast.success("Marked paid"); void qc.invalidateQueries({ queryKey: ["money"] }); } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't save"); } }}>Save</Button></div>;
}

function Money() {
  const { tab } = Route.useSearch();
  const load = useServerFn(getMoneyOverview);
  const { data, error } = useQuery({ queryKey: ["money"], queryFn: () => load() });
  if (error) return <AppShell wide><div role="alert" className="rounded-[22px] border border-danger/40 bg-danger-soft p-4 text-sm text-danger">Money figures couldn't load: {(error as Error).message}</div></AppShell>;
  if (!data) return <AppShell wide><p className="text-muted-foreground">Loading…</p></AppShell>;
  const tile = "rounded-[22px] border bg-card p-5 shadow-sm";
  return (
    <AppShell wide>
      <h1 className="mb-4 font-display text-3xl font-extrabold">{tab === "payouts" ? "Payouts" : "Money"}</h1>
      {tab !== "payouts" && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className={tile}><p className="text-xs font-bold text-muted-foreground">Our margin this month</p><p className="mt-1 font-display text-2xl font-extrabold">{data.margin != null ? aud(data.margin) : "—"}</p>{data.marginError && <p className="text-xs text-danger">Couldn't read margins</p>}</div>
          <div className={tile}><p className="text-xs font-bold text-muted-foreground">VEECs lodged this month</p><p className="mt-1 font-display text-2xl font-extrabold">{data.lodged}</p></div>
          <div className={tile}><p className="text-xs font-bold text-muted-foreground">Owners owe us (Xero)</p><p className="mt-1 font-display text-2xl font-extrabold">{aud(data.owed)}</p></div>
          <div className={tile}><p className="text-xs font-bold text-muted-foreground">We owe trades</p><p className="mt-1 font-display text-2xl font-extrabold">{data.weOwe} job{data.weOwe === 1 ? "" : "s"}</p></div>
        </div>
      )}
      <h2 className="mb-2 font-display text-lg font-extrabold">Payouts</h2>
      <p className="mb-3 text-sm text-muted-foreground">Due within 7 days of AP approval (installer-supplied jobs also need the owner paid in full). Payouts never wait for VEEC registration. No money moves automatically — mark each one paid.</p>
      {data.payouts.length === 0 ? <p className="rounded-[22px] border bg-card p-5 text-sm text-muted-foreground">No payouts yet.</p> : (
        <div className="overflow-x-auto rounded-[22px] border bg-card shadow-sm">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b text-left text-xs text-muted-foreground"><tr><th className="p-3">Job</th><th className="p-3">Owner</th><th className="p-3">Rule</th><th className="p-3">Due</th><th className="p-3">Status</th></tr></thead>
            <tbody>{data.payouts.map((p) => (
              <tr key={p.jobId} className="border-b last:border-0">
                <td className="p-3 font-semibold"><Link to="/admin/jobs/$jobId" params={{ jobId: p.jobId }} className="text-primary underline">{p.jobNumber}</Link></td>
                <td className="p-3">{p.owner ?? "—"}{p.suburb ? ` · ${p.suburb}` : ""}</td><td className="p-3">{p.route}</td>
                <td className="p-3">{p.dueAt ? fmtDate(p.dueAt) : "—"}</td>
                <td className="p-3">{p.paidAt ? <span className="font-semibold text-success">Paid {fmtDate(p.paidAt)}</span> : <MarkPaid jobId={p.jobId} />}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
