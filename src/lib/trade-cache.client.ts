// Last copy of an installer screen, kept on this phone so a return visit draws at once while a fresh copy loads.
// Speed only: keyed per signed-in user, ignored after 24 hours, cleared on sign-out. Any storage failure = no cache.
const PREFIX = "hiv-trade:v1:";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

const store = (): Storage | null => {
  try { return (globalThis as { localStorage?: Storage }).localStorage ?? null; } catch { return null; }
};

export function readTradeCache<T>(userId: string, key: string): { data: T; at: number } | null {
  try {
    const raw = store()?.getItem(`${PREFIX}${userId}:${key}`);
    if (!raw) return null;
    const v = JSON.parse(raw) as { at?: unknown; data?: unknown };
    if (typeof v.at !== "number" || v.data === undefined) return null;
    if (Date.now() - v.at > MAX_AGE_MS) return null;
    return { data: v.data as T, at: v.at };
  } catch { return null; }
}

/** Call only after a successful fetch, so an error is never kept. */
export function writeTradeCache(userId: string, key: string, data: unknown): void {
  try { store()?.setItem(`${PREFIX}${userId}:${key}`, JSON.stringify({ at: Date.now(), data })); } catch { /* no cache is fine */ }
}

export function clearTradeCache(): void {
  try {
    const s = store();
    if (!s) return;
    const keys: string[] = [];
    for (let i = 0; i < s.length; i++) { const k = s.key(i); if (k && k.startsWith(PREFIX)) keys.push(k); }
    for (const k of keys) s.removeItem(k);
  } catch { /* nothing to clear */ }
}
