import { describe, expect, test } from "bun:test";
import { Constants } from "../src/integrations/supabase/types";
import { nextStepBox, type NextStepFacts } from "../src/lib/next-step-box.core";

// Melbourne is UTC+11 in November (AEDT).
const base: NextStepFacts = {
  channel: "hivic_lead", stage: "ready_check_ready_to_schedule", ownerFirst: "Sarah", ownerName: "Sarah Brown", ownerPhone: "0400 000 000",
  now: new Date("2026-11-03T01:00:00Z"),
  givenAt: "2026-10-25T23:00:00Z", // Mon 26 Oct
  readyCheck: { start: null, done: false, missing: [] },
  priceEntered: null, quote: "none", acceptedAt: null, whoBooks: "office", electricianName: null,
  piesa: { start: null, outcome: null, upgradesDone: false, certificateIn: false },
  access: null, depositPaidAt: null,
  install: { start: null, lead: null, swmsSigned: 0, swmsTotal: 0 },
  installDone: false, pay: null, mittiFormUrl: null,
};
const f = (o: Partial<NextStepFacts>): NextStepFacts => ({ ...base, ...o });
const rcDone = { start: "2026-11-03T22:00:00Z", done: true, missing: [] as string[] };
const accepted = { quote: "accepted" as const, acceptedAt: "2026-10-30T01:00:00Z" }; // Fri 30 Oct
const piesaUpgrades = { start: "2026-11-05T22:00:00Z", outcome: "upgrades" as const, upgradesDone: false, certificateIn: false };

