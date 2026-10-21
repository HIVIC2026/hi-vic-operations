// P1-R1-S93 — Office UI for the Template 8 Ready Check invitation.
//
// OWNER DECISION (approved): OPTION A — OFFICE MANUAL TRIGGER. Office picks ONE saved-spot job and
// explicitly prepares, reviews and then confirms the invitation. Nothing on this page runs by itself:
// there is no load-time send, no schedule and no automatic send when a spot is saved.
//
// Every action is a POST to the S92 backend, which re-checks Office authority, the frozen snapshot and
// both COM-04 switches on its own. This page never decides who is allowed, never renders pricing of its
// own, and never treats a successful preview as a successful send.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AppShell } from "@/components/portal/AppShell";
import { Button } from "@/components/ui/button";
import { getReadyCheckCandidates, prepareReadyCheckInvitation, sendReadyCheckInvitation } from "@/lib/ready-check-invitation.functions";
import type { PreparedReadyCheckInvitation, ReadyCheckCandidate, ReadyCheckSavedPricing, SentReadyCheckInvitation } from "@/lib/ready-check-invitation.server";

export const Route = createFileRoute("/_authenticated/admin/ready-check")({
  head: () => ({ meta: [
    { title: "Ready Check invitations – Home Insulation Victoria Operations" },
    { name: "description", content: "Prepare and send Template 8 Ready Check invitations for saved-spot jobs." },
    { property: "og:title", content: "Ready Check invitations – Home Insulation Victoria Operations" },
    { property: "og:description", content: "Prepare and send Template 8 Ready Check invitations for saved-spot jobs." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: ReadyCheckPage,
});

const money = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 2 }).format(n);
const when = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—";

/** The saved-pricing panel. Read-only: these are the frozen values, never a recalculation. */
function SavedPricing({ snapshot }: { snapshot: ReadyCheckSavedPricing }) {
  const rows: [string, string][] = [
    ["Ceiling size", `${snapshot.ceilingAreaM2} m²`],
    ["R5.0 insulation, supply and installation", money(snapshot.installation)],
    ["Pre Insulation Electrical Safety Assessment (PIESA)", money(snapshot.piesaFee)],
    ["Accredited Person management", money(snapshot.apFee)],
    ["Before rebate", money(snapshot.totalBeforeRebate)],
    ["VEU rebate", `− ${money(snapshot.veuRebate)}`],
  ];
  return <div className="rounded-lg border bg-muted/20 p-3">
    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Frozen saved pricing (saved {when(snapshot.savedAt)})</p>
    <dl className="mt-2 space-y-1 text-sm">{rows.map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt className="text-muted-foreground">{k}</dt><dd className="font-medium">{v}</dd></div>)}</dl>
    <div className="mt-2 flex justify-between gap-3 border-t pt-2 text-sm"><span className="font-semibold">Customer total</span><span className="font-bold">{money(snapshot.customerTotal)}</span></div>
    <p className="mt-2 text-xs text-muted-foreground">These are the figures saved with the customer's spot. Current rates are never applied.</p>
  </div>;
}

/**
 * The prepare / preview / confirm-send panel for ONE job Office selected.
 * State machine: idle -> previewing -> reviewed -> confirming -> result.
 */
function InvitationPanel({ job, onClosed }: { job: ReadyCheckCandidate; onClosed: () => void }) {
  const prepare = useServerFn(prepareReadyCheckInvitation);
  const send = useServerFn(sendReadyCheckInvitation);
  const [busy, setBusy] = useState(false);
  const [prepared, setPrepared] = useState<PreparedReadyCheckInvitation | null>(null);
  const [sent, setSent] = useState<SentReadyCheckInvitation | null>(null);
  const [confirm, setConfirm] = useState(false);

  const runPrepare = async () => {
    setBusy(true); setPrepared(null); setSent(null);
    try { setPrepared(await prepare({ data: { jobId: job.jobId } })); }
    catch (e) { setPrepared({ ok: false, jobId: job.jobId, jobNumber: job.jobNumber, reason: e instanceof Error ? e.message : "Could not prepare the invitation." }); }
    finally { setBusy(false); }
  };

  const runSend = async () => {
    setBusy(true); setConfirm(false);
    try { setSent(await send({ data: { jobId: job.jobId } })); }
    catch (e) { setSent({ sent: false, jobId: job.jobId, jobNumber: job.jobNumber, reason: e instanceof Error ? e.message : "Could not send the invitation." }); }
    finally { setBusy(false); }
  };

  const good = prepared && prepared.ok ? prepared : null;

  return <section className="mt-4 rounded-xl border bg-card p-4" aria-label={`Ready Check invitation for ${job.jobNumber ?? "this job"}`}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="font-display text-lg font-bold">{(job.jobNumber ?? "Job")}</h2>
        <p className="text-sm text-muted-foreground">{job.ownerName ?? "No owner name"} · {job.ownerEmail ?? "no email"} · {job.address ?? "No address"}</p>
      </div>
      <Button variant="ghost" size="sm" onClick={onClosed}>Close</Button>
    </div>

    <div className="mt-3 flex flex-wrap gap-2">
      <Button variant="outline" disabled={busy} onClick={() => void runPrepare()}>
        {busy && !good ? "Preparing…" : "Prepare Ready Check Invitation"}
      </Button>
      {/* Send is a separate, confirmed action — never triggered by preparing or by loading the page. */}
      <Button disabled={busy || !good} onClick={() => setConfirm(true)}>Send Ready Check Invitation</Button>
    </div>

    {prepared && !prepared.ok && <p role="alert" className="mt-3 text-sm text-destructive">{prepared.reason}</p>}

    {good && <>
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          <p className="text-sm"><span className="text-muted-foreground">To:</span> <span className="font-semibold">{good.to}</span></p>
          <p className="text-sm"><span className="text-muted-foreground">Subject:</span> <span className="font-semibold">{good.subject}</span></p>
          <div className="mt-2 overflow-x-auto rounded-lg border bg-muted/20 p-2">
            <iframe title={`Ready Check invitation for ${job.jobNumber ?? "job"}`} sandbox="" srcDoc={good.html} className="mx-auto h-[720px] w-full max-w-[420px] bg-card" />
          </div>
          <details className="mt-2 text-sm"><summary className="cursor-pointer font-semibold">Plain-text alternative</summary><pre className="mt-2 whitespace-pre-wrap rounded-lg border bg-muted/20 p-3 text-xs">{good.plainText}</pre></details>
        </div>
        <div className="space-y-3">
          <SavedPricing snapshot={good.snapshot} />
          <div className="rounded-lg border bg-muted/20 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Links in this email</p>
            <p className="mt-2 break-all text-sm"><span className="text-muted-foreground">Personal estimate:</span> <code>{good.snapshot.personalEstimateUrl}</code></p>
            <p className="mt-1 break-all text-sm"><span className="text-muted-foreground">Ready Check booking:</span> <code>{good.snapshot.readyCheckBookingUrl ?? "—"}</code></p>
            <p className="mt-2 text-xs text-muted-foreground">Booking opens the existing Ready Check page. It never books the appointment by itself.</p>
          </div>
          <p className="text-xs text-muted-foreground">Previewing does not send anything, and does not reserve the send.</p>
        </div>
      </div>
    </>}

    {sent && <div role={sent.sent ? "status" : "alert"} className={`mt-4 rounded-lg border p-3 text-sm ${sent.sent ? "border-primary/40 bg-primary/5" : "border-destructive/40 bg-destructive/5"}`}>
      {sent.sent
        ? <p className="font-semibold">Invitation sent and recorded for {sent.jobNumber ?? "this job"}.</p>
        : <p className="font-semibold">Not sent. {sent.reason}</p>}
      {!sent.sent && <p className="mt-1 text-xs">Live sending needs both communication switches to be on. Do not retry a blocked send; check the job's history first.</p>}
    </div>}

    {/* Explicit confirmation naming the customer, the job and the recipient. */}
    <AlertDialog open={confirm} onOpenChange={setConfirm}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Send a Ready Check invitation to {job.ownerName ?? "this customer"}?</AlertDialogTitle>
          <AlertDialogDescription>
            This sends the Template 8 Ready Check invitation to one real customer. It can't be undone, and each home is only ever invited once.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <dl className="space-y-1 text-sm">
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Job</dt><dd className="font-semibold">{job.jobNumber ?? "—"}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Customer</dt><dd className="font-semibold">{job.ownerName ?? "—"}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Recipient</dt><dd className="font-semibold">{good?.to ?? "—"}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Saved total</dt><dd className="font-semibold">{money(job.savedTotal)}</dd></div>
        </dl>
        <p className="text-sm">The server re-checks your Office access, the frozen pricing, consent and both communication switches before anything is sent.</p>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => void runSend()}>Send invitation</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>;
}

function ReadyCheckPage() {
  const load = useServerFn(getReadyCheckCandidates);
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ["ready-check-candidates"], queryFn: () => load() });
  const [selected, setSelected] = useState<ReadyCheckCandidate | null>(null);

  // Keep the open panel in step with the list so a job that changes underneath is never acted on stale.
  useEffect(() => {
    if (!selected) return;
    const fresh = data?.rows.find((r) => r.jobId === selected.jobId);
    if (!fresh) setSelected(null);
    else if (fresh !== selected) setSelected(fresh);
  }, [data, selected]);

  const rows = data?.rows ?? [];

  return <AppShell wide>
    <header className="mb-5">
      <h1 className="font-display text-2xl font-bold">Ready Check invitations</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Saved-spot jobs only. Office chooses one job and confirms each invitation. Nothing is sent automatically.
      </p>
    </header>

    <div className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm">
      <strong>Live sending is switched off.</strong> Both communication switches are off, so a send attempt will be refused and reported here. A successful preview is not a successful send.
    </div>

    {isLoading ? <p role="status" className="mt-4">Loading saved-spot jobs…</p>
      : isError ? <p role="alert" className="mt-4 text-sm text-destructive">Could not load the saved-spot jobs. {error instanceof Error ? error.message : "Try again."}</p>
      : rows.length === 0 ? <p className="mt-4 text-sm text-muted-foreground">No saved-spot jobs are eligible for a Ready Check invitation right now.</p>
      : <>
        <div className="mt-4 overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="p-3">Job</th><th className="p-3">Customer</th><th className="p-3">Property</th>
                <th className="p-3">Spot saved</th><th className="p-3">Saved total</th><th className="p-3">Office action</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => <tr key={r.jobId} className={`align-top hover:bg-muted/30 ${selected?.jobId === r.jobId ? "bg-muted/40" : ""}`}>
                <td className="p-3"><Link to="/admin/jobs/$jobId" params={{ jobId: r.jobId }} className="font-semibold text-primary underline">{r.jobNumber ?? "—"}</Link></td>
                <td className="p-3">{r.ownerName ?? "—"}<div className="text-xs text-muted-foreground">{r.ownerEmail ?? "No email"}</div></td>
                <td className="p-3">{r.address ?? "—"}</td>
                <td className="p-3">{when(r.spotSavedAt)}</td>
                <td className="p-3 font-semibold">{money(r.savedTotal)}<div className="text-xs font-normal text-muted-foreground">{r.savedAreaM2 ? `${r.savedAreaM2} m²` : ""}</div></td>
                <td className="p-3"><Button size="sm" variant="outline" onClick={() => setSelected(r)}>{selected?.jobId === r.jobId ? "Selected" : "Select job"}</Button></td>
              </tr>)}
            </tbody>
          </table>
        </div>

        {selected && <InvitationPanel job={selected} onClosed={() => setSelected(null)} />}
      </>}
  </AppShell>;
}
