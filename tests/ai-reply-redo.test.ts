// AI replies step 1 (redo blocked drafts), task 1: before release, AI replies may explain the Ready Check but never promise timing.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
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

// Task 3: fix prompt and fix loop.
import { AI_FIX_INSTRUCTIONS, AI_FIX_TRIES, AI_SIGN_OFF, NO_REPLY_NEEDED, buildAiFixInput, fixUntilClean } from "../src/lib/ai-email-reply.core";

describe("buildAiFixInput / AI_FIX_INSTRUCTIONS", () => {
  const body = `Hi Sam,\n\nYour VEEC is sorted.\n\n${AI_SIGN_OFF}`;
  test("lists every problem and drops the sign-off from the body", () => {
    const input = buildAiFixInput(body, ["Say “rebate” instead of scheme words.", "Take out the phone number."], false);
    expect(input).toContain("Say “rebate” instead of scheme words.");
    expect(input).toContain("Take out the phone number.");
    expect(input).toContain("Your VEEC is sorted.");
    expect(input).not.toContain(AI_SIGN_OFF);
    expect(input).not.toContain(AI_WAIT_LINE);
  });
  test("pre-release adds the allowed wording", () => {
    const input = buildAiFixInput(body, ["x"], true);
    expect(input).toContain(AI_RELEASE_MEANS);
    expect(input).toContain(AI_WAIT_LINE);
  });
  test("instructions say change only what breaks the rules", () => {
    expect(AI_FIX_INSTRUCTIONS).toMatch(/only/i);
    expect(AI_FIX_INSTRUCTIONS).toMatch(/word for word/i);
    expect(AI_FIX_INSTRUCTIONS).toMatch(/greeting/i);
    expect(AI_FIX_INSTRUCTIONS).toMatch(/sign-off/i);
  });
});

describe("fixUntilClean", () => {
  const bad = `Hi Sam,\n\nYour VEEC is sorted.\n\n${AI_SIGN_OFF}`;
  test("AI_FIX_TRIES is 2", () => expect(AI_FIX_TRIES).toBe(2));
  test("clean body: no tries, ai not called", async () => {
    let calls = 0;
    const clean = `Hi Sam,\n\nAll good.\n\n${AI_SIGN_OFF}`;
    const r = await fixUntilClean(clean, false, async () => { calls++; return "x"; });
    expect(r).toEqual({ body: clean, problems: [], tries: 0 });
    expect(calls).toBe(0);
  });
  test("one fix cleans it, one sign-off", async () => {
    const r = await fixUntilClean(bad, false, async () => "Hi Sam,\n\nYour rebate is sorted.\n\nCheers, the Home Insulation Victoria team");
    expect(r.tries).toBe(1);
    expect(r.problems).toEqual([]);
    expect(r.body.split(AI_SIGN_OFF).length - 1).toBe(1);
    expect(r.body.endsWith(AI_SIGN_OFF)).toBe(true);
  });
  test("always bad: two tries, problems kept, last version", async () => {
    let calls = 0;
    const r = await fixUntilClean("Hi Sam,\n\nSee you this week.", true, async () => { calls++; return `Hi Sam,\n\nSee you this week (v${calls}).`; });
    expect(r.tries).toBe(2);
    expect(calls).toBe(2);
    expect(r.problems.length).toBeGreaterThan(0);
    expect(r.body).toContain("(v2)");
    expect(r.body.endsWith(AI_SIGN_OFF)).toBe(true);
  });
  test("ai throws: stops, tries 1, original kept", async () => {
    let calls = 0;
    const r = await fixUntilClean(bad, false, async () => { calls++; throw new Error("down"); });
    expect(calls).toBe(1);
    expect(r.tries).toBe(1);
    expect(r.body).toBe(bad);
    expect(r.problems.length).toBeGreaterThan(0);
  });
  test("empty or NO_REPLY_NEEDED counts as a try, body kept", async () => {
    for (const out of ["", "  \n ", NO_REPLY_NEEDED, AI_SIGN_OFF, `\n${AI_SIGN_OFF}\n`]) {
      let calls = 0;
      const r = await fixUntilClean(bad, false, async () => { calls++; return out; });
      expect(calls).toBe(2);
      expect(r.tries).toBe(2);
      expect(r.body).toBe(bad);
      expect(r.problems.length).toBeGreaterThan(0);
    }
  });
});

