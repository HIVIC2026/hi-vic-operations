import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { setWorkerRole } from "@/lib/worker-links.functions";
import { WORKER_ROLE_LABEL, type WorkerRole } from "@/lib/worker-role.core";

/** Jo 28 Oct: Lead / Crew switch for one installer person. Applies straight away; the server records the change. */
export function LeadCrewSwitch({ workerId, role, onChanged }: { workerId: string; role: WorkerRole; onChanged?: () => void }) {
  const save = useServerFn(setWorkerRole);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pick = async (to: WorkerRole) => {
    if (to === role || busy) return;
    setBusy(true); setErr(null);
    try { await save({ data: { workerId, role: to } }); onChanged?.(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <span className="inline-flex flex-col">
      <span role="radiogroup" aria-label="Lead or Crew" data-lead-crew className="inline-flex overflow-hidden rounded-[10px] border border-estimate-line">
        {(["lead", "crew"] as const).map((r) => (
          <button key={r} type="button" role="radio" aria-checked={role === r} disabled={busy} onClick={() => void pick(r)}
            className={`min-h-11 px-3 text-[13px] font-semibold ${role === r ? "bg-estimate-blue text-white" : "bg-white text-estimate-blue"}`}>{WORKER_ROLE_LABEL[r]}</button>
        ))}
      </span>
      {err && <span role="alert" className="mt-1 text-[13px] font-semibold text-[#8A3B4A]">{err}</span>}
    </span>
  );
}
