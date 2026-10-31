// What the app forgets and refreshes when the sign-in changes (called from the root's onAuthStateChange listener).
// On SIGNED_OUT nothing of the signed-out person may stay in this tab: the in-memory Query cache is cancelled and
// cleared, the trade last copies and the installer head starts are dropped. Without this, a background sign-out (the
// auth server refusing the saved session) followed by someone else signing in on /auth, with no reload, would let the
// next person's screens draw the previous person's answers from memory until their own fetch returned.
import type { QueryClient } from "@tanstack/react-query";
import { clearTradeCache } from "./trade-cache";
import { forgetHeadStarts } from "./trade-route-prefetch";

export function refreshForAuthChange(event: string, router: { invalidate: () => unknown }, queryClient: QueryClient): void {
  if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
  if (event === "SIGNED_OUT") {
    void queryClient.cancelQueries();
    queryClient.clear();
    clearTradeCache();
    forgetHeadStarts();
  }
  void router.invalidate();
  if (event !== "SIGNED_OUT") void queryClient.invalidateQueries();
}
