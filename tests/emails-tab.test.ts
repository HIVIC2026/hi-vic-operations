import { describe, expect, test } from "bun:test";
import { buildEmailsTab, buildNoJobFollowUpInput, buildNoJobInput, chunks, finishNoJobFollowUp, finishNoJobReply, jobDraftKey, missingDrafts, NOTHING_TO_ANSWER, noJobBaseText, followUpRetryDue, linkStates, noJobFollowUpKey, noJobFollowUpProblems, noJobFollowUpSentKey, noJobReplyProblems, stripQuotedEmail, type JobEmailRow, type UnmatchedRow } from "../src/lib/emails-tab.core";
import { HOMEOWNER_ENQUIRY_URL } from "../src/lib/engagement.core";

// Jo 27 Oct 2026, decision 414: the office Emails tab.
const change = (o: Partial<JobEmailRow> = {}): JobEmailRow => ({ eventId: "c1", jobId: "j1", jobNumber: "HV-2614", at: "2026-10-27T01:00:00Z", intent: "reply", messageId: "m1", from: "juineta@x.com", subject: "Is my spot saved?", label: "Owner emailed — reply needed", ...o });
const un = (o: Partial<UnmatchedRow> = {}): UnmatchedRow => ({ eventId: "u1", at: "2026-10-27T02:00:00Z", messageId: "m9", from: "Sam.K@email.com", fromName: "Sam King", subject: "Price?", snippet: "How much in Werribee?", guesses: [], ...o });
const base = () => ({ changes: [change()], unmatched: [un()], jobDrafts: new Map(), noJobDrafts: new Map(), closedJobDrafts: new Set<string>(), inboundByMessage: new Map([["m1", "Is my spot still saved?"]]), ownerNameByJob: new Map([["j1", "Juineta Smith"]]), autoRepliedSenders: new Set<string>() });

