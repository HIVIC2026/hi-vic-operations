import { expect, test } from "bun:test";
import { qaPerson, qaRequestSignature, verifiedQaRequest } from "../src/lib/qa-request.core";
test("TEST email alone cannot authorise a visitor", async () => {
  expect(qaPerson("owner@hivic-test.example")).toBe(true);
  expect(await verifiedQaRequest("http://localhost:8080/calculator", new Headers(), "unit-test-key")).toBe(false);
});
test("signed preview request succeeds but production, tampering and expiry refuse", async () => {
  const now = 1793079000000, stamp = String(now);
  const headers = new Headers({ "x-hivic-qa-time": stamp, "x-hivic-qa-signature": await qaRequestSignature("unit-test-key", stamp, "/calculator") });
  expect(await verifiedQaRequest("http://localhost:8080/calculator", headers, "unit-test-key", now)).toBe(true);
  expect(await verifiedQaRequest("https://portal.homeinsulationvictoria.com.au/calculator", headers, "unit-test-key", now)).toBe(false);
  expect(await verifiedQaRequest("http://localhost:8080/auth", headers, "unit-test-key", now)).toBe(false);
  expect(await verifiedQaRequest("http://localhost:8080/calculator", headers, "unit-test-key", now + 60001)).toBe(false);
  expect(await verifiedQaRequest("http://localhost:8080/calculator", headers, undefined, now)).toBe(false);
});