describe("final review fixes", () => {
  const sign = (r: { body: string }) => r.body.split(AI_SIGN_OFF).length - 1;
  test("F1: a differently worded sign-off from the AI gives exactly one sign-off", async () => {
    for (const out of ["Hi Sam,\n\nYour rebate is sorted.\n\nCheers, the Home Insulation Victoria team.", "Hi Sam,\n\nYour rebate is sorted.\n\nKind regards, the Home Insulation Victoria team", "Hi Sam,\n\nYour rebate is sorted.\n\nCheers,\nJo"]) {
      const r = await fixUntilClean(`Hi Sam,\n\nYour VEEC is sorted.\n\n${AI_SIGN_OFF}`, false, async () => out);
      expect(sign(r)).toBe(1);
      expect(r.body.endsWith(AI_SIGN_OFF)).toBe(true);
      expect(r.body.toLowerCase()).not.toContain("kind regards");
      expect(r.body).not.toMatch(/Jo$/);
      expect(r.body.match(/cheers/gi)?.length).toBe(1);
    }
  });
  test("F1b: real last sentences that mention thanks or the team are kept", async () => {
    for (const last of ["Thanks again to the whole team for your patience.", "Thanks for choosing Home Insulation Victoria.", "Thanks, our team will be in touch."]) {
      const r = await fixUntilClean(`Hi Sam,\n\nYour VEEC is sorted.\n\n${AI_SIGN_OFF}`, false, async () => `Hi Sam,\n\nYour rebate is sorted.\n\n${last}`);
      expect(r.body).toContain(last);
      expect(sign(r)).toBe(1);
    }
  });
  test("F2: wider timing phrases are flagged", () => {
    for (const bad of ["within a week", "within 2-3 weeks", "in 2 weeks", "in a fortnight", "in a couple of weeks", "in a week or two", "in the coming weeks", "in the next few weeks", "next month", "this month", "next year", "tomorrow", "we can move up your spot"])
      expect(aiPreReleaseViolations(`We'll be in touch ${bad}.`).length).toBeGreaterThan(0);
    expect(aiPreReleaseViolations("We'll remove up to date notes.")).toEqual([]);
  });
  test("F2: both spellings of the release phrase pass, 'soon' elsewhere does not", () => {
    for (const ok of ["as soon as your spot is released", "as soon as your spot's released", "as soon as their spot is released", "as soon as\nyour  spot\nis released"])
      expect(aiPreReleaseViolations(`We'll be in touch ${ok}.`)).toEqual([]);
    expect(aiPreReleaseViolations("as soon as your spot's released, or soon")).toEqual(["soon"]);
    expect(aiPreReleaseViolations(AI_WAIT_LINE)).toEqual([]);
    expect(aiPreReleaseViolations(AI_RELEASE_MEANS)).toEqual([]);
  });
  test("F3: the fix call has a time limit (source check)", () => {
    const src = readFileSync("src/lib/ai-email-reply.server.ts", "utf8");
    expect(src).toMatch(/abortSignal/);
    expect(src.match(/AbortSignal\.timeout\(25_000\)/g)?.length).toBeGreaterThanOrEqual(2);
  });
  test("F3: a call that never answers but is cut off counts as a used try", async () => {
    let calls = 0;
    const hang = (input: string, instr: string) => { calls++; void input; void instr; return Promise.race([new Promise<string>(() => {}), new Promise<string>((_, rej) => setTimeout(() => rej(new Error("timeout")), 20))]); };
    const r = await fixUntilClean(`Hi Sam,\n\nYour VEEC is sorted.`, false, hang);
    expect(r.tries).toBe(1);
    expect(calls).toBe(1);
  });
  test("F4: an empty body returns at once with no AI call", async () => {
    for (const empty of ["", "  \n "]) {
      let calls = 0;
      const r = await fixUntilClean(empty, false, async () => { calls++; return "Hi"; });
      expect(calls).toBe(0);
      expect(r.tries).toBe(0);
      expect(r.problems.length).toBeGreaterThan(0);
      expect(r.body).toBe(empty);
    }
  });
  test("F5: 'NO_REPLY_NEEDED.' counts as a used try", async () => {
    let calls = 0;
    const r = await fixUntilClean(`Hi Sam,\n\nYour VEEC is sorted.`, false, async () => { calls++; return "NO_REPLY_NEEDED."; });
    expect(calls).toBe(2);
    expect(r.tries).toBe(2);
    expect(r.body).toBe("Hi Sam,\n\nYour VEEC is sorted.");
  });
});

