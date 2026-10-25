import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { confirmMittiInviteDoneFn, listMittiInvites } from "@/lib/mitti-invite.functions";

/** Staff approvals (People): partner people the office still has to finish in Mitti (decisions 188/331). Shown only when
 *  there is something to do: an invite the portal may not make yet, a group add, or a Mitti failure with its plain reason. */
export function OfficeMittiInvites() {
  const load = useServerFn(listMittiInvites);
  const confirm = useServerFn(confirmMittiInviteDoneFn);
  const q = useQuery({ queryKey: ["mitti-invites"], queryFn: () => load() });
  const rows = q.data?.invites ?? [];
  if (!rows.length) return null;
  const done = async (workerId: string) => {
    try { const r = await confirm({ data: { workerId } }); toast.success(r.access === "member" ? "Recorded — Mitti confirms they're in" : "Recorded"); await q.refetch(); } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  };
  return (
    <section className="mb-6 rounded-xl border bg-card p-3 text-sm" data-mitti-invites>
      <h2 className="mb-2 font-semibold">Mitti set-up to finish ({rows.length})</h2>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.workerId} className="rounded-lg border p-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-medium">{r.name ?? r.email} <span className="font-normal text-muted-foreground">· {r.business ?? ""} · {r.email}</span></div>
              <Button size="sm" variant="outline" onClick={() => done(r.workerId)}>Done in Mitti</Button>
            </div>
            <ul className="mt-1 list-disc pl-5 text-xs">{r.todo.map((t) => <li key={t}>{t}</li>)}</ul>
          </li>
        ))}
      </ul>
    </section>
  );
}
