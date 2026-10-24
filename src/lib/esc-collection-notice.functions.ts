// Public (no login) server functions for an installer person's own ESC collection notice link (decision 130).
// The token is the only credential; the server stores its SHA-256 and records time, IP and user agent on acknowledgement.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { withRequestMeta } from "./request-meta";

const token = z.string().min(20).max(100).regex(/^[A-Za-z0-9_-]+$/);

export const getCollectionNoticeLink = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ token }).strict().parse(d))
  .handler(async ({ data }) => (await import("./esc-collection-notice.server")).noticeLinkPage(data.token));

export const acknowledgeCollectionNoticeLink = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({ token, ticked: z.boolean(), typedName: z.string().trim().max(200) }).strict().parse(d))
  .handler(async ({ data, context }) => (await import("./esc-collection-notice-send.server")).noticeLinkAcknowledge({ token: data.token, ticked: data.ticked, typedName: data.typedName, ip: context.ip, userAgent: context.userAgent }));
