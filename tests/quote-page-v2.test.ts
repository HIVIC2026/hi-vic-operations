/**
 * Quote page v2 (touchpoint #33 + Fix 3 + lawyer Q8 + 2 Nov payment timing, Jo 2 Nov 2026): two ticks, a typed name,
 * the 30-day timing line, the "What's changed" box, and an Accept button that stays locked until all three are done.
 * Would fail if the old tick copy / "How you can pay" box came back, if the typed name stopped being required, or if
 * ESC declarations were asked for on the quote page again (they move to the confirm-and-pay page).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { P2 } from "../src/lib/owner-pages.core";
import { quoteSittingBlockers } from "../src/lib/owner-quote-sign.core";
import { tidyTypedName } from "../src/lib/acceptance-signature.core";

const route = readFileSync("src/routes/my-job.$token.tsx", "utf8");
const accept = route.slice(route.indexOf("function AcceptQuote("), route.indexOf("\n}\n", route.indexOf("function AcceptQuote(")));
const screen = route.slice(route.indexOf("function QuoteScreen("), route.indexOf("function PayNowCard("));
const fns = readFileSync("src/lib/owner-link.functions.ts", "utf8");
const acceptFn = fns.slice(fns.indexOf("export const ownerAcceptQuoteFn"), fns.indexOf("export const ownerDeclineQuoteFn"));

describe("P2 wording (decisions #33, Fix 3, 2 Nov payment timing)", () => {
  test("the approved lines, verbatim", () => {
    expect(P2.tick1).toBe("I accept this quote, the Customer Agreement and the payment terms, and I've been given my Statement of rights under the VEU program. I'm 18 or over, I own this home (or I'm allowed to sign for the owner), and I'm happy to get my documents by email.");
    // Jo 4 Nov 2026 21:20 / 21:25: the 30-day tick names the consequence and carries the quote's own PIESA amount.
    expect(P2.tick2).toBe("I understand my install must be done within 30 days of my electrical safety check (PIESA). If it isn't, the check has to be done again — and if the delay is mine, I pay for the new check ($349).");
    expect(P2.tick2For("$275")).toBe("I understand my install must be done within 30 days of my electrical safety check (PIESA). If it isn't, the check has to be done again — and if the delay is mine, I pay for the new check ($275).");
    // Jo 4 Nov 2026 21:05 (wording B) — the same words as the quote email and Customer Agreement section 2.
    expect(P2.notIncluded).toBe("If the safety check finds electrical work is needed before insulation can go in, your electrician quotes that separately and you pay them direct. Nothing happens without your OK. This price and your rebate don't change.");
    expect(P2.howYouPay).toBe("How you pay: $349 now for the electrical safety check (PIESA). 50% to book your install day. The rest on install day. Card or bank transfer, no fees.");
    expect(P2.howYouPayFor("$220")).toBe("How you pay: $220 now for the electrical safety check (PIESA). 50% to book your install day. The rest on install day. Card or bank transfer, no fees.");
    expect(P2.timing).toBe("Your install will be done within 30 days of your electrical safety check (PIESA). Your installer will confirm the day with you. Most installs are finished on the day they start.");
    expect(P2.button("$349")).toBe("Accept and pay $349");
    expect(P2.twoTicks).toBe("Two ticks, then accept");
    expect(P2.agreementLink).toBe("Read the agreement (PDF) ›");
    expect(P2.paymentTermsLink).toBe("Payment terms (PDF) ›");
    expect(P2.rightsLink).toBe("Statement of rights (PDF) ›");
    expect(P2.attachedNote).toBe("(attached to your quote email)");
  });
  test("old copy is gone", () => {
    expect(JSON.stringify(P2)).not.toMatch(/VEU rebate|electrical fixes|7 days after|I assign my VEECs/);
    for (const k of ["tick2Sub", "tick1Sub", "tick1Read", "tick2Read", "twoThings", "tapEach", "typeAgain"]) expect(P2).not.toHaveProperty(k);
  });
});

describe("quoteSittingBlockers", () => {
  test("both ticks and a real typed name", () => {
    expect(quoteSittingBlockers({ tick1: true, tick2: false, typedName: "Sarah Brown" })).not.toEqual([]);
    expect(quoteSittingBlockers({ tick1: false, tick2: true, typedName: "Sarah Brown" })).not.toEqual([]);
    expect(quoteSittingBlockers({ tick1: true, tick2: true, typedName: "  " })).not.toEqual([]);
    expect(quoteSittingBlockers({ tick1: true, tick2: true, typedName: "Sarah Brown" })).toEqual([]);
  });
});

describe("quote screen", () => {
  test("Jo 4 Nov 2026 20:05 (pack 2 batch 5): 'How you pay' and the 30-day line sit above the two ticks; the address shows once (title line only)", () => {
    expect(accept.indexOf("P2.howYouPayFor(")).toBeLessThan(accept.indexOf("P2.tick1"));
    expect(accept.indexOf("P2.timing")).toBeLessThan(accept.indexOf("P2.tick1"));
    expect(screen).toContain("{P2.measured}</p>");
    expect(screen).not.toContain("{v.address && <>{v.address}<br /></>}{P2.measured}");
  });
  test("two ticks, typed name, three PDF links, the attached-to-email note", () => {
    expect(accept).toContain("P2.twoTicks");
    expect(accept).toContain("P2.tick1");
    expect(accept).toContain("P2.tick2For(fee)"); // Jo 4 Nov 2026 21:25: the quote's own PIESA amount
    expect(accept).toContain("P2.attachedNote");
    for (const l of ["P2.agreementLink", "P2.paymentTermsLink", "P2.rightsLink"]) expect(accept).toContain(l);
    expect(accept).toContain("P2.signLabel");
    expect(accept).toContain("P2.howYouPayFor(");
    expect(accept).toContain("P2.timing");
    expect(accept).toContain("P2.button(");
    expect(accept).not.toContain("OWNER_DECLARATIONS");
    expect(accept).not.toContain("declarations");
  });
  test("button stays disabled until both ticks and a non-blank name", () => {
    expect(accept).toMatch(/quoteSittingBlockers\(\{\s*tick1,\s*tick2,\s*typedName\s*\}\)/);
    expect(accept).toContain("ready={ready}");
  });
  test("no electrical-fixes box on the quote screen (the approved upgrades line is in P2.notIncluded)", () => {
    expect(screen).not.toContain("FixesNote");
    expect(screen).toContain("P2.notIncluded");
  });
  test("PDF links and the attached-to-email note only show for 30-day quotes (validLine set)", () => {
    expect(screen).toMatch(/showDocs=\{!!q\.validLine\}/);
    expect(accept).toMatch(/showDocs/);
    const tick1 = accept.slice(accept.indexOf("P2.tick1"), accept.indexOf("P2.tick2"));
    expect(tick1).toMatch(/showDocs && /);
    expect((tick1.match(/showDocs/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
  test("quotes with no validLine (14-day) show the inline read body so tick 1 can be read", () => {
    const tick1 = accept.slice(accept.indexOf("P2.tick1"), accept.indexOf("P2.tick2"));
    expect(tick1).toMatch(/!showDocs/);
    expect(tick1).toContain("agreementWording");
    expect(tick1).toContain("consumerRights");
    expect(tick1).toContain("paymentTerms");
  });
  test("the old 'How you can pay' box (50% of the install price, PayID, pay in full) is off the quote screen", () => {
    expect(screen).not.toContain("howYouPayLines");
    expect(screen).not.toContain("paymentOptionSummary");
    expect(screen).not.toContain("how-you-pay");
    expect(route).not.toContain("howYouPayLines(");
  });
  test("What's changed box only when rows exist, plus the 30-day valid line", () => {
    expect(screen).toContain("QUOTE_CHANGES_HEADING");
    expect(screen).toContain("QUOTE_CHANGES_FOOTNOTE");
    expect(screen).toMatch(/q\.changes\.length > 0/);
    expect(screen).toContain("q.validLine");
  });
});

describe("accept call", () => {
  test("takes two ticks and a typed name; ESC declarations are not asked or recorded here", () => {
    expect(acceptFn).toContain("tick1: z.boolean()");
    expect(acceptFn).toContain("tick2: z.boolean()");
    expect(acceptFn).toContain("typedName");
    expect(acceptFn).not.toContain("declarations");
    expect(acceptFn).not.toContain("prepareQuoteConsent");
    expect(acceptFn).not.toContain("signOwnerConsent");
  });
});

describe("typed name is tidied before the gate documents are signed", () => {
  test("signGateDoc gets the trimmed, single-spaced name", () => {
    const fn = readFileSync("src/lib/owner-link.functions.ts", "utf8");
    expect(fn).toContain("signatoryName:tidyTypedName(data.signing.typedName)");
    expect(tidyTypedName("  Jo   Smith ")).toBe("Jo Smith");
  });
});