describe("Emails tab cards", () => {
  test("confirmed answered email leaves the inbox and count, but a later email from that sender stays", () => {
    const t = buildEmailsTab({ ...base(), unmatched: [un(), un({ eventId: "u2", messageId: "later" })], answeredNoJobMessageIds: new Set(["m9"]), autoRepliedSenders: new Set(["sam.k@email.com"]) });
    expect(t.noJob.map((c) => c.unmatchedEventId)).toEqual(["u2"]);
    expect(t.count).toBe(2);
    // Jo 28 Oct 2026: the later email is a follow-up from someone who already has the link — it gets an answer-only draft.
    expect(missingDrafts(t).unmatched).toEqual(["u2"]);
  });
  test("a reply claim without confirmed delivery does not hide the unanswered email", () => {
    const t = buildEmailsTab({ ...base(), autoRepliedSenders: new Set(["sam.k@email.com"]), answeredNoJobMessageIds: new Set() });
    expect(t.noJob.map((c) => c.unmatchedEventId)).toEqual(["u1"]);
  });
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
  test("missing drafts: job reply emails first, then no-job emails (follow-ups included, Jo 28 Oct 2026), capped", () => {
    const t = buildEmailsTab({ ...base(), changes: [change({ eventId: "r1" }), change({ eventId: "x", intent: "cancel" })], unmatched: [un({ eventId: "u1" }), un({ eventId: "u2", from: "done@x.com", at: "2026-10-27T01:00:00Z" })], autoRepliedSenders: new Set(["done@x.com"]) });
    expect(missingDrafts(t)).toEqual({ jobRequests: ["r1"], unmatched: ["u1", "u2"] });
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
    expect(finishNoJobReply(`Hi Sam,\n\nGreat question! Check here: ${HOMEOWNER_ENQUIRY_URL}`, "Sam King")).toMatch(/Cheers, the Home Insulation Victoria team$/);
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

describe("Follow-up questions from people who already got the website link (Jo 28 Oct 2026)", () => {
  const carolyn = "Thanks for that. Do you know how long we'd currently be looking at in terms of wait time if we did qualify? Thanks heaps. On 28 Oct 2026, at 6:35 pm, Home Insulation Victoria <Info@homeinsulation";
  test("the card is a follow-up and uses only a follow-up draft, never the website-link draft", () => {
    const linkDraft = buildEmailsTab({ ...base(), autoRepliedSenders: new Set(["sam.k@email.com"]), noJobDrafts: new Map([["m9", { eventId: "d1", body: "link", kind: "link" as const }]]) });
    expect(linkDraft.noJob[0]).toMatchObject({ followUp: true, draft: null, nothingToAnswer: false });
    const fu = buildEmailsTab({ ...base(), autoRepliedSenders: new Set(["sam.k@email.com"]), noJobDrafts: new Map([["m9", { eventId: "d2", body: "Hi Sam,", kind: "follow_up" as const }]]) });
    expect(fu.noJob[0]).toMatchObject({ followUp: true, draft: { eventId: "d2" } });
    const first = buildEmailsTab({ ...base(), noJobDrafts: new Map([["m9", { eventId: "d3", body: "link", kind: "link" as const }]]) });
    expect(first.noJob[0]).toMatchObject({ followUp: false, draft: { eventId: "d3" } });
  });
  test("'Nothing to answer' (just thanks or no) shows on the card, with no draft asked for again", () => {
    const t = buildEmailsTab({ ...base(), autoRepliedSenders: new Set(["sam.k@email.com"]), noJobDrafts: new Map([["m9", { eventId: "d4", body: "", kind: "follow_up" as const, nothingToAnswer: true }]]) });
    expect(t.noJob[0]).toMatchObject({ followUp: true, nothingToAnswer: true });
    expect(missingDrafts(t).unmatched).toEqual([]);
  });
  test("the AI sees only their new words — the quoted earlier email is cut off", () => {
    expect(stripQuotedEmail(carolyn)).toBe("Thanks for that. Do you know how long we'd currently be looking at in terms of wait time if we did qualify? Thanks heaps.");
    expect(stripQuotedEmail("Is it free?\n\nOn Tue, 28 Oct 2026 Home Insulation Victoria wrote:\n> Hi")).toBe("Is it free?");
    expect(stripQuotedEmail("Plain question")).toBe("Plain question");
    // Review fix: ordinary words are never cut — "on" in a sentence, or a signature with an email address.
    expect(stripQuotedEmail("Hi, do you work on weekends? Thanks, Sam <sam@gmail.com>")).toBe("Hi, do you work on weekends? Thanks, Sam <sam@gmail.com>");
    expect(stripQuotedEmail("On Monday I can be home. Is that ok? Jo <jo@x.com>")).toBe("On Monday I can be home. Is that ok? Jo <jo@x.com>");
  });
  test("AI input has their name and question, and no website link or base reply", () => {
    const s = buildNoJobFollowUpInput({ fromName: "Carolyn Cage", subject: "Re: VEU program ceiling insulation", snippet: carolyn });
    expect(s).toContain("Their first name: Carolyn");
    expect(s).toContain("wait time");
    expect(s).not.toContain("On 28 Oct 2026");
    expect(s).not.toContain(HOMEOWNER_ENQUIRY_URL);
  });
  test("finished follow-up: sign-off added, no link forced in; 'nothing to answer' gives no reply", () => {
    const r = finishNoJobFollowUp("Hi Carolyn,\n\nIt depends on installer availability.");
    expect(r).toMatch(/^Hi Carolyn,/);
    expect(r).toMatch(/Cheers, the Home Insulation Victoria team$/);
    expect(r).not.toContain(HOMEOWNER_ENQUIRY_URL);
    expect(finishNoJobFollowUp(NOTHING_TO_ANSWER)).toBeNull();
    expect(finishNoJobFollowUp(` ${NOTHING_TO_ANSWER}. `)).toBeNull();
    // Review fix: an empty or glitchy AI answer is an error (tried again later), never "Nothing to answer".
    expect(() => finishNoJobFollowUp("")).toThrow();
    expect(() => finishNoJobFollowUp("  ")).toThrow();
    expect(finishNoJobFollowUp("Hi Sam, NOTHING_TO_ANSWER but also a real sentence")).not.toBeNull();
  });
  test("follow-up send checks: no website link (answer only), no call us, no prices", () => {
    expect(noJobFollowUpProblems("Hi Carolyn, it depends on installers.")).toEqual([]);
    expect(noJobFollowUpProblems(" ")).toHaveLength(1);
    expect(noJobFollowUpProblems("Call us — it's $30/m²")).toHaveLength(2);
    expect(noJobFollowUpProblems(`Hi, see ${HOMEOWNER_ENQUIRY_URL}`)).toHaveLength(1);
  });
  test("send key: same email + same words = same key (a double tap can't send twice); edited words after a refusal = new key", () => {
    expect(noJobFollowUpKey("m9", "Hi")).toBe(noJobFollowUpKey("m9", "Hi "));
    expect(noJobFollowUpKey("m9", "Hi")).not.toBe(noJobFollowUpKey("m10", "Hi"));
    expect(noJobFollowUpKey("m9", "Hi")).not.toBe(noJobFollowUpKey("m9", "Hello"));
    expect(noJobFollowUpKey("m9", "Hi").startsWith(noJobFollowUpSentKey("m9"))).toBe(true);
  });
  test("'already has the link' unless the link email definitely failed (Jo 28 Oct 2026; unclear or still sending counts as had, so it can't go twice)", () => {
    const st = linkStates({
      claims: ["a@x.com", "b@x.com", "c@x.com", "p@x.com", "o@x.com", "r@x.com"],
      automatic: [{ from: "A@x.com", outcome: "accepted" }, { from: "b@x.com", outcome: "rejected" }, { from: "c@x.com", outcome: "uncertain" }, { from: "r@x.com", outcome: "not_attempted" }],
      office: [{ to: "o@x.com", status: "failed: bounced", kind: "link" }, { to: "r@x.com", status: "sent", kind: null }, { to: "b@x.com", status: "sent", kind: "follow_up" }],
    });
    expect(st.get("a@x.com")).toEqual({ hasLink: true, failedOnly: false, failures: 0 });
    expect(st.get("b@x.com")).toEqual({ hasLink: false, failedOnly: true, failures: 1 });
    expect(st.get("c@x.com")?.hasLink).toBe(true);
    expect(st.get("p@x.com")?.hasLink).toBe(true); // claimed, result not written yet
    expect(st.get("o@x.com")).toEqual({ hasLink: false, failedOnly: true, failures: 1 });
    expect(st.get("r@x.com")?.hasLink).toBe(true); // failed once, then the office link went
    expect(st.get("nobody@x.com")).toBeUndefined();
  });
  test("follow-ups never contain our website at all (any form)", () => {
    for (const b of ["see homeinsulationvictoria.com.au", "www.homeinsulationvictoria.com.au/homeowner", "HomeInsulationVictoria.com.au"]) expect(noJobFollowUpProblems(`Hi, ${b}`)).toHaveLength(1);
  });
  test("Outlook-style quotes are cut too", () => {
    expect(stripQuotedEmail("When can you come? From: Home Insulation Victoria <info@x.com> Sent: Tuesday To: me")).toBe("When can you come?");
    expect(stripQuotedEmail("Yes please -----Original Message----- old")).toBe("Yes please");
  });
  test("a failed AI attempt waits 30 minutes before trying that email again", () => {
    const now = Date.parse("2026-10-28T10:00:00Z");
    expect(followUpRetryDue([], now)).toBe(true);
    expect(followUpRetryDue(["2026-10-28T09:45:00Z"], now)).toBe(false);
    expect(followUpRetryDue(["2026-10-28T09:20:00Z"], now)).toBe(true);
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
    // A second link email only goes when every earlier attempt definitely failed, under its own once-only claim.
    expect(src).toContain("if (claimErr?.code === \"23505\") {");
    expect(src).toContain("retry${");
    expect(src).toContain(":send:${draft.id}:${shortHash(body.trim())}");
  });
  test("a follow-up reply does NOT use the one-link-per-person claim, but checks it wasn't already sent and uses a per-email key", () => {
    const fu = src.slice(src.indexOf("async function sendNoJobFollowUp"));
    expect(fu.length).toBeGreaterThan(30);
    const body = fu.slice(0, fu.indexOf("\n}\n"));
    expect(body).not.toContain("newSenderReplyKey");
    expect(body).toContain("noJobFollowUpKey(");
    expect(body).toContain("noJobFollowUpSentKey(");
    const check = body.indexOf("NO_JOB_REPLY_SENT_EVENT");
    expect(check).toBeGreaterThan(0);
    expect(body.indexOf("await resendSend(to,")).toBeGreaterThan(check);
    expect(src).toContain('draft.details["kind"] === "follow_up"');
  });
  test("Match only raises a reply for the job's owner", () => {
    expect(src).toContain("if (fromOwner && !(open ?? []).length)");
  });
});
