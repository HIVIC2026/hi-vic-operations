import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createWorkerInvite, listWorkerInvites, revokeWorkerInvite } from "@/lib/worker-invite.functions";
import { workerInviteQueryKey } from "@/lib/worker-invite.core";

const LABEL: Record<string, string> = { active: "Waiting for them", used: "Registered", revoked: "Cancelled", expired: "Expired" };

export function WorkerInvites({ businessId, sample = false }: { businessId: string; sample?: boolean }) {
  const list = useServerFn(listWorkerInvites);
  const create = useServerFn(createWorkerInvite);
  const revoke = useServerFn(revokeWorkerInvite);
  const { data, error, refetch } = useQuery({ queryKey: workerInviteQueryKey(businessId, sample), queryFn: () => sample ? Promise.resolve([]) : list({ data: { businessId } }), initialData: sample ? [] : undefined });
  const [f, setF] = useState({ name: "", contact: "", trade: "installer" as "electrician" | "installer" });
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <section className="mb-6 rounded-xl border bg-card p-4">
      <h2 className="text-lg font-bold">Invite a staff member</h2>
      <p className="mb-3 text-sm text-muted-foreground">Each person gets a private, single-use link to provide their own details and sign their declarations. Electricians provide their personal licence; installers provide their relevant qualification. The link lasts 14 days.</p>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true);
        try {
          if (sample) return;
          const r = await create({ data: { businessId, name: f.name, contact: f.contact || null, trade: f.trade } });
          setLink(`${window.location.origin}/join/${r.token}`); setF({ ...f, name: "", contact: "" }); refetch();
        } catch (er) { toast.error(er instanceof Error ? er.message : "Could not create invite"); } finally { setBusy(false); }
      }}>
        <div className="flex gap-2 sm:col-span-2">
          {(["installer", "electrician"] as const).map((t) => <Button key={t} type="button" variant={f.trade === t ? "default" : "outline"} onClick={() => setF({ ...f, trade: t })}>{t === "electrician" ? "Electrician" : "Installer"}</Button>)}
        </div>
        <label className="text-sm font-medium">Their name<Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className="mt-1 h-12" /></label>
        <label className="text-sm font-medium">Their mobile or email<Input value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} className="mt-1 h-12" /></label>
        <Button type="submit" size="field" disabled={busy || sample} className="sm:col-span-2">{sample ? "Preview only — invitations disabled" : busy ? "Creating…" : "Create invite link"}</Button>
      </form>
      {link && (
        <div className="mt-3 rounded-lg bg-success-soft p-3 text-sm">
          <div className="mb-1 font-semibold">Invite link ready — send this to them:</div>
          <div className="break-all font-mono text-xs">{link}</div>
          <Button size="sm" className="mt-2" onClick={() => { navigator.clipboard.writeText(link); toast.success("Copied"); }}>Copy link</Button>
          <p className="mt-1 text-xs text-muted-foreground">You won't see this link again — create a new one if it gets lost.</p>
        </div>
      )}
      {error && <p role="alert" className="mt-3 text-sm text-danger">Invites could not be loaded. Please try again.</p>}
      {!!data?.length && (
        <ul className="mt-4 space-y-2 text-sm">
          {data.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2">
              <span><strong>{i.invitee_name}</strong> · {i.trade_role === "electrician" ? "Electrician" : "Installer"} · {LABEL[i.state]}</span>
              {!sample && i.state === "active" && <Button size="sm" variant="outline" onClick={async () => { await revoke({ data: { id: i.id } }); refetch(); }}>Cancel</Button>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
