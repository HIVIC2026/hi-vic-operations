import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** No caller-selected identity, actor, business or email. Never put the result in Query cache. */
export const downloadDadTestLogin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({}).strict().parse(input ?? {}))
  .handler(async ({ context }) => {
    const { issueDadTestDownload } = await import("./dad-test-login.server");
    return issueDadTestDownload(context);
  });