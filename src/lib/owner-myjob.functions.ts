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

/** Public, no-login (A48 batch 1 final fix): whether My job shows the life support plan upload. Token-scoped. */
export const getLifeSupportPlanState = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({ token: z.string().max(200) }).parse(d))
  .handler(async ({ data }) => {
    const { ownerLifeSupportPlanState } = await import("./owner-myjob.server");
    return ownerLifeSupportPlanState(data.token);
  });

/** Public, no-login: a signed upload slot for the owner's life support plan (photo or PDF). The job comes from the token. */
export const startLifeSupportPlanUploadFn = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({ token: z.string().max(200), fileName: z.string().max(300), mime: z.string().max(100), size: z.number() }).parse(d))
  .handler(async ({ data }) => {
    const { startLifeSupportPlanUpload } = await import("./owner-myjob.server");
    return startLifeSupportPlanUpload(data.token, data);
  });

/** Public, no-login: records the uploaded plan (one documents row, kind life_support_plan). */
export const finishLifeSupportPlanUploadFn = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({ token: z.string().max(200), path: z.string().max(300), fileName: z.string().max(300) }).parse(d))
  .handler(async ({ data }) => {
    const { finishLifeSupportPlanUpload } = await import("./owner-myjob.server");
    return finishLifeSupportPlanUpload(data.token, data);
  });
