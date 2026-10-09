import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { evidenceApplicability, type OperationRow } from "@/lib/operations-preview.core";
import { communicationPurposeLabel, communicationStatusLabel, evidenceStatusLabel, latestCommunicationEvent, latestConfirmedSend } from "@/lib/portal-presentation.core";
import { cn } from "@/lib/utils";
import { RowDeleteButton } from "./JobDeleteControls";

const when = (at: string | null | undefined) => at && Number.isFinite(Date.parse(at)) ? new Date(at).toLocaleString("en-AU", { timeZone: "Australia/Melbourne", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : null;
const Fact = ({ k, v }: { k: string; v: string }) => <div className="min-w-0"><dt className="text-xs text-sub">{k}</dt><dd className="break-words font-medium">{v}</dd></div>;
const Fold = ({ title, children }: { title: string; children: React.ReactNode }) => <details className="border-t border-line py-2"><summary className="cursor-pointer text-sm font-semibold text-hiv-blue">{title}</summary><div className="mt-2 text-sm">{children}</div></details>;

/** Expanded office record: next step first, short facts, everything else folded away. Presentation only. */
export function RecordDetail({ r }: { r: OperationRow }) {
  const confirmed = latestConfirmedSend(r.communications);
  const latest = latestCommunicationEvent(r.communications);
  const failed = latest && ["failed", "bounced", "undelivered"].includes(latest.status) ? latest : null;
  const now = Date.now();
  const evidence = r.evidence.map((e) => ({ ...e, when: evidenceApplicability(e.gate, r.facts, now) }));
  const source = r.channel === "installer_sourced" ? `Installer customer · ${r.originatingInstaller ?? "installer not recorded"}` : r.channel === "hivic_sourced" ? "Home Insulation Victoria lead" : "Source not recorded";
  return (
    <div className="mt-3 space-y-3 rounded-2xl border border-line bg-paper p-4 text-sm">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div className="min-w-0">
          <h3 className="text-xs font-bold uppercase tracking-wide text-sub">Next step</h3>
          {r.tasks.length ? <ul className="mt-1 space-y-1">{r.tasks.map((t, i) => <li key={i} className="break-words"><span className="font-semibold">{t.label}</span> <span className="text-sub">· {t.party}</span>{(t.overdue || t.blocked || t.dueAt) && <span className={cn("ml-2 rounded-full px-2 py-0.5 text-xs font-semibold", t.overdue || t.blocked ? "bg-danger-soft text-rose" : "bg-mist text-sub")}>{t.blocked ? "Blocked" : t.overdue ? `Overdue${t.dueAt ? ` · ${when(t.dueAt)}` : ""}` : `Due ${when(t.dueAt)}`}</span>}</li>)}</ul> : <p className="mt-1 text-sub">No outstanding task recorded.</p>}
        </div>
        <div className="flex flex-wrap gap-2 sm:justify-end">
          <Link to="/admin/jobs/$jobId" params={{ jobId: r.id }} className="inline-flex h-10 items-center gap-1 rounded-full bg-hiv-blue px-4 font-semibold text-paper hover:opacity-90">Open job<ArrowUpRight className="h-4 w-4" /></Link>
          <RowDeleteButton jobId={r.id} jobNumber={r.jobNumber} />
        </div>
      </div>
      <dl className="grid gap-3 border-t border-line pt-3 sm:grid-cols-4">
        <Fact k="Source" v={source} />
        <Fact k="Installer" v={r.assignedInstaller ?? "Not assigned"} />
        <Fact k="Spot" v={r.savedSpot ? "Spot saved" : "Not saved"} />
        <Fact k="Photos and videos" v={r.mediaCount ? `${r.mediaCount} received · ${r.mediaState}` : r.mediaState} />
      </dl>
      <p className="border-t border-line pt-3"><span className="text-sub">Last email or text sent: </span><b>{confirmed ? `${communicationPurposeLabel(confirmed)} · ${when(confirmed.at)}` : "None confirmed"}</b>{failed && <span className="mt-1 block text-rose">Latest attempt failed: {communicationPurposeLabel(failed)}{when(failed.recordedAt) ? ` · ${when(failed.recordedAt)}` : ""}</span>}</p>
      <Fold title="Eligibility details"><p><b>{r.eligibilityLabel}</b></p><p className="mt-1 text-sub">{r.eligibilityReason ?? "No reason recorded."}</p></Fold>
      <Fold title={`Evidence checklist · ${evidence.length}`}>{evidence.length ? <ul className="divide-y divide-line">{evidence.map((e, i) => <li key={i} className="flex flex-wrap justify-between gap-2 py-1.5"><span className="min-w-0 break-words">{e.label}</span><span className={cn("text-xs", e.when === "current" && (e.status === "outstanding" || e.status === "rejected") ? "font-semibold text-rose" : "text-sub")}>{e.when === "future" ? "Later stage" : evidenceStatusLabel(e.status)}</span></li>)}</ul> : <p className="text-sub">No evidence requirements recorded.</p>}</Fold>
      <Fold title={`Communication history · ${r.communications.length}`}>{r.communications.length ? <ul className="divide-y divide-line">{[...r.communications].reverse().map((c, i) => <li key={i} className="flex flex-wrap justify-between gap-2 py-1.5"><span>{communicationPurposeLabel(c)}</span><span className="text-xs text-sub">{communicationStatusLabel(c)} · {when(c.at) ?? when(c.recordedAt) ?? "time not recorded"}</span></li>)}</ul> : <p className="text-sub">No messages recorded.</p>}
        {r.communications.length > 0 && <details className="mt-2 text-xs text-sub"><summary className="cursor-pointer">Technical audit detail</summary><ul className="mt-1 space-y-0.5 break-all">{r.communications.map((c, i) => <li key={i}>{c.purpose} · {c.status} · sent {c.at ?? "—"} · recorded {c.recordedAt ?? "—"}{c.error ? ` · ${c.error}` : ""}</li>)}</ul></details>}
      </Fold>
    </div>
  );
}
