// AI replies step 2, task 1: Jo's standard answers are the AI's rules.
import { describe, expect, test } from "bun:test";
import { AI_SEED_ANSWERS, rulesFromAnswers } from "../src/lib/ai-answers.core";
import { AI_RELEASE_MEANS, AI_WAIT_LINE, aiPreReleaseViolations, aiReplyInstructions, buildAiReplyInput } from "../src/lib/ai-email-reply.core";

const ctx = { jobNumber: "HV-1", ownerFirstName: "Sam", stageLabel: "Quote sent", facts: ["Ceiling 100 m²"], links: [], changeLink: null, history: [], email: { from: "sam@x.au", subject: "Hi", body: "Hello?" } };
const topics = AI_SEED_ANSWERS.map((a) => a.topic.toLowerCase());
const has = (t: string) => topics.some((x) => x.includes(t.toLowerCase()));
const seedText = AI_SEED_ANSWERS.map((a) => `${a.topic}\n${a.answer}`).join("\n");

describe("seed answers", () => {
  test("covers every topic in the spec table", () => {
    for (const t of ["Payment plan", "Low income", "Cheaper quote", "Existing electrical certificate", "Own electrician for electrical upgrades", "Garage", "flat roof", "cathedral", "no manhole", "R6.0/R7.0", "Underfloor", "walls", "Cancel", "Rental", "Paying by card", "Home on install day", "Other languages", "Tenant", "Installer access", "Wording"])
      expect({ t, found: has(t) }).toEqual({ t, found: true });
  });
  test("no scheme words and no 'never quote'", () => expect(seedText).not.toMatch(/\bVEECs?\b|\bVEU\b|Victorian Energy Upgrades|Activity 48|never quote/i));
  test("R6/R7 gives the price from the job facts and says tell the installer at the Ready Check", () => {
    const a = AI_SEED_ANSWERS.find((x) => x.topic.includes("R6.0"))!.answer;
    expect(a).toContain("$33/m²");
    expect(a).toContain("$35/m²");
    expect(a).toMatch(/tell the installer/);
    expect(a).toContain("free Ready Check");
  });
  test("cheaper quote lists the value points and never names the program", () => {
    const a = AI_SEED_ANSWERS.find((x) => x.topic.toLowerCase().includes("cheaper quote"))!.answer;
    for (const p of ["PIESA", "wiring", "downlight", "CII-certified", "REC", "licences", "$5 million", "Australian standard", "Accredited Person", "upfront", "can't give the rebate", "compare", "no obligation", "Never name the program"])
      expect({ p, ok: a.includes(p) }).toEqual({ p, ok: true });
  });
  test("underfloor: installer quotes it directly at the Ready Check, outside our system", () => {
    expect(AI_SEED_ANSWERS.find((x) => x.topic.includes("Underfloor"))!.answer).toMatch(/directly at the free Ready Check, outside our system/);
  });
  test("wording answer carries the standing rules", () => {
    const a = AI_SEED_ANSWERS.find((x) => x.topic === "Wording")!.answer;
    expect(a).toContain("electrical safety check (PIESA)");
    expect(a).toContain("the government's rebate rules");
    expect(a).toContain("electrical upgrades");
  });
  test("passes the pre-release timing check", () => expect(aiPreReleaseViolations(seedText)).toEqual([]));
});

describe("rulesFromAnswers", () => {
  const seedLines = AI_SEED_ANSWERS.map((a) => a.answer);
  test("null and empty fall back to the seed", () => {
    expect(rulesFromAnswers(null)).toEqual(seedLines);
    expect(rulesFromAnswers([])).toEqual(seedLines);
  });
  test("saved rows are used as they are", () => expect(rulesFromAnswers([{ topic: "T", answer: "  Be kind.  " }])).toEqual(["Be kind."]));
});

describe("buildAiReplyInput uses the answers", () => {
  const custom = [{ topic: "Pets", answer: "Pets are fine, the crew is careful." }];
  test("custom answers replace the seed (released and pre-release)", () => {
    for (const preRelease of [false, true]) {
      const out = buildAiReplyInput(ctx, { preRelease, answers: custom });
      expect(out).toContain("Pets are fine, the crew is careful.");
      expect(out).not.toContain(AI_SEED_ANSWERS[0].answer);
    }
  });
  test("no answers passed → the seed", () => {
    for (const preRelease of [false, true]) {
      const out = buildAiReplyInput(ctx, { preRelease });
      for (const a of AI_SEED_ANSWERS) expect(out).toContain(a.answer);
    }
  });
  test("pre-release keeps the wait and release lines and has no timing words", () => {
    const out = buildAiReplyInput(ctx, { preRelease: true, answers: custom });
    expect(out).toContain(AI_WAIT_LINE);
    expect(out).toContain(AI_RELEASE_MEANS);
    expect(aiPreReleaseViolations(buildAiReplyInput(ctx, { preRelease: true }))).toEqual([]);
  });
  test("the old 'never quote R6/R7' line is gone; never inventing stays", () => {
    for (const preRelease of [false, true]) {
      const ins = aiReplyInstructions({ preRelease });
      expect(ins).not.toMatch(/Never quote an R6\.0 or R7\.0 price/);
      expect(ins).toContain("Never invent dates, prices, times, people or links.");
    }
  });
});

describe("aiPreReleaseViolations and the 30-day rule", () => {
  test("'within N days of the install' passes", () => {
    expect(aiPreReleaseViolations("It must be done within 30 days of the install.")).toEqual([]);
    expect(aiPreReleaseViolations("done within  30\n days of your install")).toEqual([]);
  });
  test("other 'within N days' wording is still flagged", () => {
    expect(aiPreReleaseViolations("within 30 days").length).toBe(1);
    expect(aiPreReleaseViolations("within 10 days we'll call").length).toBe(1);
  });
});

describe("fix round 1", () => {
  test("instructions no longer treat 'no thanks' / 'not going ahead' as no-reply", () => {
    for (const preRelease of [false, true]) {
      const ins = aiReplyInstructions({ preRelease });
      expect(ins).not.toMatch(/no thanks|not going ahead/);
      expect(ins).toContain("NO_REPLY_NEEDED");
    }
  });
  test("Cancel answer is conditional on the job facts", () => {
    const a = AI_SEED_ANSWERS.find((x) => x.topic.startsWith("Cancel"))!.answer;
    expect(a).toContain("Only if the job facts show the job is closed or cancelled");
    expect(a).toContain("without promising it's closed");
  });
  test("all-blank rows fall back to the seed", () => expect(rulesFromAnswers([{ topic: "a", answer: " " }])).toEqual(AI_SEED_ANSWERS.map((a) => a.answer)));
  test("seed uses PIESA wording and R6/R7 rebate rule", () => {
    expect(AI_SEED_ANSWERS.find((x) => x.topic === "Steps after the quote")!.answer).toContain("electrical safety check (PIESA)");
    expect(AI_SEED_ANSWERS.find((x) => x.topic === "What the price includes")!.answer).toContain("electrical safety check (PIESA)");
    expect(AI_SEED_ANSWERS.find((x) => x.topic.includes("R6.0"))!.answer).toContain("same as for R5.0");
  });
});
