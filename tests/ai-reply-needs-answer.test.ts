// AI replies step 2, task 4: the AI flags questions it can't answer (NEEDS_JO) and complaints after the install (NEEDS_YOU);
// the draft shows "Needs your answer"; after Jo sends she can save her answer as a standard answer.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { aiPreReleaseViolations, aiReplyInstructions, aiReplyProblems, splitAiOutput } from "../src/lib/ai-email-reply.core";
import { buildEmailsTab, jobDraftKey, type JobEmailRow } from "../src/lib/emails-tab.core";

describe("splitAiOutput", () => {
  test("no markers: body unchanged, nothing flagged", () => {
    const r = splitAiOutput("Hi Sam,\n\nYour spot is saved.");
    expect(r).toEqual({ body: "Hi Sam,\n\nYour spot is saved.", needsAnswer: [], needsYou: false, actions: {} });
  });
  test("one NEEDS_JO line is taken out of the body and returned", () => {
    const r = splitAiOutput("Hi Sam,\n\nYour spot is saved.\n\nNEEDS_JO: Do you install in Bendigo?");
    expect(r.body).toBe("Hi Sam,\n\nYour spot is saved.");
    expect(r.needsAnswer).toEqual(["Do you install in Bendigo?"]);
    expect(r.needsYou).toBe(false);
  });
  test("two NEEDS_JO lines", () => {
    const r = splitAiOutput("Hi Sam,\n\nThanks.\nNEEDS_JO: Can you do my shed?\nNEEDS_JO: Do you take cash?");
    expect(r.needsAnswer).toEqual(["Can you do my shed?", "Do you take cash?"]);
    expect(r.body).toBe("Hi Sam,\n\nThanks.");
  });
  test("NEEDS_YOU: complaint", () => {
    const r = splitAiOutput("Hi Sam,\n\nSorry to hear that — we're looking into it with the installer.\n\nNEEDS_YOU: complaint");
    expect(r.needsYou).toBe(true);
    expect(r.needsAnswer).toEqual([]);
    expect(r.body).toBe("Hi Sam,\n\nSorry to hear that — we're looking into it with the installer.");
  });
  test("lenient: mixed case, spaces, markers in the middle", () => {
    const r = splitAiOutput("Hi Sam,\n  needs_jo :  Is it safe for my cat? \n\nThanks for asking.\n Needs_You:Complaint ");
    expect(r.needsAnswer).toEqual(["Is it safe for my cat?"]);
    expect(r.needsYou).toBe(true);
    expect(r.body).toBe("Hi Sam,\n\nThanks for asking.");
  });
  test("an ACTIONS line never reaches the body; actions stay empty for now", () => {
    const r = splitAiOutput("Hi Sam,\n\nThanks.\nACTIONS: {\"installerNote\":\"x\"}");
    expect(r.body).toBe("Hi Sam,\n\nThanks.");
    expect(r.actions).toEqual({});
  });
  test("markers only: empty body", () => {
    const r = splitAiOutput("NEEDS_JO: What about solar?\nNEEDS_YOU: complaint");
    expect(r.body).toBe("");
    expect(r.needsAnswer).toEqual(["What about solar?"]);
    expect(r.needsYou).toBe(true);
  });
  test("'NEEDS JO:' / 'needs you :' spellings are accepted", () => {
    const r = splitAiOutput("Hi,\n\nThanks.\nNEEDS JO: Bendigo?\nneeds you : complaint");
    expect(r.needsAnswer).toEqual(["Bendigo?"]);
    expect(r.needsYou).toBe(true);
    expect(r.body).toBe("Hi,\n\nThanks.");
  });
  test("an empty NEEDS_JO question is dropped", () => {
    expect(splitAiOutput("Hi,\nNEEDS_JO:   ").needsAnswer).toEqual([]);
  });
});

