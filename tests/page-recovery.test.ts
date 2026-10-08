import { expect, test } from "bun:test";
import { isRecoverableTransportError } from "@/lib/page-recovery.core";

test("flags an aborted stream", () => {
  expect(isRecoverableTransportError(new Error("aborted"))).toBe(true);
});

test("flags an AbortError from a cancelled request", () => {
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  expect(isRecoverableTransportError(error)).toBe(true);
});

test("flags a server function request whose payload could not be read", () => {
  expect(
    isRecoverableTransportError(
      new TypeError("Cannot read properties of undefined (reading 'method')"),
    ),
  ).toBe(true);
});

test("flags dropped-connection failures from each browser engine", () => {
  expect(isRecoverableTransportError(new TypeError("Failed to fetch"))).toBe(true);
  expect(isRecoverableTransportError(new Error("Load failed"))).toBe(true);
  expect(isRecoverableTransportError(new Error("socket hang up"))).toBe(true);
  expect(isRecoverableTransportError(new Error("read ECONNRESET"))).toBe(true);
  expect(isRecoverableTransportError(new Error("Network request failed"))).toBe(true);
  expect(isRecoverableTransportError(new TypeError("Importing a module script failed."))).toBe(true);
  expect(isRecoverableTransportError(new TypeError("Failed to fetch dynamically imported module"))).toBe(true);
});

test("does not flag ordinary application errors", () => {
  expect(isRecoverableTransportError(new Error("Job not found"))).toBe(false);
  expect(isRecoverableTransportError(new Error("Cannot read properties of undefined (reading 'jobId')"))).toBe(false);
  expect(isRecoverableTransportError(new Error("You are not authorised to view this job"))).toBe(false);
  expect(isRecoverableTransportError("Something went wrong")).toBe(false);
});

test("does not flag a rejected server response", () => {
  expect(isRecoverableTransportError(new Response("Unauthorized", { status: 401 }))).toBe(false);
});
