import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Copy, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/portal/panels";
import { createWorkerJobLink, jobWorkerLinks, revokeWorkerJobLink } from "@/lib/worker-links.functions";

const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "Pending office approval", cls: "bg-warning-soft text-warning" },
  approved: { label: "Approved", cls: "bg-success-soft text-success" },
  rejected: { label: "Not approved", cls: "bg-danger-soft text-danger" },
};
function WorkerStatus({ s }: { s: string }) {
  const x = STATUS[s] ?? { label: s, cls: "bg-muted" };
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${x.cls}`}>{x.label}</span>;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—");

/** On a job: pick an approved staff member, create their magic link, copy it, see opens, revoke. */
export function WorkerLinksPanel({ jobId }: { jobId: string }) {
  const load = useServerFn(jobWorkerLinks);
  const create = useServerFn(createWorkerJobLink);
  const revoke = useServerFn(revokeWorkerJobLink);
  const { data, refetch } = useQuery({ queryKey: ["worker-links", jobId], queryFn: () => load({ data: { jobId } }), staleTime: 20_000 });
  const [fresh, setFresh] = useState<{ workerId: string; url: string } | null>(null);
  if (!data) return null;
  if (!data.assignedBusinesses) return <Section title="Staff job links"><p className="text-sm text-muted-foreground">Assign an installer or electrician company to this job first — then you can send one of their approved staff members a job link.</p></Section>;
  const copy = async (url: string) => { await navigator.clipboard.writeText(url); toast.success("Link copied — send it to the staff member"); };
  return (
    <Section title="Staff job links">
      <p className="mb-3 text-xs text-muted-foreground">Each staff member gets a private link to just this job: the form, timeline and messages. No login needed. Links last 30 days and can be switched off any time. Nothing is texted or emailed automatically yet — copy the link and send it.</p>
      {data.mittiFlag && <p role="alert" className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm font-medium text-destructive">Needs Mitti access — {data.mittiFlag.replace(/^Needs Mitti access: /, "")}</p>}
      <ul className="space-y-2">
        {data.workers.map((w) => {
          const live = data.links.find((l) => l.worker_id === w.id && l.state === "active");
          return (
            <li key={w.id} className="rounded-lg border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><span className="font-semibold">{w.full_legal_name}</span> <span className="text-muted-foreground">· {w.trade_role} · {(w.businesses as { name: string } | null)?.name}</span></div>
                <WorkerStatus s={w.approval_status} />
              </div>
              {w.blocker ? <p className="mt-1 text-xs text-muted-foreground">{w.blocker}</p> : (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {live && <span className="text-xs text-muted-foreground">Link active · opened {live.open_count}× · last {fmt(live.last_opened_at)}</span>}
                  <Button size="sm" variant={live ? "outline" : "default"} onClick={async () => {
                    try { const r = await create({ data: { jobId, workerId: w.id } }); const url = `${window.location.origin}${r.path}`; setFresh({ workerId: w.id, url }); await copy(url); if (r.mitti?.status === "assigned") toast.success("Ready Check form created in Mitti and assigned to this worker"); else if (r.mitti && r.mitti.status !== "not_needed") toast.warning(`Needs Mitti access: ${r.mitti.message}`); refetch(); } catch (e) { toast.error(errMsg(e)); }
                  }}><Link2 className="mr-1 h-4 w-4" />{live ? "Make a new link" : "Create job link"}</Button>
                  {live && <Button size="sm" variant="ghost" onClick={async () => { await revoke({ data: { linkId: live.id } }); toast.success("Link switched off"); setFresh(null); refetch(); }}>Switch off</Button>}
                </div>
              )}
              {fresh?.workerId === w.id && (
                <div className="mt-2 flex items-center gap-2 rounded bg-accent p-2">
                  <code className="flex-1 truncate text-xs">{fresh.url}</code>
                  <Button size="sm" variant="outline" onClick={() => copy(fresh.url)}><Copy className="h-4 w-4" /></Button>
                </div>
              )}
            </li>
          );
        })}
        {!data.workers.length && <li className="text-sm text-muted-foreground">No staff listed for the assigned company yet. The company adds them under Staff in their portal.</li>}
      </ul>
    </Section>
  );
}
