// O2 Job page (approved mock-up + states; decisions 216, 218, 223, 227, 230, 233, 240): header with split address and
// Last heard from us, ONE Next panel, six stage cards (each opens its working tools), Money (one invoice, four steps,
// office-only margin, no Record payment), Contact history (+ Log a call or note), File list, More menu
// (Hold · Mark as test · Cancel · Delete test jobs only). Margin = the shared job-margin.core rule (decision 230). Presentation only — every action is an existing guarded path.
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { MenuPanel } from "@/components/portal/kit";
import { useAction } from "@/hooks/use-me";
import { CARD_STATE_LABEL, type CardKey, type StageCard } from "@/lib/office-stage-cards.core";
import { CONTACT_CHANNELS, channelCounts, filterContacts, type ContactChannel, type ContactRow } from "@/lib/contact-history.core";
import { fileChecklist } from "@/lib/job-file-checklist.core";
import { PAYMENT_STEP_LABEL, type PaymentStep } from "@/lib/payments.core";
import { safetyCheckShort } from "@/lib/safety-check-amount.core";
import { cancelOfficeJob, getOfficeJobMoney, holdOfficeJob, logOfficeCallOrNote, markOfficeJobTest, reopenOfficeJob } from "@/lib/office-screens.functions";
import { bulkJobAction } from "@/lib/bulk.functions";
import { completeInstallation, overrideDepositGate, regenerateRectificationQuote, setHold, syncInvoice } from "@/lib/portal.functions";
import { openJobDocument } from "@/lib/jobfile.functions";
import { reopenDeclinedQuote } from "@/lib/installer-quote-review.functions";
import { supabase } from "@/integrations/supabase/client";
import { openFileViewer } from "@/components/portal/file-viewer";
import { AllDocuments, ExportJobPack, JobTimeline, SectionDocuments, useJobFile } from "@/components/portal/jobfile";
import { ClearTimeline } from "@/components/portal/waiting";
import { AdminVisitHistory } from "@/components/portal/visit-changes";
import { IntakeSummary } from "@/components/portal/intake";
import { EligibilityCard } from "@/components/portal/eligibility-card";
import { VerifiedEligibilityCard } from "@/components/portal/verified-eligibility";
import { AdminEstimateCard } from "@/components/portal/estimate";
import { ChooseInstallerPanel } from "@/components/portal/choose-installer";
import { ChooseElectricianPanel } from "@/components/portal/choose-electrician";
import { MittiCard } from "@/components/portal/mitti";
import { AreaDiagramCard } from "@/components/portal/area-diagram";
import { InstallerQuoteDraftPanel } from "@/components/portal/installer-quote";
import { EvidencePanel, QuotesPanel } from "@/components/portal/panels";
import { AdminAssignmentPanel } from "@/components/portal/assignment";
import { OfficeFixesQuoteReview } from "@/components/portal/allocation";
import { OfficePrestartCard } from "@/components/portal/prestart";
import { PiisaPanel } from "@/components/portal/piisa-panel";
import { AdminBookingOverride } from "@/components/portal/partner";
import { manualVisitKind } from "@/lib/pilot.core";
import { AssessmentView, Compliance, ComplianceRecords, EligibilityForm, JobCoverage, Veec } from "@/components/portal/office-job-parts";
import { FinalCheckScreen } from "@/components/portal/final-check";
import { panelLoad, readOrThrow } from "@/lib/panel-load.core";
import { LoadFailed } from "@/components/portal/load-failed";
import { RepairPriceCard } from "@/components/trade/RepairPriceCard";

export type JobPage = Awaited<ReturnType<typeof import("@/lib/office-job-page.server").loadJobPage>>;
type Header = JobPage["header"];

const dayTime = (iso: string) => new Date(iso).toLocaleString("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Australia/Melbourne" });
const day = (iso: string) => new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "Australia/Melbourne" });
const money = (c: number) => `$${(c / 100).toLocaleString("en-AU", { maximumFractionDigits: 0 })}`;
const btn = "inline-flex min-h-[40px] items-center justify-center rounded-[10px] px-4 text-[13px] font-bold disabled:opacity-50";
const card = "rounded-[18px] border border-line bg-paper p-5 shadow-card";

