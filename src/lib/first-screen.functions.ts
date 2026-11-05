// Portal speed step 2, Task 6: the one call /portal makes after sign-in (first-screen.server.ts). Literal createServerFn
// chain (AGENTS). Reads only; every screen and server function still checks access itself.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getFirstScreen = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { firstScreenAfterSignIn } = await import("./first-screen.server");
    return firstScreenAfterSignIn(context.userId, {
      tradeHome: async (userId) => (await import("./trade-view.server")).tradeHome(userId),
      officeIdentity: async () => (await import("./qa-office-access.server")).requireOfficeIdentity(context.supabase, context),
      // Exactly getNeedsMePage's office-admin answer (includeTest false, no refresh): the saved copy.
      needsMe: async () => (await import("./office-needs-snapshot.server")).getNeedsMeSnapshot(false),
    });
  });
