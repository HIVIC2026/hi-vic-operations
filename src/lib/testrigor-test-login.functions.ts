import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Decision 403. No caller-selected identity, actor, business or email. Never put the result in Query cache. */
export const downloadTestRigorLogins = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({}).strict().parse(input ?? {}))
  .handler(async ({ context }) => {
    const { issueTestRigorDownload } = await import("./testrigor-test-login.server");
    return issueTestRigorDownload(context);
  });
