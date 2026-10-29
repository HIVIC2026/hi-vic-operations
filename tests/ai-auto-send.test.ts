// AI replies step 4, task 1: the AI labels each draft's kind; a pure rule says whether it may send itself.
import { describe, expect, test } from "bun:test";
import { AUTO_SEND_KINDS, COMPLAINT_WORDS, aiReplyInstructions, aiReplyProblems, autoSendDecision, splitAiOutput, type AiAutoKind } from "../src/lib/ai-email-reply.core";

const BODY = "Hi Sam,\n\nYour job is booked in.";
// 30 Oct 2026 is daylight time in Melbourne (UTC+11).
const TWO_PM = "2026-10-30T03:00:00Z";
const NINE_PM = "2026-10-30T10:00:00Z";
const SIX_59_AM = "2026-10-29T19:59:00Z";
const SEVEN_AM = "2026-10-29T20:00:00Z";

const ok = () => ({
  switchOn: true, kind: "job_status" as AiAutoKind, problems: [] as string[], needsAnswer: [] as string[], needsYou: false,
  hasActions: false, optedOut: false, ownerEmail: "sam@example.com", ownerText: "Where is my job up to?", nowIso: TWO_PM,
});

describe("kind label", () => {
  test("missing or unknown → other", () => {
    expect(splitAiOutput(BODY).kind).toBe("other");
    expect(splitAiOutput(`${BODY}\nKIND: banana`).kind).toBe("other");
    expect(splitAiOutput(`${BODY}\nKIND:`).kind).toBe("other");
  });
  test("each kind parses; mixed case and spaces", () => {
    expect(splitAiOutput(`${BODY}\nKIND: job_status`).kind).toBe("job_status");
    expect(splitAiOutput(`${BODY}\nkind:   Resend_Link  `).kind).toBe("resend_link");
    expect(splitAiOutput(`${BODY}\nKiNd: FILES_RECEIVED`).kind).toBe("files_received");
  });
  test("bold and list forms", () => {
    expect(splitAiOutput(`${BODY}\n\n**KIND**: job_status`).kind).toBe("job_status");
    expect(splitAiOutput(`${BODY}\n\n- **KIND:** resend_link`).kind).toBe("resend_link");
    expect(splitAiOutput(`${BODY}\n> KIND: files_received`).kind).toBe("files_received");
  });
  test("two lines that disagree → other; two that agree keep the kind", () => {
    expect(splitAiOutput(`${BODY}\nKIND: job_status\nKIND: resend_link`).kind).toBe("other");
    expect(splitAiOutput(`${BODY}\nKIND: job_status\nKIND: job_status`).kind).toBe("job_status");
  });
  test("marker is stripped from the body", () => {
    const r = splitAiOutput(`${BODY}\n\nKIND: job_status`);
    expect(r.body).toBe(BODY);
    expect(r.needsAnswer).toEqual([]);
  });
  test("a leftover KIND line is flagged on Send so it never reaches an owner", () => {
    expect(aiReplyProblems(`${BODY}\nKIND: job_status`).length).toBeGreaterThan(0);
    expect(aiReplyProblems(`${BODY}\n**KIND**: other`).length).toBeGreaterThan(0);
    expect(aiReplyProblems(BODY)).toEqual([]);
  });
  test("both prompts ask for the KIND line", () => {
    expect(aiReplyInstructions()).toContain("KIND:");
    expect(aiReplyInstructions({ preRelease: true })).toContain("KIND:");
  });
  test("auto-send kinds", () => {
    expect([...AUTO_SEND_KINDS].sort()).toEqual(["files_received", "job_status", "resend_link"]);
  });
});

describe("autoSendDecision", () => {
  test("eligible at 2pm → now", () => expect(autoSendDecision(ok())).toEqual({ send: "now", reason: "Sends itself" }));
  test("eligible at 9pm → at7am", () => expect(autoSendDecision({ ...ok(), nowIso: NINE_PM })).toEqual({ send: "at7am", reason: "Waiting for 7am" }));
  test("6:59am → at7am, 7:00am → now", () => {
    expect(autoSendDecision({ ...ok(), nowIso: SIX_59_AM }).send).toBe("at7am");
    expect(autoSendDecision({ ...ok(), nowIso: SEVEN_AM }).send).toBe("now");
  });
  const blockers: [string, Partial<ReturnType<typeof ok>>, string][] = [
    ["switch off", { switchOn: false }, "Auto-send is off"],
    ["kind other", { kind: "other" }, "Only simple replies send themselves"],
    ["problems", { problems: ["Take out the phone number."] }, "Has a rule problem"],
    ["needs answer", { needsAnswer: ["Do you do sheds?"] }, "Needs your answer"],
    ["needs you", { needsYou: true }, "Needs you"],
    ["actions", { hasActions: true }, "Has a suggested job change"],
    ["opted out", { optedOut: true }, "Owner unsubscribed"],
    ["blank email", { ownerEmail: "  " }, "No owner email"],
    ["complaint words", { ownerText: "I want a refund" }, "Owner sounds unhappy"],
  ];
  for (const [name, patch, reason] of blockers) {
    test(`blocker: ${name}`, () => expect(autoSendDecision({ ...ok(), ...patch })).toEqual({ send: "no", reason }));
  }
  test("blockers win over quiet hours", () => {
    expect(autoSendDecision({ ...ok(), nowIso: NINE_PM, needsYou: true }).send).toBe("no");
  });
  test("blockers are checked in order", () => {
    const all = { switchOn: false, kind: "other" as AiAutoKind, problems: ["x"], needsAnswer: ["q"], needsYou: true, hasActions: true, optedOut: true, ownerEmail: "", ownerText: "refund" };
    const steps: [Partial<typeof all>, string][] = [
      [{}, "Auto-send is off"], [{ switchOn: true }, "Only simple replies send themselves"], [{ kind: "job_status" as AiAutoKind }, "Has a rule problem"],
      [{ problems: [] }, "Needs your answer"], [{ needsAnswer: [] }, "Needs you"], [{ needsYou: false }, "Has a suggested job change"],
      [{ hasActions: false }, "Owner unsubscribed"], [{ optedOut: false }, "No owner email"], [{ ownerEmail: "a@b.co" }, "Owner sounds unhappy"],
    ];
    let cur = { ...all, nowIso: TWO_PM };
    for (const [patch, reason] of steps) { cur = { ...cur, ...patch }; expect(autoSendDecision(cur).reason).toBe(reason); }
  });
  test("each complaint word", () => {
    for (const w of ["refund", "damage", "damaged", "unhappy", "mess", "cancel", "complain", "complaint", "disappointed", "angry", "wrong", "broken", "leak", "scam", "rip-off", "Rip off"]) {
      expect(COMPLAINT_WORDS.test(`this is ${w} now`)).toBe(true);
      expect(autoSendDecision({ ...ok(), ownerText: `this is ${w} now` }).send).toBe("no");
    }
    expect(autoSendDecision({ ...ok(), ownerText: "Thanks, where are we up to?" }).send).toBe("now");
  });
});
