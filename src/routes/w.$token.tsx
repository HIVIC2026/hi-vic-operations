import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ClipboardList, HeartPulse } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { addWorkerApprovedRectificationItem, getWorkerApprovedRectificationRates, getWorkerJobView, postWorkerMessage } from "@/lib/worker-links.functions";
import logo from "@/assets/home-insulation-victoria-logo.png.asset.json";

export const Route = createFileRoute("/w/$token")({
  ssr: false,
  head: () => ({ meta: [{ title: "Your job – Home Insulation Victoria" }, { name: "description", content: "Your private job page from Home Insulation Victoria." }, { name: "robots", content: "noindex, nofollow" }, { name: "referrer", content: "no-referrer" }, { property: "og:title", content: "Your job – Home Insulation Victoria" }, { property: "og:description", content: "Your private job page from Home Insulation Victoria." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: WorkerJob,
});

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "");
const fmtDay = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }) : "");

function WorkerJob() {
  const { token } = Route.useParams();
  const load = useServerFn(getWorkerJobView);
  const send = useServerFn(postWorkerMessage);
  const { data, error, refetch } = useQuery({ queryKey: ["worker-job", token], queryFn: () => load({ data: { token } }), retry: false, refetchInterval: 20000 });
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const rates = useServerFn(getWorkerApprovedRectificationRates);
  const addRate = useServerFn(addWorkerApprovedRectificationItem);
  const { data: approvedRates = [], refetch: refetchRates } = useQuery({ queryKey: ["worker-approved-rates", token], queryFn: () => rates({ data: { token } }), retry: false });
  const [approved, setApproved] = useState({ code: "", quantity: "1", error: "", saved: "" });
  if (error) return <Shell><div className="rounded-xl border bg-card p-6 text-center"><p className="font-semibold">{error.message}</p></div></Shell>;
  if (!data) return <Shell><p className="text-muted-foreground">Loading your job…</p></Shell>;
  const { job, worker } = data;
  return (
    <Shell>
      <p className="mb-1 text-sm text-muted-foreground">Hi {worker.firstName} — {worker.business}</p>
      <div className="mb-4 rounded-xl border bg-card p-4">
        <div className="text-xs font-bold text-primary">{job.job_number}</div>
        <h1 className="text-xl font-bold">{job.property_address}</h1>
        {data.ownerContact ? (
          <div className="mt-2 rounded-xl bg-secondary p-3 text-sm">
            <div className="font-semibold">{data.ownerContact.name}</div>
            {data.ownerContact.phone && <a className="mt-1 flex h-12 items-center justify-center rounded-xl bg-primary font-semibold text-primary-foreground" href={`tel:${data.ownerContact.phone}`}>Call {data.ownerContact.phone}</a>}
            {data.ownerContact.phone && <a className="mt-2 block text-center font-semibold text-primary underline" href={`sms:${data.ownerContact.phone}`}>Text the owner</a>}
            {data.ownerContact.email && <a className="mt-1 block text-center text-primary underline" href={`mailto:${data.ownerContact.email}`}>{data.ownerContact.email}</a>}
            <p className="mt-2 text-xs text-muted-foreground">Use these contact details only to arrange and complete this Home Insulation Victoria job. Do not use them for unrelated marketing or future work unless the owner separately agrees.</p>
          </div>
        ) : job.owner_first_name && <p className="text-sm text-muted-foreground">Owner: {job.owner_first_name}</p>}
        {job.life_support && <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-danger-soft px-2 py-0.5 text-xs font-semibold text-danger"><HeartPulse className="h-3 w-3" /> Life support at this property</p>}
        {job.next_action && <p className="mt-3 rounded bg-accent px-2 py-1 text-sm font-medium text-accent-foreground">Next: {job.next_action}</p>}
        {data.bookings.map((b, i) => <p key={i} className="mt-2 text-sm"><span className="font-semibold capitalize">{String(b.kind).replace(/_/g, " ")}</span> · {fmt(b.scheduled_start)} {b.status === "proposed" && <span className="text-muted-foreground">(proposed)</span>}</p>)}
        {job.install_deadline && <p className="mt-2 text-sm">Install must happen by <span className="font-semibold">{fmtDay(job.install_deadline)}</span>{job.days_remaining != null && ` (${job.days_remaining} days left)`} — 30 days from the PIESA.</p>}
      </div>

      {worker.role === "electrician" && approvedRates.length > 0 && (
        <div className="mb-4 rounded-xl border bg-card p-4">
          <h2 className="mb-1 font-semibold">Mandatory safety rectification</h2>
          <p className="mb-3 text-sm text-muted-foreground">Add only an item identified by the assessment and listed on your REC business's approved supplier rate schedule.</p>
          <select className="mb-2 h-12 w-full rounded-md border bg-background px-3 text-sm" value={approved.code} onChange={(e) => setApproved((x) => ({ ...x, code: e.target.value, error: "", saved: "" }))}><option value="">Choose an approved item</option>{approvedRates.map((rate) => <option key={rate.code} value={rate.code}>{rate.description} · {rate.display_unit || rate.unit}</option>)}</select>
          <input className="mb-2 h-12 w-full rounded-md border bg-background px-3" aria-label="Quantity" type="number" min="0.01" step="0.01" value={approved.quantity} onChange={(e) => setApproved((x) => ({ ...x, quantity: e.target.value, error: "", saved: "" }))} />
          <Button className="h-12 w-full" disabled={!approved.code || !(Number(approved.quantity) > 0)} onClick={async () => { try { await addRate({ data: { token, rateCode: approved.code, quantity: Number(approved.quantity) } }); setApproved({ code: "", quantity: "1", error: "", saved: "Item added." }); void refetchRates(); } catch (e) { setApproved((x) => ({ ...x, error: e instanceof Error ? e.message : "Item could not be added.", saved: "" })); } }}>Add approved item</Button>
          {approved.error && <p role="alert" className="mt-2 text-sm text-destructive">{approved.error}</p>}
          {approved.saved && <p role="status" className="mt-2 text-sm text-success">{approved.saved}</p>}
        </div>
      )}

      <div className="mb-4 rounded-xl border bg-card p-4">
        <h2 className="mb-2 flex items-center gap-2 font-semibold"><ClipboardList className="h-4 w-4" /> Your form</h2>
        {data.mittiUrl
          ? <><p className="mb-3 text-sm text-muted-foreground">Fill this in on site, in order — it collects every photo and reading needed so nothing is missed.</p><Button asChild className="h-12 w-full"><a href={data.mittiUrl} target="_blank" rel="noreferrer">Open the form in Mitti</a></Button></>
          : <p className="text-sm text-muted-foreground">Your form isn't ready yet. Home Insulation Victoria will set it up before your visit.</p>}
      </div>

      <div className="mb-4 rounded-xl border bg-card p-4">
        <h2 className="mb-1 font-semibold">Messages (optional)</h2>
        <p className="mb-3 text-xs text-muted-foreground">You can call or text the owner directly, or message here. Your company and Home Insulation Victoria can see this conversation. Use these contact details only to arrange and complete this Home Insulation Victoria job. Do not use them for unrelated marketing or future work unless the owner separately agrees.</p>
        <div className="max-h-96 space-y-2 overflow-y-auto">
          {data.messages.map((m) => (
            <div key={m.id} className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${m.mine ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                <div className={`text-[11px] ${m.mine ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{m.mine ? "You" : m.from} · {fmt(m.created_at)}</div>
                <div className="whitespace-pre-wrap">{m.body}</div>
              </div>
            </div>
          ))}
          {!data.messages.length && <p className="text-sm text-muted-foreground">No messages yet.</p>}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {["On my way", "Running about 20 minutes late", "Can you make sure the ceiling access is clear?"].map((q) => (
            <Button key={q} size="sm" variant="outline" className="h-auto min-h-10 whitespace-normal" onClick={() => setBody(q)}>{q}</Button>
          ))}
        </div>
        <form className="mt-3 space-y-2" onSubmit={async (e) => {
          e.preventDefault(); if (!body.trim()) return; setSending(true);
          try { await send({ data: { token, body } }); setBody(""); refetch(); } finally { setSending(false); }
        }}>
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write a message… e.g. 'Can I come Tuesday 10am?'" rows={2} />
          <Button type="submit" className="h-12 w-full" disabled={sending}>Send</Button>
        </form>
      </div>

      {data.timeline.length > 0 && (
        <div className="rounded-xl border bg-card p-4">
          <h2 className="mb-2 font-semibold">What's happened</h2>
          <ol className="space-y-1 text-sm">{data.timeline.map((t, i) => <li key={i}><span className="text-muted-foreground">{fmtDay(t.created_at)}</span> · {t.summary}</li>)}</ol>
        </div>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="estimate-brand min-h-screen bg-estimate-canvas text-estimate-navy">
      <header className="border-b bg-card px-4 py-3"><img src={logo.url} alt="Home Insulation Victoria" className="h-9" /></header>
      <main className="mx-auto max-w-xl p-4">{children}</main>
    </div>
  );
}
