// Installer redesign — Action items rules (plan Task 4).
import { describe, expect, test } from "bun:test";
import { actionItems, greetingLine, thisWeek, type ActionRow } from "../src/lib/action-items.core";
import type { NextStepBox } from "../src/lib/next-step-box.core";

const box = (o: Partial<NextStepBox>): NextStepBox => ({ kind: "book_install", title: "Book the install", sub: null, yours: true, bookBy: null, overdue: false, phone: null, button: "Book the install", lines: [], alsoBookInstall: null, pickPerson: null, ...o });
const row = (o: Partial<ActionRow>): ActionRow => ({ jobId: "j1", jobNumber: "HV-3821", owner: "Sam Lee", street: "12 Smith St, Melton", suburb: "Melton", channel: "hiv_lead", box: box({}), reason: "", stop: null, waitingOn: null, ownerFirst: "Sam", ...o });

describe("greetingLine", () => {
  test("greeting edges", () => {
    expect(greetingLine("Deep", "Reinsulate", new Date("2026-11-06T00:59:00Z"))).toBe("Good morning, Deep");
    expect(greetingLine("Deep", "Reinsulate", new Date("2026-11-06T01:00:00Z"))).toBe("Good afternoon, Deep");
    expect(greetingLine("Deep", "Reinsulate", new Date("2026-11-06T06:00:00Z"))).toBe("Good evening, Deep");
    expect(greetingLine(null, "TEST Rapid", new Date("2026-11-06T01:00:00Z"))).toBe("Hi, Rapid team");
  });
});

describe("actionItems", () => {
  test("stop job is only in fix", () => {
    const r = actionItems([row({ stop: "Book an electrician for install day", installAt: "2026-11-10T21:00:00Z" })]);
    expect(r.fix.map((c) => c.action)).toEqual(["Book an electrician for install day"]);
    expect(r.fix[0]!.due).toBe("Install Wed 11 Nov");
    expect(r.turn).toEqual([]);
  });
  test("waiting says who", () => {
    const r = actionItems([row({ box: box({ kind: "waiting_deposit", title: "Waiting for the deposit", yours: false }), waitingOn: "Sam (owner)" })]);
    expect(r.waiting[0]!.waitingOn).toBe("Sam (owner)");
    expect(r.waiting[0]!.status).toBe("Waiting for the deposit");
  });
  test("own electrician: in Your turn, never waiting", () => {
    const r = actionItems([row({ box: box({ kind: "waiting_electrician_book", yours: false, button: null }), electricianName: "JAMES WOOD" }), row({ box: box({ kind: "piesa_booked", yours: false, button: null }), electricianName: null })]);
    expect(r.waiting).toEqual([]);
    expect(r.turn.map((c) => [c.action, c.button])).toEqual([["Get James to book the PIESA", "Open"], ["PIESA booked · your electrician", null]]);
    expect(r.count).toBe(1);
  });
  test("closed jobs are left out", () => {
    expect(actionItems([row({ box: box({ kind: "closed", yours: false }) })]).waiting).toEqual([]);
  });
  test("names show in normal case", () => {
    expect(actionItems([row({ owner: "JO LOWE" })]).turn[0]!.meta.startsWith("Jo Lowe · ")).toBe(true);
    expect(actionItems([row({ channel: "installer_sourced" })]).turn[0]!.meta).toBe("Sam Lee · HV-3821 · Your customer");
  });
  test("sub wording", () => {
    expect(actionItems([]).sub).toBe("Nothing needs you today.");
    expect(actionItems([row({})]).sub).toBe("1 job needs you today.");
    expect(actionItems([row({ stop: "x" }), row({}), row({}), row({})]).sub).toBe("4 jobs need you today. 1 must be fixed before work starts.");
    expect(actionItems([row({}), row({})]).sub).toBe("2 jobs need you today.");
  });
  test("no deadline chip without bookBy", () => {
    expect(actionItems([row({})]).turn[0]!.due).toBeNull();
    expect(actionItems([row({ box: box({ bookBy: "2026-11-12" }) })]).turn[0]!.due).toBe("By Thu 12 Nov");
  });
});

describe("thisWeek", () => {
  const b = (kind: string, at: string) => ({ kind, scheduled_start: at, suburb: "Melton", who: "Dave", flag: null, flagTone: null });
  const list = [b("piesa", "2026-11-09T22:00:00Z"), b("install", "2026-11-08T21:00:00Z")]; // Tue 10 Nov 9:00, Mon 9 Nov 8:00 Melbourne
  test("next week isn't shown", () => {
    expect(thisWeek(list, new Date("2026-11-06T02:00:00Z"))).toEqual([]);
  });
  test("this week order and days", () => {
    const r = thisWeek(list, new Date("2026-11-08T20:00:00Z")); // Mon 9 Nov 7:00am Melbourne
    expect(r.map((w) => [w.day, w.date, w.kind, w.time])).toEqual([["Mon", 9, "Install", "8:00am"], ["Tue", 10, "PIESA", "9:00am"]]);
  });
});

test("overdue only with a book-by date", () => {
  const { actionItems } = require("../src/lib/action-items.core");
  const b = { kind: "book_install", title: "Book the install", sub: null, yours: true, bookBy: "2026-11-01", overdue: true, phone: null, button: "Book", lines: [], alsoBookInstall: null, pickPerson: null };
  const r = { jobId: "j", jobNumber: "HV-1", owner: "A B", street: null, suburb: "Kew", channel: null, box: b, reason: "", stop: null, waitingOn: null, ownerFirst: "A" };
  expect(actionItems([r]).turn[0].overdue).toBe(true);
  expect(actionItems([{ ...r, box: { ...b, bookBy: null } }]).turn[0].overdue).toBe(false);
});