/* ---------------- Header (decision 223) ---------------- */
export function JobHeader({ h, more }: { h: Header; more: ReactNode }) {
  return (
    <header className={cn(card, "mb-4")} data-why="decision 218 header; 216 split address + Last heard from us; 207 permission wording">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Link to="/admin/jobs/active" className="font-semibold text-sub">‹ Jobs</Link>
            <span className="font-display text-lg font-bold text-ink">{h.jobNumber}</span>
            <span className="rounded-full bg-mist px-2.5 py-0.5 text-[11px] font-semibold text-hiv-blue">{h.ownJob ? `Installer's own · ${h.installerName ?? "installer"}` : "Our lead"}</span>
            {h.statusPill && <span className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-semibold", h.stage === "cancelled" ? "bg-pink text-rose" : "bg-mint text-hiv-green")}>{h.statusPill}</span>}
            {h.isTest && <span className="rounded-full bg-warning-soft px-2.5 py-0.5 text-[11px] font-bold">TEST</span>}
            {h.lifeSupport && <span className="rounded-full bg-pink px-2.5 py-0.5 text-[11px] font-semibold text-rose">Life support</span>}
            {h.installBy && <span className="rounded-full bg-pink px-2.5 py-0.5 text-[11px] font-semibold text-rose">Install by {day(h.installBy)}</span>}
            {h.escDue && <span className="rounded-full bg-warning-soft px-2.5 py-0.5 text-[11px] font-semibold">ESC notice due {dayTime(h.escDue)}</span>}
          </div>
          <h1 className="mt-2 font-display text-[28px] font-extrabold leading-tight text-ink">{h.ownerName ?? "Owner not recorded"}</h1>
          <p className="text-base text-ink">{[h.street, h.suburb, h.postcode].filter(Boolean).join(" · ") || "Address not recorded"}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            {h.phone && <><span>{h.phone}</span><a href={`tel:${h.phone}`} className="font-semibold text-hiv-blue underline">Call</a><a href={`sms:${h.phone}`} className="font-semibold text-hiv-blue underline">Text</a></>}
            {h.email && <><span className="ml-2 truncate">{h.email}</span><a href={`mailto:${h.email}`} className="font-semibold text-hiv-blue underline">Email</a></>}
          </div>
          <p className="mt-2 text-xs text-sub">
            {h.sourceLabel} {day(h.receivedAt)} · {h.permissionAt ? `permission to contact given ${day(h.permissionAt)}` : h.permissionState === "declined" ? "permission to contact NOT given" : "no permission to contact recorded"} · Last heard from us: {h.lastHeard ? `${dayTime(h.lastHeard.at)} · ${h.lastHeard.channel.toLowerCase()}` : "never"}
          </p>
          {h.deleted && <p role="status" className="mt-2 rounded-[10px] bg-pink px-3 py-2 text-sm font-semibold text-rose">This job is deleted. It is hidden from every list; restore it from More › Settings › Deleted jobs.</p>}
        </div>
        {more}
      </div>
    </header>
  );
}

/* ---------------- Next (decision 218: one Next panel, one button) ---------------- */
export function NextPanel({ next, onGo }: { next: JobPage["next"]; onGo: (k: CardKey) => void }) {
  return (
    <section aria-label="Next" className={cn("mb-4 rounded-[18px] border p-5", next.who === "us" ? "border-hiv-green/30 bg-mint" : "border-line bg-mist")} data-why="decision 218: one Next panel, one button">
      <p className="text-[11px] font-bold uppercase tracking-wide text-sub">Next · {next.who === "nobody" ? "nothing to do" : next.who}</p>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 flex-1 text-base font-semibold text-ink">{next.sentence}</p>
        {next.button && <button type="button" className={cn(btn, "bg-hiv-green text-white")} onClick={() => onGo(next.button!.section as CardKey)}>{next.button.label}</button>}
      </div>
      {next.blocked && <p className="mt-2 text-sm text-rose">Blocked because {next.blocked}</p>}
    </section>
  );
}

/* ---------------- Six stage cards (decision 223) ---------------- */
export function StageCards({ cards, open, onOpen }: { cards: StageCard[]; open: CardKey | null; onOpen: (k: CardKey) => void }) {
  return (
    <div className="mb-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
      {cards.map((c) => (
        <section key={c.key} id={`stage-${c.key}`} aria-label={c.title} className={cn(card, "scroll-mt-24 p-4", open === c.key && "ring-2 ring-hiv-blue/40")}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="font-display text-base font-bold text-ink">{c.n} · {c.title}</h2>
            <span className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-semibold", c.state === "done" ? "bg-mint text-hiv-green" : c.state === "now" ? "bg-pink text-rose" : "bg-mist text-sub")}>{c.state === "now" ? "Now" : CARD_STATE_LABEL[c.state]}</span>
          </div>
          <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-2 gap-y-1 text-[13px]">
            {c.lines.map((l) => <div key={l.label} className="contents"><dt className="text-sub">{l.label}</dt><dd className="min-w-0 break-words text-ink">{l.value}</dd></div>)}
          </dl>
          <button type="button" aria-expanded={open === c.key} onClick={() => onOpen(c.key)} className="mt-3 text-sm font-semibold text-hiv-blue">{open === c.key ? "Close ▴" : "Open ›"}</button>
        </section>
      ))}
    </div>
  );
}

/** The working tools behind each card — the kept, guarded panels (audit Part 5 §4). */
export function StageWorkspace({ jobId, k, page, onGo }: { jobId: string; k: CardKey; page: JobPage; onGo?: (k: CardKey | "money" | "contact") => void }) {
  const h = page.header;
  const regen = useAction(regenerateRectificationQuote);
  const complete = useAction(completeInstallation);
  const title = page.cards.find((c) => c.key === k)?.title ?? "";
  const body = (() => {
    switch (k) {
      case "enquiry": return <>
        <IntakeSummary jobId={jobId} />
        {!h.ownJob && <AdminEstimateCard jobId={jobId} />}
        <EligibilityCard jobId={jobId} override={<EligibilityForm jobId={jobId} />} verifiedControls={<VerifiedEligibilityCard jobId={jobId} />} />
        <SectionDocuments jobId={jobId} categories={["Property"]} />
      </>;
      case "ready-check": return <>
        {!h.ownJob && <ChooseInstallerPanel jobId={jobId} />}
        {h.ownJob && <p className="text-sm text-sub">The installer does the Ready Check with their own customer.</p>}
        {!h.ownJob && <JobCoverage jobId={jobId} />}
        <MittiCard jobId={jobId} isAdmin />
        <AreaDiagramCard jobId={jobId} kind="ready_check" />
        <SectionDocuments jobId={jobId} categories={["Ready Check"]} />
      </>;
      case "quote": return <>
        <DeclinedQuoteReopen jobId={jobId} />
        <InstallerQuoteDraftPanel jobId={jobId} />
        <QuotesPanel jobId={jobId} canRespond={false} />
        <AdminAssignmentPanel jobId={jobId} sections={[1]} />
        <SectionDocuments jobId={jobId} categories={["Quotes"]} />
      </>;
      case "piesa": return <>
        {page.stage === "piesa" && <ChooseElectricianPanel jobId={jobId} />}
        <AssessmentView jobId={jobId} part="piesa" />
        <AssessmentView jobId={jobId} part="rectification" />
        {/* Task 9 (Jo 28 Oct 2026): the office can enter the electrician's repair price here too. */}
        <RepairPriceCard jobId={jobId} office />
        <OfficeFixesQuoteReview jobId={jobId} />
        <button type="button" className={cn(btn, "border border-line bg-paper text-hiv-blue")} onClick={() => void regen({ jobId }, "Electrical fixes quote re-priced")}>Re-price fixes quote</button>
        <details className="rounded-[12px] border border-line p-3"><summary className="cursor-pointer text-sm font-semibold">Earlier electrical assessment record (older jobs)</summary><div className="mt-2"><AssessmentView jobId={jobId} part="assessment" /></div></details>
        <SectionDocuments jobId={jobId} categories={["Electrical / PIESA"]} />
      </>;
      case "install": return <>
        <OfficePrestartCard jobId={jobId} />
        <AdminAssignmentPanel jobId={jobId} sections={[2]} />
        <PiisaPanel jobId={jobId} />
        <EvidencePanel jobId={jobId} role="admin" gates={["installation"]} />
        {["installation_booked", "evidence_outstanding"].includes(h.stage) && (
          <div className="rounded-[12px] border border-line p-3 text-sm" data-why="decision 213: the office button stays as the fallback">
            <p className="mb-2">Normally the installer's Mitti Complete records the install. Use this only if that did not happen.</p>
            <button type="button" className={cn(btn, "bg-ink text-white")} onClick={() => void complete({ jobId }, "Installation recorded complete")}>Complete installation</button>
          </div>
        )}
        <AreaDiagramCard jobId={jobId} kind="final" />
        <SectionDocuments jobId={jobId} categories={["Installation"]} />
      </>;
      case "final-check": return <>
        <FinalCheckScreen jobId={jobId} {...(onGo ? { onGo } : {})} />
        <ComplianceRecords jobId={jobId} />
        <Compliance jobId={jobId} />
        <AdminAssignmentPanel jobId={jobId} sections={[4]} />
        <Veec jobId={jobId} />
        <EvidencePanel jobId={jobId} role="admin" excludeGates={["installation"]} />
        <SectionDocuments jobId={jobId} categories={["ESC / VEEC", "Evidence"]} />
      </>;
    }
  })();
  return (
    <section aria-label={`${title} tools`} className={cn(card, "mb-4 space-y-4")}>
      <h2 className="font-display text-lg font-bold text-ink">{title}</h2>
      {body}
    </section>
  );
}

/** Jo 24 Oct: a quote the owner said "Not for me" to can be reopened by the office for Send (reopenDeclinedQuote). */
function DeclinedQuoteReopen({ jobId }: { jobId: string }) {
  const reopen = useAction(reopenDeclinedQuote);
  const { data, error, refetch } = useQuery({ queryKey: ["declined-quote", jobId], queryFn: async () => readOrThrow(await supabase.from("quotes").select("id, status, customer_total_inc_gst").eq("job_id", jobId).eq("kind", "installation").neq("status", "superseded").order("created_at", { ascending: false }).limit(1).maybeSingle()) });
  if (panelLoad({ error, data }) === "failed") return <LoadFailed what="The quote status" onRetry={() => void refetch()} />;
  if (data?.status !== "declined") return null;
  return (
    <div className="rounded-[12px] border border-rose/30 bg-pink p-3 text-sm">
      <p className="font-semibold text-rose">The owner declined this quote.</p>
      <button type="button" className={cn(btn, "mt-2 border border-line bg-paper text-hiv-blue")} onClick={() => void reopen({ jobId, quoteId: data.id }, "Quote reopened — check it and press Send")}>Reopen the quote for Send</button>
    </div>
  );
}

/* ---------------- Money (decisions 139–144, 152, 209, 230, 233, 240) ---------------- */
const STEP_STATE: Record<string, string> = { not_yet: "Not due", requested: "Due", paid: "Paid", overdue: "Overdue", waived: "Waived" };
const STEP_HOW: Record<string, string> = { safety_check: "At acceptance · card or bank transfer", fixes: "In full at approval · card or bank transfer", install_deposit: "Before the install is booked · bank transfer", balance: "On install day · bank transfer" };
export function MoneyCard({ jobId }: { jobId: string }) {
  const load = useServerFn(getOfficeJobMoney);
  const sync = useAction(syncInvoice);
  const override = useAction(overrideDepositGate);
  const { data, error } = useQuery({ queryKey: ["office-job-money", jobId], queryFn: () => load({ data: { jobId } }), staleTime: 30_000 });
  const [showMargin, setShowMargin] = useState(false);
  const [overriding, setOverriding] = useState(false);
  const [why, setWhy] = useState("");
  if (error) return <section id="stage-money" className={cn(card, "mb-4 text-sm text-danger")}>Money could not load: {(error as Error).message}</section>;
  if (!data) return <section id="stage-money" className={cn(card, "mb-4 text-sm text-sub")}>Loading money…</section>;
  const v = data.view, m = data.margin;
  return (
    <section id="stage-money" aria-label="Money" className={cn(card, "mb-4 scroll-mt-24")} data-why="decisions 139/140/141/144/152/209 one invoice + steps; 230 office-only margin; 240 no manual recording">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg font-bold text-ink">Money{data.invoice ? ` · invoice ${data.invoice.number ?? "not in Xero yet"} · $${data.invoice.total.toLocaleString("en-AU", { maximumFractionDigits: 0 })} inc GST · paid $${data.invoice.paid.toLocaleString("en-AU", { maximumFractionDigits: 0 })}` : ""}</h2>
        {v?.onlineInvoiceUrl && <a href={v.onlineInvoiceUrl} target="_blank" rel="noreferrer" className="text-sm font-semibold text-hiv-blue underline">Xero invoice (office view)</a>}
      </div>
      {!v ? <p className="text-sm text-sub">No invoice yet — the one Xero invoice is created when the owner accepts the quote.</p> : (
        <ul className="divide-y divide-line rounded-[12px] border border-line">
          {(v.steps as PaymentStep[]).map((s) => (
            <li key={s.key} className="grid gap-1 px-3 py-2 text-sm md:grid-cols-[minmax(0,1fr)_80px_220px] md:items-center">
              <span className="font-semibold">{s.key === "safety_check" ? `${safetyCheckShort(s.amountCents)} safety check` : `${PAYMENT_STEP_LABEL[s.key]}${s.amountCents ? ` · ${money(s.amountCents)}` : ""}`}</span>
              <span className={cn("text-xs font-semibold", s.state === "paid" ? "text-hiv-green" : s.state === "overdue" ? "text-rose" : "text-sub")}>{s.key === "fixes" && !s.amountCents ? "None yet" : STEP_STATE[s.state] ?? s.state}</span>
              <span className="text-xs text-sub">{STEP_HOW[s.key] ?? ""}{s.state !== "paid" && s.key !== "safety_check" && s.key !== "fixes" ? " · Xero" : ""}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 rounded-[12px] bg-mist px-3 py-2 text-sm" data-why="decision 230: office only, never shown to installers, electricians or owners">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-semibold">Our margin {m.margin != null ? `$${m.margin.toLocaleString("en-AU", { maximumFractionDigits: 0 })}${m.pct != null ? ` (${m.pct}%)` : ""}` : "— not known yet"}</span>
          <button type="button" aria-expanded={showMargin} className="text-sm font-semibold text-hiv-blue" onClick={() => setShowMargin(!showMargin)}>Breakdown {showMargin ? "▴" : "▾"}</button>
        </div>
        {showMargin && (
          <dl className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1">
            {m.lines.map((l) => <div key={l.key} className="contents"><dt>{l.label}{l.key === "veec_value" && m.veecBasis !== "unknown" ? <span className="text-xs text-sub"> · {m.veecBasis}</span> : null}</dt><dd className="text-right tabular-nums">{l.amount == null ? "—" : `${l.amount < 0 ? "−" : l.key === "price" ? "" : "+"}$${Math.abs(l.amount).toLocaleString("en-AU", { maximumFractionDigits: 0 })}`}</dd></div>)}
            <dt className="font-semibold">Margin · office only</dt><dd className="text-right font-semibold tabular-nums">{m.margin != null ? `$${m.margin.toLocaleString("en-AU", { maximumFractionDigits: 0 })}` : "—"}</dd>
            {m.missing.length > 0 && <dd className="col-span-2 text-xs text-rose">Not worked out yet: {m.missing.join(" · ")}</dd>}
          </dl>
        )}
      </div>
      {v && data.invoice && (
        <p className="mt-3 text-xs text-sub">
          {data.invoice.syncedAt ? `Synced with Xero ${dayTime(data.invoice.syncedAt)}` : "Not synced with Xero yet"}{data.invoice.syncError ? ` · last sync failed: ${data.invoice.syncError}` : ""} · <button type="button" className="font-semibold text-hiv-blue underline" onClick={() => void sync({ invoiceId: v.invoiceId }, "Synced with Xero")}>Sync with Xero</button>
          {v.bank?.configured ? ` · bank transfer to ${v.bank.accountName}, BSB ${v.bank.bsb} acct ${v.bank.accountNumber}, reference ${v.reference ?? ""}` : " · bank details to be confirmed"}
          {" · Payments arrive from Stripe (the $349 and fixes) or Xero reconciliation · nothing is recorded by hand"}
          {" · "}<button type="button" className="font-semibold text-hiv-blue underline" onClick={() => setOverriding(!overriding)}>Override the $349 block…</button>
        </p>
      )}
      {overriding && v && (
        <div className="mt-2 grid gap-2 rounded-[12px] border border-line p-3">
          <Textarea value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Why the PIESA can be booked before the $349 arrives (required, audited)" aria-label="Override reason" />
          <button type="button" disabled={why.trim().length < 5} className={cn(btn, "bg-ink text-white")} onClick={async () => { if (await override({ invoiceId: v.invoiceId, reason: why }, "Override recorded")) { setOverriding(false); setWhy(""); } }}>Record override</button>
        </div>
      )}
    </section>
  );
}

/* ---------------- Contact history (decision 216) ---------------- */
const DIR: Record<ContactRow["direction"], string> = { sent: "↑ Sent", received: "↓ Received", call: "☎ Call", note: "✎ Note" };
export function ContactHistory({ jobId, rows, waitingFor, onLog }: { jobId: string; rows: ContactRow[]; waitingFor: string; onLog: () => void }) {
  const [channel, setChannel] = useState<ContactChannel | "All">("All");
  const [all, setAll] = useState(false);
  const counts = useMemo(() => channelCounts(rows), [rows]);
  const shown = filterContacts(rows, channel);
  void jobId;
  return (
    <section id="stage-contact" aria-label="Contact history" className={cn(card, "mb-4 scroll-mt-24")} data-why="decision 216 Contact history: every email/text/call with what we are waiting for">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg font-bold text-ink">Contact history · {rows.length}</h2>
        <button type="button" className={cn(btn, "border border-line bg-paper text-hiv-blue")} onClick={onLog}>Log a call or note</button>
      </div>
      <p className="mb-3 text-sm"><span className="font-semibold">Waiting for:</span> {waitingFor}</p>
      <div className="mb-2 flex flex-wrap gap-1.5" role="group" aria-label="Filter by channel">
        {(["All", ...CONTACT_CHANNELS] as const).map((c) => (
          <button key={c} type="button" aria-pressed={channel === c} onClick={() => setChannel(c)} className={cn("rounded-full border px-3 py-1 text-xs font-semibold", channel === c ? "border-ink bg-ink text-white" : "border-line bg-paper text-sub")}>{c}{c !== "All" ? ` ${counts[c]}` : ""}</button>
        ))}
      </div>
      {shown.length === 0 ? <p className="text-sm text-sub">Nothing here yet.</p> : (
        <ul className="divide-y divide-line">
          {(all ? shown : shown.slice(0, 25)).map((r) => (
            <li key={r.id} className="grid gap-1 py-2 text-[13px] md:grid-cols-[150px_92px_72px_minmax(0,1fr)_auto] md:items-center">
              <span className="text-sub">{dayTime(r.at)}</span>
              <span className="font-semibold">{DIR[r.direction]}</span>
              <span className="text-sub">{r.channel}</span>
              <span className="min-w-0 break-words">{r.what}{r.byOffice ? <span className="text-xs text-sub"> · logged by the office</span> : null}</span>
              <span className={cn("text-xs font-semibold", r.failed ? "text-rose" : "text-sub")}>{r.status}</span>
            </li>
          ))}
        </ul>
      )}
      {shown.length > 25 && !all && <button type="button" className="mt-2 text-sm font-semibold text-hiv-blue" onClick={() => setAll(true)}>Show all {shown.length}</button>}
    </section>
  );
}

/* ---------------- File (6-year record) ---------------- */
export function FileList({ jobId }: { jobId: string }) {
  const { data, error, refetch } = useJobFile(jobId);
  const open = useServerFn(openJobDocument);
  const [more, setMore] = useState<"none" | "docs" | "timeline">("none");
  const rows = fileChecklist(data?.documents ?? []);
  const onFile = rows.filter((r) => r.doc).length;
  // A failed read showed "File · 0 documents" with every item missing; say it could not load instead.
  const load = panelLoad({ error, data });
  return (
    <section aria-label="File" className={cn(card, "mb-4")} data-why="6-year ESC record: documents, area diagram (219), PIESA/PIISA/SWMS (206), VEEC form (119), consent (123); export pack for audit">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg font-bold text-ink">File{load === "ready" ? ` · ${onFile} document${onFile === 1 ? "" : "s"}` : ""}{data?.retention ? ` · retain until ${new Date(data.retention.retainUntil).toLocaleDateString("en-AU", { month: "short", year: "numeric" })}` : ""}</h2>
      </div>
      {load === "failed" ? <LoadFailed what="The file list" onRetry={() => void refetch()} /> : load === "loading" ? <p className="text-sm text-sub">Loading the file list…</p> : <ul className="divide-y divide-line">
        {rows.map((r) => (
          <li key={r.key} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 py-2 text-[13px]">
            <span className="font-semibold">{r.label}</span>
            {r.doc ? (r.doc.storagePath
              ? <button type="button" className="text-hiv-blue underline" onClick={async () => { try { const { url } = await open({ data: { jobId, docId: r.doc!.id } }); openFileViewer(url, r.doc!.title); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not open"); } }}>{r.doc.at ? day(r.doc.at) : "On file"}</button>
              : <span className="text-sub">{r.doc.status === "signed" ? "Signed" : "Recorded"} {r.doc.at ? day(r.doc.at) : ""}</span>)
              : <span className="text-sub">— {r.when}</span>}
          </li>
        ))}
      </ul>}
      <div className="mt-3 flex flex-wrap gap-3 text-sm">
        <button type="button" className="font-semibold text-hiv-blue" onClick={() => setMore(more === "docs" ? "none" : "docs")}>All documents {more === "docs" ? "▴" : "▾"}</button>
        <button type="button" className="font-semibold text-hiv-blue" onClick={() => setMore(more === "timeline" ? "none" : "timeline")}>Timeline {more === "timeline" ? "▴" : "▾"}</button>
      </div>
      {more === "docs" && <div className="mt-3 space-y-3"><AllDocuments jobId={jobId} /><ExportJobPack jobId={jobId} /></div>}
      {more === "timeline" && <div className="mt-3 space-y-3"><ClearTimeline jobId={jobId} admin /><AdminVisitHistory jobId={jobId} /><details className="rounded-[12px] border border-line p-3"><summary className="cursor-pointer text-sm font-semibold">Raw audit history</summary><div className="mt-2"><JobTimeline jobId={jobId} /></div></details></div>}
    </section>
  );
}

/* ---------------- More menu + dialogs (decisions 220, 227, 228, 233) ---------------- */
const CANCEL_REASONS = ["Owner changed mind", "Not eligible", "No response", "Duplicate", "Other"];
const HOLD_REASONS = ["Owner asked us to wait", "Waiting on the owner", "Waiting on the installer", "Other"];

function Chips({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return <div className="flex flex-wrap gap-1.5">{options.map((o) => <button key={o} type="button" aria-pressed={value === o} onClick={() => onChange(o)} className={cn("rounded-full border px-3 py-1 text-xs font-semibold", value === o ? "border-ink bg-ink text-white" : "border-line bg-paper text-sub")}>{value === o ? "✓ " : ""}{o}</button>)}</div>;
}
/** Decision 291: Cancel ticks SEND the approved emails (O69 owner, I70 installer — email only); Hold ticks are still recorded only. */
function TellTicks({ owner, installer, set, sends }: { owner: boolean; installer: boolean; set: (o: boolean, i: boolean) => void; sends: boolean }) {
  return (
    <div className="space-y-1 text-sm">
      <label className="flex items-center gap-2"><input type="checkbox" checked={owner} onChange={(e) => set(e.target.checked, installer)} /> Email the owner</label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={installer} onChange={(e) => set(owner, e.target.checked)} /> Email the installer</label>
      {(owner || installer) && (sends
        ? <p className="text-xs text-sub">Sends the approved “Job cancelled” email now; TEST jobs go to the TEST inbox only.</p>
        : <p className="text-xs text-rose">Recorded only — nothing is sent until Jo approves the hold wording (decision 233).</p>)}
    </div>
  );
}

export function CancelDialog({ h, open, onOpenChange, onDone }: { h: Header; open: boolean; onOpenChange: (v: boolean) => void; onDone: () => void }) {
  const cancel = useAction(cancelOfficeJob);
  const [reason, setReason] = useState("Owner changed mind");
  const [other, setOther] = useState("");
  const [note, setNote] = useState("");
  const [tell, setTell] = useState({ owner: false, installer: false });
  const why = reason === "Other" ? other.trim() : reason;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-why="decision 227 cancel at any time">
        <DialogHeader><DialogTitle>Cancel {h.jobNumber} · {h.ownerName}</DialogTitle><DialogDescription>{[h.street, h.suburb].filter(Boolean).join(", ")}{h.statusPill ? ` · ${h.statusPill.toLowerCase()}` : ""}</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <p className="text-sm font-semibold">Reason</p>
          <Chips options={CANCEL_REASONS} value={reason} onChange={setReason} />
          {reason === "Other" && <Input value={other} onChange={(e) => setOther(e.target.value)} placeholder="Reason" aria-label="Other reason" />}
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional) — e.g. owner called, selling the house" aria-label="Note" />
          <TellTicks owner={tell.owner} installer={tell.installer} set={(o, i) => setTell({ owner: o, installer: i })} sends />
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={why.length < 3} className={cn(btn, "bg-rose text-white")} onClick={async () => { if (await cancel({ jobId: h.jobId, reason: why, ...(note.trim() ? { note: note.trim() } : {}), tellOwner: tell.owner, tellInstaller: tell.installer }, "Job cancelled")) { onOpenChange(false); onDone(); } }}>Cancel job</button>
            <button type="button" className={cn(btn, "border border-line bg-paper text-hiv-blue")} onClick={() => onOpenChange(false)}>Keep the job</button>
          </div>
          <p className="text-xs text-sub">Stops every reminder and text, releases the install day and installer, keeps the history.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function HoldDialog({ h, open, onOpenChange }: { h: Header; open: boolean; onOpenChange: (v: boolean) => void }) {
  const hold = useAction(holdOfficeJob);
  const [reason, setReason] = useState("Owner asked us to wait");
  const [other, setOther] = useState("");
  const [until, setUntil] = useState("");
  const [note, setNote] = useState("");
  const [tell, setTell] = useState({ owner: false, installer: false });
  const why = reason === "Other" ? other.trim() : reason;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-why="decision 233 Hold dialog">
        <DialogHeader><DialogTitle>Put {h.jobNumber} on hold</DialogTitle><DialogDescription>{h.ownerName} · {[h.street, h.suburb].filter(Boolean).join(", ")}</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <p className="text-sm font-semibold">Reason</p>
          <Chips options={HOLD_REASONS} value={reason} onChange={setReason} />
          {reason === "Other" && <Input value={other} onChange={(e) => setOther(e.target.value)} placeholder="Reason" aria-label="Other reason" />}
          <label className="block text-sm font-semibold">Until <Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className="mt-1" aria-label="Until" /></label>
          <p className="text-xs text-sub">Or leave blank until you resume it.</p>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional) — e.g. owner overseas until 9 Nov" aria-label="Note" />
          {/* Decision 345 (Jo 25 Oct 2026): Hold sends nobody anything — no "tell them" ticks. */}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={why.length < 3} className={cn(btn, "bg-ink text-white")} onClick={async () => { if (await hold({ jobId: h.jobId, reason: why, ...(until ? { until } : {}), ...(note.trim() ? { note: note.trim() } : {}), tellOwner: false, tellInstaller: false }, "On hold")) onOpenChange(false); }}>Put on hold</button>
            <button type="button" className={cn(btn, "border border-line bg-paper text-hiv-blue")} onClick={() => onOpenChange(false)}>Keep going</button>
          </div>
          <p className="text-xs text-sub">Pauses every reminder and text until then; the 30-day clock is unchanged; the job shows “On hold” on Jobs and Needs me.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function LogNoteDialog({ h, open, onOpenChange }: { h: Header; open: boolean; onOpenChange: (v: boolean) => void }) {
  const log = useAction(logOfficeCallOrNote);
  const [what, setWhat] = useState<"call" | "note" | "email_received" | "text_received">("call");
  const [who, setWho] = useState<"owner" | "installer" | "electrician">("owner");
  const [said, setSaid] = useState("");
  const [waiting, setWaiting] = useState<"us" | "owner" | "installer" | "electrician" | "nothing">("us");
  const WHAT = { call: "Call", note: "Note", email_received: "Email received", text_received: "Text received" } as const;
  const WHO = { owner: `Owner · ${h.ownerName ?? ""}`.trim(), installer: `Installer${h.installerName ? ` · ${h.installerName}` : ""}`, electrician: "Electrician" } as const;
  const WAIT = { us: "Us", owner: "The owner", installer: "The installer", electrician: "The electrician", nothing: "Nothing" } as const;
  const pick = <K extends string>(map: Record<K, string>, value: K, set: (k: K) => void) => <Chips options={Object.values(map)} value={map[value]} onChange={(label) => set((Object.keys(map) as K[]).find((k) => map[k] === label)!)} />;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-why="decision 216 Log a call or note lives in Contact history">
        <DialogHeader><DialogTitle>Log a call or note · {h.jobNumber}</DialogTitle><DialogDescription>Goes into Contact history as recorded by the office, not sent by the portal.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <p className="text-sm font-semibold">What</p>{pick(WHAT, what, setWhat)}
          <p className="text-sm font-semibold">Who</p>{pick(WHO, who, setWho)}
          <Textarea value={said} onChange={(e) => setSaid(e.target.value)} placeholder="What was said" aria-label="What was said" />
          <p className="text-sm font-semibold">Now waiting for</p>{pick(WAIT, waiting, setWaiting)}
          <div className="flex gap-2">
            <button type="button" disabled={said.trim().length < 2} className={cn(btn, "bg-hiv-green text-white")} onClick={async () => { if (await log({ jobId: h.jobId, what, who, said, waitingFor: waiting }, "Logged")) { setSaid(""); onOpenChange(false); } }}>Save</button>
            <button type="button" className={cn(btn, "border border-line bg-paper text-hiv-blue")} onClick={() => onOpenChange(false)}>Close</button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ReasonDialog({ title, description, action, tone, open, onOpenChange, run }: { title: string; description: string; action: string; tone: "rose" | "ink"; open: boolean; onOpenChange: (v: boolean) => void; run: (reason: string) => Promise<boolean> }) {
  const [reason, setReason] = useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required, kept in the history)" aria-label="Reason" />
        <div className="flex gap-2">
          <button type="button" disabled={reason.trim().length < 3} className={cn(btn, tone === "rose" ? "bg-rose text-white" : "bg-ink text-white")} onClick={async () => { if (await run(reason.trim())) { setReason(""); onOpenChange(false); } }}>{action}</button>
          <button type="button" className={cn(btn, "border border-line bg-paper text-hiv-blue")} onClick={() => onOpenChange(false)}>Close</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** More ▾ (decision 233): Hold · Mark as test · Cancel · Delete (test jobs only); plus the one hidden by-hand visit time (220). */
export function JobMoreMenu({ h, cancelOpen, setCancelOpen, onDeleted }: { h: Header; cancelOpen: boolean; setCancelOpen: (v: boolean) => void; onDeleted: () => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<"hold" | "test" | "delete" | "reopen" | "override" | null>(null);
  const resume = useAction(setHold);
  const markTest = useAction(markOfficeJobTest);
  const reopen = useAction(reopenOfficeJob);
  const bulk = useAction(bulkJobAction);
  const closed = h.stage === "cancelled" || h.stage === "complete";
  const visitKind = manualVisitKind(h.stage);
  const item = "block w-full rounded-[10px] px-3 py-2 text-left text-sm hover:bg-mist";
  return (
    <div className="relative">
      <button type="button" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(!open)} className={cn(btn, "border border-line bg-paper text-hiv-blue")}>More ▾</button>
      <MenuPanel open={open} onPick={() => setOpen(false)}>
          {h.stage === "on_hold" ? <button role="menuitem" type="button" className={item} onClick={() => void resume({ jobId: h.jobId, action: "resume" }, "Resumed")}>Resume</button>
            : !closed && <button role="menuitem" type="button" className={item} onClick={() => setDialog("hold")}>Put on hold</button>}
          {!h.isTest && <button role="menuitem" type="button" className={item} onClick={() => setDialog("test")}>Mark as test</button>}
          {!closed && <button role="menuitem" type="button" className={cn(item, "text-rose")} onClick={() => setCancelOpen(true)}>Cancel job…</button>}
          {h.canReopen && <button role="menuitem" type="button" className={item} onClick={() => setDialog("reopen")}>Reopen…</button>}
          {h.canDelete && <button role="menuitem" type="button" className={cn(item, "text-rose")} onClick={() => setDialog("delete")}>Delete (test jobs only)</button>}
          {!closed && visitKind && <button role="menuitem" type="button" className={item} onClick={() => setDialog("override")}>Set a visit time by hand…</button>}
      </MenuPanel>
      <CancelDialog h={h} open={cancelOpen} onOpenChange={setCancelOpen} onDone={() => void qc.invalidateQueries()} />
      <HoldDialog h={h} open={dialog === "hold"} onOpenChange={(v) => setDialog(v ? "hold" : null)} />
      <ReasonDialog title={`Mark ${h.jobNumber} as test`} description="It moves to Jobs › Closed › Removed / test and leaves every live list." action="Mark as test" tone="ink" open={dialog === "test"} onOpenChange={(v) => setDialog(v ? "test" : null)} run={async (reason) => !!(await markTest({ jobId: h.jobId, reason }, "Marked as test"))} />
      <ReasonDialog title={`Reopen ${h.jobNumber}`} description="Back to the stage it was at; the history is kept." action="Reopen" tone="ink" open={dialog === "reopen"} onOpenChange={(v) => setDialog(v ? "reopen" : null)} run={async (reason) => !!(await reopen({ jobId: h.jobId, reason }, "Reopened"))} />
      <ReasonDialog title={`Delete ${h.jobNumber}`} description="TEST jobs only. Signed or sent records linked to it stop the delete and are kept." action="Delete" tone="rose" open={dialog === "delete"} onOpenChange={(v) => setDialog(v ? "delete" : null)} run={async (reason) => { const r = await bulk({ jobIds: [h.jobId], action: "delete", reason }); if (r?.failed.length) { toast.error(r.failed[0]!.error ?? "Could not delete"); return false; } if (r) { toast.success("Deleted"); onDeleted(); } return !!r; }} />
      <Dialog open={dialog === "override"} onOpenChange={(v) => setDialog(v ? "override" : null)}>
        <DialogContent data-why="decision 220: one hidden office override for phone bookings, reason required, logged">
          <DialogHeader><DialogTitle>Set a visit time by hand · {visitKind === "ready_check" ? "Ready Check" : "PIESA"}</DialogTitle><DialogDescription>For phone bookings only. Recorded permanently with your reason.</DialogDescription></DialogHeader>
          {visitKind && <AdminBookingOverride jobId={h.jobId} kind={visitKind} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
