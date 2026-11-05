// Portal speed step 2 (spec rule 3, "Last copy on job pages too"): while a job page is still showing the last copy kept on
// this device, its buttons wait for the fresh copy — so Send, Give, Pay, Book and Cancel never act on an old copy — and the
// page says "Updating…" (the same line as the office lists and installer screens). Presentation only: no cache of its own
// (the copies stay in trade-cache.ts / office-last-copy.ts), no wording or rule of its own.
import type { ReactNode } from "react";

/** The page's actions, held (disabled) while `waiting`; laid out exactly as without the wrapper. */
export function LastCopyWait({ waiting, children }: { waiting: boolean; children: ReactNode }) {
  return (
    <>
      {waiting && <p data-last-copy-updating className="text-xs text-sub">Updating…</p>}
      <fieldset disabled={waiting} data-last-copy-wait={waiting ? "" : undefined} className="m-0 min-w-0 border-0 p-0">{children}</fieldset>
    </>
  );
}
