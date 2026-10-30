// Decision 386 (Jo 25 Oct 2026, "Auto-send simple ones"): matched OWNERS' standard questions get ONE automatic reply;
// anything unusual stays a decision-244 draft + a Needs me row; a replied conversation is filed in Outlook Archive.
// Pure classifier table, wording + draft files (rendered HTML equals the file), the Archive-only Outlook write guard,
// then the server against an in-memory backend with every sender mocked: unapproved → draft + row and nothing sent,
// TEST → test-send, one claim before the send, a second run sends nothing, filing after a sent reply only.
// Run: bun test tests/owner-email-auto-reply.test.ts
import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  ANSWER_CODES, ANSWER_SAMPLES, ANSWER_TYPES, EMAIL_AUTO_REPLIED_EVENT, EMAIL_AUTO_REPLY_FILED_EVENT, EMAIL_AUTO_REPLY_HELD_EVENT, LONG_LIST,
  OWNER_EMAIL_AUTO_REPLY_APPROVED, REPLY_NEEDED_INTENT, answerText, autoReplyKey, autoReplyMode, decideOwnerAutoReply, quoteScreenLink,
  renderAnswerSample, renderOwnerAutoReplyEmail, type AnswerType, type AutoReplyInput, type OwnerJobFacts,
} from "../src/lib/owner-email-auto-reply.core";
import { ARCHIVE_FOLDER, assertArchiveMoveRequest, assertDraftOnlyRequest } from "../src/lib/email-reply.core";
import { OUTLOOK_ARCHIVE_AFTER_REPLY_ENABLED } from "../src/lib/outlook-reply-drafts.core";

const read = (f: string) => readFileSync(f, "utf8");
const MY_JOB = "https://estimate.homeinsulationvictoria.com.au/my-job/tok";
const QUESTIONS = "https://estimate.homeinsulationvictoria.com.au/estimate/tok/video";
const RC = { kind: "ready_check" as const, slot: { start: "2026-10-27T21:00:00Z", end: null } };

const facts = (o: Partial<OwnerJobFacts> = {}): OwnerJobFacts => ({
  stage: "preliminary_estimate_ready", ownerFullName: "Helen Yang", spotSaved: false, questionsAnswered: false, nextVisit: null, quoteStatus: null,
  myJobLink: MY_JOB, questionsLink: QUESTIONS, ...o,
});
const WAITING = { stage: "spot_saved", spotSaved: true } as const;
const input = (body: string, job: OwnerJobFacts | null = facts(), o: Partial<AutoReplyInput> = {}): AutoReplyInput => ({
  subject: "Re: Your estimate", body, fromName: "Helen", hasAttachments: false, attachments: [], jobCount: 1, senderIsOwner: true, senderIsPartnerOrStaff: false, job, ...o,
});
const decide = (body: string, job?: OwnerJobFacts | null, o?: Partial<AutoReplyInput>) => decideOwnerAutoReply(input(body, job === undefined ? facts() : job, o));

