// Jo's approved owner/installer page wording (24 Oct 2026, decisions 125–130, 137) must match the approved mock-ups
// byte for byte — Jo rejects paraphrases. These pin the pure labels and formatters the pages render from.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { CONSUMER_DECLARATION } from "../src/lib/veec-assignment-form.core";
import { OWNER_DECLARATIONS } from "../src/lib/consent.core";
import { COLLECTION_NOTICE_ACK_TEXT } from "../src/lib/esc-collection-notice.core";
import { P1, P2, P3, P4, P5, P6, THIRTY_DAY_CLOCK, OWNER_PAGE_FOOTER, centsAud, clock, dayMonth, declarationBullets, longDate, sentence, shortAud, weekdayDate } from "../src/lib/owner-pages.core";

const approved = (f: string) => readFileSync(`docs/templates/${f.startsWith("P5") ? "installer" : f.startsWith("O45") ? "invoices" : "owner"}/${f}`, "utf8").replace(/&rsaquo;/g, "›").replace(/&#10003;/g, "✓").replace(/&#9200;/g, "⏰").replace(/&amp;/g, "&");
const inApproved = (f: string, texts: string[]) => { const html = approved(f); for (const t of texts) expect(html).toContain(t); };

describe("approved page wording", () => {
  test("P1 questions page", () => inApproved("P1-questions-page.html", [P1.title, "Just tap. It takes under a minute. Your $1,610 rebate is waiting.", P1.photosTitle, P1.photosSub, P1.addPhotos, P1.addVideo, P1.save, P1.lockHint("question 3"), P1.noObligation, P1.notInterested, P1.labels.insulation_type!, P1.labels.insulation_thickness!, P1.labels.house_built_period!, P1.question(2), P1.kicker("Helen")]));
  test("P2 quote + acceptance page", () => inApproved("P2-quote-accept-page.html", [P2.kicker, P2.title("Helen"), P2.sub({ address: "824 High Street Road, Glen Waverley VIC 3150", measuredOn: "28 October", heldUntil: "7 November 2026" }), P2.youSave("$1,850"), P2.rebateNote, P2.priceNote, P2.itemsTitle, P2.notIncluded, P2.sayYes, P2.twoThings, P2.tapEach, P2.tick1, P2.tick1Sub("$1,850"), P2.tick1Read, P2.tick2, P2.tick2Sub("$349"), P2.tick2Read, P2.signTitle, P2.signSub, P2.fullName, P2.tick3, P2.typeAgain, P2.button("$349.00"), P2.lockHint, P2.payNote("$349"), P2.notForMe, P2.rebateLineSub, P2.youPay]));
  test("P3 owner consent page", () => inApproved("P3-owner-consent-page.html", [P3.kicker, P3.sub("$185.10"), P3.whyLead + "</b>" + P3.why, P3.formEyebrow, P3.section1, P3.section2, P3.declare, P3.signLabel, P3.dateLine("24 October 2026"), P3.button, P3.lockHint, P3.afterNote, P3.correct, ...OWNER_DECLARATIONS.map((d) => sentence(d.text)), ...P3.rows.map(([, l]) => l)]));
  test("P4 VEEC signing page", () => inApproved("P4-veec-sign-page.html", [P4.kicker, P4.title("Helen"), P4.intro({ installedOn: "Tuesday 11 November", rebate: "$1,850" }), P4.rightsLead + "</b>" + P4.rights("$1,850"), P4.rightsRead, P4.formEyebrow, P4.section2, P4.tellUs, P4.section4, P4.tick, P4.signLabel, P4.dateLine("12 November 2026"), P4.button, P4.lockHint, P4.afterNote,
    // The page shows the official form text; the two bullets naming the AP carry its full registered name there, the mock-up shortened it.
    ...declarationBullets(CONSUMER_DECLARATION).filter((b) => !b.includes("(DC Construction"))]));
  test("P5 installer privacy notice page", () => inApproved("P5-installer-privacy-notice.html", [P5.title, P5.sub, P5.yourInstallers, COLLECTION_NOTICE_ACK_TEXT, P5.note + "<b>" + P5.noteTeam + "</b>" + P5.noteEnd, P5.button, "Acknowledged 24 Oct 2026, 2:15pm", P5.leadSuffix]));
  test("footer line on P2–P4 and P6", () => { for (const f of ["P2-quote-accept-page.html", "P3-owner-consent-page.html", "P4-veec-sign-page.html", "P6-piesa-confirm-page.html"]) expect(approved(f)).toContain(OWNER_PAGE_FOOTER); });
  // P6 (decision 296, owner confirms the PIESA by secure link) is pinned line by line in tests/piesa-owner-confirm.test.ts.
  test("P6 PIESA confirmation page", () => inApproved("P6-piesa-confirm-page.html", [P6.kicker, P6.title, P6.formEyebrow, P6.button, P6.lockHint, P6.afterNote, P6.confirmedTitle]));
  test("decision 137: the 30-day clock wording matches the approved emails", () => {
    const o26 = approved("O26-safety-check-times.html"); const o29 = approved("O29-fixes-quote.html");
    expect(o26).toContain(THIRTY_DAY_CLOCK.title); expect(o26).toContain(`<strong>${THIRTY_DAY_CLOCK.lead}</strong>${THIRTY_DAY_CLOCK.body}`);
    expect(o29).toContain(`<strong>${THIRTY_DAY_CLOCK.fixesLead}</strong>${THIRTY_DAY_CLOCK.fixesBefore}<strong>5 December</strong>${THIRTY_DAY_CLOCK.fixesAfter}`);
  });
});

describe("declarationBullets", () => {
  test("ten Section 4 declarations, in order, nothing else", () => {
    const b = declarationBullets(CONSUMER_DECLARATION);
    expect(b).toHaveLength(10);
    expect(b[0]).toBe("I am the energy consumer, or I am authorised to make this declaration on behalf of the above-named entity that is the consumer");
    expect(b[9]).toStartWith("I am aware that it is an offence");
    expect(b.some((x) => /Consumer signature/.test(x))).toBe(false);
  });
  test("no declaration block → empty", () => expect(declarationBullets("nothing here")).toEqual([]));
});

describe("formatters (Melbourne)", () => {
  test("money", () => { expect(shortAud(1850)).toBe("$1,850"); expect(shortAud(185.1)).toBe("$185.10"); expect(centsAud(2200)).toBe("$2,200.00"); expect(centsAud(4050)).toBe("$4,050.00"); });
  test("dates", () => {
    const iso = "2026-11-10T20:30:00Z"; // Wednesday 11 Nov 2026 07:30 Melbourne (AEDT); the mock-up's "Tuesday" is sample text
    expect(weekdayDate(iso)).toBe("Wednesday 11 November"); expect(clock(iso)).toBe("7:30am"); expect(longDate(iso)).toBe("11 November 2026"); expect(dayMonth(iso)).toBe("11 November");
    expect(P3.title(iso)).toBe("Wednesday 11 November, arriving 7:30am");
    expect(P5.acknowledged("2026-10-24T03:15:00Z")).toBe("Acknowledged 24 Oct 2026, 2:15pm");
  });
  test("sentence() only adds the full stop the approved page shows", () => { expect(sentence("abc")).toBe("abc."); expect(sentence("abc.")).toBe("abc."); });
});
