// Jo 23 Oct 2026: the plain office summary at the top of an installer job. Presentation only.
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink } from "lucide-react";
import { getInstallerJobSummary } from "@/lib/installer-job-summary.functions";
import { mittiAuditUrl } from "@/lib/installer-quote-approval.core";
import { Button } from "@/components/ui/button";

const WAITING: Record<string, string> = { installer: "Waiting on the installer", office: "Needs you", owner: "Waiting on the owner", nobody: "Nothing to do yet" };

export function InstallerJobSummary({ jobId }: { jobId: string }) {
  const load = useServerFn(getInstallerJobSummary);
  const q = useQuery({ queryKey: ["installer-job-summary", jobId], queryFn: () => load({ data: { jobId } }), staleTime: 30_000 });
  if (q.isPending) return <p role="status" className="my-3 text-sm text-muted-foreground">Loading the installer job summary…</p>;
  if (q.error) return <p role="alert" className="my-3 text-sm text-destructive">{q.error.message} <Button size="sm" variant="outline" onClick={() => void q.refetch()}>Retry</Button></p>;
  const s = q.data;
  if (!s?.applies) return null;
  const url = mittiAuditUrl(s.form.auditId);
  const row = (label: string, value: React.ReactNode) => <div className="grid gap-1 py-2 sm:grid-cols-[10rem_1fr]"><dt className="text-sm text-muted-foreground">{label}</dt><dd className="text-sm">{value}</dd></div>;
  return (
    <section aria-label="Installer job summary" className="my-3 rounded-md border-2 border-primary/30 bg-card p-4" data-installer-job-summary>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg font-bold">Installer job{s.installer ? ` · ${s.installer}` : ""}</h2>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${s.waitingOn === "office" ? "bg-warning text-warning-foreground" : "bg-muted text-foreground"}`}>{WAITING[s.waitingOn]}</span>
      </div>
      <p className="mt-1 text-base font-semibold">{s.upTo}</p>
      <dl className="mt-2 divide-y">
        {row("Owner permission", s.consent === "granted" ? "✅ Given" : "⚠️ Not recorded")}
        {row("Ready Check form", <span className="flex flex-wrap items-center gap-2">{s.form.status}{url && <Button asChild size="sm" variant="outline"><a href={url} target="_blank" rel="noreferrer">Open in Mitti<ExternalLink className="h-3 w-3" /></a></Button>}</span>)}
        {row("Quote", s.quote.status)}
        {row("What you need to do", s.officeActions.length ? <ul className="list-disc space-y-1 pl-5">{s.officeActions.map((a) => <li key={a}>{a}</li>)}</ul> : "Nothing right now")}
      </dl>
    </section>
  );
}