describe("decision 386 classifier: send only the standard answers", () => {
  const SEND: [string, string, OwnerJobFacts, AnswerType, string][] = [
    ["how do I save my spot (not saved)", "Hi, how do I save my spot?", facts(), "save_spot", QUESTIONS],
    ["is my spot saved (not saved yet → how to save)", "Is my spot saved?", facts(), "save_spot", QUESTIONS],
    ["answered but not saved → one more tap", "Hi, I've answered the questions.", facts({ questionsAnswered: true }), "answers_save_spot", QUESTIONS],
    ["is my spot saved (saved)", "Hi, is my spot saved?", facts(WAITING), "spot_saved", MY_JOB],
    ["answered the questions (saved)", "We have answered the 3 questions", facts({ ...WAITING, questionsAnswered: true }), "answers_received", MY_JOB],
    ["what happens next (waiting)", "What happens next?", facts(WAITING), "spot_saved", MY_JOB],
    ["any update (waiting)", "Any update?", facts({ stage: "ready_check_ready_to_schedule", spotSaved: true }), "spot_saved", MY_JOB],
    ["what happens next (times offered)", "What's next?", facts({ stage: "ready_check_awaiting_acceptance", spotSaved: true }), "pick_times", MY_JOB],
    ["when is my visit (booked)", "When is the installer coming?", facts({ stage: "ready_check_scheduled", spotSaved: true, nextVisit: RC }), "visit_booked", MY_JOB],
    ["when is my visit (safety check booked)", "What day is the electrician coming?", facts({ stage: "piesa_scheduled", spotSaved: true, quoteStatus: "accepted", nextVisit: { kind: "piesa", slot: RC.slot } }), "visit_booked", MY_JOB],
    ["where is my quote (sent)", "Where is my quote?", facts({ stage: "awaiting_quote_acceptance", spotSaved: true, quoteStatus: "issued" }), "quote_ready", MY_JOB],
    ["where is my quote (being prepared)", "Haven't received my quote yet, where is my quote?", facts({ stage: "ready_check_complete", spotSaved: true }), "quote_preparing", MY_JOB],
    ["where is my quote (spot saved, not released → the spot-saved answer, decision 388)", "Where is my quote?", facts(WAITING), "spot_saved", MY_JOB],
    ["where is my quote (times offered → after the Ready Check)", "Where is my quote?", facts({ stage: "ready_check_awaiting_acceptance", spotSaved: true }), "quote_after_ready_check", MY_JOB],
    ["how do I pay (quote accepted)", "How do I pay?", facts({ stage: "measured_quote_accepted", spotSaved: true, quoteStatus: "accepted" }), "how_to_pay", MY_JOB],
  ];
  for (const [name, body, f, answer, link] of SEND) test(`send: ${name}`, () => {
    const d = decide(body, f);
    expect(d).toMatchObject({ kind: "send", answer, link });
  });

  test("thank-you only → no reply needed", () => {
    for (const b of ["Thanks!", "Thank you so much, Helen", "Got it, cheers"]) expect(decide(b, facts(WAITING)).kind).toBe("none");
    expect(decide("Thanks! Is my spot saved?", facts(WAITING)).kind).toBe("send");
  });

  const DRAFT: [string, string, OwnerJobFacts | null, Partial<AutoReplyInput>, RegExp][] = [
    ["complaint", "I'm really not happy with how long this is taking, is my spot saved?", facts(WAITING), {}, /complaint/],
    ["price dispute", "Your price is way too high, the other quote was cheaper", facts(WAITING), {}, /price/],
    ["price question", "How much will it cost?", facts(WAITING), {}, /price/],
    ["price in a status question", "Where is my quote? Is the $2,000 still right?", facts(WAITING), {}, /price/],
    ["legal / ESC", "Can I talk to someone about the ESC and my rights?", facts(WAITING), {}, /legal|ESC/],
    ["rebate question", "Am I eligible for the rebate?", facts(WAITING), {}, /rebate/],
    ["unusual roof", "We have a tiled roof with no manhole, is my spot saved?", facts(WAITING), {}, /roof|access/],
    ["cancel the owner can't do on My job (no 337 intent caught)", "I want to cancel please", facts(WAITING), {}, /change of plans/],
    ["multiple jobs", "Is my spot saved?", facts(WAITING), { jobCount: 2 }, /more than one job/],
    ["attachments not yet listed", "Is my spot saved?", facts(WAITING), { hasAttachments: true, attachments: [] }, /attachments/],
    ["no link → never invent one", "How do I save my spot?", facts({ myJobLink: null, questionsLink: null }), {}, /no working secure link/],
    ["says answered but nothing recorded", "I've answered the questions", facts(WAITING), {}, /no answers are recorded/],
    ["nothing to pay yet", "How do I pay?", facts(WAITING), {}, /nothing is due/],
    ["no booked visit outside the waiting list", "When is my visit?", facts({ stage: "piesa_and_install_window_pending", spotSaved: true, quoteStatus: "accepted" }), {}, /no booked visit/],
    ["not recognised", "Hello, I was wondering about the colour of the batts", facts(WAITING), {}, /no standard question/],
    ["several questions", "Is my spot saved? When is the visit? What happens next?", facts(WAITING), {}, /several questions/],
    ["two different answers", "Where is my quote? How do I pay?", facts({ stage: "awaiting_quote_acceptance", spotSaved: true, quoteStatus: "issued" }), {}, /nothing is due|more than one/],
    ["cancelled job", "What happens next?", facts({ stage: "cancelled" }), {}, /cancelled/],
    ["long email", `Is my spot saved? ${"We are really looking forward to it. ".repeat(20)}`, facts(WAITING), {}, /long email/],
    ["facts unreadable", "Is my spot saved?", null, {}, /could not be read/],
  ];
  for (const [name, body, f, o, why] of DRAFT) test(`draft: ${name}`, () => {
    const d = decide(body, f, o);
    expect(d.kind).toBe("draft");
    expect((d as { reason: string }).reason).toMatch(why);
  });

  test("never for partners, staff or anyone but the owner on file (unchanged path: skip)", () => {
    expect(decide("Is my spot saved?", facts(WAITING), { senderIsOwner: false })).toEqual({ kind: "skip", reason: "sender is not the owner on file" });
    expect(decide("Is my spot saved?", facts(WAITING), { senderIsPartnerOrStaff: true }).kind).toBe("skip");
  });
  test("decisions 245/337 keep priority for change / cancel / contact asks (skip)", () => {
    expect(decide("Sorry, we can't make Thursday, can we change the day?", facts(WAITING))).toMatchObject({ kind: "skip", reason: expect.stringContaining("reschedule") });
    expect(decide("Please use my new number 0412 345 678", facts(WAITING))).toMatchObject({ kind: "skip", reason: expect.stringContaining("contact_change") });
    // A file attached is decision 245's "Owner sent a photo or document" row (attachments always reach a person).
    expect(decide("Is my spot saved?", facts(WAITING), { hasAttachments: true, attachments: [{ name: "ceiling.jpg", contentType: "image/jpeg", isInline: false }] })).toMatchObject({ kind: "skip", reason: expect.stringContaining("attachment") });
  });
  test("quoted history and our own 'Re:' subject never trigger an answer", () => {
    const body = "Thanks!\n\nOn Mon, 20 Oct 2026 Home Insulation Victoria wrote:\n> How much will it cost? Save my spot here. Price $2,188";
    expect(decide(body, facts(WAITING), { subject: "Re: Save my spot — price inside" }).kind).toBe("none");
  });
  test("mode: TEST → test-send; real owners need the approved flag AND customer comms", () => {
    expect(OWNER_EMAIL_AUTO_REPLY_APPROVED).toBe(true); // Jo approved the O76 wording 27 Oct 2026 (decision 406)
    expect(autoReplyMode({ testJob: true, approved: false, commsEnabled: null })).toEqual({ mode: "test_send" });
    expect(autoReplyMode({ testJob: false, approved: false, commsEnabled: true }).mode).toBe("held");
    expect(autoReplyMode({ testJob: false, approved: true, commsEnabled: false }).mode).toBe("held");
    expect(autoReplyMode({ testJob: false, approved: true, commsEnabled: true })).toEqual({ mode: "live" });
    expect(autoReplyKey("AAMk")).toBe("owner-email-auto-reply:v1:AAMk");
  });
});

