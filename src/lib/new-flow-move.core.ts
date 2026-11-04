// Part 3 Task 18: the safety check before an installer is moved onto "installer calls and books" (the in-house path,
// businesses.in_house). Pure: no network, no database. The move itself is the existing save_in_house_partner RPC.
export type NewFlowMoveFacts = {
  inHouse: boolean;
  officePhone: string | null;
  email: string | null;
  electricians: number;
  piesaRateIncGst: number | null;
  /** Real jobs (test, deleted and cancelled left out) still at an old pre-acceptance step, one row per step. */
  oldStepJobs: { step: string; count: number }[];
};

const has = (v: string | null | undefined) => (v ?? "").trim().length > 0;

/** Why this installer cannot be moved yet. Empty = safe to move. */
export function newFlowMoveBlockers(f: NewFlowMoveFacts): string[] {
  if (f.inHouse) return ["Already on the new flow"];
  const out: string[] = [];
  if (!has(f.officePhone)) out.push("No office phone");
  if (!has(f.email)) out.push("No business email");
  if (f.electricians < 1) out.push("No electrician in Team");
  if (f.piesaRateIncGst == null || !Number.isFinite(f.piesaRateIncGst) || f.piesaRateIncGst <= 0) out.push("No PIESA rate on the rate card");
  for (const s of f.oldStepJobs) if (s.count > 0) out.push(`${s.count} real ${s.count === 1 ? "job" : "jobs"} still at: ${s.step}`);
  return out;
}
