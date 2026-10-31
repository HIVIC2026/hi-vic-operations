import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// Jo 31 Oct 2026: both onboarding forms ask the availability question in the same words.
const Q = "Are you available to accept Home Insulation Victoria work at the moment?";
const installer = readFileSync(new URL("../src/routes/installer-onboarding.tsx", import.meta.url), "utf8");
const electrician = readFileSync(new URL("../src/routes/electrician-onboarding.tsx", import.meta.url), "utf8");

describe("Jo 31 Oct: availability question wording", () => {
  test("installer onboarding asks Jo's question", () => {
    expect(installer).toContain(`label="${Q}"`);
    expect(installer).not.toContain("Are you accepting new work now?");
  });
  test("electrician onboarding asks Jo's question", () => {
    expect(electrician).toContain(`label="${Q}"`);
    expect(electrician).not.toContain("Are you accepting new Home Insulation Victoria work now?");
  });
});
