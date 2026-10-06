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

/** Public, no-login: owner cancels their own job before the safety check is booked. Token-scoped. */
export const cancelMyJob = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({ token: z.string().max(200) }).parse(d))
  .handler(async ({ data }) => {
    const { cancelOwnerJob } = await import("./owner-myjob.server");
    return cancelOwnerJob(data.token).catch(() => ({ ok: false, reason: "Something went wrong. Please try again." }));
  });
