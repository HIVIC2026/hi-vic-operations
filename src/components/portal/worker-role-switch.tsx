// Jo 28 Oct 2026: Lead / Crew switch for an installer person (My business › Team and the office business file).
// Calls setWorkerRole (HIV admins and the business's own business_admin); applies straight away.
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { setWorkerRole } from "@/lib/worker-links.functions";
import { WORKER_ROLE_LABEL, type WorkerRole } from "@/lib/worker-role.core";

export function WorkerRoleSwitch({ workerId, role, onDone, tone = "trade" }: { workerId: string; role: WorkerRole; onDone: () => void; tone?: "trade" | "office" }) {
  const save = useServerFn(setWorkerRole);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const trade = tone === "trade";
  const base = trade ? "min-h-11 px-3 text-[13px] font-semibold" : "min-h-8 px-2.5 text-xs font-semibold";
  const on = trade ? "bg-estimate-blue text-white" : "bg-hiv-blue text-white";
  const off = trade ? "bg-white text-estimate-blue" : "bg-white text-hiv-blue";
  const pick = async (to: WorkerRole) => {
    if (to === role || busy) return;
    setBusy(true); setErr(null);
    try { await save({ data: { id: workerId, role: to } }); onDone(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <span data-worker-role={role} className="inline-flex flex-col">
      <span role="group" aria-label="Lead Installer or Crew" className={`inline-flex overflow-hidden rounded-[10px] border ${trade ? "border-estimate-line" : "border-line"}`}>
        {(["lead", "crew"] as const).map((r) => (
          <button key={r} type="button" aria-pressed={role === r} disabled={busy} onClick={() => void pick(r)} className={`${base} ${role === r ? on : off} disabled:opacity-60`}>{r==='lead'?'Lead Installer':WORKER_ROLE_LABEL[r]}</button>
        ))}
      </span>
      {err && <span role="alert" className="mt-1 text-xs font-semibold text-destructive">{err}</span>}
    </span>
  );
}
