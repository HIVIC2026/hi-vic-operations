// Part 2: the installer's boss changes the electrician on its own job until the safety check (PIESA) is done.
// Shows nothing for anyone else, for jobs that aren't the installer's own, and once the safety check is done.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/trade/trade-ui";
import { refreshInstallerJob } from "./job-cache";
import { getTradeSwapElectricianOptions, tradeSwapElectrician } from "@/lib/trade-view.functions";

export function ChangeElectricianCard({ jobId }: { jobId: string }) {
  const load = useServerFn(getTradeSwapElectricianOptions), swap = useServerFn(tradeSwapElectrician), qc = useQueryClient();
  const q = useQuery({ queryKey: ["swap-electrician-options", jobId], queryFn: () => load({ data: { jobId } }), retry: false });
  const [pick, setPick] = useState(""), [busy, setBusy] = useState(false), [msg, setMsg] = useState<string | null>(null);
  if (!q.data?.allowed || !q.data.options.length) return null;
  return (
    <section className="space-y-2 rounded-[18px] border border-line bg-paper p-3 shadow-card" data-change-electrician>
      <h2 className="text-base font-semibold">Change electrician</h2>
      <p className="text-sm text-sub">Pick a different electrician for the safety check (PIESA). If it's already booked, the booking is cancelled and the new electrician books it again.</p>
      <label className="block text-sm">Electrician
        <select aria-label="New electrician" className="mt-1 h-12 w-full rounded-md border border-line bg-paper px-3" value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">Choose an electrician</option>
          {q.data.options.map((o) => <option key={o.businessId} value={o.businessId}>{o.name}</option>)}
        </select>
      </label>
      {msg && <p role="alert" className="text-sm text-rose">{msg}</p>}
      <Button className="h-12 w-full" disabled={busy || !pick} onClick={async () => {
        setBusy(true); setMsg(null);
        try {
          await swap({ data: { jobId, electricianBusinessId: pick } });
          setPick("");
          toast.success("Electrician changed");
          await Promise.all([q.refetch(), refreshInstallerJob(qc, jobId)]);
        } catch (e) { setMsg(e instanceof Error ? e.message : "Couldn't change the electrician. Please try again."); }
        finally { setBusy(false); }
      }}>{busy ? "Saving…" : "Change electrician"}</Button>
    </section>
  );
}
