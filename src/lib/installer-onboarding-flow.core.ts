// Pure orchestration for the installer onboarding tab (no React, no network): injected deps make it testable.

/** Holds the exact server revision this tab last loaded/saved. */
export type RevisionRef = { current: string | null };

/**
 * Own insurance upload: send the held revision, then adopt the server's new revision ONLY if the tab still
 * holds the one it sent (navigation is locked meanwhile). Typed, unsaved answers stay in local state untouched;
 * the upload changes only the certificate columns, never the saved answers.
 */
export async function uploadWithRevision<T extends { updated_at: string }>(rev: RevisionRef, confirm: (base: string) => Promise<T>): Promise<T> {
  const base = rev.current;
  if (!base) throw new Error("Reload the page to continue your application.");
  const r = await confirm(base);
  if (rev.current === base) rev.current = r.updated_at;
  return r;
}

export type SignDeps = {
  load: () => Promise<{ status: string; updated_at: string | null }>;
  saveReviewed: () => Promise<void>;
  agreement: () => Promise<{ sha256: string; updated_at: string }>;
  revision: () => string | null;
  sign: (expectedUpdatedAt: string, sha256: string) => Promise<{ outcome: string; signed_at: string }>;
};
export const REVIEW_AGAIN = "The agreement changed since you reviewed it. Please review it again before signing.";

/**
 * Sign with lost-response recovery: if an earlier attempt already committed (status submitted), skip the
 * draft save and replay the idempotent sign with the exact reviewed hash; the server returns the original
 * signature or refuses a different agreement.
 */
export async function signWithRecovery(reviewedSha: string | null, deps: SignDeps) {
  if (!reviewedSha) throw new Error(REVIEW_AGAIN);
  const now = await deps.load();
  if (now.status !== "draft") return deps.sign(now.updated_at ?? new Date(0).toISOString(), reviewedSha);
  await deps.saveReviewed();
  const current = await deps.agreement();
  if (current.sha256 !== reviewedSha || Date.parse(current.updated_at) !== Date.parse(deps.revision() ?? "")) throw new Error(REVIEW_AGAIN);
  try {
    return await deps.sign(current.updated_at, current.sha256);
  } catch (error) {
    // The database may have committed even when the browser lost the response. Re-read once and use
    // the RPC's hash-checked replay path only when the application is now submitted.
    const after = await deps.load();
    if (after.status !== "draft") return deps.sign(after.updated_at ?? new Date(0).toISOString(), reviewedSha);
    throw error;
  }
}
