import { expect, test } from "bun:test";
import { isConnectionTeardown } from "@/lib/http-abort";
import { renderReloadPage } from "@/lib/error-page";
import { readFileSync } from "node:fs";

test("recognises the preview's node HTTP abort without classifying application errors", () => {
  const error = new Error("aborted");
  error.stack = "Error: aborted\n    at abortIncoming (node:_http_server:838:17)\n    at socketOnClose (node:_http_server:832:3)";
  expect(isConnectionTeardown(error)).toBe(true);
  expect(isConnectionTeardown(new Error("Quote was aborted by the owner"))).toBe(false);
  expect(isConnectionTeardown(new Error("Job not found"))).toBe(false);
  expect(isConnectionTeardown(Object.assign(new Error("HTTPError"), { statusCode: 500, cause: error }))).toBe(true);
});

test("all server layers show a reload page instead of returning a blank response", () => {
  const page = renderReloadPage();
  expect(page).toContain("Refresh");
  expect(page).toContain("location.reload()");
  const server = readFileSync("src/server.ts", "utf8");
  const start = readFileSync("src/start.ts", "utf8");
  expect(server).toContain("isConnectionTeardown(captured)");
  expect(server).toContain("isConnectionTeardown(error)");
  expect(start).toContain("isConnectionTeardown(error)");
  expect(start).not.toContain("new Response(null, { status: 499 })");
});

test("page rendering is detached from the local adapter's response-close signal", () => {
  const server = readFileSync("src/server.ts", "utf8");
  expect(server).toContain("function detachedPageRequest(request: Request)");
  expect(server).toContain("rewritten ?? detachedPageRequest(request)");
  expect(server).toContain('request.method !== "GET" && request.method !== "HEAD"');
});