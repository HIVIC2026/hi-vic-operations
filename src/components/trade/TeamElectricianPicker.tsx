import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getTeamElectricians, allocateElectricianFn } from "@/lib/visit-allocation.functions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Group } from "./installer-kit";

export function TeamElectricianPicker({ jobId }: { jobId: string }) {
  const load = useServerFn(getTeamElectricians);
  const allocate = useServerFn(allocateElectricianFn);
  const qc = useQueryClient();
  const { data, error } = useQuery({ queryKey: ["team-electricians", jobId], queryFn: () => load({ data: { jobId } }), retry: false });
  const [chosen, setChosen] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const id = `team-electrician-${jobId}`;
  return <Group title="Safety check electrician">
    {error && <p role="alert" className="text-sm text-rose">{error.message}</p>}
    {data && <><Label htmlFor={id}>Your Team</Label>
      <select id={id} className="mt-2 h-12 w-full rounded-md border border-line bg-background px-3 text-foreground" value={chosen || data.workers.find(w => w.selected)?.id || ""} onChange={e => setChosen(e.target.value)}>
        <option value="">Choose electrician</option>
        {data.workers.map(w => <option key={w.id} value={w.id} disabled={!w.allowed}>{w.name}{w.reason ? ` — ${w.reason}` : ""}</option>)}
      </select>
      {!data.workers.some(w => w.allowed) && <p role="alert" className="mt-2 text-sm text-rose">Add a verified electrician to your Team before booking the safety check.</p>}
      <Button size="field" variant="outline" className="mt-3 w-full" disabled={busy || !chosen || !data.workers.some(w => w.id === chosen && w.allowed)} onClick={async () => {
        setBusy(true); setMessage(null);
        try { const r = await allocate({ data: { jobId, workerId: chosen } }); setMessage(`${r.name} selected`); setChosen(""); await qc.invalidateQueries({ queryKey: ["team-electricians", jobId] }); await qc.invalidateQueries({ queryKey: ["in-house-booking-access", jobId] }); }
        catch (e) { setMessage(e instanceof Error ? e.message : "Couldn't select electrician"); }
        finally { setBusy(false); }
      }}>{busy ? "Saving…" : "Choose electrician"}</Button></>}
    {message && <p role="status" className="mt-2 text-sm">{message}</p>}
  </Group>;
}