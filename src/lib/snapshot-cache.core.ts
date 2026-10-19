/**
 * A tiny keyed, short-lived cache of in-flight-or-settled reads. Pure (no I/O): the caller supplies the loader.
 *
 * - A hit returns the SAME promise, so concurrent callers share one read instead of each starting their own.
 * - An entry expires `ttlMs` after it was started; `invalidate()` drops everything immediately and also stops a
 *   read that was already running from being stored once it settles.
 * - A read that fails is never kept: the next call loads again.
 */
export function createSnapshotCache<T>(ttlMs: number) {
  const entries = new Map<string, { at: number; generation: number; value: Promise<T> }>();
  let generation = 0;
  return {
    ttlMs,
    get(key: string, load: () => Promise<T>, now = Date.now()): Promise<T> {
      const hit = entries.get(key);
      if (hit && hit.generation === generation && now - hit.at < ttlMs) return hit.value;
      const started = generation;
      const value = load();
      entries.set(key, { at: now, generation: started, value });
      value.catch(() => { if (entries.get(key)?.value === value) entries.delete(key); });
      return value;
    },
    invalidate() {
      generation++;
      entries.clear();
    },
  };
}
