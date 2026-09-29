// Captures caller IP / user agent for acceptance evidence (server-side middleware only).
import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

export const withRequestMeta = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const req = getRequest();
  const ip = req?.headers.get("cf-connecting-ip") ?? req?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const hostname = req ? new URL(req.url).hostname : "";
  const assessmentTestMode = hostname === "localhost" || hostname === "127.0.0.1" || hostname.includes("-preview--") || hostname.includes("-dev.lovable.app");
  return next({ context: { ip, userAgent: req?.headers.get("user-agent") ?? null, assessmentTestMode } });
});
