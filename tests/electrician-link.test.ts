import { describe, expect, test } from "bun:test";
import { ELECTRICIAN_LINK_WORDS, canBookFromLink, electricianStep, type ElectricianLinkFacts } from "../src/lib/electrician-link.core";

// Fri 6 Nov 2026 10:00am Melbourne (AEDT, UTC+11)
const FRI_10AM = "2026-11-05T23:00:00.000Z";
const base = (over: Partial<ElectricianLinkFacts> = {}): ElectricianLinkFacts => ({
  whoBooks: "electrician",
  piesa: { start: null, formUrl: null, outcome: null, upgradesSameDay: false },
  upgrades: { start: null, formUrl: null, formDone: false },
  certificateIn: false,
  handedBack: false,
  now: new Date("2026-11-03T00:00:00Z"),
  ...over,
});
const piesaBooked = (outcome: "pass" | "upgrades" | null = null, upgradesSameDay = false) => ({
  start: FRI_10AM, formUrl: "https://mitti.example/p", outcome, upgradesSameDay,
});

describe("electricianStep", () => {
  test("nothing booked, electrician books", () => {
    const v = electricianStep(base());
    expect(v.step).toBe("book_piesa");
    expect(v.button).toBe("Enter day and time");
    expect(v.title).toBe("Book the safety check");
    expect(v.canBook).toBe(true);
  });
  test("nothing booked, either", () => {
    expect(electricianStep(base({ whoBooks: "either" })).step).toBe("book_piesa");
  });
  test("nothing booked, office books", () => {
    const v = electricianStep(base({ whoBooks: "office" }));
    expect(v.step).toBe("waiting_office_book");
    expect(v.button).toBeNull();
    expect(v.canBook).toBe(false);
  });
  test("PIESA booked shows the form button and the day", () => {
    const v = electricianStep(base({ piesa: piesaBooked() }));
    expect(v.step).toBe("piesa_day");
    expect(v.button).toBe("Open safety check form");
    expect(v.sub).toBe("Fri 6 Nov, 10:00am");
  });
  test("booked by the office on an either business: step is gone for the electrician", () => {
    const v = electricianStep(base({ whoBooks: "either", piesa: piesaBooked() }));
    expect(v.step).toBe("piesa_day");
    expect(v.canBook).toBe(false);
  });
  test("pass goes straight to done", () => {
    expect(electricianStep(base({ piesa: piesaBooked("pass") })).step).toBe("all_done");
  });
  test("upgrades the same day, no certificate", () => {
    const v = electricianStep(base({ piesa: piesaBooked("upgrades", true) }));
    expect(v.step).toBe("upload_certificate");
    expect(v.button).toBe("Upload the certificate");
    expect(v.title).toBe("Upload the Certificate of Electrical Safety");
  });
  test("upgrades another day, none set, electrician", () => {
    const v = electricianStep(base({ piesa: piesaBooked("upgrades") }));
    expect(v.step).toBe("set_upgrades_day");
    expect(v.title).toBe("When are you doing the upgrades?");
    expect(v.button).toBe("Enter the day");
    expect(v.canBook).toBe(true);
  });
  test("upgrades another day, none set, office", () => {
    const v = electricianStep(base({ whoBooks: "office", piesa: piesaBooked("upgrades") }));
    expect(v.step).toBe("waiting_office_upgrades");
    expect(v.canBook).toBe(false);
    expect(v.button).toBeNull();
  });
  test("upgrades day set, form not done", () => {
    const v = electricianStep(base({
      piesa: piesaBooked("upgrades"),
      upgrades: { start: FRI_10AM, formUrl: "https://mitti.example/u", formDone: false },
    }));
    expect(v.step).toBe("upgrades_day");
    expect(v.button).toBe("Open upgrades form");
  });
  test("upgrades form done, no certificate", () => {
    const v = electricianStep(base({
      piesa: piesaBooked("upgrades"),
      upgrades: { start: FRI_10AM, formUrl: "https://mitti.example/u", formDone: true },
    }));
    expect(v.step).toBe("upload_certificate");
  });
  test("certificate in", () => {
    const v = electricianStep(base({
      piesa: piesaBooked("upgrades"),
      upgrades: { start: FRI_10AM, formUrl: null, formDone: true },
      certificateIn: true,
    }));
    expect(v.step).toBe("all_done");
  });
  test("handed back is closed whatever else is true", () => {
    expect(electricianStep(base({ handedBack: true })).step).toBe("closed");
    expect(electricianStep(base({ handedBack: true, certificateIn: true, piesa: piesaBooked("pass") })).step).toBe("closed");
  });
});

describe("canBookFromLink", () => {
  test("electrician and either only", () => {
    expect(canBookFromLink("electrician")).toBe(true);
    expect(canBookFromLink("either")).toBe(true);
    expect(canBookFromLink("office")).toBe(false);
  });
});

describe("ELECTRICIAN_LINK_WORDS", () => {
  test("no fixes, HIV or login wording", () => {
    expect(JSON.stringify(ELECTRICIAN_LINK_WORDS)).not.toMatch(/fixes|Rectification|HIV\b|log ?in|password/i);
  });
});

// Fix round 2, R1: approved #39 says "then update it on the job" — a booked day can be changed from the link when the setting allows.
describe("canChange on a booked day", () => {
  const base = { handedBack: false, certificateIn: false, now: new Date("2026-11-03T02:00:00Z"), upgrades: { start: null, formUrl: null, formDone: false } } as const;
  test("piesa_day: canChange follows the who-books setting; office = no", () => {
    const booked = { start: "2026-11-06T23:00:00Z", formUrl: "https://m/a3", outcome: null, upgradesSameDay: false };
    expect(electricianStep({ ...base, whoBooks: "electrician", piesa: booked }).canChange).toBe(true);
    expect(electricianStep({ ...base, whoBooks: "either", piesa: booked }).canChange).toBe(true);
    expect(electricianStep({ ...base, whoBooks: "office", piesa: booked }).canChange).toBe(false);
  });
  test("upgrades_day: the same; every other step is false", () => {
    const up = { start: "2026-11-06T23:00:00Z", formUrl: "https://m/a3", outcome: "upgrades" as const, upgradesSameDay: false };
    expect(electricianStep({ ...base, whoBooks: "electrician", piesa: up, upgrades: { start: "2026-11-09T23:00:00Z", formUrl: null, formDone: false } }).canChange).toBe(true);
    expect(electricianStep({ ...base, whoBooks: "office", piesa: up, upgrades: { start: "2026-11-09T23:00:00Z", formUrl: null, formDone: false } }).canChange).toBe(false);
    expect(electricianStep({ ...base, whoBooks: "electrician", piesa: { ...up, start: null, outcome: null } }).canChange).toBe(false); // book_piesa: the Book step itself
    expect(electricianStep({ ...base, whoBooks: "electrician", piesa: { ...up, outcome: "pass" } }).canChange).toBe(false);
  });
});
