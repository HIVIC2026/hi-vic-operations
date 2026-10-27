import { describe, expect, test } from "bun:test";
import { buildEmailsTab, buildNoJobInput, chunks, finishNoJobReply, jobDraftKey, missingDrafts, noJobBaseText, noJobReplyProblems, type JobEmailRow, type UnmatchedRow } from "../src/lib/emails-tab.core";
import { HOMEOWNER_ENQUIRY_URL } from "../src/lib/engagement.core";

// Jo 27 Oct 2026, decision 414: the office Emails tab.
const change = (o: Partial<JobEmailRow> = {}): JobEmailRow => ({ eventId: "c1", jobId: "j1", jobNumber: "HV-2614", at: "2026-10-27T01:00:00Z", intent: "reply", messageId: "m1", from: "juineta@x.com", subject: "Is my spot saved?", label: "Owner emailed — reply needed", ...o });
const un = (o: Partial<UnmatchedRow> = {}): UnmatchedRow => ({ eventId: "u1", at: "2026-10-27T02:00:00Z", messageId: "m9", from: "Sam.K@email.com", fromName: "Sam King", subject: "Price?", snippet: "How much in Werribee?", guesses: [], ...o });
const base = () => ({ changes: [change()], unmatched: [un()], jobDrafts: new Map(), noJobDrafts: new Map(), closedJobDrafts: new Set<string>(), inboundByMessage: new Map([["m1", "Is my spot still saved?"]]), ownerNameByJob: new Map([["j1", "Juineta Smith"]]), autoRepliedSenders: new Set<string>() });

describe("Emails tab cards", () => {
  test("a job email shows what they wrote, the owner, its draft and Done", () => {
    const t = buildEmailsTab({ ...base(), jobDrafts: new Map([[jobDraftKey("j1", "m1"), { eventId: "d1", body: "Hi Juineta! Yes it's saved." }]]) });
    expect(t.count).toBe(2);
    expect(t.withJob[0]).toMatchObject({ requestEventId: "c1", jobNumber: "HV-2614", name: "Juineta Smith", theyWrote: "Is my spot still saved?", draft: { eventId: "d1" }, action: "done" });
  });
  test("change requests keep their Apply; reschedule is 'dealt with'", () => {
    const t = buildEmailsTab({ ...base(), changes: [change({ eventId: "a", intent: "cancel" }), change({ eventId: "b", intent: "reschedule", at: "2026-10-27T00:00:00Z" })] });
    expect(t.withJob.map((c) => c.action)).toEqual(["apply", "dealt_with"]);
  });
  test("a no-job email shows the best guess and whether the automatic website reply already went", () => {
    const t = buildEmailsTab({ ...base(), unmatched: [un({ guesses: [{ job_id: "j7", job_number: "HV-3193" }] })], autoRepliedSenders: new Set(["sam.k@email.com"]) });
    expect(t.noJob[0]).toMatchObject({ unmatchedEventId: "u1", guess: { jobId: "j7", jobNumber: "HV-3193" }, alreadyAutoReplied: true, theyWrote: "How much in Werribee?" });
  });
  test("newest first in each list", () => {
    const t = buildEmailsTab({ ...base(), changes: [change({ eventId: "old", at: "2026-10-01T00:00:00Z" }), change({ eventId: "new", at: "2026-10-27T05:00:00Z" })] });
    expect(t.withJob.map((c) => c.requestEventId)).toEqual(["new", "old"]);
  });
  test("missing drafts: job reply emails first, then no-job emails not already auto-replied, capped", () => {
    const t = buildEmailsTab({ ...base(), changes: [change({ eventId: "r1" }), change({ eventId: "x", intent: "cancel" })], unmatched: [un({ eventId: "u1" }), un({ eventId: "u2", from: "done@x.com" })], autoRepliedSenders: new Set(["done@x.com"]) });
    expect(missingDrafts(t)).toEqual({ jobRequests: ["r1"], unmatched: ["u1"] });
    expect(missingDrafts(t, 1)).toEqual({ jobRequests: ["r1"], unmatched: [] });
  });
});

