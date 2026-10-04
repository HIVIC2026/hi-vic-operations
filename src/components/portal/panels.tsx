import { useRef, useState } from "react";
import { requiredDepositCents } from "@/lib/payment-gate.core";
import { depositPctFor } from "@/config/workflow-decisions";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, FileUp, Lock, Paperclip, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { CUSTOMER_INVOICE_COLUMNS } from "@/lib/invoice.lifecycle";
import { getJobOverview } from "@/lib/admin-records.functions";

type CustomerInvoice = { id: string; job_id: string; kind: string; xero_invoice_number: string | null; xero_online_url: string | null; total_inc_gst: number; deposit_amount: number; deposit_paid_at: string | null; balance_amount: number; balance_due_date: string | null; balance_paid_at: string | null; total_paid: number; deposit_cleared: boolean; effective_status: string; created_at: string };
import { useAction } from "@/hooks/use-me";
import {
  confirmEvidenceUpload, createBooking, getAuthorityDocUrl, getEvidenceUrl, getInvoiceInternals,
  getJobBlockers, overrideDepositGate, requestEvidenceUpload, respondToQuote, 
  sendMessage, cancelBooking, markDepositRequestRaised, syncInvoice, verifyEvidence,
} from "@/lib/portal.functions";
import { EVIDENCE_STATUS_LABEL, STAGE_LABEL, aud, fmtDate, fmtDateTime } from "@/lib/workflow";
import { ASSISTANCE_LABEL } from "@/lib/authority";
import { QUICK_ACTIONS } from "@/lib/messaging.core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { AcceptanceFlow } from "./assignment";
import { AuthorityBadge, PaymentBadge, Pill } from "./badges";

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
  const load = useServerFn(getJobOverview);
  return useQuery({
    queryKey: ["job", jobId],
    queryFn: () => load({ data: { jobId } }),
    retry: (n, e) => !/permission|not found/i.test(String((e as Error)?.message)) && n < 3,
    staleTime: 30_000,
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
export function EvidencePanel({ jobId, role, gates, excludeGates }: { jobId: string; role: string; gates?: string[]; excludeGates?: string[] }) {
  const { data } = useQuery({
    queryKey: ["evidence", jobId],
    queryFn: async () => {
      const { data } = await supabase.from("evidence_requirements").select("*, evidence_files(*)").eq("job_id", jobId).order("sort");
      return data ?? [];
    },
  });
  const reqs = (data ?? []).filter((r) => (!gates || gates.includes(r.gate)) && !excludeGates?.includes(r.gate));
  const done = reqs.filter((r) => r.required && ["uploaded", "verified"].includes(r.status)).length;
  const total = reqs.filter((r) => r.required).length;
  return (
    <Section title="Evidence" action={<span className="text-sm text-muted-foreground">{done}/{total} required</span>}>
      <div className="space-y-2">
        {reqs.map((r) => <EvidenceRow key={r.id} req={r} canUpload={role === "admin" || r.responsible_role === role || (role === "measure" && ["measurement", "existing_insulation_r_value"].includes((r as { category?: string }).category ?? ""))} isAdmin={role === "admin"} />)}
      </div>
    </Section>
  );
}

type Req = { id: string; label: string; status: string; required: boolean; notes: string | null; responsible_role: string | null; verified_at: string | null; evidence_files: { id: string; file_name: string; uploaded_at: string }[] };

/** Location at the moment of upload. null if the phone refuses or times out — the server then refuses the photo. */
function currentFix(): Promise<{ lat: number; lng: number; accuracyM: number; capturedAt: string } | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((res) => navigator.geolocation.getCurrentPosition(
    (p) => res({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: p.coords.accuracy, capturedAt: new Date(p.timestamp).toISOString() }),
    () => res(null), { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }));
}

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
      const fix = /^(image|video)\//.test(f.type) && !isAdmin ? await currentFix() : null;
      const up = await reqUpload({ requirementId: req.id, fileName: f.name, mimeType: f.type || "application/octet-stream", fix });
      if (!up) return;
      const { path, token } = up;
      const { error } = await supabase.storage.from("job-files").uploadToSignedUrl(path, token, f, { contentType: f.type });
      if (error) throw error;
      await confirm({ requirementId: req.id, path, fileName: f.name, mimeType: f.type, size: f.size, fix }, "Uploaded");
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
export function MessagesPanel({ jobId, isAdmin, role }: { jobId: string; isAdmin: boolean; role?: "owner" | "electrician" | "installer" }) {
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const send = useAction(sendMessage);
  const { data: me } = useQuery({ queryKey: ["me-id"], queryFn: async () => (await supabase.auth.getUser()).data.user?.id ?? null });
  const { data, refetch } = useQuery({
    queryKey: ["messages", jobId],
    refetchInterval: 15000,
    queryFn: async () => (await supabase.from("messages").select("*, profiles(full_name)").eq("job_id", jobId).order("created_at")).data ?? [],
  });
  const quick = role ? QUICK_ACTIONS[role] : [];
  const submit = async (text: string) => {
    if (!text.trim()) return;
    await send({ jobId, body: text, internal });
    setBody("");
    refetch();
  };
  return (
    <Section title="Messages">
      <p className="mb-2 text-xs text-muted-foreground">All contact happens here in the portal — no phone numbers or emails are shared. Home Insulation Victoria can see this conversation.</p>
      <div className="max-h-96 space-y-2 overflow-y-auto">
        {(data ?? []).map((m) => {
          const mine = me && m.sender_id === me;
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${m.internal ? "bg-warning-soft" : mine ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                <div className={`text-[11px] ${mine && !m.internal ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{mine ? "You" : m.sender_label ?? (m.profiles as { full_name: string | null } | null)?.full_name ?? "System"} · {fmtDateTime(m.created_at)}{m.internal && " · internal"}</div>
                <div className="whitespace-pre-wrap">{m.body}</div>
              </div>
            </div>
          );
        })}
        {!data?.length && <p className="text-sm text-muted-foreground">No messages yet.</p>}
      </div>
      {quick.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {quick.map((q) => (
            <Button key={q} type="button" variant="outline" size="sm" className="h-auto min-h-10 whitespace-normal text-left" onClick={() => submit(q)}>{q}</Button>
          ))}
        </div>
      )}
      <form className="mt-3 space-y-2" onSubmit={async (e) => { e.preventDefault(); await submit(body); }}>
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
export function BookingPanel({ jobId, kind, canBook, isAdmin = false }: { jobId: string; kind: "assessment" | "rectification" | "installation"; canBook: boolean; isAdmin?: boolean }) {
  const [when, setWhen] = useState("");
  const book = useAction(createBooking);
  const cancel = useAction(cancelBooking);
  const { data } = useQuery({
    queryKey: ["bookings", jobId],
    queryFn: async () => (await supabase.from("bookings").select("*").eq("job_id", jobId).order("scheduled_start", { ascending: false })).data ?? [],
  });
  const current = (data ?? []).find((b) => b.kind === kind && b.status !== "cancelled");
  return (
    <Section title={`${kind[0]!.toUpperCase()}${kind.slice(1)} booking`}>
      {current ? <p className="text-sm">Booked: <strong>{fmtDateTime(current.scheduled_start)}</strong> <Pill t="good">{current.status}</Pill>{isAdmin && <Button size="sm" variant="ghost" className="ml-2" onClick={() => { const r = prompt("Reason for cancelling this booking (required, audited)"); if (r) cancel({ jobId, kind, reason: r }, "Booking cancelled"); }}>Cancel booking</Button>}</p> : <p className="text-sm text-muted-foreground">Not booked yet.</p>}
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
  const [accepting, setAccepting] = useState<string | null>(null);
  const respond = useAction(respondToQuote);
  const { data } = useQuery({
    queryKey: ["quotes", jobId],
    queryFn: async () => (await supabase.from("quotes").select("*, quote_items(*)").eq("job_id", jobId).neq("status", "superseded").order("created_at")).data ?? [],
  });
  if (!data?.length) return <Section title="Quotes"><p className="text-sm text-muted-foreground">No quotes yet.</p></Section>;
  const open = data.some((q) => q.status === "issued" && q.kind === "rectification");
  if (accepting) return <AcceptanceFlow quoteId={accepting} jobId={jobId} onClose={() => setAccepting(null)} />;
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
            <div className="text-xs text-muted-foreground">{q.kind === "rectification" ? "Scope approval – included in your final installation quote (no payment yet)" : `Minimum upfront deposit ${aud(requiredDepositCents(q.customer_total_inc_gst) / 100)} (${depositPctFor(Number(q.customer_total_inc_gst))}%), paid in full, or an approved 3-instalment plan · balance on installation day`}</div>
            {q.kind === "installation" && q.status === "issued" && q.sent_at && <div className="text-xs text-muted-foreground">Valid until {fmtDate(new Date(quoteExpiresAt(q.sent_at).getTime() - 1).toISOString())}</div>}
            {(q.status === "expired" || (q.status === "issued" && quoteIsExpired(q))) && (
              <p className="mt-3 rounded-md bg-muted p-2 text-sm">{QUOTE_EXPIRED_OWNER_MESSAGE}{q.expired_at && <span className="block text-xs text-muted-foreground">Expired on {fmtDate(q.expired_at)}</span>}</p>
            )}
            {canRespond && q.status === "issued" && !quoteIsExpired(q) && (
              <div className="mt-3 flex gap-2">
                {q.kind === "installation"
                  ? <Button size="field" className="flex-1" onClick={() => setAccepting(q.id)}>Review & accept</Button>
                  : <Button size="field" className="flex-1" disabled={!consent} onClick={() => respond({ quoteId: q.id, accept: true, consent }, "Scope approved")}>Approve scope</Button>}
                {q.kind === "rectification" && <Button size="field" variant="outline" onClick={() => respond({ quoteId: q.id, accept: false }, "Declined")}>Decline</Button>}
              </div>
            )}
          </div>
        ))}
      </div>
      {canRespond && open && (
        <label className="mt-3 flex items-start gap-2 text-sm"><Checkbox checked={consent} onCheckedChange={(v) => setConsent(!!v)} className="mt-0.5" /> I have reviewed the rectification scope and prices (inc GST). Nothing is payable yet – these lines are included in my final installation quote.</label>
      )}
    </Section>
  );
}

// ---------------- Payments ----------------
export function PaymentsPanel({ jobId, isAdmin }: { jobId: string; isAdmin: boolean }) {
  const sync = useAction(syncInvoice);
  const override = useAction(overrideDepositGate);
  const markRaised = useAction(markDepositRequestRaised);
  const internalsFn = useServerFn(getInvoiceInternals);
  const { data } = useQuery({
    queryKey: ["invoices", jobId],
    queryFn: async () => ((await supabase.from("invoice_status").select(CUSTOMER_INVOICE_COLUMNS.join(",")).eq("job_id", jobId).order("created_at")).data as unknown as CustomerInvoice[]) ?? [],
  });
  const { data: internals } = useQuery({ queryKey: ["invoice-internals", jobId], enabled: isAdmin, queryFn: () => internalsFn({ data: { jobId } }) });
  return (
    <Section title="Xero invoice & payments">
      {!data?.length && <p className="text-sm text-muted-foreground">No invoice yet – one Xero invoice for the full accepted price is raised when the owner accepts the final installation quote. An approved payment option (minimum upfront deposit, paid in full, or an active 3-instalment plan) is required before the PIESA or any scheduling; the rest is due on installation day.</p>}
      <div className="space-y-3">
        {(data ?? []).map((i) => {
          const x = internals?.invoices.find((v) => v.id === i.id);
          const ov = internals?.overrides.filter((o) => o.invoice_id === i.id) ?? [];
          const remaining = Math.max(0, Number(i.total_inc_gst) - Number(i.total_paid));
          return (
            <div key={i.id} className="rounded-lg border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-semibold">Invoice {i.xero_invoice_number && <span className="font-normal text-muted-foreground">· {i.xero_invoice_number}</span>}</div>
                <PaymentBadge status={i.effective_status} />
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                <div><dt className="text-xs text-muted-foreground">Total accepted price (inc GST)</dt><dd className="font-medium">{aud(i.total_inc_gst)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Minimum upfront deposit</dt><dd className="font-medium">{aud(i.deposit_amount)} {i.deposit_paid_at ? <span className="text-xs text-success">paid {fmtDate(i.deposit_paid_at)}</span> : i.deposit_cleared ? <span className="text-xs text-success">cleared</span> : <span className="text-xs text-danger">not yet paid</span>}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Paid to date</dt><dd className="font-medium">{aud(i.total_paid)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Remaining balance</dt><dd className="font-medium">{aud(remaining)} {i.balance_paid_at && <span className="text-xs text-success">fully paid {fmtDate(i.balance_paid_at)}</span>}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Final due date (installation day)</dt><dd className="font-medium">{i.balance_due_date ? fmtDate(i.balance_due_date) : <span className="text-xs text-muted-foreground">Pending – set when installation is booked</span>}</dd></div>
              </dl>
              {i.xero_online_url && <a href={i.xero_online_url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm font-semibold text-primary underline">View / pay invoice</a>}
              {!i.deposit_cleared && <p className="mt-2 flex items-center gap-1 rounded bg-danger-soft px-2 py-1 text-xs font-semibold text-danger"><Lock className="h-3 w-3" /> PIESA, rectification and installation scheduling are locked until an approved payment option is verified.</p>}
              {isAdmin && x && (
                <>
                  {x.deposit_request_raised_at
                    ? <p className="mt-2 rounded bg-muted px-2 py-1 text-xs">Native Xero {Number(x.deposit_request_pct ?? 50)}% deposit request raised ({aud(x.deposit_request_amount)}) by {x.deposit_request_raised_by_name ?? "admin"} on {fmtDateTime(x.deposit_request_raised_at)}. Scheduling still waits for Xero to confirm payment.</p>
                    : <p className="mt-2 rounded bg-warning-soft px-2 py-1 text-xs font-semibold">Deposit request must be raised in Xero (Invoice → Request deposit), then mark it raised here.</p>}
                  <dl className="mt-3 grid grid-cols-2 gap-1 rounded bg-muted p-2 text-xs sm:grid-cols-3">
                    <div><dt className="text-muted-foreground">Xero contact</dt><dd className="break-all">{x.xero_contact_id ?? "—"}</dd></div>
                    <div><dt className="text-muted-foreground">Xero invoice ID</dt><dd className="break-all">{x.xero_invoice_id ?? "—"}</dd></div>
                    <div><dt className="text-muted-foreground">Xero status</dt><dd>{x.xero_invoice_status ?? "—"}</dd></div>
                    <div><dt className="text-muted-foreground">Reference</dt><dd>{x.xero_reference ?? "—"}</dd></div>
                    <div><dt className="text-muted-foreground">Last sync</dt><dd>{fmtDateTime(x.last_synced_at)}</dd></div>
                    {x.xero_update_pending && <div><dt className="text-muted-foreground">Due date in Xero</dt><dd className="text-warning">Update pending (not yet sent)</dd></div>}
                  </dl>
                </>
              )}
              {isAdmin && x?.last_sync_error && <p className="mt-2 rounded bg-danger-soft px-2 py-1 text-xs text-danger">Xero sync error: {x.last_sync_error}</p>}
              {ov.map((o) => <p key={o.id} className="mt-2 rounded bg-warning-soft px-2 py-1 text-xs">Override by {o.by ?? "admin"} on {fmtDateTime(o.created_at)}: {o.reason}</p>)}
              {isAdmin && internals && !internals.xeroAllowed && <p className="mt-2 rounded bg-danger-soft px-2 py-1 text-xs font-semibold text-danger">Xero automation blocked: this is not a Home Insulation Victoria job.</p>}
              {isAdmin && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {internals?.xeroAllowed !== false && <Button size="sm" variant="outline" disabled={!!x?.sync_lock_at && Date.now() - Date.parse(x.sync_lock_at) < 120000} onClick={() => sync({ invoiceId: i.id }, "Xero sync finished")}>{x?.xero_invoice_id ? "Sync with Xero" : "Send to Xero (safe retry)"}</Button>}
                  {internals?.xeroAllowed && x?.xero_invoice_id && !x.deposit_request_raised_at && <Button id="target-deposit-request" data-portal-focus="target" size="sm" variant="outline" onClick={() => { if (confirm(`Confirm the native Xero deposit request (${aud(i.deposit_amount)}) has been raised in Xero? This does not unlock scheduling.`)) markRaised({ invoiceId: i.id }, "Deposit request recorded"); }}>Mark deposit request raised</Button>}
                  {!i.deposit_cleared && <Button size="sm" variant="outline" onClick={() => { const r = prompt("Reason for overriding the deposit gate (required, permanently audited)"); if (r) override({ invoiceId: i.id, reason: r }, "Override recorded"); }}>Override deposit gate</Button>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

// ---------------- Owner Authority ----------------
export function useAuthorities(jobId: string) {
  return useQuery({
    queryKey: ["authority", jobId],
    queryFn: async () => (await supabase.from("owner_authorities").select("*").eq("job_id", jobId).order("version", { ascending: false })).data ?? [],
  });
}

export function AdminAuthorityPanel({ jobId }: { jobId: string }) {
  const { data = [] } = useAuthorities(jobId);
  const doc = useServerFn(getAuthorityDocUrl);
  const cur = data[0];
  const eff = cur && cur.status === "accepted" && cur.expires_at && new Date(cur.expires_at) < new Date() ? "expired" : cur?.status ?? "not_requested";
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section title="Owner Authority" action={<AuthorityBadge status={eff} />}>
        <p className="mb-3 rounded bg-muted p-2 text-sm text-muted-foreground">Retired – kept as history only. Consent is now signed at quote acceptance (Customer Acceptance &amp; VEEC Assignment).</p>
        {cur ? (
          <dl className="grid grid-cols-2 gap-1 text-sm">
            <dt className="text-muted-foreground">Version</dt><dd>v{cur.version} · wording {cur.wording_version}</dd>
            <dt className="text-muted-foreground">Requested</dt><dd>{fmtDateTime(cur.requested_at)}</dd>
            <dt className="text-muted-foreground">Viewed</dt><dd>{fmtDateTime(cur.viewed_at)}</dd>
            <dt className="text-muted-foreground">Accepted</dt><dd>{fmtDateTime(cur.accepted_at)}</dd>
            <dt className="text-muted-foreground">Starts</dt><dd>{fmtDateTime(cur.starts_at)}</dd>
            <dt className="text-muted-foreground">Expires</dt><dd>{fmtDate(cur.expires_at)}</dd>
            <dt className="text-muted-foreground">Signed as</dt><dd>{cur.signature_name ?? "—"}</dd>
            <dt className="text-muted-foreground">18+ / authorised</dt><dd>{cur.confirmed_over_18 ? "Yes" : "—"} / {cur.confirmed_owner_or_authorised ? "Yes" : "—"}</dd>
            <dt className="text-muted-foreground">Assistance</dt><dd>{cur.assistance_requirement ? ASSISTANCE_LABEL[cur.assistance_requirement] : "—"}</dd>
            <dt className="text-muted-foreground">Method</dt><dd>{cur.acceptance_method?.replaceAll("_", " ") ?? "—"}</dd>
            <dt className="text-muted-foreground">IP / device</dt><dd className="truncate" title={cur.user_agent ?? ""}>{cur.ip_address ?? "—"}</dd>
            <dt className="text-muted-foreground">Record hash</dt><dd className="truncate font-mono text-xs">{cur.document_sha256 ?? "—"}</dd>
            {cur.revocation_reason && <><dt className="text-muted-foreground">Revoked</dt><dd>{fmtDate(cur.revoked_at)}: {cur.revocation_reason}</dd></>}
            {cur.decline_reason && <><dt className="text-muted-foreground">Declined</dt><dd>{cur.decline_reason}</dd></>}
          </dl>
        ) : <p className="text-sm text-muted-foreground">No legacy record for this job.</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          {cur?.document_path && <Button variant="ghost" onClick={async () => window.open((await doc({ data: { authorityId: cur.id } })).url, "_blank")}><Paperclip /> Locked record</Button>}
        </div>
      </Section>
      <Section title="Authority wording snapshot">
        {cur ? <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed">{cur.wording_snapshot}</pre> : <p className="text-sm text-muted-foreground">—</p>}
        {data.length > 1 && (
          <div className="mt-3 border-t pt-2 text-xs text-muted-foreground">
            <div className="mb-1 font-semibold">Previous versions</div>
            {data.slice(1).map((a) => <div key={a.id}>v{a.version} · {a.status} · requested {fmtDate(a.requested_at)}{a.accepted_at && ` · accepted ${fmtDate(a.accepted_at)}`}</div>)}
          </div>
        )}
      </Section>
    </div>
  );
}


// ---------------- Documents ----------------
export function DocumentsPanel({ jobId }: { jobId: string }) {
  const { data = [] } = useAuthorities(jobId);
  const doc = useServerFn(getAuthorityDocUrl);
  const accepted = data.filter((a) => a.document_path);
  return (
    <Section title="Documents">
      {!accepted.length && <p className="text-sm text-muted-foreground">No documents yet.</p>}
      {accepted.map((a) => (
        <button key={a.id} className="flex w-full items-center gap-2 rounded border p-3 text-left text-sm hover:bg-muted" onClick={async () => window.open((await doc({ data: { authorityId: a.id } })).url, "_blank")}>
          <Paperclip className="h-4 w-4" /> Owner Authority v{a.version} · accepted {fmtDate(a.accepted_at)}
        </button>
      ))}
    </Section>
  );
}
