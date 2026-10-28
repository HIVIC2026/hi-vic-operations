// Decision 244: pure reply drafter. Realistic, anonymised owner/partner emails (names, numbers, addresses invented).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  CHECK_BEFORE_SENDING, EMAIL_REPLY_DRAFTS_ENABLED, EMAIL_REPLY_DRAFTS_TEST_ONLY, REPLY_AUTO_SEND, SIGN_OFF, TRADE_PORTAL_URL,
  assertDraftOnlyRequest, bodySentences, composeReply, draftBlocker, draftCategories, firstNameOf, forbiddenContentProblems, money, pickReplyType,
  slotText, wouldAutoSend, type ReplyDraft, type ReplyInput,
} from "../src/lib/email-reply.core";
import { classifyEmailIntents } from "../src/lib/email-intent.core";
import { PUBLIC_CALCULATOR_URL } from "../src/lib/estimate-email";
import { CUSTOMER_BASE } from "../src/lib/engagement.core";
import { SAMPLES, SAMPLE_NOW, baseOwner, basePartner, enquiryStageOwner } from "./fixtures/email-reply-samples";
import { WEBSITE_CALCULATOR_URL } from "../src/lib/new-sender-reply.core";

const owner = (body: string, o: Parameters<typeof baseOwner>[0] = {}, extra: Partial<ReplyInput> = {}): ReplyInput => ({
  subject: "Re: Home Insulation Victoria HV-3150", body, from: "helen.sample@example.com", fromName: "Helen Sample", fromPartner: false, now: SAMPLE_NOW, owner: baseOwner(o), ...extra,
});
const draft = (i: ReplyInput) => { const d = composeReply(i); if (!d) throw new Error("no draft"); return d; };
const links = (d: ReplyDraft) => (d.text.match(/https:\/\/\S+/g) ?? []).length;

/** The shape every draft must have: Hi {name}, 2–5 short sentences, at most one link, Jo's sign-off, nothing internal. */
function wellFormed(d: ReplyDraft, name: string | null) {
  const lines = d.text.split("\n\n");
  expect(lines[0]).toBe(`Hi ${name ?? "there"},`);
  expect(lines.at(-1)).toBe(SIGN_OFF);
  const n = bodySentences(d.text);
  expect(n).toBeGreaterThanOrEqual(2);
  expect(n).toBeLessThanOrEqual(5);
  expect(links(d)).toBeLessThanOrEqual(1);
  expect(d.text).not.toMatch(/margin|mark-?up|payout|installer pay|electrician rate|commission/i);
  expect(d.html).not.toContain("<script");
}

describe("the sample drafts (shown to Jo)", () => {
  for (const s of SAMPLES) {
    test(`${s.key}: picks its type and is well formed`, () => {
      const d = draft(s.input);
      expect(d.type).toBe(s.key as ReplyDraft["type"]);
      wellFormed(d, firstNameOf(s.input.owner?.ownerFullName) ?? firstNameOf(s.email.fromName));
    });
  }
  test("the approval document shows exactly what the drafter writes today", () => {
    const doc = readFileSync("docs/templates/office/email-reply-samples.md", "utf8");
    for (const s of SAMPLES) expect(doc).toContain(draft(s.input).text);
  });
  test("sample facts appear verbatim; nothing is invented", () => {
    const [status, enquiry, price, estimatePrice, partner] = SAMPLES.map((s) => draft(s.input));
    expect(status!.text).toContain("Your free Ready Check is booked for Wednesday 28 October at 9am.");
    expect(status!.checkBeforeSending).toBe(false);
    // Matched owners get their OWN homeowner page (Save my spot), never the calculator (decision 292: new senders are
    // not drafted for at all — see new-sender-reply.core).
    expect(enquiry!.link).toBe("https://estimate.homeinsulationvictoria.com.au/estimate/SAMPLETOKEN2/campaign");
    expect(enquiry!.text).toContain(`Save your free spot here, no payment and no obligation: ${enquiry!.link}`);
    expect(enquiry!.text).toContain("Your estimate for your Ringwood home is ready");
    expect(enquiry!.checkBeforeSending).toBe(false);
    expect(estimatePrice!.link).toBe("https://estimate.homeinsulationvictoria.com.au/estimate/SAMPLETOKEN3");
    expect(estimatePrice!.text).toContain("Your estimate is $3,798 incl. GST, and the $1,610 VEU rebate comes straight off, so you'd pay $2,188");
    expect(estimatePrice!.flags.join(" ")).toContain("R2.0"); // some insulation declared → checked on site
    expect(estimatePrice!.text).not.toContain("street address");
    expect(price!.text).toContain("$4,050");
    expect(price!.text).toContain("$1,850 VEU rebate");
    expect(price!.text).toContain("you pay $2,200");
    expect(price!.text).toContain("below R2.0");
    expect(price!.text).toContain("over 5 years old");
    expect(partner!.text).toContain("Your next payment is due Friday 30 October for HV-3102.");
    expect(partner!.link).toBe(TRADE_PORTAL_URL);
  });
});

