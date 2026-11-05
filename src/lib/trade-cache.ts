// Last copy of an installer screen, kept on this phone so a return visit draws at once while a fresh copy loads.
// Speed only: keyed per signed-in user, ignored after 24 hours, cleared on sign-out. Any storage failure = no cache.
// Office lists keep theirs the same way under "hiv-last:v1:" (readLastCopy / writeLastCopy); sign-out clears both.
import { isOwnerOnlyRefusal } from "./owner-only.core";

const PREFIX = "hiv-trade:v1:";
const LAST_PREFIX = "hiv-last:v1:";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
// Job pages get one copy each, so they are capped: the 15 most recently saved per user (oldest dropped on write).
const MAX_JOB_COPIES = 15;
const JOB_COPY_NAMES = ["office-job:", "job-bundle:"];

// Set by clearTradeCache (sign-out): a fetch still in flight must not write the old user's answer back. Sign-out reloads the page.
let signedOut = false;
/** Tests only. */
export function resetTradeCacheSignOut(): void { signedOut = false; }

const store = (): Storage | null => {
  try { return (globalThis as { localStorage?: Storage }).localStorage ?? null; } catch { return null; }
};

function read<T>(prefix: string, userId: string, key: string): { data: T; at: number } | null {
  if (!userId) return null;
  try {
    const raw = store()?.getItem(`${prefix}${userId}:${key}`);
    if (!raw) return null;
    const v = JSON.parse(raw) as { at?: unknown; data?: unknown };
    if (typeof v.at !== "number" || v.data === undefined) return null;
    if (Date.now() - v.at > MAX_AGE_MS) { try { store()?.removeItem(`${prefix}${userId}:${key}`); } catch { /* ignore */ } return null; } // too old: delete it
    if (v.at > Date.now()) return null; // stamped in the future (clock set back)
    return { data: v.data as T, at: v.at };
  } catch { return null; }
}

function write(prefix: string, userId: string, key: string, data: unknown): void {
  if (signedOut || !userId) return;
  try {
    store()?.setItem(`${prefix}${userId}:${key}`, JSON.stringify({ at: Date.now(), data }));
    if (JOB_COPY_NAMES.some((n) => key.startsWith(n))) capJobCopies(prefix, userId, key);
  } catch { /* no cache is fine */ }
}

/** Keep at most MAX_JOB_COPIES job-page copies of this kind for this user; the oldest saved go first. */
function capJobCopies(prefix: string, userId: string, key: string): void {
  const s = store();
  if (!s) return;
  const family = `${prefix}${userId}:${JOB_COPY_NAMES.find((n) => key.startsWith(n))}`;
  const found: { k: string; at: number }[] = [];
  for (let i = 0; i < s.length; i++) {
    const k = s.key(i);
    if (!k || !k.startsWith(family)) continue;
    let at = 0;
    try { const a = (JSON.parse(s.getItem(k) ?? "") as { at?: unknown }).at; if (typeof a === "number") at = a; } catch { /* unreadable = oldest */ }
    found.push({ k, at });
  }
  if (found.length <= MAX_JOB_COPIES) return;
  found.sort((a, b) => b.at - a.at);
  for (const f of found.slice(MAX_JOB_COPIES)) s.removeItem(f.k);
}

export function readTradeCache<T>(userId: string, key: string): { data: T; at: number } | null { return read<T>(PREFIX, userId, key); }

/** Call only after a successful fetch, so an error is never kept. */
export function writeTradeCache(userId: string, key: string, data: unknown): void { write(PREFIX, userId, key, data); }

/** Last copy of an office list or other screen (same rules as the installer cache, own prefix). */
export function readLastCopy<T>(userId: string, key: string): { data: T; at: number } | null { return read<T>(LAST_PREFIX, userId, key); }

/** Call only after a successful fetch, so an error is never kept. */
export function writeLastCopy(userId: string, key: string, data: unknown): void { write(LAST_PREFIX, userId, key, data); }

/** Drop one entry (a screen the server no longer answers for this user). */
export function dropTradeCache(userId: string, key: string): void {
  try { store()?.removeItem(`${PREFIX}${userId}:${key}`); } catch { /* nothing to drop */ }
}

/** An owner-only screen's fetch was refused (this person is no longer the business owner): drop the kept copy so it
 *  never shows again. Any other failure (no signal, server down) keeps the copy. Never throws. */
export function forgetRefusedCopy(userId: string, key: string, error: unknown): void {
  if (isOwnerOnlyRefusal(error)) dropTradeCache(userId, key);
}

export function clearTradeCache(): void {
  signedOut = true;
  clearLastCopies();
}

/** Remove every kept copy (both prefixes) without blocking later writes: signing in over an existing session. */
export function clearLastCopies(): void {
  try {
    const s = store();
    if (!s) return;
    const keys: string[] = [];
    for (let i = 0; i < s.length; i++) { const k = s.key(i); if (k && (k.startsWith(PREFIX) || k.startsWith(LAST_PREFIX))) keys.push(k); }
    for (const k of keys) s.removeItem(k);
  } catch { /* nothing to clear */ }
}
