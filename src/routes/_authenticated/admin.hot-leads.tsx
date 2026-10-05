import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AppShell } from "@/components/portal/AppShell";
import { Button } from "@/components/ui/button";
import { getHotLeads } from "@/lib/hot-leads.functions";
import { HOT_SUBJECT } from "@/lib/hot-leads.core";
import logo from "@/assets/home-insulation-victoria-logo.png.asset.json";

const title = "Hot leads – Home Insulation Victoria Operations";
const description = "Office-only preliminary quotes and trade coverage for eligible website leads.";
export const Route = createFileRoute("/_authenticated/admin/hot-leads")({
  head: () => ({ meta: [{ title }, { name: "description", content: description }, { property: "og:title", content: title }, { property: "og:description", content: description }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: HotLeadsPage,
});

const money = (n: number | null) => n === null ? "—" : new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(n);
type Row = Awaited<ReturnType<typeof getHotLeads>>["covered"][number];

function HotLeadsPage() {
  const load = useServerFn(getHotLeads);
  const { data, isPending, error } = useQuery({ queryKey: ["hot-leads-draft"], queryFn: () => load() });
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((x) => x !== id) : [...current, id]);
  const samples = data?.covered.slice(0, 3) ?? [];
  const lead = samples.find((r) => r.id === preview);
  const list = (rows: Row[], label: string) => <section className="mt-8"><h2 className="font-display text-xl font-bold">{label} ({rows.length})</h2><div className="mt-3 overflow-x-auto border bg-card"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-muted"><tr><th className="p-3">Select</th><th className="p-3">Name and area</th><th className="p-3">Region</th><th className="p-3">Coverage</th><th className="p-3">Preliminary price</th></tr></thead><tbody className="divide-y">{rows.map((r) => <tr key={r.id}><td className="p-3"><input type="checkbox" aria-label={`Select ${r.name}`} checked={selected.includes(r.id)} onChange={() => toggle(r.id)} /></td><td className="p-3"><Link to="/admin/jobs/$jobId" params={{ jobId: r.id }} className="font-semibold text-primary underline">{r.name}</Link><div className="text-muted-foreground">{r.suburb || "Suburb unknown"} {r.postcode} · {r.area} m² {r.checkCoverage ? "· Check coverage" : ""}</div></td><td className="p-3">{r.region}</td><td className="p-3"><div>Installer: {r.installers.join(", ") || "—"}</div><div>Electrician: {r.electricians.join(", ") || "—"}</div></td><td className="p-3 font-semibold">{money(r.price)}</td></tr>)}</tbody></table></div></section>;
  return <AppShell wide><div className="space-y-3"><h1 className="font-display text-2xl font-bold">Hot leads</h1><p className="text-sm text-muted-foreground">Draft preliminary quotes. No emails are sent or queued. Coverage is indicative from enquiries and applications, not a confirmed booking.</p>
    {isPending ? <p role="status">Loading current leads…</p> : error ? <p role="alert" className="text-destructive">Could not prepare quotes: {(error as Error).message}</p> : data && <>
      <div className="flex flex-wrap gap-4 text-sm"><strong>{data.covered.length} covered</strong><span>{data.duplicates} duplicate records hidden</span><span>Current customer install price: {money(data.settings.installationRate)}/m²</span></div>
      <div className="flex flex-wrap gap-2">{data.counts.map((c) => <span key={c.region} className="border px-2 py-1 text-sm">{c.region} {c.count}</span>)}</div>
      <Button disabled>Send to {selected.length} selected</Button><p className="text-xs text-muted-foreground">Sending remains off until Jo approves the words and explicitly turns it on.</p>
      {list(data.covered, "Covered leads")}
      {list(data.noElectrician, "No electrician yet")}
      <div className="text-sm">{data.gapCounts.map((c) => <p key={c.region}>{c.region}: {c.count}</p>)}</div>
      {!!data.otherGaps.length && list(data.otherGaps, "Other coverage or price gaps")}
      <section className="mt-8"><h2 className="font-display text-xl font-bold">Email preview</h2><p className="text-sm text-muted-foreground">Three sample leads; links are disabled in this draft.</p><div className="mt-3 flex gap-2">{samples.map((r, i) => <Button key={r.id} variant={preview === r.id ? "default" : "outline"} onClick={() => setPreview(r.id)}>Sample {i + 1}</Button>)}</div>
        {lead && <div data-email-preview className="estimate-brand mt-4 max-w-[640px] bg-background p-3 sm:p-6"><div className="border bg-card p-5 sm:p-9"><img src={logo.url} alt="Home Insulation Victoria" className="mb-7 h-16 w-auto" /><p className="text-xs text-muted-foreground">Subject: {HOT_SUBJECT}</p><h3 className="mt-5 font-display text-2xl font-extrabold">Your ceiling insulation quote</h3><p className="mt-3">Hi {lead.name?.split(" ")[0]},</p><p className="mt-3">Your estimated price is <strong>{money(lead.price)} including GST</strong>, after an estimated <strong>{money(lead.discount)} VEU discount</strong>.</p><p className="mt-3">This includes R5.0 insulation supply and installation for your estimated {lead.area} m², the electrical safety assessment and Accredited Person management.</p><p className="mt-3 font-semibold">Preliminary — final price confirmed after your free Ready Check.</p><p className="mt-3">Installer spots in your area are limited.</p><Button disabled className="mt-6 w-full bg-estimate-green text-primary-foreground">SAVE MY SPOT</Button><p className="mt-5 text-center text-sm text-muted-foreground">Take me off the list (preview only)</p></div></div>}
      </section>
    </>}
  </div></AppShell>;
}