describe("Review fixes (decision 414)", () => {
  test("a job card never picks up a no-job draft for the same message (after Match)", () => {
    const t = buildEmailsTab({ ...base(), changes: [change({ messageId: "m9" })], unmatched: [], noJobDrafts: new Map([["m9", { eventId: "nj", body: "x" }]]) });
    expect(t.withJob[0]!.draft).toBeNull();
  });
  test("a job draft is only used on its own job", () => {
    const t = buildEmailsTab({ ...base(), jobDrafts: new Map([[jobDraftKey("other-job", "m1"), { eventId: "d9", body: "x" }]]) });
    expect(t.withJob[0]!.draft).toBeNull();
  });
  test("a job email whose draft was already sent or discarded is not asked for again (never blocks the queue)", () => {
    const closed = new Set([jobDraftKey("j1", "s1"), jobDraftKey("j1", "s2"), jobDraftKey("j1", "s3"), jobDraftKey("j1", "s4"), jobDraftKey("j1", "s5")]);
    const t = buildEmailsTab({ ...base(), changes: ["s1", "s2", "s3", "s4", "s5"].map((m, n) => change({ eventId: `c${n}`, messageId: m })), closedJobDrafts: closed });
    expect(t.withJob.every((c) => c.draftClosed)).toBe(true);
    expect(missingDrafts(t)).toEqual({ jobRequests: [], unmatched: ["u1"] });
  });
  test("chunks keep request lists short", () => {
    expect(chunks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunks([], 50)).toEqual([]);
  });
});

describe("No-job AI reply", () => {
  test("base text is Jo's approved wording without the sign-off", () => {
    const b = noJobBaseText("Sam");
    expect(b.startsWith("Hi Sam,\n\nThanks for getting in touch!")).toBe(true);
    expect(b).toContain(HOMEOWNER_ENQUIRY_URL);
    expect(b).not.toContain("Cheers");
  });
  test("AI input carries the base reply and what they wrote", () => {
    const s = buildNoJobInput({ fromName: "Sam King", subject: "Price?", snippet: "How much in Werribee?" });
    expect(s).toContain("Their first name: Sam");
    expect(s).toContain(HOMEOWNER_ENQUIRY_URL);
    expect(s).toContain("How much in Werribee?");
  });
  test("finished reply keeps the link, adds the sign-off; a reply that lost the link falls back to the base", () => {
    expect(finishNoJobReply(`Hi Sam,\n\nGreat question! Check here: ${HOMEOWNER_ENQUIRY_URL}`, "Sam King")).toMatch(/Kind regards,\nJo\nHome Insulation Victoria$/);
    const fb = finishNoJobReply("Hi Sam, we'll be in touch.", "Sam King");
    expect(fb).toContain(HOMEOWNER_ENQUIRY_URL);
    expect(fb).toContain("Thanks for getting in touch!");
  });
  test("send checks: link kept, no call us, no prices", () => {
    expect(noJobReplyProblems(`Hi, here: ${HOMEOWNER_ENQUIRY_URL}`)).toEqual([]);
    expect(noJobReplyProblems("Hi there")).toHaveLength(1);
    expect(noJobReplyProblems(`Call us! ${HOMEOWNER_ENQUIRY_URL} it's $30/m²`)).toHaveLength(2);
  });
});

describe("Emails show in one place only (decision 414)", () => {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  test("Needs me no longer lists owner emails; Enquiries no longer has Emails to match", () => {
    expect(readFileSync("src/lib/office-needs.server.ts", "utf8")).toContain("for (const c of [] as unknown as { eventId: string; jobId: string; at: string; intent?: string; phrase?: string }[])");
    expect(readFileSync("src/components/portal/EnquiriesScreen.tsx", "utf8")).not.toContain("<EmailsToMatch />");
  });
  test("the Emails heading has a route and a count", () => {
    expect(readFileSync("src/routes/_authenticated/admin.emails.tsx", "utf8")).toContain('createFileRoute("/_authenticated/admin/emails")');
    const bar = readFileSync("src/components/portal/office.tsx", "utf8");
    expect(bar).toContain("useEmailsCount()");
    expect(bar).toContain('<div className="grid grid-cols-6">');
  });
});

describe("Send safety (decision 414 review)", () => {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const src = readFileSync("src/lib/emails-tab.server.ts", "utf8");
  test("a no-job reply claims the one-per-person website reply BEFORE sending", () => {
    const claim = src.indexOf("idempotency_key: newSenderReplyKey(to)");
    const send = src.indexOf("await resendSend(to,");
    expect(claim).toBeGreaterThan(0);
    expect(send).toBeGreaterThan(claim);
    expect(src).toContain('claimErr?.code === "23505"');
  });
  test("Match only raises a reply for the job's owner", () => {
    expect(src).toContain("if (fromOwner && !(open ?? []).length)");
  });
});
