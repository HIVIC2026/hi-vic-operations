import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { withRequestMeta } from "./request-meta";

const tok = z.string().max(200);

/** Public, no-login: the job-bound secure link token is the only credential. */
export const getCaptureStatus = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({ token: tok }).parse(d))
  .handler(async ({ data }) => {
    const { captureStatus } = await import("./owner-capture.server");
    return captureStatus(data.token);
  });

export const startCaptureUpload = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({ token: tok, fileName: z.string().max(300), mime: z.string().max(100), size: z.number() }).parse(d))
  .handler(async ({ data }) => {
    const { startCapture } = await import("./owner-capture.server");
    return startCapture(data.token, data);
  });

export const finishCaptureUpload = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({ token: tok, path: z.string().max(300), fileName: z.string().max(300), deviceModifiedAt: z.number().nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    const { finishCapture } = await import("./owner-capture.server");
    return finishCapture(data.token, data, { userAgent: context.userAgent });
  });