describe("decision 386 wording (DRAFT O76a–O76j)", () => {
  test("never the calculator, and no link at all for a non-owner or an owner without an active link (Jo 25 Oct)", () => {
    for (const a of ANSWER_TYPES) {
      const m = renderAnswerSample(a);
      expect({ a, calc: /calculator/i.test(m.html + m.text) }).toEqual({ a, calc: false });
    }
    expect(decide("Is my spot saved?", facts(WAITING), { senderIsOwner: false })).not.toHaveProperty("link");
    expect(decide("Is my spot saved?", facts({ ...WAITING, myJobLink: null, questionsLink: null }))).toMatchObject({ kind: "draft" });
    expect(read("src/lib/owner-email-auto-reply.core.ts")).not.toMatch(/CUSTOMER_BASE|WEBSITE_CALCULATOR_URL|\/calculator/);
  });
  test("subject Re: their subject; greeting, the team sign-off, their own link; long list wherever they wait", () => {
    const m = renderOwnerAutoReplyEmail({ answer: "spot_saved", facts: { firstName: "Helen", link: MY_JOB }, theirSubject: "Is my spot saved?" });
    expect(m.subject).toBe("Re: Is my spot saved?");
    expect(m.text).toContain("Hi Helen,");
    expect(m.text).toContain("Cheers, the Home Insulation Victoria team");
    expect(m.html).toContain("Cheers,<br />the Home Insulation Victoria team");
    expect(m.html).toContain(`href="${MY_JOB}"`);
    expect(m.html).toContain("https://homeinsulationvictoria.com.au/home-insulation-victoria-logo.png");
    expect(m.html).not.toContain("data:image");
    for (const a of ["save_spot", "answers_save_spot", "spot_saved", "answers_received"] as AnswerType[]) expect(answerText(a, { firstName: null, link: MY_JOB })).toContain(LONG_LIST);
    expect(LONG_LIST).toBe("Thousands of Victorians have registered. Spots are released in the order they were saved."); // decision 388
    const booked = answerText("visit_booked", { firstName: null, link: MY_JOB, visit: RC });
    expect(booked).toContain("Your free Ready Check is booked");
    expect(booked).toContain("It's on Wednesday 28 October at 8am.");
    expect(renderOwnerAutoReplyEmail({ answer: "visit_booked", facts: { firstName: null, link: MY_JOB, visit: RC }, theirSubject: null }).html).toContain("<strong>Wednesday 28 October at 8am</strong>");
    expect(answerText("quote_ready", { firstName: "Helen", link: `${MY_JOB}?x=1` })).toContain(`See your quote: ${quoteScreenLink(MY_JOB)}`);
    expect(renderOwnerAutoReplyEmail({ answer: "quote_ready", facts: { firstName: "Helen", link: `${MY_JOB}?x=1` }, theirSubject: null }).html).toContain(`href="${quoteScreenLink(MY_JOB)}"`);
    expect(renderOwnerAutoReplyEmail({ answer: "how_to_pay", facts: { firstName: null, link: MY_JOB }, theirSubject: null, test: true }).html).toContain("TEST — only sent to Jo");
  });
  test("one draft file per answer, rendered HTML equals the file (bun scripts/render-decision-386-drafts.ts)", () => {
    const src = read("scripts/render-decision-386-drafts.ts");
    expect(src).toContain("renderAnswerSample");
    expect(new Set(ANSWER_TYPES.map((a) => ANSWER_CODES[a].code)).size).toBe(ANSWER_TYPES.length);
    for (const a of ANSWER_TYPES) {
      const file = `docs/templates/drafts/${ANSWER_CODES[a].file}`;
      expect({ file, same: renderAnswerSample(a).html === read(file) }).toEqual({ file, same: true });
      expect(read(file)).toContain("VEU Accredited Person A003654");
      expect(read(file)).toContain(ANSWER_SAMPLES[a].facts.link.replace(/\?.*$/, ""));
    }
  });
});

