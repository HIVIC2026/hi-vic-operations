import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { withRequestMeta } from "./request-meta";

/** Public, no-login: the secure link token is the only credential. Generic null on any failure. Read-only. */
export const getOwnerMyJob = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({ token: z.string().max(200) }).parse(d))
  .handler(async ({ data }) => {
    const { resolveOwnerJob } = await import("./owner-myjob.server");
    return JSON.parse(JSON.stringify(await resolveOwnerJob(data.token).catch(() => null)));
  });
