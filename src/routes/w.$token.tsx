import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ClipboardList, HeartPulse } from "lucide-react";
import { TradePublicShell, card, navyCard, greenBtn, ghostBtn, inputCls } from "@/components/trade/TradeShell";
import { addWorkerApprovedRectificationItem, getWorkerApprovedRectificationRates, getWorkerJobView, postWorkerMessage } from "@/lib/worker-links.functions";

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
  if (error) return <Shell><section className="rounded-[18px] border border-rose bg-pink p-5 text-ink" data-worker-link-invalid><h1 className="font-display text-2xl font-bold">This job link is unavailable.</h1><p className="mt-1 text-sm">{error.message}</p><p className="mt-2 text-sm">The link may have expired, been revoked or no longer match your assignment. Ask your business owner for a current link.</p></section></Shell>;
  if (!data) return <Shell><p className="text-sm text-sub">Loading your job…</p></Shell>;
  const { job, worker } = data;
  return (
    <Shell>
      <div>
        <p className="text-sm text-sub">Hi {worker.firstName} · {worker.business}</p>
        <h1 className="font-display text-[26px] font-bold leading-tight">{job.property_address}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-2"><span className="text-xs font-bold text-sub">{job.job_number} · Private staff job link</span><span className="rounded-[18px] bg-mist px-2.5 py-0.5 text-[11px] font-semibold capitalize text-hiv-blue">{worker.role}</span></div>
      </div>
      <section className={navyCard} data-worker-assigned>
        <p className="text-xs font-bold uppercase tracking-wide opacity-80">Assigned work</p>
        <h2 className="mt-1 font-display text-xl font-bold">{job.next_action || "Your visit"}</h2>
        {data.bookings.map((b, i) => <p key={i} className="mt-1 text-sm opacity-90"><span className="font-semibold capitalize">{String(b.kind).replace(/_/g, " ")}</span> · {fmt(b.scheduled_start)}{b.status === "proposed" && " (proposed)"}</p>)}
        {data.mittiUrl
          ? <a className={`${greenBtn} mt-4`} href={data.mittiUrl} target="_blank" rel="noreferrer"><ClipboardList className="h-4 w-4" />Open your onsite form</a>
          : <p className="mt-3 text-sm opacity-90">Your form isn't ready yet. Home Insulation Victoria will set it up before your visit.</p>}
      </section>
      <div className={card}>
        {data.ownerContact ? (
          <div className="text-sm">
            <div className="font-semibold">{data.ownerContact.name}</div>
            {data.ownerContact.phone && <a className={`${ghostBtn} mt-2`} href={`tel:${data.ownerContact.phone}`}>Call {data.ownerContact.phone}</a>}
            {data.ownerContact.phone && <a className="mt-2 block text-center font-semibold text-estimate-blue underline" href={`sms:${data.ownerContact.phone}`}>Text the owner</a>}
            {data.ownerContact.email && <a className="mt-1 block text-center text-estimate-blue underline" href={`mailto:${data.ownerContact.email}`}>{data.ownerContact.email}</a>}
            <p className="mt-2 text-xs text-sub">Use these contact details only to arrange and complete this Home Insulation Victoria job. Do not use them for unrelated marketing or future work unless the owner separately agrees.</p>
          </div>
        ) : job.owner_first_name && <p className="text-sm text-sub">Owner: {job.owner_first_name}</p>}
        {job.life_support && <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-danger-soft px-2 py-0.5 text-xs font-semibold text-danger"><HeartPulse className="h-3 w-3" /> Life support at this property</p>}
        {job.install_deadline && <p className="mt-2 text-sm">Install must happen by <span className="font-semibold">{fmtDay(job.install_deadline)}</span>{job.days_remaining != null && ` (${job.days_remaining} days left)`} — 30 days from the PIESA.</p>}
      </div>

      {worker.role === "electrician" && approvedRates.length > 0 && (
        <div className={card}>
          <h2 className="mb-1 font-display text-lg font-bold">Mandatory safety electrical fixes</h2>
          <p className="mb-3 text-sm text-sub">Add only an item identified by the assessment and listed on your REC business's approved supplier rate schedule.</p>
          <select className={`${inputCls} mb-2`} value={approved.code} onChange={(e) => setApproved((x) => ({ ...x, code: e.target.value, error: "", saved: "" }))}><option value="">Choose an approved item</option>{approvedRates.map((rate) => <option key={rate.code} value={rate.code}>{rate.description} · {rate.display_unit || rate.unit}</option>)}</select>
          <input className={`${inputCls} mb-2`} aria-label="Quantity" type="number" min="0.01" step="0.01" value={approved.quantity} onChange={(e) => setApproved((x) => ({ ...x, quantity: e.target.value, error: "", saved: "" }))} />
          <button type="button" className={greenBtn} disabled={!approved.code || !(Number(approved.quantity) > 0)} onClick={async () => { try { await addRate({ data: { token, rateCode: approved.code, quantity: Number(approved.quantity) } }); setApproved({ code: "", quantity: "1", error: "", saved: "Item added." }); void refetchRates(); } catch (e) { setApproved((x) => ({ ...x, error: e instanceof Error ? e.message : "Item could not be added.", saved: "" })); } }}>Add approved item</button>
          {approved.error && <p role="alert" className="mt-2 text-sm text-danger">{approved.error}</p>}
          {approved.saved && <p role="status" className="mt-2 text-sm text-success">{approved.saved}</p>}
        </div>
      )}

      <div className={card}>
        <h2 className="mb-1 font-display text-lg font-bold">Messages</h2>
        <p className="mb-3 text-xs text-sub">You can call or text the owner directly, or message here. Your company and Home Insulation Victoria can see this conversation. Use these contact details only to arrange and complete this Home Insulation Victoria job. Do not use them for unrelated marketing or future work unless the owner separately agrees.</p>
        <div className="max-h-96 space-y-2 overflow-y-auto">
          {data.messages.map((m) => (
            <div key={m.id} className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${m.mine ? "bg-ink text-paper" : "bg-mist text-ink"}`}>
                <div className={`text-[11px] ${m.mine ? "opacity-80" : "text-sub"}`}>{m.mine ? "You" : m.from} · {fmt(m.created_at)}</div>
                <div className="whitespace-pre-wrap">{m.body}</div>
              </div>
            </div>
          ))}
          {!data.messages.length && <p className="text-sm text-sub">No messages yet.</p>}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {["On my way", "Running about 20 minutes late", "Can you make sure the ceiling access is clear?"].map((q) => (
            <button type="button" key={q} className="min-h-10 rounded-[10px] border border-line bg-paper px-3 py-2 text-left text-sm font-bold" onClick={() => setBody(q)}>{q}</button>
          ))}
        </div>
        <form className="mt-3 space-y-2" onSubmit={async (e) => {
          e.preventDefault(); if (!body.trim()) return; setSending(true);
          try { await send({ data: { token, body } }); setBody(""); refetch(); } finally { setSending(false); }
        }}>
          <textarea className="w-full rounded-[9px] border border-field-line bg-paper p-3 text-base" aria-label="Message" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write a message… e.g. 'Can I come Tuesday 10am?'" rows={2} />
          <button type="submit" className={greenBtn} disabled={sending}>Send</button>
        </form>
      </div>

      <section className={card} data-worker-access><h2 className="font-display text-lg font-bold">Your access</h2><p className="mt-1 text-sm text-sub">This private link covers the assigned job and its form. Business banking and rate management are not included.</p></section>
      {data.timeline.length > 0 && (
        <div className={card}>
          <h2 className="mb-2 font-display text-lg font-bold">What's happened</h2>
          <ol className="space-y-1 text-sm">{data.timeline.map((t, i) => <li key={i}><span className="text-sub">{fmtDay(t.created_at)}</span> · {t.summary}</li>)}</ol>
        </div>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <TradePublicShell>{children}</TradePublicShell>;
}