describe("filing: the only Outlook write besides drafts is ONE move to Archive", () => {
  const P = "/users/info%40homeinsulationvictoria.com.au/messages/AAMk1/move";
  test("allowed: POST …/messages/{id}/move to archive; refused: anything else", () => {
    expect(OUTLOOK_ARCHIVE_AFTER_REPLY_ENABLED).toBe(false);
    expect(() => assertArchiveMoveRequest("POST", P, { destinationId: ARCHIVE_FOLDER })).not.toThrow();
    expect(() => assertArchiveMoveRequest("POST", P, { destinationId: "deleteditems" })).toThrow(/Archive/);
    expect(() => assertArchiveMoveRequest("POST", P, { destinationId: "archive", extra: 1 })).toThrow();
    expect(() => assertArchiveMoveRequest("POST", P.replace("/move", "/send"), { destinationId: "archive" })).toThrow();
    expect(() => assertArchiveMoveRequest("POST", P.replace("/move", "/copy"), { destinationId: "archive" })).toThrow();
    expect(() => assertArchiveMoveRequest("DELETE", P, { destinationId: "archive" })).toThrow();
    expect(() => assertArchiveMoveRequest("POST", `${P}?x=1`, { destinationId: "archive" })).toThrow();
    // The draft guard still refuses a move (the two capabilities stay separate).
    expect(() => assertDraftOnlyRequest("POST", P)).toThrow();
  });
  test("source: the move lives beside the draft writes, behind its own switch, and nothing sends through Graph", () => {
    const er = read("src/lib/email-reply.server.ts");
    const fn = er.slice(er.indexOf("export async function archiveRepliedMessage"), er.indexOf("/** Create the draft reply"));
    expect(fn).toContain("p.enabled ?? OUTLOOK_ARCHIVE_AFTER_REPLY_ENABLED");
    expect(fn.indexOf("assertArchiveMoveRequest(\"POST\", path, body)")).toBeLessThan(fn.indexOf("await fetch("));
    const srv = read("src/lib/owner-email-auto-reply.server.ts").replace(/^\s*\/\/.*$/gm, "");
    expect(srv).not.toMatch(/sendMail|createReply|\/send["'`]|graphDraftWrite|fetch\(/);
    expect(srv.indexOf("archiveRepliedMessage(")).toBeGreaterThan(srv.indexOf("if (!sent)"));
  });
});

describe("copier wiring", () => {
  test("the auto reply runs after the 245/337 step and before the decision-244 draft, in sync and office match", () => {
    const s = read("src/lib/outlook-sync.server.ts");
    const fw = s.slice(s.indexOf("async function finishWork"), s.indexOf("async function portalDuplicate"));
    expect(fw.indexOf("recordChangeRequests(")).toBeLessThan(fw.indexOf("ownerAutoReply("));
    expect(fw.indexOf("ownerAutoReply(")).toBeLessThan(fw.indexOf("draftReply("));
    expect(fw).toContain("!replied && await draftReply(work.message");
    const om = s.slice(s.indexOf("export async function fileOutlookMessageOnJob"), s.indexOf("async function finishWork"));
    expect(om).toContain("const replied = await ownerAutoReply([jobId], filed, mailbox, undefined, { autoSend: false });");
    expect(om).toContain("replied ? null : await draftReply(filed, mailbox, [jobId], \"office_matched\")");
  });
  test("Needs me: the reply-needed row reuses the email row (Done / Ignore) and Done changes nothing on the job", async () => {
    const { CHANGE_LINE, emailRow } = await import("../src/lib/office-needs.core");
    expect(CHANGE_LINE.reply).toBe("Owner emailed — reply needed (AI draft on the job)");
    const row = emailRow({ type: "change", eventId: "e1", jobId: "j1", jobNumber: "HV-1", surname: "Yang", suburb: null, line: CHANGE_LINE.reply, at: "2026-10-25T00:00:00Z", intent: REPLY_NEEDED_INTENT });
    expect(row.button?.label).toBe("Done");
    const office = read("src/lib/email-office.server.ts");
    expect(office.slice(office.indexOf('case "reply":'), office.indexOf('case "reschedule":'))).toContain('outcome = "office_replied"');
  });
});

// ---------------------------------------------------------------- server (in-memory backend, senders mocked)

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- in-memory rows of any table
type Row = Record<string, any>;
const FUTURE = "2099-01-01T00:00:00Z";
const fresh = (): Record<string, Row[]> => ({
  jobs: [
    { id: "job-real", stage: "spot_saved", source: "website", owner_id: "o1", deleted_at: null },
    { id: "job-test", stage: "spot_saved", source: "qa_test", owner_id: "o2", deleted_at: null },
    { id: "job-enq", stage: "preliminary_estimate_ready", source: "website", owner_id: "o3", deleted_at: null },
    { id: "job-staff", stage: "spot_saved", source: "website", owner_id: "o4", deleted_at: null },
  ],
  owners: [
    { id: "o1", full_name: "Helen Yang", email: "Helen@Example.com" }, { id: "o2", full_name: "Test Owner", email: "jo@test.test" },
    { id: "o3", full_name: "Sam Lee", email: "sam@example.com" }, { id: "o4", full_name: "Chris Staff", email: "chris@homeinsulationvictoria.com.au" },
  ],
  lead_campaign_responses: [
    { job_id: "job-real", spot_saved_at: "2026-10-20T00:00:00Z", opted_out_at: null }, { job_id: "job-test", spot_saved_at: "2026-10-20T00:00:00Z", opted_out_at: null },
    { job_id: "job-staff", spot_saved_at: "2026-10-20T00:00:00Z", opted_out_at: null },
  ],
  customer_estimate_links: [
    { job_id: "job-real", purpose: "step3_estimate", status: "active", token: "tokreal", expires_at: FUTURE },
    { job_id: "job-test", purpose: "step3_estimate", status: "active", token: "toktest", expires_at: FUTURE },
    { job_id: "job-staff", purpose: "step3_estimate", status: "active", token: "tokstaff", expires_at: FUTURE },
  ],
  businesses: [{ id: "b1", email: "office@inst.test", signer_email: null }],
  partner_workers: [], partner_enquiries: [], profiles: [{ id: "p1", email: "chris@homeinsulationvictoria.com.au" }],
  bookings: [], quotes: [], workflow_events: [],
});
let db = fresh();
function q(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  const rows = () => (db[table] ?? []).filter((r) => filters.every((f) => f(r)));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- chainable query stub
  const api: any = {
    select: () => api, order: () => api, limit: () => api,
    eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return api; },
    in: (k: string, v: unknown[]) => { filters.push((r) => v.includes(r[k])); return api; },
    ilike: (k: string, v: string) => { filters.push((r) => String(r[k] ?? "").toLowerCase() === v.toLowerCase()); return api; },
    contains: (k: string, v: Row) => { filters.push((r) => Object.entries(v).every(([kk, vv]) => (r[k] ?? {})[kk] === vv)); return api; },
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    insert: (row: Row) => {
      // The pending unique index: one email_auto_replied claim per idempotency key.
      const dup = row["event_type"] === EMAIL_AUTO_REPLIED_EVENT && (db[table] ?? []).some((r) => r["event_type"] === EMAIL_AUTO_REPLIED_EVENT && r["details"]?.idempotency_key === row["details"]?.idempotency_key);
      if (!dup) (db[table] ??= []).push({ ...row, created_at: new Date().toISOString() });
      return Promise.resolve({ error: dup ? { code: "23505", message: "duplicate key" } : null });
    },
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(res, rej),
  };
  return api;
}
const calls = { testEmail: [] as string[], owner: [] as string[], archive: [] as string[], claimsAtSend: [] as number[] };
let commsOn = true;
let ownerSendResult = "sent";
let archiveResult: "archived" | "failed" = "archived";
const claims = () => db.workflow_events!.filter((e) => e["event_type"] === EMAIL_AUTO_REPLIED_EVENT).length;
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: q } }));
mock.module("../src/lib/comms.server", () => ({ customerCommsEnabled: async () => commsOn, assertCustomerDeliveryAllowed: async () => { if (!commsOn) throw new Error("comms off"); } }));
mock.module("../src/lib/test-send.server", () => ({
  sendTestEmail: async (ctx: { label: string }, to: string, subject: string) => { calls.claimsAtSend.push(claims()); calls.testEmail.push(`${ctx.label}:${to}:${subject}`); return { status: "sent", detail: "test" }; },
}));
mock.module("../src/lib/owner-email-send.server", () => ({
  sendGuardedOwnerEmail: async (p: { purpose: string; key: string; to: string; build: (u: string | null) => { subject: string; text: string } }) => {
    calls.claimsAtSend.push(claims());
    const mail = p.build("https://u");
    calls.owner.push(`${p.purpose}:${p.key}:${p.to}:${mail.subject}:${mail.text.includes("my-job/tokreal")}`);
    return ownerSendResult;
  },
}));
mock.module("../src/lib/email-reply.server", () => ({
  archiveRepliedMessage: async (p: { mailbox: string | null; messageId: string; enabled?: boolean }) => {
    if (!(p.enabled ?? false)) return { status: "skipped", detail: "off" };
    calls.archive.push(`${p.mailbox}:${p.messageId}`);
    return { status: archiveResult, detail: archiveResult };
  },
}));
const { autoReplyToOwner } = await import("../src/lib/owner-email-auto-reply.server");

