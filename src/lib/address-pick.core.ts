// Owner address page: one save at a time, and the page is always usable again after a refusal, error or slow reply
// (Jo 28 Oct: wrong-state pick froze on "Saving…"). Pure so it can be tested without a browser.
export type PickResult = { ok: true } | { ok: false; error: string };
export type PickHooks = { setBusy: (b: boolean) => void; onDone: (r: PickResult) => void };

export const SAVE_TIMEOUT_MS = 20000;
export const SAVE_FAILED = "We couldn't save that address. Please try again.";

export function createAddressPicker(save: (placeId: string) => Promise<PickResult>, hooks: PickHooks, timeoutMs = SAVE_TIMEOUT_MS) {
  let inFlight = false;
  return async function pick(placeId: string): Promise<boolean> {
    if (inFlight) return false; // no double saves (double tap before the button disables)
    inFlight = true; hooks.setBusy(true);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<PickResult>((res) => { timer = setTimeout(() => res({ ok: false, error: SAVE_FAILED }), timeoutMs); });
      const r = await Promise.race([save(placeId).catch((): PickResult => ({ ok: false, error: SAVE_FAILED })), timeout]);
      hooks.onDone(r);
    } finally {
      clearTimeout(timer); inFlight = false; hooks.setBusy(false);
    }
    return true;
  };
}
