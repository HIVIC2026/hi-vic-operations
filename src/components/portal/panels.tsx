import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, FileUp, Lock, Paperclip, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAction } from "@/hooks/use-me";
import {
  confirmEvidenceUpload, createBooking, getEvidenceUrl, getJobBlockers, overrideDepositGate, requestEvidenceUpload,
  respondToQuote, retryXeroPush, sendMessage, simulateXeroPayment, syncInvoice, verifyEvidence,
} from "@/lib/portal.functions";
import { EVIDENCE_STATUS_LABEL, STAGE_LABEL, aud, fmtDate, fmtDateTime } from "@/lib/workflow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { PaymentBadge, Pill } from "./badges";

export function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function useJob(jobId: string) {
  return useQuery({
    queryKey: ["job", jobId],
    queryFn: async () => {
      const { data, error } = await supabase.from("job_overview").select("*").eq("id", jobId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function BlockersPanel({ jobId }: { jobId: string }) {
  const fn = useServerFn(getJobBlockers);
  const { data } = useQuery({ queryKey: ["blockers", jobId], queryFn: () => fn({ data: { jobId } }) });
  if (!data) return null;
  if (!data.blockers.length)
    return (
      <div className="flex items-center gap-2 rounded-xl border border-success/30 bg-success-soft p-3 text-sm font-medium text-success">
        <CheckCircle2 className="h-4 w-4" /> {data.next ? `Nothing blocking the move to ${STAGE_LABEL[data.next]}` : "No further stage"}
      </div>
    );
  return (
    <div className="rounded-xl border border-danger/30 bg-danger-soft p-3 text-sm">
      <div className="mb-1 flex items-center gap-2 font-semibold text-danger">
        <ShieldAlert className="h-4 w-4" /> Blocking {data.next ? STAGE_LABEL[data.next] : "progress"}
      </div>
      <ul className="list-disc space-y-0.5 pl-6 text-foreground">{data.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
    </div>
  );
}

// ---------------- Evidence ----------------
export function EvidencePanel({ jobId, role, gates }: { jobId: string; role: string; gates?: string[] }) {
  const { data } = useQuery({
    queryKey: ["evidence", jobId],
    queryFn: async () => {
      const { data } = await supabase.from("evidence_requirements").select("*, evidence_files(*)").eq("job_id", jobId).order("sort");
      return data ?? [];
    },
  });
  const reqs = (data ?? []).filter((r) => !gates || gates.includes(r.gate));
  const done = reqs.filter((r) => r.required && ["uploaded", "verified"].includes(r.status)).length;
  const total = reqs.filter((r) => r.required).length;
  return (
    <Section title="Evidence" action={<span className="text-sm text-muted-foreground">{done}/{total} required</span>}>
      <div className="space-y-2">
        {reqs.map((r) => <EvidenceRow key={r.id} req={r} canUpload={role === "admin" || r.responsible_role === role} isAdmin={role === "admin"} />)}
      </div>
    </Section>
  );
}

type Req = { id: string; label: string; status: string; required: boolean; notes: string | null; responsible_role: string | null; verified_at: string | null; evidence_files: { id: string; file_name: string; uploaded_at: string }[] };

function EvidenceRow({ req, canUpload, isAdmin }: { req: Req; canUpload: boolean; isAdmin: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const reqUpload = useAction(requestEvidenceUpload);
  const confirm = useAction(confirmEvidenceUpload);
  const verify = useAction(verifyEvidence);
  const openUrl = useServerFn(getEvidenceUrl);
  const onFile = async (f: File) => {
    setBusy(true);
    try {
      const { path, token } = await reqUpload({ requirementId: req.id, fileName: f.name, mimeType: f.type || "application/octet-stream" });
      const { error } = await supabase.storage.from("job-files").uploadToSignedUrl(path, token, f, { contentType: f.type });
      if (error) throw error;
      await confirm({ requirementId: req.id, path, fileName: f.name, mimeType: f.type, size: f.size }, "Uploaded");
    } finally {
      setBusy(false);
    }
  };
  const t = req.status === "verified" ? "good" : req.status === "uploaded" ? "info" : req.status === "rejected" ? "bad" : req.status === "not_required" ? "neutral" : "warn";
  return (
    <div className="rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-medium">{req.label}{!req.required && <span className="ml-1 text-xs text-muted-foreground">(optional)</span>}</div>
        <Pill t={t}>{EVIDENCE_STATUS_LABEL[req.status]}</Pill>
      </div>
      {req.notes && <p className="mt-1 text-xs text-muted-foreground">{req.notes}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        {req.evidence_files.map((f) => (
          <button key={f.id} className="inline-flex items-center gap-1 rounded bg-muted px-2 py-1 text-xs hover:bg-secondary" onClick={async () => window.open((await openUrl({ data: { fileId: f.id } })).url, "_blank")}>
            <Paperclip className="h-3 w-3" /> {f.file_name}
          </button>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {canUpload && req.status !== "verified" && req.status !== "not_required" && (
          <>
            <input ref={input} type="file" accept="image/*,video/*,application/pdf" capture="environment" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
            <Button size="field" variant="outline" disabled={busy} onClick={() => input.current?.click()} className="w-full sm:w-auto">
              <FileUp /> {busy ? "Uploading…" : "Add photo / video / PDF"}
            </Button>
          </>
        )}
        {isAdmin && req.status === "uploaded" && (
          <>
            <Button size="sm" onClick={() => verify({ requirementId: req.id, status: "verified" }, "Verified")}>Verify</Button>
            <Button size="sm" variant="outline" onClick={() => { const n = prompt("Reason for rejection"); if (n) verify({ requirementId: req.id, status: "rejected", notes: n }, "Rejected"); }}>Reject</Button>
          </>
        )}
        {isAdmin && req.status === "outstanding" && !req.required && null}
      </div>
    </div>
  );
}

// ---------------- Messages / history ----------------
export function MessagesPanel({ jobId, isAdmin }: { jobId: string; isAdmin: boolean }) {
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const send = useAction(sendMessage);
  const { data } = useQuery({
    queryKey: ["messages", jobId],
    queryFn: async () => (await supabase.from("messages").select("*, profiles(full_name)").eq("job_id", jobId).order("created_at")).data ?? [],
  });
  return (
    <Section title="Messages">
      <div className="max-h-80 space-y-2 overflow-y-auto">
        {(data ?? []).map((m) => (
          <div key={m.id} className={`rounded-lg p-2 text-sm ${m.internal ? "bg-warning-soft" : "bg-muted"}`}>
            <div className="text-xs text-muted-foreground">{(m.profiles as { full_name: string | null } | null)?.full_name ?? "System"} · {fmtDateTime(m.created_at)}{m.internal && " · internal"}</div>
            {m.body}
          </div>
        ))}
        {!data?.length && <p className="text-sm text-muted-foreground">No messages yet.</p>}
      </div>
      <form className="mt-3 space-y-2" onSubmit={async (e) => { e.preventDefault(); if (!body.trim()) return; await send({ jobId, body, internal }); setBody(""); }}>
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write a message…" rows={2} />
        <div className="flex items-center justify-between">
          {isAdmin ? <label className="flex items-center gap-2 text-sm"><Checkbox checked={internal} onCheckedChange={(v) => setInternal(!!v)} /> Internal note</label> : <span />}
          <Button type="submit" size="sm">Send</Button>
        </div>
      </form>
    </Section>
  );
}

export function TimelinePanel({ jobId }: { jobId: string }) {
  const { data } = useQuery({
    queryKey: ["events", jobId],
    queryFn: async () => (await supabase.from("workflow_events").select("*, profiles(full_name)").eq("job_id", jobId).order("created_at", { ascending: false })).data ?? [],
  });
  return (
    <Section title="History">
      <ol className="space-y-3 border-l pl-4">
        {(data ?? []).map((e) => (
          <li key={e.id} className="relative text-sm">
            <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary" />
            <div className="font-medium">{e.summary}</div>
            <div className="text-xs text-muted-foreground">{fmtDateTime(e.created_at)} · {(e.profiles as { full_name: string | null } | null)?.full_name ?? "System"}{e.internal && " · internal"}</div>
          </li>
        ))}
      </ol>
    </Section>
  );
}

// ---------------- Bookings ----------------
export function BookingPanel({ jobId, kind, canBook }: { jobId: string; kind: "assessment" | "rectification" | "installation"; canBook: boolean }) {
  const [when, setWhen] = useState("");
  const book = useAction(createBooking);
  const { data } = useQuery({
    queryKey: ["bookings", jobId],
    queryFn: async () => (await supabase.from("bookings").select("*").eq("job_id", jobId).order("scheduled_start", { ascending: false })).data ?? [],
  });
  const current = (data ?? []).find((b) => b.kind === kind && b.status !== "cancelled");
  return (
    <Section title={`${kind[0]!.toUpperCase()}${kind.slice(1)} booking`}>
      {current ? <p className="text-sm">Booked: <strong>{fmtDateTime(current.scheduled_start)}</strong> <Pill t="good">{current.status}</Pill></p> : <p className="text-sm text-muted-foreground">Not booked yet.</p>}
      {canBook && (
        <form className="mt-3 flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); if (when) book({ jobId, kind, start: new Date(when).toISOString() }, "Booking saved"); }}>
          <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="h-12" required />
          <Button type="submit" size="field">{current ? "Reschedule" : "Confirm date"}</Button>
        </form>
      )}
    </Section>
  );
}

// ---------------- Quotes (customer-facing) ----------------
export function QuotesPanel({ jobId, canRespond }: { jobId: string; canRespond: boolean }) {
  const [consent, setConsent] = useState(false);
  const respond = useAction(respondToQuote);
  const { data } = useQuery({
    queryKey: ["quotes", jobId],
    queryFn: async () => (await supabase.from("quotes").select("*, quote_items(*)").eq("job_id", jobId).neq("status", "superseded").order("created_at")).data ?? [],
  });
  if (!data?.length) return <Section title="Quotes"><p className="text-sm text-muted-foreground">No quotes yet.</p></Section>;
  const open = data.some((q) => q.status === "issued");
  return (
    <Section title="Quotes (all prices inc GST)">
      <div className="grid gap-3 md:grid-cols-3">
        {data.map((q) => (
          <div key={q.id} className="flex flex-col rounded-lg border p-3">
            <div className="flex items-start justify-between gap-2"><div className="font-semibold">{q.option_label}</div><Pill t={q.status === "accepted" ? "good" : q.status === "declined" ? "bad" : "info"}>{q.status}</Pill></div>
            <ul className="mt-2 flex-1 space-y-1 text-sm">
              {q.quote_items.sort((a, b) => a.sort - b.sort).map((i) => (
                <li key={i.id} className="flex justify-between gap-2"><span>{i.description} × {Number(i.quantity)}</span><span>{aud(i.line_total_inc_gst)}</span></li>
              ))}
              {Number(q.veec_discount_inc_gst) > 0 && <li className="flex justify-between text-success"><span>VEEC discount</span><span>−{aud(q.veec_discount_inc_gst)}</span></li>}
            </ul>
            <div className="mt-2 border-t pt-2 text-lg font-bold">{aud(q.customer_total_inc_gst)} <span className="text-xs font-normal text-muted-foreground">inc GST</span></div>
            <div className="text-xs text-muted-foreground">50% deposit {aud(Number(q.customer_total_inc_gst) / 2)} due on acceptance</div>
            {canRespond && q.status === "issued" && (
              <div className="mt-3 flex gap-2">
                <Button size="field" className="flex-1" disabled={!consent} onClick={() => respond({ quoteId: q.id, accept: true, consent }, "Accepted – deposit invoice on its way")}>Accept</Button>
                {q.kind === "rectification" && <Button size="field" variant="outline" onClick={() => respond({ quoteId: q.id, accept: false }, "Declined")}>Decline</Button>}
              </div>
            )}
          </div>
        ))}
      </div>
      {canRespond && open && (
        <label className="mt-3 flex items-start gap-2 text-sm"><Checkbox checked={consent} onCheckedChange={(v) => setConsent(!!v)} className="mt-0.5" /> I consent to the works and to assigning VEECs to HI VIC, and understand a 50% deposit is due on acceptance with the balance due on installation day.</label>
      )}
    </Section>
  );
}

// ---------------- Payments ----------------
export function PaymentsPanel({ jobId, isAdmin }: { jobId: string; isAdmin: boolean }) {
  const sync = useAction(syncInvoice);
  const retry = useAction(retryXeroPush);
  const override = useAction(overrideDepositGate);
  const simulate = useAction(simulateXeroPayment);
  const { data } = useQuery({
    queryKey: ["invoices", jobId],
    queryFn: async () => (await supabase.from("invoice_payment_state").select("*").eq("job_id", jobId).order("created_at")).data ?? [],
  });
  return (
    <Section title="Payments">
      {!data?.length && <p className="text-sm text-muted-foreground">No invoice yet – raised automatically in Xero when a quote is accepted.</p>}
      <div className="space-y-3">
        {(data ?? []).map((i) => (
          <div key={i.id} className="rounded-lg border p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-semibold capitalize">{i.kind} invoice {i.xero_invoice_number && `· ${i.xero_invoice_number}`}</div>
              <PaymentBadge status={i.effective_status} />
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-1 sm:grid-cols-4">
              <div><dt className="text-xs text-muted-foreground">Total inc GST</dt><dd className="font-medium">{aud(i.total_inc_gst)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Deposit (50%)</dt><dd className="font-medium">{aud(i.deposit_amount)} {i.deposit_cleared ? <Lock className="inline h-3 w-3 text-success" /> : null}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Balance</dt><dd className="font-medium">{aud(i.balance_amount)} {i.balance_due_date && `due ${fmtDate(i.balance_due_date)}`}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Paid</dt><dd className="font-medium">{aud(i.total_paid)}</dd></div>
            </dl>
            {!i.deposit_cleared && <p className="mt-2 rounded bg-warning-soft px-2 py-1 text-xs font-medium text-accent-foreground">Scheduling is locked until the 50% deposit is paid.</p>}
            {isAdmin && i.last_sync_error && <p className="mt-2 rounded bg-danger-soft px-2 py-1 text-xs text-danger">Xero: {i.last_sync_error}</p>}
            {isAdmin && (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => sync({ invoiceId: i.id! }, "Synced")}>Sync from Xero</Button>
                {!i.xero_invoice_id && <Button size="sm" variant="outline" onClick={() => retry({ invoiceId: i.id! }, "Retried")}>Retry Xero push</Button>}
                {!i.deposit_cleared && <Button size="sm" variant="outline" onClick={() => { const r = prompt("Reason for overriding the deposit gate (audited)"); if (r) override({ invoiceId: i.id!, reason: r }, "Override recorded"); }}>Override deposit gate</Button>}
                <Button size="sm" variant="ghost" onClick={() => { const a = prompt("Testing only: total amount paid in Xero", String(i.deposit_amount)); if (a) simulate({ invoiceId: i.id!, amountPaid: Number(a) }, "Payment applied"); }}>Simulate payment</Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </Section>
  );
}
