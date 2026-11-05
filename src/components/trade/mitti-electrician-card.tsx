// Jo 3 Nov 2026: the one electrician question on a Mitti pickup. Own electricians only (usual one first); no Home
// Insulation Victoria option and no new invitation from here — nothing is sent.
// Go-live 5 Nov 2026 (Tom's TEST job): an in-house business answers it from its TEAM (the verified electricians on
// My business › Team, the same picker the PIESA booking uses — `getTeamElectricians` / `allocateElectricianFn`), never the
// retired "My business › Electrician" nominations. The legacy picker stays for a business that is not in-house.
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { electricianAllocationMessage } from "@/lib/electrician-allocation-message.core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/trade/trade-ui";
import { inputCls } from "@/components/trade/trade-classes";
import { ElectricianPicker } from "./job-intake";
import { refreshInstallerJob } from "./job-cache";
import { bulkElectricianChoices } from "@/lib/bulk-import.functions";
import { answerMittiElectrician, getMittiElectricianQuestion } from "@/lib/mitti-electrician.functions";
import { MITTI_ELECTRICIAN_QUESTION } from "@/lib/mitti-electrician.core";
import { usualElectrician, type ElectricianPlan } from "@/lib/job-electrician.core";
import { allocateElectricianFn, getTeamElectricians } from "@/lib/visit-allocation.functions";
import { showTradeSaved } from '@/lib/trade-save-confirmation';

export const TEAM_NONE_YET = "You have no electricians on your Team yet. Add them under My business › Team; the office checks their licence, then choose here.";

export function MittiElectricianCard({ jobId }: { jobId: string }) {
  const get = useServerFn(getMittiElectricianQuestion), getEl = useServerFn(bulkElectricianChoices), save = useServerFn(answerMittiElectrician);
  const getTeam = useServerFn(getTeamElectricians), allocate = useServerFn(allocateElectricianFn);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["mitti-electrician-question", jobId], queryFn: () => get({ data: { jobId } }), retry: false });
  const biz = q.data?.open ? q.data.businessId : null;
  // In-house business (Team model): the picker read succeeds; any other business: it refuses and the legacy picker shows.
  const team = useQuery({ queryKey: ["mitti-electrician-team", jobId], queryFn: async () => { try { return await getTeam({ data: { jobId } }); } catch { return null; } }, retry: false });
  const el = useQuery({ queryKey: ["bulk-electricians", biz], queryFn: () => {
    if (!biz) throw new Error("Couldn't check this job's installer.");
    return getEl({ data: { businessId: biz } });
  }, enabled: !!biz && team.isFetched && !team.data });
  const [plan, setPlan] = useState<ElectricianPlan | null>(null);
  const [who, setWho] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if ((!q.data?.open && !team.data?.pendingWorkerId) || !team.isFetched) return null;
  if (team.data) {
    const workers = team.data.workers;
    const picked = who || team.data.pendingWorkerId || "";
    const none = !workers.length;
    return (
      <section className="space-y-2 rounded-[18px] border border-line bg-paper p-3 shadow-card" data-mitti-electrician-question data-team-picker>
        <h2 className="text-base font-semibold">{MITTI_ELECTRICIAN_QUESTION}</h2>
        <p className="text-sm text-sub">Who does the safety check on this job? Pick one of your Team electricians.</p>
        {none ? <p className="text-sm">{TEAM_NONE_YET}</p> : (
          <select className={inputCls} value={picked} onChange={(e) => setWho(e.target.value)} aria-label="Electrician">
            <option value="">Choose the electrician</option>
            {workers.map((w) => <option key={w.id} value={w.id} disabled={!w.allowed}>{w.name}{w.reason ? ` — ${w.reason}` : ""}</option>)}
          </select>
        )}
        {msg && <p role="alert" className="text-sm">{msg}</p>}
        <Link to="/field/business/team" className="inline-flex min-h-12 items-center text-sm font-semibold underline">Open Team</Link>
        {team.data.pendingWorkerId && <p className="text-sm text-sub">Your electrician choice is saved. After updating Team, save the electrician here.</p>}
        {!none && <Button className="h-12 w-full" disabled={busy || !workers.some(w => w.id === picked && w.allowed)} onClick={async () => {
          setBusy(true); setMsg(null);
          try {
            await allocate({ data: { jobId, workerId: picked } });
            showTradeSaved(`Electrician saved: ${workers.find(w => w.id === picked)?.name ?? 'Team electrician'}`);
            await Promise.all([q.refetch(), refreshInstallerJob(qc, jobId)]);
          } catch (e) { setMsg(electricianAllocationMessage(e instanceof Error ? e.message : "Couldn't save. Please try again.", workers.find(w => w.id === picked)?.name)); }
          finally { setBusy(false); }
        }}>Save electrician</Button>}
      </section>
    );
  }
  if (!el.data) return null;
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
        ? <p className="text-sm">{TEAM_NONE_YET}</p>
        : <ElectricianPicker ownOnly value={value} onChange={setPlan} note={false} approved={approved} pending={pending} />}
      {msg && <p role="alert" className="text-sm">{msg}</p>}
      {!none && <Button className="h-12 w-full" disabled={busy || (!value.business_id && !value.nomination_id)} onClick={async () => {
        setBusy(true); setMsg(null);
        try {
          await save({ data: { jobId, plan: { mode: "mine", business_id: value.business_id ?? null, nomination_id: value.nomination_id ?? null } } });
          showTradeSaved('Electrician saved');
          await Promise.all([q.refetch(), refreshInstallerJob(qc, jobId)]);
        } catch (e) { setMsg(e instanceof Error ? e.message : "Couldn't save. Please try again."); }
        finally { setBusy(false); }
      }}>Save electrician</Button>}
    </section>
  );
}