describe("instructions", () => {
  for (const preRelease of [false, true]) {
    test(`${preRelease ? "pre-release" : "released"} prompt asks for NEEDS_JO and NEEDS_YOU`, () => {
      const i = aiReplyInstructions({ preRelease });
      expect(i).toContain("NEEDS_JO: <their question>");
      expect(i).toContain("NEEDS_YOU: complaint");
      expect(i).toMatch(/still answer the rest/i);
      expect(i).toMatch(/looking into it with the installer/i);
    });
  }
  test("pre-release prompt stays timing-clean", () => {
    expect(aiPreReleaseViolations(aiReplyInstructions({ preRelease: true }))).toEqual([]);
  });
});

describe("aiReplyProblems: a marker left in the body", () => {
  for (const m of ["NEEDS_JO: what about solar?", "NEEDS_YOU: complaint", "ACTIONS: {}", "NEEDS JO: what about solar?", "needs you : complaint", "needsjo: x"]) {
    test(m, () => {
      const p = aiReplyProblems(`Hi Sam,\n\nThanks.\n${m}`);
      expect(p.join(" ")).toContain("Take out the AI's note to the office (NEEDS_JO…)");
    });
  }
  test("ordinary words are fine", () => {
    expect(aiReplyProblems("Hi Sam,\n\nWe need you to reply with your actions.")).toEqual([]);
    expect(aiReplyProblems("Hi Sam,\n\nYour actions: none.")).toEqual([]);
  });
});

describe("empty after the sign-off (fix round 1)", () => {
  test("markers-only AI output gives a draft flagged as empty, and the fix loop does not invent a reply", async () => {
    const { finishAiReply, fixUntilClean, AI_SIGN_OFF } = await import("../src/lib/ai-email-reply.core");
    const out = splitAiOutput("NEEDS_YOU: complaint");
    const first = finishAiReply(out.body);
    expect(first.trim()).toBe(AI_SIGN_OFF);
    let calls = 0;
    const fixed = await fixUntilClean(first, false, async () => { calls++; return "Hi,\n\nMade up."; });
    expect(calls).toBe(0);
    expect(fixed.problems).toContain("The reply is empty.");
  });
  test("aiReplyProblems: sign-off only is empty", async () => {
    const { AI_SIGN_OFF } = await import("../src/lib/ai-email-reply.core");
    expect(aiReplyProblems(`\n\n${AI_SIGN_OFF}`)).toContain("The reply is empty.");
    expect(aiReplyProblems("Cheers,\nJo")).toContain("The reply is empty.");
    expect(aiReplyProblems(`Hi Sam,\n\nThanks.\n\n${AI_SIGN_OFF}`)).toEqual([]);
  });
});

describe("fix loop output with a marker (fix round 1)", () => {
  test("a rewrite that still has NEEDS_JO stays a problem", async () => {
    const { fixUntilClean } = await import("../src/lib/ai-email-reply.core");
    const r = await fixUntilClean("Hi Sam,\n\nThanks.\nNEEDS_JO: solar?", false, async () => "Hi Sam,\n\nThanks.\nNEEDS_JO: solar?");
    expect(r.tries).toBe(2);
    expect(r.problems.join(" ")).toContain("Take out the AI's note to the office (NEEDS_JO…)");
  });
});

