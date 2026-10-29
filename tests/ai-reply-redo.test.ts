// AI replies step 1 (redo blocked drafts), task 1: before release, AI replies may explain the Ready Check but never promise timing.
import { describe, expect, test } from "bun:test";
import { aiPreReleaseViolations, aiReplyProblems } from "../src/lib/ai-email-reply.core";

describe("aiPreReleaseViolations (timing only)", () => {
  test("Ready Check explanation and the wait line are allowed", () => {
    expect(aiPreReleaseViolations("When your spot is released, an installer will text you times for your free Ready Check.")).toEqual([]);
    expect(aiPreReleaseViolations("We're bringing on more certified installers, but demand is high … as quickly as we can … we'll be in touch as soon as your spot is released.")).toEqual([]);
  });
  test("timing promises are flagged", () => {
    for (const bad of ["soon", "shortly", "this week", "next week", "in a few weeks", "in a couple of days", "within 10 days", "jump the queue", "move up the list"])
      expect(aiPreReleaseViolations(`We'll call ${bad}.`).length).toBeGreaterThan(0);
  });
  test("other 'soon' is flagged, 'as soon as your spot is released' is not", () => {
    expect(aiPreReleaseViolations("We'll be in touch as soon as possible.")).toEqual(["soon"]);
    expect(aiPreReleaseViolations("Soon as your spot is released, and also soon.")).toEqual(["soon"]);
  });
});

describe("aiReplyProblems pre-release", () => {
  test("explaining the Ready Check is fine", () => {
    expect(aiReplyProblems("Hi Jo,\n\nYour free Ready Check is next.\n\nCheers, the Home Insulation Victoria team", { preRelease: true })).toEqual([]);
  });
  test("timing is flagged with the new wording", () => {
    const p = aiReplyProblems("Hi Jo,\n\nYour Ready Check is this week.", { preRelease: true });
    expect(p.join(" ")).toContain("this week");
    expect(p.join(" ")).toContain("we can't promise timing before their spot is released");
  });
  test("released owners are unaffected", () => {
    expect(aiReplyProblems("Your Ready Check is this week.", { preRelease: false })).toEqual([]);
  });
});
