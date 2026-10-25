import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Copy, Link2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Section } from "@/components/portal/panels";
import { createWorkerJobLink, jobWorkerLinks, revokeWorkerJobLink, removeWorker, saveWorker } from "@/lib/worker-links.functions";

const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "Pending office approval", cls: "bg-warning-soft text-warning" },
  approved: { label: "Approved", cls: "bg-success-soft text-success" },
  rejected: { label: "Not approved", cls: "bg-danger-soft text-danger" },
};
export function WorkerStatus({ s }: { s: string }) {
  const x = STATUS[s] ?? { label: s, cls: "bg-muted" };
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${x.cls}`}>{x.label}</span>;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

type Worker = { id: string; full_legal_name: string; email: string | null; mobile: string | null; trade_role: string; licence_number: string | null; qualification: string | null; approval_status: string; rejection_reason?: string | null };

export function WorkerForm({ businessId, worker, onDone }: { businessId: string; worker?: Worker; onDone: () => void }) {
  const save = useServerFn(saveWorker);
  const [f, setF] = useState({
    full_legal_name: worker?.full_legal_name ?? "", email: worker?.email ?? "", mobile: worker?.mobile ?? "",
    trade_role: (worker?.trade_role ?? "electrician") as "electrician" | "installer",
    licence_number: worker?.licence_number ?? "", qualification: worker?.qualification ?? "",
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true);
      try {
        const r = await save({ data: { ...f, business_id: businessId, ...(worker ? { id: worker.id } : {}), licence_number: f.licence_number || null, qualification: f.qualification || null } });
        toast.success(r.pending ? "Saved — Home Insulation Victoria will approve this staff member shortly." : "Saved");
        onDone();
      } catch (er) { toast.error(errMsg(er)); } finally { setBusy(false); }
    }}>
      <div className="sm:col-span-2 flex gap-2">
        {(["electrician", "installer"] as const).map((r) => (
          <Button key={r} type="button" variant={f.trade_role === r ? "default" : "outline"} onClick={() => setF({ ...f, trade_role: r })}>{r === "electrician" ? "Electrician" : "Installer"}</Button>
        ))}
      </div>
      <label className="text-sm font-medium">Full name<Input required value={f.full_legal_name} onChange={set("full_legal_name")} className="mt-1 h-12" /></label>
      <label className="text-sm font-medium">Mobile<Input required inputMode="tel" value={f.mobile} onChange={set("mobile")} className="mt-1 h-12" /></label>
      <label className="text-sm font-medium">Email<Input required type="email" value={f.email} onChange={set("email")} className="mt-1 h-12" /></label>
      {f.trade_role === "electrician"
        ? <label className="text-sm font-medium">Electrical licence number<Input required value={f.licence_number} onChange={set("licence_number")} className="mt-1 h-12" /></label>
        : <label className="text-sm font-medium">Qualification<Input required placeholder="e.g. Cert III or experienced installer" value={f.qualification} onChange={set("qualification")} className="mt-1 h-12" /></label>}
      <div className="sm:col-span-2 flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone}>Cancel</Button>
        <Button type="submit" disabled={busy}>{worker ? "Save changes" : "Add staff member"}</Button>
      </div>
    </form>
  );
}

export function WorkerRemoveButton({ id, onDone }: { id: string; onDone: () => void }) {
  const remove = useServerFn(removeWorker);
  return <Button size="sm" variant="ghost" aria-label="Remove staff member" onClick={async () => {
    if (!confirm("Remove this staff member? Their job links stop working straight away.")) return;
    try { await remove({ data: { id } }); toast.success("Staff member removed"); onDone(); } catch (e) { toast.error(errMsg(e)); }
  }}><Trash2 className="h-4 w-4" /></Button>;
}

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
