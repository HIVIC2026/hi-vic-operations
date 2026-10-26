// Decision 292 (replaces 255 for new senders): pure rules for the ONE website reply to a new email sender, the O70
// design, and source pins (no Outlook send, the guarded live sender, no enquiry created).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  HELD_COMMS_OFF, HELD_TEST_ONLY, HELD_UNAPPROVED, NEW_SENDER_REPLIED_EVENT, NEW_SENDER_REPLY_APPROVED, NEW_SENDER_REPLY_TEST_ONLY, NOT_KNOWN,
  SKIP_ALREADY_REPLIED, WEBSITE_CALCULATOR_URL, decideNewSenderReply, enquiryLikeIntents, isStaffDomain, newSenderFirstName, newSenderReplyKey,
  newSenderReplyMode, newSenderReplySubject, newSenderReplyText, newSenderTestReplyKey, onTestAllowList, repliedSummary, type NewSenderFacts,
  type NewSenderMail,
} from "../src/lib/new-sender-reply.core";
import { renderNewSenderReplyEmail } from "../src/lib/new-sender-reply-email.core";
import { CUSTOMER_BASE } from "../src/lib/engagement.core";
import { FOOTER_TEXT, LOGO_DATA_URI } from "../src/lib/email-kit.core";
import { REPLY_TEST_ALLOWLIST } from "../src/lib/outlook-reply-drafts.core";
import { looksLikeNewEnquiry } from "../src/lib/email-intent.core";

const NOW = new Date("2026-10-25T00:00:00Z");
const mail = (o: Partial<NewSenderMail> = {}): NewSenderMail => ({
  direction: "inbound", from: "new.person@example.org", fromName: "New Person", subject: "Ceiling insulation quote",
  body: "Hi,\n\nI'd like a quote for ceiling insulation for my house. How much is the rebate?\n\nThanks,\nNew", at: "2026-10-24T22:00:00Z", providerMessageId: "AAMk-1", ...o,
});
const facts = (o: Partial<NewSenderFacts> = {}, m: Partial<NewSenderMail> = {}): NewSenderFacts => ({ mail: mail(m), known: NOT_KNOWN, priorReplies: [], now: NOW, ...o });
const skip = (f: NewSenderFacts) => { const d = decideNewSenderReply(f); expect(d.kind).toBe("skip"); return d.kind === "skip" ? d.reason : ""; };

