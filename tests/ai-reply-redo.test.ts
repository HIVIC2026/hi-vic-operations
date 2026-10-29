// AI replies step 1 (redo blocked drafts), task 1: before release, AI replies may explain the Ready Check but never promise timing.
import { describe, expect, test } from "bun:test";
import { AI_RELEASE_MEANS, AI_WAIT_LINE, aiPreReleaseViolations, aiReplyInstructions, aiReplyProblems, buildAiReplyInput, type AiReplyContext } from "../src/lib/ai-email-reply.core";

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

describe("pre-release prompt (task 2)", () => {
  const ctx: AiReplyContext = {
    jobNumber: "HV-1", ownerFirstName: "Jo", stageLabel: "Spot saved", facts: [], links: [], changeLink: null, history: [],
    email: { from: "jo@example.com", subject: "Hi", body: "When will you come?" },
  };
  test("exact lines are timing-clean", () => {
    expect(AI_WAIT_LINE).toBe("We're bringing on more and more certified installers, but demand is high and there aren't enough of them yet. So we're booking people in the order they saved their spot, as quickly as we can bring on more CII-certified installers. We can't give a date yet, but we'll be in touch as soon as your spot is released.");
    expect(AI_RELEASE_MEANS).toBe("When your spot is released, it's your turn: an installer will text and email you some times for your free Ready Check.");
    expect(aiPreReleaseViolations(AI_WAIT_LINE)).toEqual([]);
    expect(aiPreReleaseViolations(AI_RELEASE_MEANS)).toEqual([]);
  });
  test("instructions explain release, use the wait line, never promise", () => {
    const i = aiReplyInstructions({ preRelease: true });
    expect(i).toContain(AI_RELEASE_MEANS);
    expect(i).toContain(AI_WAIT_LINE);
    expect(i).toContain("never promise");
    expect(i).not.toContain("Say nothing else about what happens after their spot is released");
  });
  test("business rules carry both lines", () => {
    const b = buildAiReplyInput(ctx, { preRelease: true });
    expect(b).toContain(AI_WAIT_LINE);
    expect(b).toContain(AI_RELEASE_MEANS);
  });
});
