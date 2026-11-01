export type PullRow = { id: string };
export type PullDeps<T extends PullRow> = {
  page: (offset: number, size: number) => Promise<T[]>;
  cursor: () => Promise<string | null>;
  checkpoint: (id: string) => Promise<void>;
  sync: (row: T) => Promise<{ ok: boolean; message?: string }>;
  failure: (id: string, message: string) => Promise<void>;
  now?: () => number;
};
/** Initial regression fixture models the existing single-page serial sweep. */
export async function pullMittiPages<T extends PullRow>(deps: PullDeps<T>, opts: { pageSize?: number; budgetMs?: number } = {}) {
  const rows = await deps.page(0, opts.pageSize ?? 200);
  let checked = 0, failed = 0;
  for (const row of rows) { await deps.sync(row); checked++; }
  return { checked, failed, deferred: false };
}