describe("the approved wording (decision 292)", () => {
  test("Jo's wording verbatim, the canonical calculator link, Re: subject; flags as approved", () => {
    expect(WEBSITE_CALCULATOR_URL).toBe("https://homeinsulationvictoria.com.au/homeowner"); // decision 387
    expect(newSenderReplyText("Sam")).toBe([
      "Hi Sam,", "",
      "Thanks for getting in touch with Home Insulation Victoria. To get started, please submit your home on our website: https://homeinsulationvictoria.com.au/homeowner.", "",
      "There are thousands of people on the list, and spots are released in the order they're saved.", "",
      "If you have any questions, just reply to this email.", "",
      "— Home Insulation Victoria",
    ].join("\n"));
    expect(newSenderReplyText(null).startsWith("Hi there,\n")).toBe(true);
    expect((newSenderReplyText(null).match(/https?:\/\//g) ?? []).length).toBe(1);
    expect(NEW_SENDER_REPLY_APPROVED).toBe(true); // Jo approved route + wording (292)
    expect(NEW_SENDER_REPLY_TEST_ONLY).toBe(false); // decision 356: live (still behind customer_comms_enabled)
    expect(NEW_SENDER_REPLIED_EVENT).toBe("email_new_sender_replied");
  });
  test("subject is Re: their subject (never Re: Re:)", () => {
    expect(newSenderReplySubject("Ceiling insulation quote")).toBe("Re: Ceiling insulation quote");
    expect(newSenderReplySubject("RE: Quote")).toBe("RE: Quote");
    expect(newSenderReplySubject("re:quote")).toBe("re:quote");
    expect(newSenderReplySubject("  ")).toBe("Re: Your email");
    expect(newSenderReplySubject(null)).toBe("Re: Your email");
  });
  test("first name from the From name, else 'there'", () => {
    expect(newSenderFirstName("sam o'brien")).toBe("Sam");
    expect(newSenderFirstName("Smith, Jane")).toBe("Jane");
    expect(newSenderFirstName("JANE")).toBe("Jane");
    for (const n of [null, "", "jane@example.org", "The Smiths", "Info", "Accounts Team", "J", "1st Choice Homes"]) expect(newSenderFirstName(n)).toBeNull();
  });
  test("one key per sender address, whatever the spelling; TEST keys per message", () => {
    expect(newSenderReplyKey(" New.Person@Example.org ")).toBe("new-sender-reply:v1:new.person@example.org");
    expect(newSenderReplyKey("new.person@example.org")).toBe(newSenderReplyKey("NEW.PERSON@EXAMPLE.ORG"));
    expect(newSenderTestReplyKey("AAMk-1")).toBe("new-sender-reply:v1:test:AAMk-1");
  });
});

describe("classification gates (decideNewSenderReply)", () => {
  test("a new human sender asking an enquiry / price / rebate / eligibility question → reply", () => {
    const d = decideNewSenderReply(facts());
    expect(d).toMatchObject({ kind: "reply", email: "new.person@example.org" });
    if (d.kind === "reply") expect(d.intents).toContain("question_rebate");
    expect(decideNewSenderReply(facts({}, { subject: "Price?", body: "How much does ceiling insulation cost?" })).kind).toBe("reply");
    expect(decideNewSenderReply(facts({}, { subject: "Hello", body: "We're interested in getting our ceiling insulated." })).kind).toBe("reply");
    expect(decideNewSenderReply(facts({}, { subject: "Question", body: "Is my house eligible? It was built in 1975." })).kind).toBe("reply");
  });
  test("outbound, no address, automated / no-reply / bounce / mailing-list → skipped", () => {
    expect(skip(facts({}, { direction: "outbound" }))).toMatch(/inbound/);
    expect(skip(facts({}, { from: null }))).toMatch(/no sender address/);
    expect(skip(facts({}, { from: "not an address" }))).toMatch(/no sender address/);
    for (const from of ["no-reply@shop.example", "noreply@shop.example", "donotreply@shop.example", "do-not-reply@shop.example", "notifications@portal.example",
      "mailer-daemon@mail.example", "postmaster@mail.example", "bounces+123@list.example", "newsletter@deals.example", "marketing@deals.example"])
      expect(skip(facts({}, { from }))).toMatch(/Automated/);
    expect(skip(facts({}, { subject: "Automatic reply: Ceiling insulation quote" }))).toMatch(/Automated/);
    expect(skip(facts({}, { subject: "Undeliverable: Ceiling insulation quote" }))).toMatch(/Automated/);
    expect(skip(facts({}, { body: "Great ceiling insulation rebate deals! Click here to unsubscribe from our list." }))).toMatch(/Automated/);
    expect(skip(facts({}, { body: "Ceiling insulation price drop! You are receiving this email because you signed up." }))).toMatch(/Automated/);
  });
  test("our own staff and partners → skipped", () => {
    expect(skip(facts({}, { from: "jo@homeinsulationvictoria.com.au" }))).toMatch(/Automated|staff/);
    expect(isStaffDomain("Chris@HomeInsulationVictoria.com.au")).toBe(true);
    expect(isStaffDomain("chris@example.org")).toBe(false);
    expect(skip(facts({ known: { ...NOT_KNOWN, staff: true } }))).toMatch(/our own staff/);
    expect(skip(facts({ known: { ...NOT_KNOWN, partner: true } }))).toMatch(/partner/);
    expect(skip(facts({ known: { ...NOT_KNOWN, owner: true } }))).toMatch(/already an owner/);
  });
  test("too old (history catch-ups) → skipped", () => {
    expect(skip(facts({}, { at: "2026-09-01T00:00:00Z" }))).toMatch(/Too old/);
  });
  test("not an enquiry / price / rebate / eligibility question → skipped (waits for the office's Match)", () => {
    expect(skip(facts({}, { subject: "Insulation at 1 Fixture Road", body: "I manage 1 Fixture Road for the owner — when is the inspection?" }))).toMatch(/Not an enquiry/);
    expect(skip(facts({}, { subject: "Invoice", body: "Please find our invoice attached." }))).toMatch(/Not an enquiry/);
    expect(skip(facts({}, { subject: "Work", body: "We're an installer looking for more jobs, do you have any work available?" }))).toMatch(/Not an enquiry/); // trade intent
    expect(enquiryLikeIntents({ subject: "Invoice", body: "Please find our invoice attached.", from: "x@example.org" })).toBeNull();
    expect(looksLikeNewEnquiry("Quote", "I'd like a quote for ceiling insulation")).toBe(true);
  });
});

describe("idempotency: one reply per sender address, ever", () => {
  test("an earlier live reply blocks every later email from that sender; a test reply blocks only its own message", () => {
    expect(skip(facts({ priorReplies: [{ mode: "live", messageId: "AAMk-0" }] }))).toBe(SKIP_ALREADY_REPLIED);
    expect(skip(facts({ priorReplies: [{ mode: "test", messageId: "AAMk-1" }] }))).toMatch(/test reply/);
    expect(decideNewSenderReply(facts({ priorReplies: [{ mode: "test", messageId: "AAMk-0" }] })).kind).toBe("reply");
  });
});

describe("send mode: approved flag, TEST allow-list, customer_comms_enabled", () => {
  const jo = REPLY_TEST_ALLOWLIST[0]!;
  test("TEST mode: only the allow-listed sender, through test-send; everyone else held", () => {
    expect(onTestAllowList(` ${jo.toUpperCase()} `)).toBe(true);
    expect(newSenderReplyMode({ approved: true, testOnly: true, commsEnabled: null, from: jo })).toEqual({ mode: "test_send" });
    expect(newSenderReplyMode({ approved: true, testOnly: true, commsEnabled: true, from: "new.person@example.org" })).toEqual({ mode: "held", reason: HELD_TEST_ONLY });
  });
  test("unapproved → held for everyone, Jo included", () => {
    expect(newSenderReplyMode({ approved: false, testOnly: true, commsEnabled: true, from: jo })).toEqual({ mode: "held", reason: HELD_UNAPPROVED });
    expect(newSenderReplyMode({ approved: false, testOnly: false, commsEnabled: true, from: "new.person@example.org" })).toEqual({ mode: "held", reason: HELD_UNAPPROVED });
  });
  test("live: customer_comms_enabled must be on (unknown counts as off)", () => {
    expect(newSenderReplyMode({ approved: true, testOnly: false, commsEnabled: false, from: "new.person@example.org" })).toEqual({ mode: "held", reason: HELD_COMMS_OFF });
    expect(newSenderReplyMode({ approved: true, testOnly: false, commsEnabled: null, from: "new.person@example.org" })).toEqual({ mode: "held", reason: HELD_COMMS_OFF });
    expect(newSenderReplyMode({ approved: true, testOnly: false, commsEnabled: true, from: "new.person@example.org" })).toEqual({ mode: "send" });
  });
  test("office line", () => {
    expect(repliedSummary("a@b.org", "test")).toBe("TEST website reply (O70) sent to new sender a@b.org");
    expect(repliedSummary("a@b.org", "live")).toBe("Website reply (O70) sent to new sender a@b.org");
  });
});

describe("the O70 email (plain, kit design)", () => {
  const RETIRED = [/\bHI ?VIC!?(?![a-z_])/, /50 ?% deposit/i, /measure[- ]up (?:&amp;|&|and) eligibility check/i, /combined ready check/i, /piesa before (quote|payment)/i, /\$220 lead fee/i, /5[- ]year workmanship/i];
  test("shell, wording, the one link, no unsubscribe (no job), no retired words", () => {
    const m = renderNewSenderReplyEmail({ theirSubject: "Ceiling insulation quote", firstName: "Sam" });
    expect(m.subject).toBe("Re: Ceiling insulation quote");
    expect(m.html.startsWith("<!doctype html")).toBe(true);
    expect(m.html).toContain(`<img src="${LOGO_DATA_URI}" width="116" alt="Home Insulation Victoria"`);
    expect(m.html).toContain("ABN 44 671 613 979");
    expect(m.html).toContain(">Hi Sam,</p>");
    expect(m.html).toContain(`Thanks for getting in touch with Home Insulation Victoria. To get started, please submit your home on our website: <a href="${WEBSITE_CALCULATOR_URL}" style="color:`);
    expect(m.html).toContain("There are thousands of people on the list");
    expect(m.html).toContain("If you have any questions, just reply to this email.");
    expect(m.html).toContain(">— Home Insulation Victoria</p>");
    expect(m.html).not.toContain(">Unsubscribe</a>");
    expect(m.html).not.toContain("TEST — only sent to Jo");
    expect(m.html).not.toMatch(/display:\s*flex|<script|\son[a-z]+=|<h1/i);
    const hrefs = [...m.html.matchAll(/href="([^"]+)"/g)].map((x) => x[1]);
    expect(hrefs).toEqual([WEBSITE_CALCULATOR_URL]);
    expect(m.text).toContain(newSenderReplyText("Sam"));
    expect(m.text).toContain(FOOTER_TEXT);
    expect(m.text).not.toContain("Unsubscribe");
    for (const re of RETIRED) { expect(m.html).not.toMatch(re); expect(m.text).not.toMatch(re); }
    expect(renderNewSenderReplyEmail({ theirSubject: null, firstName: null }).html).toContain(">Hi there,</p>");
  });
  test("names and subjects are escaped", () => {
    const m = renderNewSenderReplyEmail({ theirSubject: "<b>Quote</b>", firstName: null });
    expect(m.subject).toBe("Re: <b>Quote</b>"); // plain header text, never HTML
    expect(m.html).not.toContain("<b>Quote</b>");
  });
  test("TEST copy carries the TEST pill and line", () => {
    const m = renderNewSenderReplyEmail({ theirSubject: "Quote", firstName: null, test: true });
    expect(m.html).toContain("TEST — only sent to Jo");
    expect(m.text).toContain("TEST — only sent to Jo.");
  });
  test("the approved sample file is exactly what the renderer writes (scripts/render-decision-292-sample.ts)", () => {
    expect(renderNewSenderReplyEmail({ theirSubject: "Ceiling insulation quote", firstName: "Sam" }).html).toBe(readFileSync("docs/templates/owner/O70-new-sender-calculator.html", "utf8"));
  });
});

describe("source pins", () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  test("the server sends only through the guarded live email sender or test-send — never Outlook / Graph — and claims before a live send", () => {
    const s = strip(readFileSync("src/lib/new-sender-reply.server.ts", "utf8"));
    expect(s).not.toMatch(/sendMail|createReply|\/reply\b|\/forward\b|microsoft_outlook|outlookGatewayUrl|outlook-connection|graph\.microsoft|fetch\(/i);
    expect(s).toContain('import("./hot-leads-send.server")');
    expect(s).toContain('import("./test-send.server")');
    expect(s).toContain('import("./comms.server")');
    expect(s).toContain("customerCommsEnabled");
    expect(s).toContain("testRecipientBoundary(email, null)");
    expect(s).toContain("newSenderReplyMode(");
    expect(s).not.toMatch(/upsertEnquiry|ensureOwnerLink|enquiry\.server|estimatelink|from\("jobs"\)\.insert|from\("owners"\)\.insert/);
    const claim = s.indexOf('recordReply(repliedSummary(email, "live")');
    expect(claim).toBeGreaterThan(0);
    expect(claim).toBeLessThan(s.indexOf("resendSend(email"));
    // The live sender is the one owner emails use: office From, Reply-To info@.
    const hot = readFileSync("src/lib/hot-leads-send.server.ts", "utf8");
    expect(hot).toMatch(/from: CAMPAIGN_FROM, to: \[to\], reply_to: "info@homeinsulationvictoria\.com\.au"/);
    expect(readFileSync("src/lib/owner-email-send.server.ts", "utf8")).toContain("resendSend(");
  });
  test("the copier calls it only for recorded unmatched inbound mail, after the email_unmatched row, and the drafter never creates an enquiry", () => {
    const sync = readFileSync("src/lib/outlook-sync.server.ts", "utf8");
    expect(sync).toContain('await (await import("./new-sender-reply.server")).replyToNewSender(m, { mailbox })');
    expect(sync.indexOf("recordUnmatched(m, mailbox")).toBeLessThan(sync.indexOf("await newSenderReply(m, mailbox, counts)"));
    for (const f of ["src/lib/email-reply.server.ts", "src/lib/email-reply.core.ts"]) expect(strip(readFileSync(f, "utf8"))).not.toMatch(/email-enquiry|upsertEnquiry|enquiryFromEmail|emailEnquiry/);
    expect(strip(readFileSync("src/lib/enquiry.server.ts", "utf8"))).not.toMatch(/emailIntake/);
  });
  test("nothing imports the retired decision-255 modules", () => {
    const { execSync } = require("node:child_process") as typeof import("node:child_process");
    const out = execSync("grep -rl 'email-enquiry\\.\\(core\\|server\\)' src tests scripts || true", { encoding: "utf8" }).trim();
    expect(out).toBe("");
  });
});
