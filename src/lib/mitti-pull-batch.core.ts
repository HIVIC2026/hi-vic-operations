export type PullRow = { id: string };
export type PullDeps<T extends PullRow> = {
  page: (offset: number, size: number) => Promise<T[]>;
  cursor: () => Promise<string | null>;
  checkpoint: (id: string) => Promise<void>;
  sync: (row: T) => Promise<{ ok: boolean; message?: string }>;
  failure: (id: string, message: string) => Promise<void>;
  now?: () => number;
};
/** Serial work keeps nested sync requests within the six-connection runtime budget.
 * Checkpoint completed attempts (including failures) so a bad form cannot starve later jobs.
 * Never race a writer against a timer: finish the current job before yielding. */
export async function pullMittiPages<T extends PullRow>(deps: PullDeps<T>, opts: { pageSize?: number; budgetMs?: number } = {}) {
  const now = deps.now ?? Date.now, started = now(), size = opts.pageSize ?? 200;
  const rows = new Map<string, T>();
  for (let offset = 0; ; offset += size) {
    const page = await deps.page(offset, size);
    for (const row of page) rows.set(row.id, row);
    if (page.length < size) break;
  }
  const cursor = await deps.cursor();
  const sorted = [...rows.values()].sort((a, b) => a.id.localeCompare(b.id));
  const ordered = cursor ? [...sorted.filter(r => r.id > cursor), ...sorted.filter(r => r.id <= cursor)] : sorted;
  let checked = 0, failed = 0;
  for (const row of ordered) {
    if (now() - started >= (opts.budgetMs ?? 40_000)) return { checked, failed, deferred: true };
    let result: { ok: boolean; message?: string };
    try { result = await deps.sync(row); }
    catch (error) { result = { ok: false, message: error instanceof Error ? error.message : "Mitti sync failed" }; }
    checked++;
    if (!result.ok) { failed++; await deps.failure(row.id, result.message ?? "Mitti sync failed"); }
    await deps.checkpoint(row.id);
  }
  return { checked, failed, deferred: false };
}