import { describe, expect, test } from "bun:test";
import { greeting, matchesSearch, myWorkCards, reasonFor } from "../src/lib/my-work.core";
import { nextStepBox, type NextStepFacts } from "../src/lib/next-step-box.core";

// Melbourne is UTC+11 in November (AEDT).
const base: NextStepFacts = {
  channel: "hivic_lead", stage: "ready_check_ready_to_schedule", ownerFirst: "Amy", ownerName: "Amy Clarke", ownerPhone: "0400 000 000",
  now: new Date("2026-11-03T01:00:00Z"), givenAt: "2026-10-25T23:00:00Z",
  readyCheck: { start: null, done: false, missing: [] },
  priceEntered: null, quote: "none", acceptedAt: null, whoBooks: "office", electricianName: null,
  piesa: { start: null, outcome: null, upgradesDone: false, certificateIn: false },
  access: null, depositPaidAt: null, install: { start: null, lead: null, swmsSigned: 0, swmsTotal: 0 },
  installDone: false, pay: null, mittiFormUrl: null,
};
const f = (o: Partial<NextStepFacts>): NextStepFacts => ({ ...base, ...o });
const row = (id: string, o: Partial<NextStepFacts> = {}, r: Partial<Parameters<typeof myWorkCards>[0][number]> = {}) => {
  const box = nextStepBox(f(o));
  return { jobId: id, jobNumber: "HV-1250", owner: "Amy Clarke", street: "3 Elm St", suburb: "Ringwood", channel: "hivic_sourced", box, reason: reasonFor(box.kind), ...r };
};
// A "yours" Ready Check card with a chosen book-by date: given N days before.
const byDate = (id: string, givenAt: string) => row(id, { givenAt });

describe("greeting", () => {
  test("business and count", () => {
    expect(greeting("Rapid", 3)).toEqual({ title: "Hi, Rapid team", sub: "3 jobs need you today." });
    // fix wave minor 11: a TEST partner's name loses its TEST mark in the greeting, like Money
    expect(greeting("TEST Rapid", 1).title).toBe("Hi, Rapid team");
    expect(greeting("[TEST PARTNER] Rapid", 1).title).toBe("Hi, Rapid team");
    expect(greeting("Rapid", 1).sub).toBe("1 job needs you today.");
    expect(greeting("Rapid", 0).sub).toBe("Nothing needs you today."); // DRAFT
  });
});

describe("cards", () => {
  test("Your turn is ordered overdue first, then by date, no date last", () => {
    // Ready Check book-by = 2 working days after it was given.
    const late = byDate("a", "2026-10-26T01:00:00Z");
    const soon = byDate("b", "2026-11-02T01:00:00Z");
    const later = byDate("c", "2026-11-09T01:00:00Z");
    const noBy = row("d", { readyCheck: { start: "2026-11-05T22:00:00Z", done: false, missing: [] } });
    const { yourTurn } = myWorkCards([noBy, later, soon, late]);
    expect(yourTurn.map((c) => c.jobId)).toEqual(["a", "b", "c", "d"]);
    expect(yourTurn[0]!.overdue).toBe(true);
    expect(yourTurn[0]!.by! < yourTurn[1]!.by!).toBe(true);
    expect(yourTurn[3]!.by).toBeNull();
  });
  test("waiting jobs appear only in All; every job once", () => {
    const mine = row("m");
    const waiting = row("w", { readyCheck: { start: null, done: true, missing: [] }, priceEntered: true, quote: "sent" });
    const { yourTurn, all } = myWorkCards([waiting, mine]);
    expect(yourTurn.map((c) => c.jobId)).toEqual(["m"]);
    expect(all.map((c) => c.jobId).sort()).toEqual(["m", "w"]);
    expect(all.find((c) => c.jobId === "w")!.yours).toBe(false);
  });
  test("card text for a Home Insulation Victoria lead", () => {
    const c = myWorkCards([row("x")]).yourTurn[0]!;
    expect(c).toMatchObject({ owner: "Amy Clarke", hvSuburb: "HV-1250 · Ringwood", pill: "Home Insulation Victoria lead", step: "Book the Ready Check", reason: "New job", button: "Book" });
  });
  test("own customer: price it", () => {
    const c = myWorkCards([row("p", { channel: "installer_sourced", readyCheck: { start: null, done: true, missing: [] }, priceEntered: false }, { channel: "installer_sourced" })]).yourTurn[0]!;
    expect(c).toMatchObject({ pill: "Your customer", reason: "Ready Check done", button: "Price it" });
  });
  test("book the install: deposit paid", () => {
    const c = myWorkCards([row("i", { quote: "accepted", acceptedAt: "2026-10-30T01:00:00Z", piesa: { start: null, outcome: "pass", upgradesDone: false, certificateIn: false }, depositPaidAt: "2026-11-02T01:00:00Z" })]).yourTurn[0]!;
    expect(c).toMatchObject({ reason: "Deposit paid", button: "Book", step: "Book the install" });
  });
  test("reasonFor covers every step", () => {
    expect(reasonFor("book_ready_check")).toBe("New job");
    // fix wave I5: no quote gone yet → the card says the Ready Check is done, not "Waiting for the owner"
    expect(reasonFor("waiting_quote", { title: "Quote being prepared" })).toBe("Ready Check done");
    expect(reasonFor("waiting_quote", { title: "Waiting for the owner to decide" })).toBe("Waiting for the owner");
    expect(reasonFor("closed")).toBeTruthy();
  });
  test("Part 7 Task 9: there is no Job offer card (nobody is offered a job; the installer calls and books)", () => {
    const { yourTurn, all } = myWorkCards([row("m")]);
    expect(yourTurn.length).toBe(1); expect(all.length).toBe(1);
    expect(JSON.stringify(myWorkCards([row("m")]))).not.toContain("Job offer");
  });
});

describe("search", () => {
  const card = { ...myWorkCards([row("s", {}, { jobNumber: "HV-1234", owner: "Sarah Brown", street: "12 Example St", suburb: "Box Hill" })]).all[0]!, street: "12 Example St" };
  test.each(["hv1234", "1234", "HV-1234", "example", "BROWN", "box hill", ""])("matches %p", (q) => expect(matchesSearch(card, q)).toBe(true));
  test("does not match another number", () => expect(matchesSearch(card, "1250")).toBe(false));
});
