/** Independent existing-form pull; deliberately excludes allocation and delivery sweeps. */
export async function runMittiPullWorker(deps: {
  pending: () => Promise<{ ok: boolean }[]>;
  completed: () => Promise<{ retried: number; watched: number; failed?: number }>;
}) {
  const timingsMs: Record<string, number> = {};
  const errors: string[] = [];
  const started = Date.now();
  let mitti: { checked: number; failed: number } | null = null;
  let mittiCompleted: { retried: number; watched: number } | null = null;
  let at = Date.now();
  try {
    const rows = await deps.pending();
    mitti = { checked: rows.length, failed: rows.filter((row) => !row.ok).length };
    if (mitti.failed) errors.push("Pending Mitti forms could not all be pulled");
  } catch (error) { errors.push(error instanceof Error ? error.message : "Pending Mitti pull failed"); }
  finally { timingsMs['syncPendingMitti'] = Date.now() - at; }
  at = Date.now();
  try {
    const result = await deps.completed();
    mittiCompleted = result;
    if (result.failed) errors.push("Completed Mitti forms could not all be pulled");
  }
  catch (error) { errors.push(error instanceof Error ? error.message : "Completed Ready Check sweep failed"); }
  finally { timingsMs['sweepCompletedMittiReadyChecks'] = Date.now() - at; }
  return { ok: errors.length === 0, mitti, mittiCompleted, errors, timingsMs: { total: Date.now() - started, ...timingsMs } };
}