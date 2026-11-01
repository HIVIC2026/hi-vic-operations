import { paidGateWarningLine, type PaidGateWarning } from "./paid-gate-warning.core";

type Job = { id: string; stage: string; at: string };
export type PaidGateReaders = {
  paid: (id: string) => Promise<boolean>;
  blockers: (id: string) => Promise<string[]>;
};
/** Re-read the same PIESA entry gates that silently stop dispatch; never invoke dispatch/progression. */
export async function paidGateWarnings(jobs: Job[], readers?: PaidGateReaders): Promise<Map<string, PaidGateWarning>> {
  const deps = readers ?? {
    paid: async (id: string) => {
      const { jobPaymentView } = await import("./payments.server");
      const view = await jobPaymentView(id);
      return view?.steps.some(s => s.key === "safety_check" && s.state === "paid") === true;
    },
    blockers: async (id: string) => {
      const { stageEntryBlockers } = await import("./workflow.server");
      return stageEntryBlockers(id, "piesa_and_install_window_pending", null);
    },
  };
  const out = new Map<string, PaidGateWarning>();
  const candidates = jobs.filter(j => ["measured_quote_accepted", "piesa_and_install_window_pending"].includes(j.stage));
  // Bound remote work without ever dropping jobs at a row cap or hiding a failed read.
  for (let i = 0; i < candidates.length; i += 4) await Promise.all(candidates.slice(i, i + 4).map(async j => {
    if (!await deps.paid(j.id)) return;
    const f = { paid: true, at: j.at, blockers: await deps.blockers(j.id) };
    if (paidGateWarningLine(f)) out.set(j.id, f);
  }));
  return out;
}