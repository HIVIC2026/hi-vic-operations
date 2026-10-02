// Captures caller IP / user agent for acceptance evidence (server-side middleware only).
import { createMiddleware } from "@tanstack/react-start";
import { getCookie, getRequest, setCookie, setResponseStatus } from "@tanstack/react-start/server";
import { START_LIMIT_MESSAGE, VISITOR_COOKIE, isVisitorId, newResumeToken } from "./onboarding-security.core";

export const withRequestMeta = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const req = getRequest();
  const ip = req?.headers.get("cf-connecting-ip") ?? req?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  // Rate limiting trusts only the edge-set header; x-forwarded-for can be supplied by the caller.
  const edgeIp = req?.headers.get("cf-connecting-ip")?.trim() || null;
  const hostname = req ? new URL(req.url).hostname : "";
  const assessmentTestMode = hostname === "localhost" || hostname === "127.0.0.1" || hostname.includes("-preview--") || hostname.includes("-dev.lovable.app");
  return next({ context: { ip, edgeIp, userAgent: req?.headers.get("user-agent") ?? null, assessmentTestMode } });
});

/** Public onboarding: a start/contact limit refusal is returned as HTTP 429 with the generic message. */
export const withStartLimitStatus = createMiddleware({ type: "function" }).server(async ({ next }) => {
  try {
    return await next();
  } catch (e) {
    if (e instanceof Error && e.message === START_LIMIT_MESSAGE) setResponseStatus(429);
    throw e;
  }
});

/**
 * Public onboarding: a server-generated first-party visitor identifier (HttpOnly cookie, 30 days).
 * Only ever stored as an HMAC. A visitor without the cookie gets a fresh one, never a shared bucket.
 */
export const withVisitorId = createMiddleware({ type: "function" }).server(async ({ next }) => {
  let visitorId = getCookie(VISITOR_COOKIE) ?? null;
  if (!isVisitorId(visitorId)) {
    visitorId = newResumeToken();
    setCookie(VISITOR_COOKIE, visitorId, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 30 * 24 * 3600 });
  }
  return next({ context: { visitorId: visitorId as string } });
});
