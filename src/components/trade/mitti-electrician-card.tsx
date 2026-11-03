// Jo 3 Nov 2026: the one electrician question on a Mitti pickup. Own electricians only (usual one first); no Home
// Insulation Victoria option and no new invitation from here — nothing is sent.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/trade/trade-ui";
import { ElectricianPicker } from "./job-intake";
import { refreshInstallerJob } from "./job-cache";
import { bulkElectricianChoices } from "@/lib/bulk-import.functions";
import { answerMittiElectrician, getMittiElectricianQuestion } from "@/lib/mitti-electrician.functions";
import { MITTI_ELECTRICIAN_QUESTION } from "@/lib/mitti-electrician.core";
import { usualElectrician, type ElectricianPlan } from "@/lib/job-electrician.core";

export function MittiElectricianCard({ jobId }: { jobId: string }) {
  const get = useServerFn(getMittiElectricianQuestion), getEl = useServerFn(bulkElectricianChoices), save = useServerFn(answerMittiElectrician);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["mitti-electrician-question", jobId], queryFn: () => get({ data: { jobId } }), retry: false });
  const biz = q.data?.open ? q.data.businessId : null;
  const el = useQuery({ queryKey: ["bulk-electricians", biz], queryFn: () => {
    if (!biz) throw new Error("Couldn't check this job's installer.");
    return getEl({ data: { businessId: biz } });
  }, enabled: !!biz });
  const [plan, setPlan] = useState<ElectricianPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (!q.data?.open || !el.data) return null;
  const approved = el.data.approved as never[];
  const pending = el.data.pending as never[];
  const u = usualElectrician(approved as never);
  const value: ElectricianPlan = plan ?? (u?.businessId ? { mode: "mine", business_id: u.businessId } : { mode: "mine" });
  const none = !approved.length && !pending.length;
  return (
    <section className="space-y-2 rounded-[18px] border border-line bg-paper p-3 shadow-card" data-mitti-electrician-question>
      <h2 className="text-base font-semibold">{MITTI_ELECTRICIAN_QUESTION}</h2>
      <p className="text-sm text-sub">Who does the safety check on this job? Pick one of your electricians.</p>
      {none
        ? <p className="text-sm">You have no electricians saved yet. Add them under My business › Electrician, then choose here.</p>
        : <ElectricianPicker ownOnly value={value} onChange={setPlan} note={false} approved={approved} pending={pending} />}
      {msg && <p role="alert" className="text-sm">{msg}</p>}
      {!none && <Button className="h-12 w-full" disabled={busy || (!value.business_id && !value.nomination_id)} onClick={async () => {
        setBusy(true); setMsg(null);
        try {
          await save({ data: { jobId, plan: { mode: "mine", business_id: value.business_id ?? null, nomination_id: value.nomination_id ?? null } } });
          await Promise.all([q.refetch(), refreshInstallerJob(qc, jobId)]);
        } catch (e) { setMsg(e instanceof Error ? e.message : "Couldn't save. Please try again."); }
        finally { setBusy(false); }
      }}>Save electrician</Button>}
    </section>
  );
}
