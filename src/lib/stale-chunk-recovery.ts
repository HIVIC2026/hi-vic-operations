// After a new version goes live, an open tab can fail to load page files that no longer exist (vite:preloadError).
// Links preload a page's files on hover/touch. A failure during such a preload must NOT reload the tab (someone may be
// mid-way through a form): it is held, and the tab reloads at the next real navigation instead. A failure while a
// real navigation is loading reloads at once, as before.

type Preload = (...args: never[]) => Promise<unknown>;
export type RecoverableRouter = {
  preloadRoute: Preload;
  state: { isLoading: boolean };
  subscribe(eventType: "onBeforeLoad", fn: () => void): unknown;
};

export function createStaleChunkRecovery(reload: () => boolean) {
  let router: RecoverableRouter | null = null;
  let preloading = 0;
  let held = false;
  return {
    /** Browser only: count link preloads and reload on the next navigation if a preload hit a stale file. */
    attach(r: RecoverableRouter): void {
      router = r;
      const preload = r.preloadRoute.bind(r) as Preload;
      r.preloadRoute = ((...args: never[]) => {
        preloading++;
        let p: Promise<unknown>;
        try {
          p = preload(...args);
        } catch (e) {
          preloading--;
          throw e;
        }
        return p.finally(() => {
          preloading--;
        });
      }) as Preload;
      r.subscribe("onBeforeLoad", () => {
        if (!held) return;
        held = false;
        reload();
      });
    },
    /** The vite:preloadError handler. */
    onPreloadError(ev: { preventDefault(): void }): void {
      if (router && preloading > 0 && !router.state.isLoading) {
        held = true; // the preload just fails quietly; the navigation that follows reloads
        return;
      }
      if (reload()) ev.preventDefault();
    },
  };
}
