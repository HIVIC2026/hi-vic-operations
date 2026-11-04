// The two refusals a business-owner-only read gives a staff login (trade-view.server bossOrThrow / tradeMoney). PURE, no
// imports: the phone's last-copy store (trade-cache.ts, on every page's first download) matches them to drop a kept copy
// when the server says this person may no longer see it (plan Task 3, review focus 1).
export const OWNER_ONLY_REFUSALS: readonly string[] = ["Only the business owner can see this.", "Money is only shown to the business owner."];

export function isOwnerOnlyRefusal(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof (error as { message?: unknown } | null)?.message === "string" ? (error as { message: string }).message : null;
  return message !== null && OWNER_ONLY_REFUSALS.includes(message);
}