describe("type selection", () => {
  const pick = (body: string, o: Partial<Parameters<typeof pickReplyType>[0]> = {}) =>
    pickReplyType({ hits: classifyEmailIntents({ subject: null, body, direction: "inbound" }), fromPartner: false, matchedJob: true, stage: "ready_check_scheduled", spotSaved: true, enquiryCue: false, ...o });
  test("'when is my free Ready Check?' is a status question, not a rebate question", () => expect(pick("When is my free Ready Check?")).toBe("owner_status"));
  test("'where is my quote?' is status", () => expect(pick("Where is my quote up to?")).toBe("owner_status"));
  test("'how much will it cost?' is price", () => expect(pick("How much will it cost all up?")).toBe("price_rebate_eligibility"));
  test("rebate eligibility question", () => expect(pick("Am I eligible for the rebate? We have some old batts.")).toBe("price_rebate_eligibility"));
  test("partners always get a partner reply", () => expect(pick("Where do I find the Mitti form?", { fromPartner: true })).toBe("partner"));
  test("an enquiry-stage owner gets the estimate / Save my spot reply", () => expect(pick("Any update?", { stage: "preliminary_estimate_ready", spotSaved: false })).toBe("new_enquiry"));
  test("decision 292: an unmatched non-partner sender never gets a draft (new senders get the website reply; the rest wait for Match)", () => {
    expect(pick("Hi, I'd like a quote for ceiling insulation please.", { matchedJob: false, enquiryCue: true })).toBeNull();
    expect(pick("How much is the rebate and what would it cost?", { matchedJob: false, enquiryCue: false })).toBeNull();
    expect(pick("Please see attached invoice.", { matchedJob: false })).toBeNull();
    // Trade-sounding unmatched mail still gets the partner draft.
    expect(pickReplyType({ hits: [{ intent: "trade", phrase: "any jobs available" }], fromPartner: false, matchedJob: false, stage: null, spotSaved: false, enquiryCue: false })).toBe("partner");
  });
  test("a plain thank-you gets no draft", () => expect(composeReply(owner("Thanks so much, see you then!"))).toBeNull());
});

