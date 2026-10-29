// Batch 2 task 3: AI email drafts follow the spot-only rule (decision 388) for owners not yet released and confirmed.
import { describe, expect, test } from "bun:test";
import { AI_BUSINESS_RULES, AI_BUSINESS_RULES_PRE_RELEASE, AI_REPLY_INSTRUCTIONS, aiReplyInstructions, aiReplyProblems, buildAiReplyInput, isPreReleaseOwner } from "../src/lib/ai-email-reply.core";
import { PRE_RELEASE_FORBIDDEN, SPOT_RELEASE_LINE, isPreReleaseStage, preReleaseViolations } from "../src/lib/spot-only-copy.core";

const ctx = { jobNumber: "HV-1", ownerFirstName: "Sam", stageLabel: "Ready Check ready to schedule", facts: ["Their spot is saved."], links: [], changeLink: null, history: [], email: { from: "sam@x.au", subject: "Hi", body: "When is my turn?" } };

describe("pre-release prompt", () => {
  test("has no forbidden phrase and carries the spot-only line", () => {
    const text = [aiReplyInstructions({ preRelease: true }), buildAiReplyInput(ctx, { preRelease: true })].join("\n");
    expect(preReleaseViolations(text)).toEqual([]);
    expect(PRE_RELEASE_FORBIDDEN.test(text)).toBe(false);
    expect(text).toContain(SPOT_RELEASE_LINE);
    expect(AI_BUSINESS_RULES_PRE_RELEASE.join(" ")).not.toMatch(/ready check/i);
  });
  test("released owners keep today's prompt unchanged", () => {
    expect(aiReplyInstructions({ preRelease: false })).toBe(AI_REPLY_INSTRUCTIONS);
    expect(aiReplyInstructions()).toBe(AI_REPLY_INSTRUCTIONS);
    expect(AI_REPLY_INSTRUCTIONS).toContain("free Ready Check");
    const out = buildAiReplyInput(ctx);
    expect(out).toContain("Current stage: Ready Check ready to schedule");
    for (const r of AI_BUSINESS_RULES) expect(out).toContain(r);
  });
  const J = (channel: string, stage: string, st: string) => ({ channel, stage, releaseState: st === "null" ? null : ({ state: st } as never) });
  test("enquiry-stage and spot-saved own leads are pre-release unless confirmed", () => {
    for (const stage of ["new_enquiry", "eligibility_review", "preliminary_estimate_ready", "ready_check_ready_to_schedule"]) {
      expect(isPreReleaseOwner(J("hivic_sourced", stage, "none"))).toBe(true);
      expect(isPreReleaseOwner(J("hivic_sourced", stage, "null"))).toBe(true);
      expect(isPreReleaseOwner(J("hivic_sourced", stage, "pending"))).toBe(true);
      expect(isPreReleaseOwner(J("hivic_sourced", stage, "declined"))).toBe(true);
      expect(isPreReleaseOwner(J("hivic_sourced", stage, "confirmed"))).toBe(false);
    }
  });
  test("F1: one shared pre-release stage rule — awaiting acceptance (times already offered) is NOT pre-release", () => {
    for (const stage of ["new_enquiry", "eligibility_review", "preliminary_estimate_ready", "ready_check_ready_to_schedule", "ready_check_awaiting_payment"]) {
      expect(isPreReleaseStage(stage)).toBe(true);
      expect(isPreReleaseOwner(J("hivic_sourced", stage, "none"))).toBe(true);
    }
    for (const stage of ["ready_check_awaiting_acceptance", "ready_check_scheduled", "ready_check_complete", "cancelled", "on_hold", "", "spot_saved"]) {
      expect(isPreReleaseStage(stage)).toBe(false);
      expect(isPreReleaseOwner(J("hivic_sourced", stage, "none"))).toBe(false);
    }
    expect(isPreReleaseStage(null)).toBe(false);
    expect(isPreReleaseStage(undefined)).toBe(false);
  });
  test("past the Ready Check stage, other channels and exception stages keep today's behaviour", () => {
    for (const stage of ["ready_check_scheduled", "ready_check_complete", "measured_quote_accepted", "installation_complete", "cancelled", "on_hold"])
      expect(isPreReleaseOwner(J("hivic_sourced", stage, "none"))).toBe(false);
    expect(isPreReleaseOwner(J("installer_supplied", "new_enquiry", "none"))).toBe(false);
    expect(isPreReleaseOwner(J("", "new_enquiry", "none"))).toBe(false);
  });
});

describe("aiReplyProblems", () => {
  const bad = "Hi Sam,\n\nWe'll text you for your free Ready Check soon.";
  test("pre-release flags timing wording (AI replies may explain the Ready Check, never promise timing)", () => {
    expect(aiReplyProblems(bad, { preRelease: true }).join(" ")).toContain("soon");
    expect(aiReplyProblems("Hi Sam,\n\nYour free Ready Check is next.", { preRelease: true })).toEqual([]);
  });
  test("released owner: same body has no pre-release problem", () => { expect(aiReplyProblems(bad, { preRelease: false })).toEqual([]); expect(aiReplyProblems(bad)).toEqual([]); });
  test("the spot-only line passes", () => expect(aiReplyProblems(`Hi Sam,\n\n${SPOT_RELEASE_LINE}`, { preRelease: true })).toEqual([]));
});