describe("task 4: the loop at draft time and on Send (source checks)", () => {
  const server = readFileSync("src/lib/ai-email-reply.server.ts", "utf8");
  const tab = readFileSync("src/lib/emails-tab.server.ts", "utf8");
  const fn = (name: string) => { const i = server.indexOf(`export async function ${name}`); return server.slice(i, server.indexOf("\nexport ", i + 10) === -1 ? undefined : server.indexOf("\nexport ", i + 10)); };
  test("writeAiReplyDraft runs fixUntilClean after finishAiReply and saves what remains", () => {
    const w = fn("writeAiReplyDraft");
    // Step 2 task 4: the AI's office notes are split off first, so finishAiReply gets the email body only.
    expect(w.indexOf("finishAiReply(out.body)")).toBeGreaterThan(-1);
    expect(w.indexOf("fixUntilClean(")).toBeGreaterThan(w.indexOf("finishAiReply(out.body)"));
    expect(w).toContain("fixUntilClean(first, preRelease, (i, ins) => aiText(i, ins, AbortSignal.timeout(25_000)))");
  });
  test("sendAiDraft rewrites, saves the edit and returns rewritten before any send", () => {
    const s = fn("sendAiDraft");
    expect(s).toContain("fixUntilClean(");
    expect(s).toContain("saveDraftEdit(");
    expect(s).toContain('status: "rewritten"');
    expect(s.indexOf('status: "rewritten"')).toBeLessThan(s.indexOf("sendGuardedOwnerEmail"));
    expect(s.indexOf("openDraft(")).toBeLessThan(s.indexOf("fixUntilClean("));
    expect(s).not.toContain("throw new Error(problems.join");
    expect(s).not.toContain("throw new Error(basic.join");
  });
  test("sendJobEmailReply returns a rewritten result unchanged, with no reply-sent events", () => {
    const t = tab.slice(tab.indexOf("export async function sendJobEmailReply"));
    const body = t.slice(0, t.indexOf("\nexport ", 10));
    expect(body).toContain('r.status === "rewritten"');
    expect(body.indexOf('r.status === "rewritten"')).toBeLessThan(body.indexOf("applyEmailChange"));
  });
});

describe("task 5: the screens show the fixed draft after a blocked Send (source checks)", () => {
  const emails = readFileSync("src/components/portal/EmailsScreen.tsx", "utf8");
  const drafts = readFileSync("src/components/portal/AiReplyDrafts.tsx", "utf8");
  const core = readFileSync("src/lib/ai-email-reply.core.ts", "utf8");
  test("the shared note lives in the core file", () => {
    expect(core).toContain('export const AI_REWRITTEN_NOTE = "We fixed the reply so it follows your rules — check it and press Send."');
  });
  for (const [name, src] of [["EmailsScreen", emails], ["AiReplyDrafts", drafts]] as const) {
    test(`${name}: rewritten fills the box, shows the note or problems, and never finishes the card`, () => {
      expect(src).toContain('status === "rewritten"');
      expect(src).toContain("AI_REWRITTEN_NOTE");
      expect(src).toMatch(/setBody\(\(?r\b/);
      expect(src).toMatch(/\.problems\.length/);
      expect(src).toContain("text-danger");
      const at = src.indexOf('status === "rewritten"');
      const branch = src.slice(at, src.indexOf("return", at) + 10);
      expect(branch).not.toContain("onDone()");
      expect(branch).not.toContain("toast.success");
    });
    test(`${name}: the note clears when Jo edits the text`, () => {
      expect(src).toMatch(/setNote\(null\)/);
    });
  }
  test("sendAiDraft's return type narrows on status", () => {
    const s = readFileSync("src/lib/ai-email-reply.server.ts", "utf8");
    expect(s).not.toContain("Promise<{ status: string } | {");
  });
});
