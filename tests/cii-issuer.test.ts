import { expect, test } from "bun:test";
import { isEecIssuer, nonEecWarning } from "../src/lib/cii-issuer.core";
import { mandatoryActivationBlockers } from "../src/lib/partner-activation.core";
test("EEC issuer detection", () => {
  expect(isEecIssuer("Energy Efficiency Council Victoria")).toBe(true);
  expect(isEecIssuer("EEC")).toBe(true);
  expect(nonEecWarning("Wall and Ceiling Institute")).toContain("Not EEC");
  expect(nonEecWarning("")).toBeNull();
});
test("verified non-EEC certificate does not unlock Approve", () => {
  const data = { installers: [{ email: "a@x.au", cii_issuer: "Wall and Ceiling Institute" }] } as never;
  const v = (issuer: string | null) => new Map([["a@x.au", { id: "1", worker_email: "a@x.au", status: "verified" as const, recorded_at: "2026", issuer }]]);
  expect(mandatoryActivationBlockers("installer", data, v(null)).length).toBe(1);
  expect(mandatoryActivationBlockers("installer", data, v("Energy Efficiency Council")).length).toBe(0);
});
