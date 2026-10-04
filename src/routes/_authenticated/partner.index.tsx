import { createFileRoute, Link } from "@tanstack/react-router";
import { nextStep } from "@/lib/nextstep.core";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AppShell } from "@/components/portal/AppShell";
import { StageBadge } from "@/components/portal/badges";
import { SlaPill } from "@/components/portal/partner";
import { useAction } from "@/hooks/use-me";
import { electricalStatusLabel } from "@/lib/allocation.core";
import { partnerDashboard, respondToOffer } from "@/lib/pilot.functions";
import { BUCKET_LABEL, PARTNER_BUCKETS } from "@/lib/pilot.core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/partner/")({
  head: () => ({ meta: [{ title: "Partner Dashboard – Home Insulation Victoria Portal" }, { name: "description", content: "Opportunities, active jobs and actions for Home Insulation Victoria installation partners." }, { property: "og:title", content: "Partner Dashboard – Home Insulation Victoria Portal" }, { property: "og:description", content: "Opportunities, active jobs and actions for Home Insulation Victoria installation partners." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: Dashboard,
});

function Dashboard() {
  const load = useServerFn(partnerDashboard);
  const { data, refetch } = useQuery({ queryKey: ["partner-dashboard"], queryFn: () => load() });
  if (data === undefined) return <AppShell wide><p className="text-muted-foreground">Loading…</p></AppShell>;
  if (data === null) return <AppShell><p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">Your account isn't linked to a partner business yet. Ask Home Insulation Victoria to add you to your business.</p></AppShell>;
  const biz = data.business as { business_type?: string; capabilities?: string[] | null };
  const isRec = biz.business_type === "rec" || !!biz.capabilities?.includes("electrician");
  const attention = data.jobs.filter((j) => j.sla && (j.sla.state === "attention" || j.sla.state === "exception"));
  return (
    <AppShell wide>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div><h1 className="text-2xl font-bold">{(data.business as { name?: string }).name}</h1><p className="text-sm text-muted-foreground">Partner dashboard</p></div>
        <div className="flex gap-2"><Button asChild size="field"><Link to="/partner/import">Import existing job</Link></Button><Button asChild variant="outline" size="field"><Link to="/partner/workers">Staff</Link></Button><Button asChild variant="outline" size="field"><Link to="/partner/profile">Business profile</Link></Button></div>
      </div>
      {data.blocker && <p className="mb-4 rounded-xl border border-danger/30 bg-danger-soft p-3 text-sm font-medium text-danger">{data.blocker}</p>}
      {attention.length > 0 && <div className="mb-4 rounded-xl border border-warning/40 bg-warning-soft p-3 text-sm"><div className="font-semibold">Needs attention</div>{attention.map((j) => <div key={j.id}><Link to="/field/$jobId" params={{ jobId: j.id }} className="font-medium underline">{j.job_number}</Link> – {j.sla?.message}</div>)}</div>}
      <h2 className="mb-2 font-semibold">Jobs available <Badge variant="secondary">{data.offers.length}</Badge></h2>
      {data.offers.length === 0 ? <p className="mb-4 text-sm text-muted-foreground">No jobs offered right now.</p> : <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{data.offers.map((o) => <Offer key={o.id} o={o} onDone={refetch} />)}</div>}
      <h2 className="mb-2 font-semibold">{isRec ? "My electrical jobs" : "My jobs"} <Badge variant="secondary">{data.jobs.length}</Badge></h2>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {PARTNER_BUCKETS.filter((b) => b !== "other" || data.jobs.some((j) => j.bucket === "other")).map((b) => {
          const js = data.jobs.filter((j) => j.bucket === b);
          return (
            <div key={b} className="rounded-xl border bg-muted/40 p-2">
              <div className="mb-2 flex items-center justify-between px-1 text-sm font-semibold">{BUCKET_LABEL[b]}<Badge variant="secondary">{js.length}</Badge></div>
              <div className="space-y-2">
                {js.map((j) => (
                  <Link key={j.id} to="/field/$jobId" params={{ jobId: j.id }} className="block rounded-lg border bg-card p-3 text-sm hover:border-primary">
                    <div className="flex items-center justify-between gap-2"><span className="text-xs font-bold text-primary">{j.job_number}</span><StageBadge stage={j.stage as never} /></div>
                    <div className="font-medium">{j.owner ?? "Customer"}</div>
                    <div className="text-muted-foreground">{(j.property as { address_line?: string; suburb?: string } | null)?.address_line}, {(j.property as { suburb?: string } | null)?.suburb}</div>
                    {isRec && <div className="mt-1 text-xs font-semibold text-primary">{electricalStatusLabel({ stage: j.stage as string, hasBooking: j.bookings.length > 0 })}</div>}
                    <div className="mt-1 text-xs">Next: {nextStep({ stage: j.stage, next_action: j.next_action }).next}</div>
                    <div className="mt-1 text-xs text-muted-foreground">Electrician: {j.electrician ?? "Not assigned"}{j.bookings[0] ? ` · Booked ${new Date(j.bookings[0].scheduled_start).toLocaleDateString("en-AU")}` : ""}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <SlaPill sla={j.sla} />
                      {j.deposit_cleared != null && <span className={`rounded-full px-2 py-0.5 text-xs ${j.deposit_cleared ? "bg-success-soft text-success" : "bg-muted"}`}>{j.deposit_cleared ? "Deposit cleared" : "Deposit not cleared"}</span>}
                      {j.channel === "hivic_sourced" && <span className="rounded-full bg-info-soft px-2 py-0.5 text-xs text-info">Home Insulation Victoria customer</span>}
                    </div>
                    {j.blockers.length > 0 && <div className="mt-1 text-xs text-danger">{j.blockers[0]}</div>}
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </AppShell>
  );
}

function Offer({ o, onDone }: { o: { id: string; kind?: string; summary: unknown; expires_at: string | null }; onDone: () => void }) {
  const respond = useAction(respondToOffer);
  const [reason, setReason] = useState("");
  const [declining, setDeclining] = useState(false);
  const s = o.summary as { job_number: string; suburb: string | null; postcode: string | null; area_m2: number | null; area_basis: string; eligibility: string | null; approx_area_m2?: number | null; access_summary?: string | null; observations?: string[]; piesa_rate_inc_gst?: number | null };
  if (o.kind === "piesa" || o.kind === "rectification") return (
    <div className="rounded-xl border bg-card p-3 text-sm">
      <div className="font-semibold">{o.kind === "piesa" ? "PIESA electrical safety visit" : "Electrical rectification"} · {s.suburb ?? "Victoria"} {s.postcode}</div>
      <div className="text-muted-foreground">{s.job_number} · {s.approx_area_m2 ? `About ${s.approx_area_m2} m² ceiling (measured)` : "Ceiling area not recorded"}</div>
      {s.access_summary && <div className="text-xs text-muted-foreground">{s.access_summary}</div>}
      {!!s.observations?.length && <ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground">{s.observations.map((x, i) => <li key={i}>{x}</li>)}</ul>}
      {s.piesa_rate_inc_gst != null && <div className="text-xs">Agreed fee: ${s.piesa_rate_inc_gst.toFixed(2)} inc GST</div>}
      {o.expires_at && <div className="text-xs text-muted-foreground">Offer open until {new Date(o.expires_at).toLocaleString("en-AU", { timeZone: "Australia/Melbourne" })}</div>}
      <p className="mt-1 text-xs text-muted-foreground">The owner's name and contact details are shared only once you accept. The first approved electrician to accept gets the job.</p>
      {declining ? <div className="mt-2 space-y-2"><Input placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} /><Button size="sm" variant="outline" onClick={async () => { await respond({ offerId: o.id, accept: false, reason: reason || null }, "Declined"); onDone(); }}>Confirm decline</Button></div> :
        <div className="mt-2 grid grid-cols-2 gap-2"><Button size="field" onClick={async () => { await respond({ offerId: o.id, accept: true, reason: null }, "Job accepted"); onDone(); }}>Accept</Button><Button size="field" variant="outline" onClick={() => setDeclining(true)}>Decline</Button></div>}
    </div>
  );
  return (
    <div className="rounded-xl border bg-card p-3 text-sm">
      <div className="font-semibold">{s.suburb ?? "Victoria"} {s.postcode}</div>
      <div className="text-muted-foreground">{s.job_number} · {s.area_m2 ? `${s.area_m2} m² (${s.area_basis})` : "Area unknown"} · {s.eligibility?.replace(/_/g, " ") ?? "eligibility pending"}</div>
      {o.expires_at && <div className="text-xs text-muted-foreground">Respond by {new Date(o.expires_at).toLocaleDateString("en-AU")}</div>}
      <p className="mt-1 text-xs text-muted-foreground">Home Insulation Victoria customer – Home Insulation Victoria stays the customer contact.</p>
      {declining ? <div className="mt-2 space-y-2"><Input placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} /><Button size="sm" variant="outline" onClick={async () => { await respond({ offerId: o.id, accept: false, reason: reason || null }, "Declined"); onDone(); }}>Confirm decline</Button></div> :
        <div className="mt-2 grid grid-cols-2 gap-2"><Button size="field" onClick={async () => { await respond({ offerId: o.id, accept: true, reason: null }, "Job accepted"); onDone(); }}>Accept</Button><Button size="field" variant="outline" onClick={() => setDeclining(true)}>Decline</Button></div>}
    </div>
  );
}
