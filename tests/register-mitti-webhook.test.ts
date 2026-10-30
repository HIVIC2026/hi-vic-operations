import { expect, test } from "bun:test";
import { buildRegistration, maskToken, missingEnv, WEBHOOK_EVENTS } from "../scripts/register-mitti-webhook.core";

test("mask shows first 4 chars only", () => {
  expect(maskToken("abcdefgh")).toBe("abcd…");
  expect(maskToken("ab")).toBe("…");
});
test("request url, events, trailing slash", () => {
  const r = buildRegistration("https://portal.example.com/", "secret123");
  expect(r.body.url).toBe("https://portal.example.com/api/public/hooks/mitti-audit?t=secret123");
  expect(r.body.trigger_events).toEqual(["audit.updated", "audit.completed"]);
  expect([...WEBHOOK_EVENTS]).toEqual(r.body.trigger_events);
});
test("masked body hides the token", () => {
  const r = buildRegistration("https://p.example.com", "secret123");
  expect(JSON.stringify(r.maskedBody)).not.toContain("secret123");
  expect(r.maskedBody.url).toContain("?t=secr…");
});
test("missing env listed", () => {
  expect(missingEnv({ MITTI_API_TOKEN: "x" })).toEqual(["MITTI_WEBHOOK_TOKEN", "PORTAL_PUBLIC_URL"]);
});