const MAILBOX = "info@homeinsulationvictoria.com.au";
const msg = (o: Partial<{ id: string; from: string; body: string; subject: string; attachments: Row[]; hasAttachments: boolean }> = {}) => ({
  providerMessageId: o.id ?? "m1", threadId: "t1", internetMessageId: "<x@y>", direction: "inbound" as const,
  from: o.from ?? "helen@example.com", fromName: "Helen", to: [MAILBOX], cc: [], subject: o.subject ?? "Spot", body: o.body ?? "Hi, is my spot saved?",
  at: new Date().toISOString(), hasAttachments: o.hasAttachments ?? false, attachments: (o.attachments ?? []) as never[],
});
const reset = () => { db = fresh(); calls.testEmail = []; calls.owner = []; calls.archive = []; calls.claimsAtSend = []; commsOn = true; ownerSendResult = "sent"; archiveResult = "archived"; };
const ev = (type: string) => db.workflow_events!.filter((e) => e["event_type"] === type);
const rows = () => db.workflow_events!.filter((e) => e["event_type"] === "email_change_request" && e["details"]?.intent === REPLY_NEEDED_INTENT);
const run = (o: Parameters<typeof msg>[0] = {}, jobIds = ["job-real"], switches: { approved: boolean; archive: boolean } | null = { approved: true, archive: true }) => // null = the code constants
  autoReplyToOwner({ jobIds, message: msg(o), mailbox: MAILBOX, ...(switches ? { switches } : {}) });