describe("owner_status", () => {
  test("spot saved, no booking yet: says how booking works, never invents a date", () => {
    const d = draft(owner("Hi, when is my free Ready Check? Haven't heard anything.", { stage: "spot_saved" }));
    expect(d.type).toBe("owner_status");
    expect(d.text).toContain("Spots are released in the order they were saved.");
    expect(d.text).not.toMatch(/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/);
    wellFormed(d, "Helen");
  });
  test("booked stage but booking missing → office confirms, flagged", () => {
    const d = draft(owner("When is my Ready Check?", { stage: "ready_check_scheduled", readyCheck: null }));
    expect(d.text).toContain("The office will check your Ready Check time and confirm it with you.");
    expect(d.checkBeforeSending).toBe(true);
    expect(d.flags).toContain("Missing: Ready Check booking time");
    expect(draftCategories(d)).toContain(CHECK_BEFORE_SENDING);
  });
  test("quote sent: figures from the job's own quote + one link", () => {
    const d = draft(owner("Any update on my quote?", { stage: "measured_estimate_ready", quote: { status: "issued", fullPrice: 3920.5, rebate: 1720, youPay: 2200.5 } }));
    expect(d.text).toContain("you pay $2,200.50 after the $1,720 VEU rebate (full price $3,920.50 incl. GST)");
    expect(d.link).toContain("/estimate/");
    wellFormed(d, "Helen");
  });
  test("quote stage without a sent quote never quotes a figure", () => {
    const d = draft(owner("Any update on my quote?", { stage: "measured_estimate_ready", quote: null }));
    expect(d.text).not.toMatch(/\$\d/);
    expect(d.checkBeforeSending).toBe(true);
  });
  test("install booked, deposit due: held-until time, bank transfer only, no card fee", () => {
    const d = draft(owner("Any update on our install day?", {
      stage: "installation_booked", install: { start: "2026-11-03T21:30:00Z", end: null },
      paymentDue: { key: "install_deposit", outstanding: 185.1, dueAt: "2026-10-26T00:00:00Z", state: "requested", cardAvailable: false }, installHeldUntil: "2026-10-26T00:00:00Z",
    }));
    expect(d.text).toContain("Your install is booked for Wednesday 4 November at 8:30am.");
    expect(d.text).toContain("booking payment of $185.10");
    expect(d.text).toContain("by bank transfer or PayID");
    expect(d.text).not.toMatch(/card/i);
    wellFormed(d, "Helen");
  });
  test("can't make the day: the reply matches the change request and nothing is promised", () => {
    const d = draft(owner("Sorry, we can't make Tuesday anymore, something has come up. Could we do Thursday instead?", { stage: "ready_check_scheduled", readyCheck: { start: "2026-10-27T22:00:00Z", end: null } }));
    expect(d.text).toContain("we'll arrange a new one with you");
    expect(d.text).toContain("Nothing changes until we've confirmed the new time with you.");
    expect(d.text).not.toContain("booked for");
    expect(d.checkBeforeSending).toBe(true);
    wellFormed(d, "Helen");
  });
  test("$349 safety check: card mentioned only when card payment is actually available", () => {
    const due = { key: "safety_check" as const, outstanding: 349, dueAt: null, state: "requested" as const };
    const withCard = draft(owner("Any update?", { stage: "measured_quote_accepted", paymentDue: { ...due, cardAvailable: true } }));
    expect(withCard.text).toContain("safety check payment of $349, by card or bank transfer, with no fee.");
    const bankOnly = draft(owner("Any update?", { stage: "measured_quote_accepted", paymentDue: { ...due, cardAvailable: false } }));
    expect(bankOnly.text).toContain("safety check payment of $349, by bank transfer or PayID.");
    expect(bankOnly.text).not.toMatch(/card/i);
  });
  test("cancel: acknowledgement only, flagged for the office's Apply", () => {
    const d = draft(owner("We have decided not to go ahead with the insulation, please cancel.", { stage: "ready_check_scheduled", readyCheck: { start: "2026-10-27T22:00:00Z", end: null } }));
    expect(d.type).toBe("owner_status");
    expect(d.text).toContain("you'd like to cancel");
    expect(d.text).not.toContain("booked for");
    expect(d.flags.join(" ")).toContain("cancel");
    wellFormed(d, "Helen");
  });
  test("several matched jobs are flagged", () => {
    const d = draft(owner("Any update?", { stage: "piesa_complete", matchedJobs: 2 }));
    expect(d.flags.join(" ")).toContain("matched 2 jobs");
  });
  test("no first name → 'Hi there', flagged", () => {
    const d = draft(owner("Any update?", { stage: "piesa_complete", ownerFullName: null }, { fromName: null }));
    expect(d.text.startsWith("Hi there,")).toBe(true);
    expect(d.checkBeforeSending).toBe(true);
  });
});

describe("new_enquiry", () => {
  test("enquiry-stage owner: estimate figures + Save my spot link", () => {
    const d = draft(owner("Hi, is my estimate ready? Thanks", { stage: "preliminary_estimate_ready", spotSaved: false }));
    expect(d.type).toBe("new_enquiry");
    expect(d.text).toContain("you could save $1,610 with the VEU rebate and pay $2,188 (full price $3,798 incl. GST)");
    expect(d.link).toBe("https://estimate.homeinsulationvictoria.com.au/estimate/SAMPLETOKEN/campaign");
    expect(d.checkBeforeSending).toBe(false);
    wellFormed(d, "Helen");
  });
  test("decision 292: a new sender with no job produces NO draft at all (never an enquiry, never the calculator)", () => {
    for (const body of ["Hi, I'd like a quote for ceiling insulation please.", "Is the rebate still available and how much is it?", "Do you install ceiling insulation in Ringwood?"])
      expect(composeReply({ subject: "Ceiling insulation", body, from: "new.person@example.org", fromName: "New Person", fromPartner: false, now: SAMPLE_NOW, owner: null })).toBeNull();
  });
  test("no reply ever carries the calculator or the website eligibility check (matched owners get their own page)", () => {
    const inputs: ReplyInput[] = [...SAMPLES.map((s) => s.input), owner("Any update?", { stage: "preliminary_estimate_ready", spotSaved: false }), owner("How much is it?", { stage: "spot_saved" })];
    for (const i of inputs) {
      const d = draft(i);
      for (const url of d.text.match(/https:\/\/\S+/g) ?? []) {
        expect([PUBLIC_CALCULATOR_URL, CUSTOMER_BASE, `${CUSTOMER_BASE}/`, `${CUSTOMER_BASE}/calculator`, WEBSITE_CALCULATOR_URL]).not.toContain(url.replace(/[.,]$/, ""));
        expect(url).not.toMatch(/\/calculator\b/);
      }
      expect(d.text).not.toMatch(/calculator/i);
    }
    expect(readFileSync("src/lib/email-reply.core.ts", "utf8")).not.toMatch(/CALCULATOR_URL/);
  });
  test("no estimate yet → office confirms, flagged, no price", () => {
    const d = draft(owner("Hi, any news on my enquiry?", { stage: "new_enquiry", spotSaved: false, estimate: null }));
    expect(d.text).not.toMatch(/\$\d/);
    expect(d.checkBeforeSending).toBe(true);
  });
});

