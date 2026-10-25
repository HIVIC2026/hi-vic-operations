// Batched reads for the tick sweeps (perf 25 Oct 2026). Fails loudly: an unreadable batch fails the sweep (the tick
// records it as failed) — it never looks like "nothing is due".
import { chunkIds } from "./sweep-batch.core";

type Page = { data: unknown[] | null; error: { message: string } | null };
type Ranged = { range: (from: number, to: number) => PromiseLike<Page> };

async function allPages(what: string, q: () => Ranged): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await q().range(from, from + 999);
    if (error) throw new Error(`Could not read ${what}: ${error.message}`);
    out.push(...((data ?? []) as Record<string, unknown>[]));
    if (!data || data.length < 1000) return out;
  }
}

/** Every row of `q(chunk)` for the given job ids: one paged query per id chunk, at most `parallel` chunks in flight. */
export async function readByJobIds<T = Record<string, unknown>>(what: string, ids: string[], q: (chunk: string[]) => Ranged, parallel = 4): Promise<T[]> {
  const chunks = chunkIds([...new Set(ids)]);
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < chunks.length; i += parallel) out.push(...(await Promise.all(chunks.slice(i, i + parallel).map((c) => allPages(what, () => q(c))))).flat());
  return out as T[];
}
