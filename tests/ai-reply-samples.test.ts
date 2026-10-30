// AI replies step 2, task 6: Jo's agreed sample replies pass the rules, and the prompt carries the matching answers.
import { describe, expect, test } from "bun:test";
import { AI_SEED_ANSWERS } from "../src/lib/ai-answers.core";
import { AI_RELEASE_MEANS, AI_WAIT_LINE, aiReplyProblems, buildAiReplyInput, splitAiOutput } from "../src/lib/ai-email-reply.core";
import { AI_REPLY_SAMPLES } from "./fixtures/ai-reply-samples";

const ctx = { jobNumber: "HV-1", ownerFirstName: "Sam", stageLabel: "Quote sent", facts: ["Ceiling 100 m²"], links: [], changeLink: null, history: [], email: { from: "sam@x.au", subject: "Hi", body: "Hello?" } };
const prompt = buildAiReplyInput(ctx, { preRelease: true, answers: AI_SEED_ANSWERS });
const seed = (t: string) => AI_SEED_ANSWERS.find((a) => a.topic.includes(t))!.answer;

describe("agreed samples pass the rules", () => {
  for (const s of AI_REPLY_SAMPLES) {
    test(`sample ${s.id}`, () => {
      expect(aiReplyProblems(s.body, { preRelease: s.preRelease })).toEqual([]);
      const out = splitAiOutput(s.body);
      expect(out.body).toBe(s.body);
      expect(out.needsAnswer).toEqual([]);
      expect(out.needsYou).toBe(false);
      expect(out.actions).toEqual({});
    });
  }
  test("all ten samples are present", () => expect(AI_REPLY_SAMPLES.map((s) => s.id)).toEqual([1, 2, 3, 4, 6, 8, 9, 14, 15, 23]));
});

describe("pre-release prompt carries the matching answers", () => {
  const cases: [string, string][] = [["payment plan (1)", "Payment plan"], ["low income (2)", "Low income"], ["cheaper quote (3, 15)", "Cheaper quote"], ["existing certificate (4)", "Existing electrical certificate"], ["R6/R7 (6)", "R6.0/R7.0"]];
  for (const [name, topic] of cases) test(name, () => expect(prompt).toContain(seed(topic)));
  test("wait line (6, 8)", () => expect(prompt).toContain(AI_WAIT_LINE));
  test("release line (9)", () => expect(prompt).toContain(AI_RELEASE_MEANS));
  test("order spots are released (9)", () => expect(prompt).toContain(seed("Order spots are released")));
  test("existing insulation (23)", () => expect(prompt).toContain(seed("Existing insulation and the rebate")));
  test("own electrician (14, released owner)", () => {
    const released = buildAiReplyInput(ctx, { preRelease: false, answers: AI_SEED_ANSWERS });
    expect(released).toContain(seed("Own electrician"));
    expect(released).toContain("Current stage: Quote sent");
  });
});