describe("server wiring (source checks)", () => {
  const server = readFileSync("src/lib/ai-email-reply.server.ts", "utf8");
  const fn = (name: string) => { const i = server.indexOf(`export async function ${name}`); const j = server.indexOf("\nexport ", i + 10); return server.slice(i, j === -1 ? undefined : j); };
  test("writeAiReplyDraft splits the raw AI text before the no-reply check, finishAiReply and the fix loop", () => {
    const w = fn("writeAiReplyDraft");
    // Step 2 task 5: both AI passes (first draft, then the new-size pass) are split straight from aiText.
    const split = w.indexOf("splitAiOutput(await aiText(");
    expect(split).toBeGreaterThan(-1);
    expect(split).toBeLessThan(w.indexOf("NO_REPLY_NEEDED"));
    expect(split).toBeLessThan(w.indexOf("finishAiReply("));
    expect(split).toBeLessThan(w.indexOf("fixUntilClean("));
    expect(w).not.toContain("finishAiReply(raw)");
  });
  test("draft details carry needs_answer / needs_you only when set", () => {
    const w = fn("writeAiReplyDraft");
    expect(w).toContain("needs_answer");
    expect(w).toContain("needs_you: true");
  });
  test("listAiDrafts maps them into AiDraftRow", () => {
    const l = fn("listAiDrafts");
    expect(l).toContain("needsAnswer");
    expect(l).toContain("needsYou");
    expect(server).toMatch(/AiDraftRow = \{[^}]*needsAnswer: string\[\][^}]*needsYou: boolean/);
  });
  test("the Emails tab server copies them into the DraftRef", () => {
    const tab = readFileSync("src/lib/emails-tab.server.ts", "utf8");
    expect(tab).toContain('draftNeeds(r.details)');
  });
});

describe("listAiDrafts / Emails tab details mapping", () => {
  test("draftNeeds reads needs_answer and needs_you safely", async () => {
    const { draftNeeds } = await import("../src/lib/ai-email-reply.core");
    expect(draftNeeds({ needs_answer: ["A?", 3, " ", "B?"], needs_you: true })).toEqual({ needsAnswer: ["A?", "B?"], needsYou: true });
    expect(draftNeeds({})).toEqual({ needsAnswer: [], needsYou: false });
    expect(draftNeeds(null)).toEqual({ needsAnswer: [], needsYou: false });
    expect(draftNeeds({ needs_answer: "x", needs_you: "yes" })).toEqual({ needsAnswer: [], needsYou: false });
  });
  test("the job card carries needsAnswer / needsYou from its draft", () => {
    const change: JobEmailRow = { eventId: "c1", jobId: "j1", jobNumber: "HV-1", at: "2026-10-27T01:00:00Z", intent: "reply", messageId: "m1", from: "a@x.com", subject: "Q", label: null };
    const t = buildEmailsTab({ changes: [change], unmatched: [], noJobDrafts: new Map(), closedJobDrafts: new Set(), inboundByMessage: new Map(), ownerNameByJob: new Map(), autoRepliedSenders: new Set(),
      jobDrafts: new Map([[jobDraftKey("j1", "m1"), { eventId: "d1", body: "Hi", needsAnswer: ["Bendigo?"], needsYou: true }]]) });
    expect(t.withJob[0]!.draft?.needsAnswer).toEqual(["Bendigo?"]);
    expect(t.withJob[0]!.draft?.needsYou).toBe(true);
    expect(t.withJob[0]!.needsAnswer).toEqual(["Bendigo?"]);
    expect(t.withJob[0]!.needsYou).toBe(true);
    const none = buildEmailsTab({ changes: [change], unmatched: [], noJobDrafts: new Map(), closedJobDrafts: new Set(), inboundByMessage: new Map(), ownerNameByJob: new Map(), autoRepliedSenders: new Set(), jobDrafts: new Map() });
    expect(none.withJob[0]!.needsAnswer).toEqual([]);
    expect(none.withJob[0]!.needsYou).toBe(false);
  });
});

describe("save-answer prefill", () => {
  test("topic from the first question, max 80 characters", async () => {
    const { saveAnswerPrefill } = await import("../src/lib/ai-email-reply.core");
    const long = "x".repeat(120);
    expect(saveAnswerPrefill([long, "b"], "Hi Sam,\n\nYes we do.").topic).toHaveLength(80);
    expect(saveAnswerPrefill(["Do you go to Bendigo?"], "").topic).toBe("Do you go to Bendigo?");
  });
  test("answer is the sent body minus the greeting and the sign-off", async () => {
    const { saveAnswerPrefill, AI_SIGN_OFF } = await import("../src/lib/ai-email-reply.core");
    expect(saveAnswerPrefill(["Q"], `Hi Sam,\n\nYes, we cover Bendigo.\n\nAny other questions, just reply.\n\n${AI_SIGN_OFF}`).answer)
      .toBe("Yes, we cover Bendigo.\n\nAny other questions, just reply.");
    expect(saveAnswerPrefill(["Q"], "Hi there!\nYes.\n\nCheers,\nJo").answer).toBe("Yes.");
    expect(saveAnswerPrefill(["Q"], "Yes.").answer).toBe("Yes.");
  });
});