describe("price_rebate_eligibility", () => {
  test("estimate only (no quote yet): estimate figures + what isn't included", () => {
    const d = draft(owner("How much will it cost? And what does the rebate cover?", { stage: "spot_saved" }));
    expect(d.type).toBe("price_rebate_eligibility");
    expect(d.text).toContain("Your estimate is $3,798 incl. GST, and the $1,610 VEU rebate comes straight off, so you'd pay $2,188 for the 137 m² ceiling you told us about.");
    expect(d.text).toContain("Not included, only if needed");
    wellFormed(d, "Helen");
  });
  test("decision 292: an unknown sender's rebate question gets no draft here (the website reply handles it)", () => {
    expect(composeReply({ subject: "Rebate question", body: "Is the rebate still available and how much is it?", from: "someone@example.org", fromName: "Sam Person", fromPartner: false, now: SAMPLE_NOW, owner: null })).toBeNull();
  });
  test("matched enquiry-stage owner asking about price: estimate figures and their own page (never /campaign for a price question)", () => {
    const d = draft({ subject: "Rebate question", body: "How much is the rebate? We're at 3/22 Long Rd, Box Hill 3128.", from: "sam@example.org", fromName: "Sam Person", fromPartner: false, now: SAMPLE_NOW,
      owner: enquiryStageOwner({ ownerFullName: "Sam Person" }) });
    expect(d.type).toBe("price_rebate_eligibility");
    expect(d.link).toBe("https://estimate.homeinsulationvictoria.com.au/estimate/SAMPLETOKEN");
    expect(d.text).not.toContain("street address and suburb");
    expect(d.text).toContain("Not included, only if needed");
    wellFormed(d, "Sam");
  });
  test("existing insulation declared → flagged (R2.0 is checked on site)", () => {
    const d = draft(owner("Do I qualify for the rebate? There's some old insulation up there.", { insulationDeclared: "present" }));
    expect(d.flags.join(" ")).toContain("R2.0");
  });
});

describe("partner", () => {
  const partnerMail = (body: string, p: Parameters<typeof basePartner>[0] = {}): ReplyInput => ({ subject: "Question", body, from: "dan@sampleinsulation.example", fromName: "Dan Sample", fromPartner: true, now: SAMPLE_NOW, owner: null, partner: basePartner(p) });
  test("open offers: count, suburb and closing time", () => {
    const d = draft(partnerMail("Hi Jo, any new job offers for us this week?", { offers: [{ kind: "ready_check", suburb: "Croydon", expiresAt: "2026-10-25T03:00:00Z" }] }));
    expect(d.text).toContain("You have 1 job offer waiting, including one in Croydon that closes 2pm Sunday 25 October.");
    wellFormed(d, "Dan");
  });
  test("pay still being checked: says so, no amounts, no date invented", () => {
    const d = draft(partnerMail("When do I get paid for HV-3102?", { pay: [{ jobNumber: "HV-3102", what: "Install", channel: "hivic_sourced", state: { kind: "checking" } }] }));
    expect(d.text).toContain("HV-3102 is still being checked before payment.");
    expect(d.text).not.toMatch(/\$\d/);
  });
  test("pay question with no completed work → office confirms, flagged", () => {
    const d = draft(partnerMail("When am I getting paid?"));
    expect(d.text).toContain("The office will check your payment dates and confirm it with you.");
    expect(d.checkBeforeSending).toBe(true);
  });
  test("unknown trade address: flagged, no portal link", () => {
    const d = draft({ ...partnerMail("I'm the electrician for the Box Hill job, where is the PIESA form?"), fromPartner: false, partner: basePartner({ known: false }) });
    expect(d.type).toBe("partner");
    expect(d.link).toBeNull();
    expect(d.checkBeforeSending).toBe(true);
  });
  test("unrecognised partner question → office confirms", () => {
    const d = draft(partnerMail("Can you call me about the ladder hire?"));
    expect(d.checkBeforeSending).toBe(true);
  });
});

