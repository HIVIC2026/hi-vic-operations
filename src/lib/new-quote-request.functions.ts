// Batch 3a Task 2: the owner's "Send me a new quote" (My job `?screen=newquote`). Literal createServerFn chain (AGENTS);
// the only input is the secure My job link token — the server resolves the job from it.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { withRequestMeta } from "./request-meta";

/** Owner: ask for a new quote after the old one expired. `thanks` (also on a second tap) or `refused` (nothing written). */
export const ownerRequestNewQuoteFn = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({ token: z.string().max(200) }).parse(d))
  .handler(async ({ data }) => (await import("./new-quote-request.server")).requestNewQuote(data.token));