describe("screens (source checks)", () => {
  const emails = readFileSync("src/components/portal/EmailsScreen.tsx", "utf8");
  const drafts = readFileSync("src/components/portal/AiReplyDrafts.tsx", "utf8");
  const shared = readFileSync("src/components/portal/ai-needs-answer.tsx", "utf8");
  const fnSrc = (all: string, name: string) => { const i = all.indexOf(name); const m = /\n(?:export )?function /g; m.lastIndex = i + 10; const j = m.exec(all)?.index; return all.slice(i, j); };
  test("the shared pieces show both notes and the save form", () => {
    expect(shared).toContain("Needs your answer: ");
    expect(shared).toContain("Needs you — complaint after the install. Check with the installer before replying.");
    expect(shared).toContain("Save as a standard answer?");
    expect(shared).toContain("saveAiAnswer");
    expect(shared).toContain("Saved to your AI answers");
    expect(shared).toContain("Waiting for the database change");
    expect(shared).toContain("Skip");
    expect(shared).toContain("saveAnswerPrefill(");
    expect(shared).toMatch(/amber/);
  });
  test("PendingSaves: Save and Skip both remove the entry", () => {
    const list = fnSrc(shared, "export function PendingSaves");
    expect(list).toContain("<SaveAnswerForm");
    expect(list).toContain("onDone={() => onRemove(p.key)}");
    const form = fnSrc(shared, "export function SaveAnswerForm");
    expect(form).toMatch(/toast\.success\("Saved to your AI answers"\);\s*onDone\(\)/);
    expect(form).toContain("onClick={onDone}>Skip");
  });
  for (const [name, all, card, screen, box] of [
    ["EmailsScreen", emails, "function JobCard", "export function EmailsScreen", "<Reply "],
    ["AiReplyDrafts", drafts, "function DraftCard", "export function AiReplyDrafts", "<textarea"],
  ] as const) {
    const cardSrc = fnSrc(all, card);
    const screenSrc = fnSrc(all, screen);
    test(`${name}: notes sit above the reply box`, () => {
      expect(cardSrc).toContain("<NeedsNotes");
      expect(cardSrc.indexOf("<NeedsNotes")).toBeLessThan(cardSrc.indexOf(box));
    });
    test(`${name}: pending saves are screen state, not card state`, () => {
      expect(screenSrc).toContain("useState<PendingSave[]>");
      expect(screenSrc).toContain("<PendingSaves items={pendingSaves} onRemove={removePendingSave} />");
      expect(screenSrc).toContain("onSent={addPendingSave}");
      expect(screenSrc).toMatch(/removePendingSave = \(key: string\) => setPendingSaves\(\(xs\) => xs\.filter\(\(x\) => x\.key !== key\)\)/);
      // The list renders before (above) the cards.
      expect(screenSrc.indexOf("<PendingSaves")).toBeLessThan(screenSrc.indexOf(card === "function JobCard" ? "<JobCard" : "<DraftCard"));
      expect(cardSrc).not.toContain("<SaveAnswerForm");
      expect(cardSrc).not.toContain("setSaving(");
    });
    test(`${name}: a Send with questions hands the sent words to the screen, then the card finishes`, () => {
      expect(cardSrc).toMatch(/needsAnswer\.length \? \(\) => onSent\(\{/);
      expect(cardSrc).toContain("sentBody: sent");
      expect(all).toMatch(/after\?\.\(\);\s*onDone\(\)/);
    });
  }
});