describe("Next step box", () => {
  test("book the Ready Check", () => {
    const b = nextStepBox(base);
    expect(b).toMatchObject({ kind: "book_ready_check", title: "Book the Ready Check", bookBy: "2026-11-02", button: "Book", yours: true });
    expect(b.phone).toEqual({ name: "Sarah Brown", phone: "0400 000 000" });
  });
  test("Cup Day is skipped", () => {
    expect(nextStepBox(f({ givenAt: "2026-10-27T23:00:00Z" })).bookBy).toBe("2026-11-05"); // Wed 28 Oct
  });
  test("Ready Check booked", () => {
    const b = nextStepBox(f({ readyCheck: { start: "2026-11-03T22:00:00Z", done: false, missing: [] } })); // Wed 4 Nov 9am
    expect(b).toMatchObject({ kind: "ready_check_booked", button: "Open the Mitti form" });
    expect(b.lines[0]).toBe("Ready Check · Wed 4 Nov, 9:00am");
  });
  test("Ready Check done but missing things", () => {
    const b = nextStepBox(f({ readyCheck: { ...rcDone, missing: ["Ceiling photos"] } }));
    expect(b).toMatchObject({ kind: "ready_check_missing", sub: "Still needs: Ceiling photos", button: "Open the Mitti form" });
  });
  test("own customer: enter your price", () => {
    expect(nextStepBox(f({ channel: "own", readyCheck: rcDone, priceEntered: false }))).toMatchObject({ kind: "enter_price", title: "Enter your price", yours: true });
  });
  test("quote sent: nothing to do, never chase", () => {
    const b = nextStepBox(f({ readyCheck: rcDone, quote: "sent" }));
    expect(b).toMatchObject({ kind: "waiting_quote", yours: false });
    expect(b.sub).toContain("Nothing for you to do.");
    expect(JSON.stringify(b)).not.toMatch(/call|chase/i);
  });
  // Fix wave I5: no quote has gone yet after the Ready Check — never "Waiting for the owner to decide".
  test("Ready Check done, no quote yet: Home Insulation Victoria lead → we are checking the quote; own customer → the price step is next", () => {
    const lead = nextStepBox(f({ readyCheck: rcDone, quote: "none" }));
    expect(lead).toMatchObject({ kind: "waiting_quote", title: "Quote being prepared", sub: "Home Insulation Victoria is checking the quote.", yours: false });
    expect(lead.title).not.toContain("owner");
    const ownNoPrice = nextStepBox(f({ channel: "installer_sourced", readyCheck: rcDone, quote: "none", priceEntered: null }));
    expect(ownNoPrice).toMatchObject({ kind: "waiting_quote", title: "Quote being prepared", sub: "Your boss enters the price next, then we send the owner their quote.", yours: false });
    // own customer, price already in, quote not sent yet: the price line would be wrong — it is being checked
    const ownPriced = nextStepBox(f({ channel: "installer_sourced", readyCheck: rcDone, quote: "none", priceEntered: true }));
    expect(ownPriced).toMatchObject({ kind: "waiting_quote", sub: "Home Insulation Victoria is checking the quote.", yours: false });
    // the sent quote keeps its waiting line
    expect(nextStepBox(f({ readyCheck: rcDone, quote: "sent" }))).toMatchObject({ title: "Waiting for the owner to decide", sub: "Nothing for you to do." });
    expect(nextStepBox(f({ readyCheck: rcDone, quote: "declined" })).sub).toContain("didn't take this one up");
  });
  test("accepted: book the PIESA", () => {
    expect(nextStepBox(f({ readyCheck: rcDone, ...accepted }))).toMatchObject({ kind: "book_piesa", bookBy: "2026-11-04", button: "Book" });
  });
  test("either books the PIESA: shows book_piesa", () => {
    expect(nextStepBox(f({ readyCheck: rcDone, ...accepted, whoBooks: "either" })).kind).toBe("book_piesa");
  });
  test("electrician books the PIESA", () => {
    const b = nextStepBox(f({ readyCheck: rcDone, ...accepted, whoBooks: "electrician", electricianName: "Will Casdorff" }));
    expect(b).toMatchObject({ kind: "waiting_electrician_book", sub: "Waiting for Will Casdorff to book the PIESA. Book by Wed 4 Nov.", yours: false });
  });
  test("PIESA booked", () => {
    const b = nextStepBox(f({ readyCheck: rcDone, ...accepted, piesa: { ...piesaUpgrades, outcome: null } }));
    expect(b.kind).toBe("piesa_booked");
    expect(b.lines[0]).toBe("PIESA · Fri 6 Nov, 9:00am");
  });
  test("upgrades to come, deposit not paid", () => {
    const b = nextStepBox(f({ readyCheck: rcDone, ...accepted, piesa: piesaUpgrades }));
    expect(b.kind).toBe("upload_certificate");
    expect(b.title).toBe("Upload the Certificate of Electrical Safety");
    expect(b.lines).toContain("Deposit: waiting for Sarah.");
    expect(b.alsoBookInstall).toBeNull();
  });
  test("upgrades to come, deposit paid", () => {
    const b = nextStepBox(f({ readyCheck: rcDone, ...accepted, piesa: piesaUpgrades, depositPaidAt: "2026-11-05T00:00:00Z" }));
    expect(b.kind).toBe("upload_certificate");
    expect(b.alsoBookInstall).toEqual({ button: "Book the install", warn: "Electrical upgrades aren't done yet. The install can't start until the Part C and certificate are in." });
  });
  test("PIESA pass, no deposit", () => {
    const b = nextStepBox(f({ readyCheck: rcDone, ...accepted, piesa: { ...piesaUpgrades, outcome: "pass" } }));
    expect(b).toMatchObject({ kind: "waiting_deposit", sub: "Waiting for Sarah to pay the deposit. Nothing for you to do.", yours: false });
  });
  const passed = { ...piesaUpgrades, outcome: "pass" as const };
  const depositIn = { readyCheck: rcDone, ...accepted, piesa: passed, depositPaidAt: "2026-11-05T00:00:00Z" }; // Thu 5 Nov
  test("deposit paid: book the install, overdue", () => {
    const b = nextStepBox(f({ ...depositIn, now: new Date("2026-11-07T01:00:00Z") })); // Sat 7 Nov
    expect(b).toMatchObject({ kind: "book_install", title: "Book the install", bookBy: "2026-11-06", overdue: true, button: "Book the install" });
    expect(b.sub).toBe("Sarah's deposit is in. Give Sarah a call, agree a day, then add it here. Book by Fri 6 Nov.");
    expect(b.phone).toEqual({ name: "Sarah Brown", phone: "0400 000 000" });
  });
  const booked = { ...depositIn, install: { start: "2026-11-12T20:30:00Z", lead: "Dan Lee", swmsSigned: 1, swmsTotal: 3 } }; // Fri 13 Nov 7:30am
  test("install booked", () => {
    const b = nextStepBox(f({ ...booked, now: new Date("2026-11-09T00:00:00Z") }));
    expect(b.kind).toBe("install_booked");
    expect(b.lines).toEqual(["Safety plan signed 1 of 3", "Lead Installer locks Wed 11 Nov, 5pm"]);
  });
  test("rental: call the person who lets us in", () => {
    const b = nextStepBox(f({ ...depositIn, now: new Date("2026-11-07T01:00:00Z"), access: { who: "tenant", name: "Tina Lee", mobile: "0400 111 222" } }));
    expect(b.phone).toEqual({ name: "Tina Lee (tenant)", phone: "0400 111 222" });
  });
  test("lock moment", () => {
    expect(nextStepBox(f({ ...booked, now: new Date("2026-11-11T05:59:00Z") })).kind).toBe("install_booked");
    const b = nextStepBox(f({ ...booked, now: new Date("2026-11-11T06:00:00Z") })); // Wed 11 Nov 5:00pm
    expect(b.kind).toBe("install_locked");
    expect(b.lines).toContain("Locked: ESC has been told. Email us to move this install.");
  });
  const done = { ...booked, installDone: true };
  test("after install: our lead pay", () => {
    expect(nextStepBox(f({ ...done, pay: { kind: "hivic_after_paperwork", amount: 3000, paidAt: null } }))).toMatchObject({ kind: "after_install", sub: "Your $3,000 is paid 7 days after we approve the install paperwork." });
  });
  test("after install: own customer pay", () => {
    expect(nextStepBox(f({ ...done, channel: "own", pay: { kind: "own_after_owner_paid", amount: 3275, paidAt: null } })).sub).toBe("Your $3,275 is paid once Sarah has paid in full.");
  });
  test("after install: paid", () => {
    expect(nextStepBox(f({ ...done, pay: { kind: "hivic_after_paperwork", amount: 3000, paidAt: "2026-11-02T22:00:00Z" } })).sub).toBe("Paid ✓ 3 Nov");
  });
  test("closed", () => {
    expect(nextStepBox(f({ stage: "cancelled" })).kind).toBe("closed");
  });
  test("no owner name or phone: no undefined or null text", () => {
    const b = nextStepBox(f({ ...depositIn, ownerFirst: null, ownerName: null, ownerPhone: null, now: new Date("2026-11-07T01:00:00Z") }));
    expect(b.sub?.startsWith("The owner's deposit is in. Give the owner a call")).toBe(true);
    expect(b.phone).toBeNull();
    expect(JSON.stringify(b)).not.toMatch(/undefined|"null"|null"/);
  });
  test("every live stage maps to a box with no retired words", () => {
    for (const stage of Constants.public.Enums.job_stage) {
      const b = nextStepBox(f({ stage }));
      expect(JSON.stringify(b)).not.toMatch(/offer|3 (times|days)|fixes|Rectification|lead installer|HIV\b/);
    }
  });
});