describe("never mention internal or other-customer facts", () => {
  test("forbidden words are caught", () => {
    expect(forbiddenContentProblems("Our margin on this is small.")).toContain("mentions internal pricing");
    expect(forbiddenContentProblems("The installer pay is $1,200.")).toContain("mentions partner pay");
    expect(forbiddenContentProblems("Like HV-3001 next door.", { ownJobNumbers: ["HV-3150"] })[0]).toContain("HV-3001");
    expect(forbiddenContentProblems("Your job HV-3150 is booked.", { ownJobNumbers: ["HV-3150"] })).toEqual([]);
  });
  test("owner facts carry no partner pay or cost fields at all", () => {
    expect(Object.keys(baseOwner())).not.toEqual(expect.arrayContaining(["installerPay", "margin", "cost"]));
  });
});

describe("switches and send guards", () => {
  test("drafts OFF by default, TEST mode on, every auto-send type off", () => {
    expect(EMAIL_REPLY_DRAFTS_ENABLED).toBe(false);
    expect(EMAIL_REPLY_DRAFTS_TEST_ONLY).toBe(true);
    expect(Object.values(REPLY_AUTO_SEND).every((v) => v === false)).toBe(true);
  });
  test("draftBlocker: off, TEST allow-list, qa_test jobs only, TEST partners only", () => {
    const b = (x: Partial<Parameters<typeof draftBlocker>[0]>) => draftBlocker({ enabled: true, testOnly: true, from: "jolowexo@hotmail.com", jobSources: ["qa_test"], ...x });
    expect(b({ enabled: false })).toContain("switched off");
    expect(b({})).toBeNull();
    expect(b({ from: "JoLowExo@Hotmail.com " })).toBeNull();
    expect(b({ from: "jo@actpropertyinspections.com.au" })).toContain("allow-list");
    expect(b({ jobSources: ["website"] })).toContain("qa_test");
    expect(b({ jobSources: [] })).toBeNull();
    expect(b({ jobSources: [], partnerIsTest: false })).toContain("TEST partners");
    expect(b({ testOnly: false, from: "anyone@example.com", jobSources: ["website"] })).toBeNull();
  });
  test("wouldAutoSend: never with today's switches; only clean drafts once a type is on", () => {
    const d = draft(SAMPLES[0]!.input);
    expect(wouldAutoSend(d)).toBe(false);
    const on = { ...REPLY_AUTO_SEND, owner_status: true };
    expect(wouldAutoSend(d, on)).toBe(true);
    expect(wouldAutoSend({ ...d, checkBeforeSending: true }, on)).toBe(false);
  });
  test("only draft-only Graph writes are allowed; anything that sends is refused", () => {
    expect(() => assertDraftOnlyRequest("POST", "/users/info%40homeinsulationvictoria.com.au/messages/AAMk%3D/createReply")).not.toThrow();
    expect(() => assertDraftOnlyRequest("POST", "/users/info%40homeinsulationvictoria.com.au/messages")).not.toThrow();
    expect(() => assertDraftOnlyRequest("PATCH", "/users/info%40homeinsulationvictoria.com.au/messages/AAMk%3D")).not.toThrow();
    for (const p of ["/users/x/messages/AAMk/send", "/users/x/sendMail", "/me/sendMail", "/users/x/messages/AAMk/reply", "/users/x/messages/AAMk/replyAll", "/users/x/messages/AAMk/forward", "/users/x/messages/AAMk/createForward", "/users/x/mailFolders/inbox/messages"])
      expect(() => assertDraftOnlyRequest("POST", p)).toThrow();
  });
});

describe("formatting", () => {
  test("money", () => { expect(money(2188)).toBe("$2,188"); expect(money(2200.5)).toBe("$2,200.50"); expect(money(349)).toBe("$349"); });
  test("Melbourne-local slots", () => {
    expect(slotText({ start: "2026-10-27T22:00:00Z", end: "2026-10-28T00:00:00Z" })).toBe("Wednesday 28 October at 9am");
    expect(slotText({ start: "2026-10-28T00:30:00Z", end: "2026-10-28T03:00:00Z" })).toBe("Wednesday 28 October at 11:30am");
  });
  test("first names", () => { expect(firstNameOf("helen mary sample")).toBe("Helen"); expect(firstNameOf("info@example.com")).toBeNull(); expect(firstNameOf("")).toBeNull(); });
});
