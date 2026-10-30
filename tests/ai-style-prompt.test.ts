// AI replies step 3, task 2: the prompt carries Jo's style examples and the new length/tone line. Pure core + source checks.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { AI_REPLY_INSTRUCTIONS, aiReplyInstructions, buildAiReplyInput } from "../src/lib/ai-email-reply.core";

const HEADING = "How Jo writes (style only — never copy facts, prices, dates, names or promises from these):";
const ctx = {
  jobNumber: "J1", ownerFirstName: "Sam", stageLabel: "Quote", facts: ["Ceiling 90 m²"], links: [], changeLink: null, history: [],
  email: { from: "sam@x.au", subject: "Price?", body: "How much?" },
} as unknown as Parameters<typeof buildAiReplyInput>[0];
const style = [
  { theirEmail: "Hi, is it safe?", reply: "Yes, it is :)", at: "2026-10-01T00:00:00Z" },
  { theirEmail: "x".repeat(900), reply: "Second reply", at: "2026-10-02T00:00:00Z" },
];

describe("style section in the prompt", () => {
  test("present with examples, between business rules and email history", () => {
    const t = buildAiReplyInput(ctx, { style });
    expect(t).toContain(HEADING);
    expect(t).toContain("Owner wrote:\nHi, is it safe?\nJo replied:\nYes, it is :)");
    expect(t.indexOf("Business rules:")).toBeLessThan(t.indexOf(HEADING));
    expect(t.indexOf(HEADING)).toBeLessThan(t.indexOf("Email history"));
  });
  test("owner email trimmed to 600 chars", () => {
    const t = buildAiReplyInput(ctx, { style });
    expect(t).toContain("x".repeat(600) + "\nJo replied:");
    expect(t).not.toContain("x".repeat(601));
  });
  test("absent when empty or undefined", () => {
    expect(buildAiReplyInput(ctx, { style: [] })).not.toContain("How Jo writes");
    expect(buildAiReplyInput(ctx, {})).not.toContain("How Jo writes");
  });
});

describe("length and tone instructions", () => {
  const NEW = "Answer each question fully, explaining the why when it helps, in short sentences. Warm and plain; an occasional :) is fine.";
  test.each([[false], [true]])("preRelease=%p has the new line, not the old one, and keeps the rest", (pre) => {
    const t = aiReplyInstructions({ preRelease: pre });
    expect(t).toContain(NEW);
    expect(t).not.toContain("Short sentences. Never robotic");
    expect(t).toContain("Australian English");
    expect(t).toContain("Never robotic or call-centre");
    expect(t).toContain("Never say \"No worries\"");
    expect(t).toContain("Never sign or mention a person's name for us");
  });
  test("default constant matches", () => { expect(AI_REPLY_INSTRUCTIONS).toContain(NEW); });
});

describe("writeAiReplyDraft wiring (source check)", () => {
  const src = readFileSync("src/lib/ai-email-reply.server.ts", "utf8");
  test("loads style examples once, safely, and passes style into the prompt", () => {
    expect(src).toContain("loadStyleExamples(p.jobId, m.body)");
    expect(src.match(/loadStyleExamples\(/g)?.length).toBe(1);
    expect(src).toMatch(/loadStyleExamples\(p\.jobId, m\.body\)\.catch\(\(\) => \[\]/);
    expect(src).toMatch(/\{ preRelease, answers, style \}/);
  });
});
