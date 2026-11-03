// Speed (portal speed step 1, task 9): an office list draws at once from the last copy kept on this device, then
// refreshes in place. Same rules as the installer cache (trade-cache.ts): per signed-in user, 24 h, cleared on sign-out,
// written only from a good answer. One copy per list (the opening view, first page, no search), so storage stays small.
// The user id comes from the signed-in route context (checked by the guard), never from storage.
import { useEffect } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { readLastCopy, writeLastCopy } from "./trade-cache";

type Stored = { k: string; d: unknown };
const keyText = (queryKey: readonly unknown[]) => JSON.stringify(queryKey);
// Keys whose cache entry is still the copy from this device (value = its dataUpdatedAt). Gone once fresh data replaces it.
const showing = new Map<string, number>();

/** Put the stored copy for this exact list into the Query cache (only if the cache has nothing yet). True if it did. */
export function seedLastCopy(qc: QueryClient, uid: string | undefined, name: string, queryKey: readonly unknown[]): boolean {
  try {
    if (!uid || qc.getQueryData(queryKey as unknown[]) !== undefined) return false;
    const hit = readLastCopy<Stored>(uid, name);
    const k = keyText(queryKey);
    if (!hit || hit.data?.k !== k || hit.data.d === undefined) return false;
    qc.setQueryData(queryKey as unknown[], hit.data.d, { updatedAt: hit.at });
    showing.set(k, hit.at);
    return true;
  } catch { return false; }
}

/** True while this list on screen is still the copy from this device (the fresh one has not arrived). */
export function isLastCopy(queryKey: readonly unknown[], dataUpdatedAt: number): boolean {
  return showing.get(keyText(queryKey)) === dataUpdatedAt && dataUpdatedAt > 0;
}

/** Keep each fresh good answer as the next visit's last copy. Never from an error, a placeholder, or the copy itself. */
export function useRememberLastCopy(uid: string | undefined, name: string, eligible: boolean, queryKey: readonly unknown[], q: { isSuccess: boolean; isPlaceholderData: boolean; data: unknown; dataUpdatedAt: number }): void {
  const k = keyText(queryKey);
  useEffect(() => {
    if (!uid || !eligible || !q.isSuccess || q.isPlaceholderData || q.data === undefined) return;
    if (showing.get(k) === q.dataUpdatedAt) return; // still the copy from this device
    const prev = readLastCopy<Stored>(uid, name);
    if (prev && prev.data?.k === k && prev.at >= q.dataUpdatedAt) return;
    writeLastCopy(uid, name, { k, d: q.data });
  }, [uid, name, eligible, k, q.isSuccess, q.isPlaceholderData, q.data, q.dataUpdatedAt]);
}
