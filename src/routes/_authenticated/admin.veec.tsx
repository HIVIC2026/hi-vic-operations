import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AppShell } from "@/components/portal/AppShell";
import { Pill } from "@/components/portal/badges";
import { getVeecRegister, type VeecRow } from "@/lib/veec-register.functions";

export const Route = createFileRoute("/_authenticated/admin/veec")({
  head: () => ({ meta: [{ title: "VEEC Calculator – HI VIC Portal" }, { name: "description", content: "Outstanding, potential and lodged VEECs with payment status." }, { property: "og:title", content: "VEEC Calculator – HI VIC Portal" }, { property: "og:description", content: "Outstanding, potential and lodged VEECs with payment status." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: VeecPage,
});

const BUCKETS = [
  ["outstanding", "Outstanding", "Quote accepted – VEECs to lodge once the job is complete"],
  ["potential", "Potential if job proceeds", "Enquiries and quotes not yet accepted"],
  ["lodged", "Lodged / complete", "Submitted to the registry or job complete"],
] as const;
const PAID = { paid: ["good", "Paid"], part_paid: ["warn", "Part paid"], unpaid: ["bad", "Unpaid"], no_invoice: ["neutral", "No invoice yet"] } as const;
const n = (v: number) => v.toLocaleString("en-AU", { maximumFractionDigits: 2 });
const money = (v: number) => `$${v.toLocaleString("en-AU", { maximumFractionDigits: 0 })}`;

function VeecPage() {
  const load = useServerFn(getVeecRegister);
  const { data = [], isPending, error } = useQuery({ queryKey: ["veec-register"], queryFn: () => load() });
  const [bucket, setBucket] = useState<VeecRow["bucket"]>("outstanding");
  const [paid, setPaid] = useState<"all" | VeecRow["paid"]>("all");
  const sum = (rows: VeecRow[]) => rows.reduce((t, r) => t + (r.veecs ?? 0), 0);
  const sumD = (rows: VeecRow[]) => rows.reduce((t, r) => t + (r.discount ?? 0), 0);
  const rows = data.filter((r) => r.bucket === bucket && (paid === "all" || r.paid === paid));
  return <AppShell wide>
    <p className="text-xs font-bold uppercase text-primary">Certificates</p>
    <h1 className="mt-1 text-4xl font-bold">VEEC CALCULATOR</h1>
    <p className="mt-2 max-w-3xl text-sm text-muted-foreground">VEEC numbers are estimates (VEU discount ÷ VEEC value) until a lodged quantity is recorded. Read-only – nothing is lodged or sent from here.</p>
    {error && <p role="alert" className="mt-4 rounded-md border border-danger bg-danger-soft p-3 text-sm font-semibold text-danger">The VEEC register could not be loaded.</p>}
    <section className="mt-6 grid gap-3 md:grid-cols-3">{BUCKETS.map(([key, label, hint]) => {
      const b = data.filter((r) => r.bucket === key);
      const paidVeecs = sum(b.filter((r) => r.paid === "paid"));
      return <button key={key} type="button" onClick={() => setBucket(key)} className={`rounded-md border p-4 text-left transition hover:border-primary ${bucket === key ? "border-workspace-blush-strong bg-workspace-blush shadow-sm" : "bg-card"}`}>
        <div className="text-xs font-bold uppercase text-muted-foreground">{label}</div>
        <div className="mt-1 text-3xl font-bold">{n(sum(b))} <span className="text-base font-semibold">VEECs</span></div>
        <div className="mt-1 text-sm">{b.length} jobs · {money(sumD(b))} discount</div>
        <div className="mt-2 text-xs"><b>Paid:</b> {n(paidVeecs)} · <b>Unpaid:</b> {n(sum(b) - paidVeecs)}</div>
        <p className="mt-2 text-xs text-muted-foreground">{hint}</p>
      </button>;
    })}</section>
    <div className="mt-5 flex flex-wrap gap-2">{(["all", "paid", "part_paid", "unpaid", "no_invoice"] as const).map((p) => <button key={p} type="button" onClick={() => setPaid(p)} className={`rounded-full border px-3 py-1 text-xs font-bold ${paid === p ? "border-primary bg-primary text-primary-foreground" : "bg-card"}`}>{p === "all" ? "All" : PAID[p][1]}</button>)}</div>
    <div className="mt-4 overflow-x-auto rounded-md border bg-card">
      <table className="w-full text-sm"><thead className="bg-muted text-left text-xs uppercase"><tr><th className="p-3">Job</th><th className="p-3">Property</th><th className="p-3">Owner</th><th className="p-3 text-right">VEECs</th><th className="p-3 text-right">Discount</th><th className="p-3">Based on</th><th className="p-3">Payment</th></tr></thead>
        <tbody>{isPending ? <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Loading…</td></tr> : rows.length === 0 ? <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No jobs in this view.</td></tr> : rows.map((r) => <tr key={r.jobId} className="border-t">
          <td className="p-3 font-bold"><Link to="/admin/jobs/$jobId" params={{ jobId: r.jobId }} className="text-primary underline">{r.jobNumber ?? "—"}</Link></td>
          <td className="p-3">{r.address ?? "—"}</td><td className="p-3">{r.owner ?? "—"}</td>
          <td className="p-3 text-right font-bold">{r.veecs != null ? n(r.veecs) : "—"}</td>
          <td className="p-3 text-right">{r.discount != null ? money(r.discount) : "—"}</td>
          <td className="p-3 text-xs">{r.basis}</td>
          <td className="p-3"><Pill t={PAID[r.paid][0]}>{PAID[r.paid][1]}</Pill></td>
        </tr>)}</tbody></table>
    </div>
  </AppShell>;
}