describe("server (mocked): guards, idempotency, TEST routing, approval gate, filing", () => {
  test("unapproved → draft + ONE Needs me row, nothing claimed, nothing sent, nothing filed", async () => {
    reset();
    const r = await run({}, ["job-real"], { approved: false, archive: true });
    expect(r).toMatchObject({ status: "held", suppressDraft: false, officeRow: true });
    expect(r.detail).toContain("waiting for Jo's approval");
    expect(calls.owner.length + calls.testEmail.length + calls.archive.length).toBe(0);
    expect(ev(EMAIL_AUTO_REPLIED_EVENT).length).toBe(0);
    expect(rows().length).toBe(1);
    expect(rows()[0]!["details"]).toMatchObject({ message_id: "m1", intent: "reply", decision: 386 });
    await run({}, ["job-real"], { approved: false, archive: true });
    expect(rows().length).toBe(1); // the row is raised once per email
  });
  test("approved + comms on → ONE guarded send with their own My job link, claimed BEFORE the send, then filed in Archive", async () => {
    reset();
    const r = await run();
    expect(r).toMatchObject({ status: "sent", suppressDraft: true, officeRow: false });
    expect(calls.owner).toEqual([`owner_email_auto_reply:${autoReplyKey("m1")}:Helen@Example.com:Re: Spot:true`]);
    expect(calls.claimsAtSend).toEqual([1]);
    expect(ev(EMAIL_AUTO_REPLIED_EVENT)[0]!["details"]).toMatchObject({ answer: "spot_saved", template: "O76c", mode: "live", idempotency_key: autoReplyKey("m1"), link: "https://estimate.homeinsulationvictoria.com.au/my-job/tokreal" });
    expect(calls.archive).toEqual([`${MAILBOX}:m1`]);
    expect(ev(EMAIL_AUTO_REPLY_FILED_EVENT)[0]!["details"]).toMatchObject({ message_id: "m1", status: "archived" });
    expect(rows().length).toBe(0);
  });
  test("idempotency: the second run for the same message sends nothing (and no draft is written)", async () => {
    reset();
    await run();
    const again = await run();
    expect(again).toMatchObject({ status: "already", suppressDraft: true });
    expect(calls.owner.length).toBe(1);
    expect(calls.archive.length).toBe(1);
    expect(ev(EMAIL_AUTO_REPLIED_EVENT).length).toBe(1);
    // A new message from the same owner is answered on its own.
    await run({ id: "m2" });
    expect(calls.owner.length).toBe(2);
  });
  test("TEST job → test-send only once approved, never the real sender", async () => {
    reset();
    expect((await run({ from: "jo@test.test", id: "mt0" }, ["job-test"], { approved: false, archive: false })).status).toBe("held"); // Jo 26 Oct: unapproved = draft, TEST too
    calls.testEmail = []; db.workflow_events = db.workflow_events!.filter((e) => e["details"]?.message_id !== "mt0");
    const r = await run({ from: "jo@test.test" }, ["job-test"], { approved: true, archive: false });
    expect(r.status).toBe("sent");
    expect(calls.testEmail).toEqual([`owner_email_auto_reply:${autoReplyKey("m1")}:jo@test.test:Re: Spot`]);
    expect(calls.claimsAtSend).toEqual([1]);
    expect(calls.owner.length).toBe(0);
    expect(ev(EMAIL_AUTO_REPLIED_EVENT)[0]!["details"]["mode"]).toBe("test_send");
  });
  test("approved but customer comms off → held: draft + row, nothing claimed or sent", async () => {
    reset(); commsOn = false;
    expect((await run()).status).toBe("held");
    expect(calls.owner.length + ev(EMAIL_AUTO_REPLIED_EVENT).length).toBe(0);
    expect(rows().length).toBe(1);
  });
  test("a send that fails after the claim → held event, draft + row; never retried", async () => {
    reset(); ownerSendResult = "failed: bounced";
    expect((await run())).toMatchObject({ status: "held", suppressDraft: false, officeRow: true });
    expect(ev(EMAIL_AUTO_REPLY_HELD_EVENT).length).toBe(1);
    expect(calls.archive.length).toBe(0);
    expect(rows().length).toBe(1);
    expect((await run()).status).toBe("already");
    expect(calls.owner.length).toBe(1);
  });
  test("unusual email (complaint / price) → draft + row, nothing sent", async () => {
    reset();
    for (const [id, body] of [["c1", "I'm not happy, nobody has called me. Is my spot saved?"], ["c2", "The price is too high"]]) {
      const r = await run({ id, body });
      expect(r).toMatchObject({ status: "draft", officeRow: true });
    }
    expect(calls.owner.length).toBe(0);
    expect(rows().length).toBe(2);
  });
  test("no active link → draft (never an invented link)", async () => {
    reset();
    const r = await run({ from: "sam@example.com", body: "How do I save my spot?" }, ["job-enq"]);
    expect(r).toMatchObject({ status: "draft", detail: "no working secure link for this owner" });
    expect(calls.owner.length).toBe(0);
  });
  test("thank-you only → no reply, no draft, no row", async () => {
    reset();
    expect(await run({ body: "Thanks so much!" })).toMatchObject({ status: "none", suppressDraft: true, officeRow: false });
    expect(calls.owner.length + rows().length + ev(EMAIL_AUTO_REPLIED_EVENT).length).toBe(0);
  });
  test("not the owner, a partner, or staff → skip: the existing path, nothing sent, no row", async () => {
    reset();
    expect((await run({ from: "office@inst.test" })).status).toBe("skip");
    expect((await run({ from: "chris@homeinsulationvictoria.com.au" }, ["job-staff"])).detail).toContain("partner or staff");
    expect(calls.owner.length + rows().length).toBe(0);
  });
  test("a change / cancel ask is left to decisions 245/337", async () => {
    reset();
    const r = await run({ body: "We can't make Thursday, can we change the day?" });
    expect(r.status).toBe("skip");
    expect(r.detail).toContain("245/337");
    expect(calls.owner.length + rows().length).toBe(0);
  });
  test("archive switch off → sent, nothing moved, nothing recorded about filing", async () => {
    reset();
    expect((await run({}, ["job-real"], { approved: true, archive: false })).status).toBe("sent");
    expect(calls.archive.length + ev(EMAIL_AUTO_REPLY_FILED_EVENT).length).toBe(0);
  });
});
