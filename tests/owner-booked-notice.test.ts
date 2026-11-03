// Decision #24 + Fix 5 (Jo 2 Nov 2026, booked-both2.png / veu-fix5.png): Ready Check "You're booked" email + text.
import { describe, expect, test } from "bun:test";
import { OWNER_BOOKED_V2_APPROVED, ownerBookedNotice, type BookedFacts } from "../src/lib/owner-booked-notice.core";
import { bookingNotice, ownerBookedMessage } from "../src/lib/in-house-booking.core";
import type { TradeContact } from "../src/lib/owner-will-call.core";

const rapid: TradeContact = { name: "Rapid Insulation", tradingName: null, officePhone: "03 9000 0000", email: "office@rapid.example" };
// 4 Nov is a Tuesday in 2025 (the plan's example date); 2026-11-04 is a Wednesday.
const f: BookedFacts = { kind: "ready_check", firstName: "Sarah", startIso: "2025-11-03T22:00:00Z", whoName: "John Smith", business: rapid, changed: false };
type Msg = { subject: string; text: string; html: string; sms: string };

describe("ownerBookedNotice — Ready Check (approved #24 + Fix 5 wording)", () => {
  test("approved wording, word for word", () => {
    const n = ownerBookedNotice(f) as Msg;
    expect(n.text).toContain("You're booked for your free Ready Check");
    expect(n.text).toContain("Day: Tuesday 4 November");
    expect(n.text).toContain("Arriving: 9:00am");
    expect(n.text).toContain("Who's coming: John Smith, Rapid Insulation");
    expect(n.text).toContain("They'll measure up and confirm your quote. It's free, with no obligation.");
    expect(n.text).toContain("Need to change it? Call Rapid Insulation on 03 9000 0000.");
    expect(n.text).toContain("Rapid Insulation · 03 9000 0000 · office@rapid.example");
    expect(n.text).toContain("Rebate certificates created by Home Insulation Victoria (Accredited Person A003654).");
    expect(n.text).not.toMatch(/Wrong time|Change time|job page/);
    expect(n.sms).toBe("Home Insulation Victoria: Hi Sarah, you're booked for your free Ready Check: Tue 4 Nov, 9:00am. John Smith from Rapid Insulation is coming. Need to change it? Call Rapid Insulation on 03 9000 0000.");
    expect(n.subject).toBe("You're booked for your free Ready Check");
  });
  test("the email shows the heading, the Day / Arriving / Who's coming table, the change line and the contact block", () => {
    const n = ownerBookedNotice(f) as Msg;
    for (const s of ["You're booked for your free Ready Check", ">Day<", ">Tuesday 4 November<", ">Arriving<", ">9:00am<", "Who's coming", "John Smith, Rapid Insulation", "Need to change it? Call Rapid Insulation on 03 9000 0000.", "Rapid Insulation · 03 9000 0000 · office@rapid.example", "Accredited Person A003654"])
      expect({ s, found: n.html.includes(s) }).toEqual({ s, found: true });
    expect(n.html).not.toMatch(/Wrong time|Change time|job page|HIV\b/);
  });
  test("changed time → heading starts \"Your time has changed\"; the text keeps the approved wording", () => {
    const n = ownerBookedNotice({ ...f, changed: true, startIso: "2025-11-05T03:30:00Z" }) as Msg;
    expect(n.subject.startsWith("Your time has changed")).toBe(true);
    expect(n.text.split("\n").find(l => l.trim())!.startsWith("Your time has changed")).toBe(true);
    expect(n.text).toContain("Day: Wednesday 5 November");
    expect(n.text).toContain("Arriving: 2:30pm");
    expect(n.sms).toBe("Home Insulation Victoria: Hi Sarah, you're booked for your free Ready Check: Wed 5 Nov, 2:30pm. John Smith from Rapid Insulation is coming. Need to change it? Call Rapid Insulation on 03 9000 0000.");
  });
  test("no office phone or no business email → held, never a worker's number or a blank", () => {
    expect(ownerBookedNotice({ ...f, business: { ...rapid, officePhone: null } })).toEqual({ held: "No office phone for Rapid Insulation" });
    expect(ownerBookedNotice({ ...f, business: { ...rapid, officePhone: "  " } })).toEqual({ held: "No office phone for Rapid Insulation" });
    expect(ownerBookedNotice({ ...f, business: { ...rapid, email: null } })).toEqual({ held: "No business email for Rapid Insulation" });
  });
  test("trading name is the name owners see; no first name → \"Hi there\"", () => {
    const n = ownerBookedNotice({ ...f, firstName: null, business: { ...rapid, name: "Rapid Pty Ltd", tradingName: "Rapid Insulation" } }) as Msg;
    expect(n.sms.startsWith("Home Insulation Victoria: Hi there, you're booked")).toBe(true);
    expect(n.text).toContain("Who's coming: John Smith, Rapid Insulation");
    expect(n.text).not.toContain("Rapid Pty Ltd");
  });
  test("TEST label on test jobs", () => {
    const n = ownerBookedNotice(f, { test: true }) as Msg;
    expect(n.html).toContain("TEST");
  });
  test("PIESA and install versions are Part 4's — not built here", () => {
    for (const kind of ["piesa", "install"] as const) expect("held" in ownerBookedNotice({ ...f, kind })).toBe(true);
  });
  test("ships switched off for every kind", () => {
    expect(OWNER_BOOKED_V2_APPROVED).toEqual({ ready_check: false, piesa: false, install: false });
  });
});

describe("ownerBookedMessage (in-house-booking.core) — flag decides old or new wording", () => {
  const base = { kind: "ready_check" as const, start: "2025-11-03T22:00:00Z", who: { name: "John Smith", phone: "0411 111 111" }, installer: "Rapid Insulation", phone: "03 9000 0000", ownerName: "Sarah Jones", business: rapid, changed: false };
  test("flag off → the current bookingNotice wording, unchanged", () => {
    const m = ownerBookedMessage(base);
    const old = bookingNotice(base);
    expect(m).toEqual({ version: "v1", subject: old.subject, text: old.text, sms: old.sms });
  });
  test("flag on for ready_check → the approved #24 wording with the owner's first name and the office phone only", () => {
    const m = ownerBookedMessage(base, { ready_check: true, piesa: false, install: false });
    expect(m).toMatchObject({ version: "v2" });
    const v2 = m as Msg & { version: string };
    expect(v2.sms).toBe("Home Insulation Victoria: Hi Sarah, you're booked for your free Ready Check: Tue 4 Nov, 9:00am. John Smith from Rapid Insulation is coming. Need to change it? Call Rapid Insulation on 03 9000 0000.");
    expect(v2.text).not.toContain("0411 111 111");
    expect(v2.html).toContain("You");
  });
  test("flag on, contact missing → held", () => {
    expect(ownerBookedMessage({ ...base, business: { ...rapid, officePhone: null } }, { ready_check: true, piesa: false, install: false })).toEqual({ held: "No office phone for Rapid Insulation" });
    expect(ownerBookedMessage({ ...base, business: null }, { ready_check: true, piesa: false, install: false })).toEqual({ held: "No installer business on file" });
  });
  test("piesa / install stay on the current wording even with every flag on (Part 4)", () => {
    for (const kind of ["piesa", "install"] as const) {
      const m = ownerBookedMessage({ ...base, kind }, { ready_check: true, piesa: true, install: true });
      expect(m).toMatchObject({ version: "v1" });
    }
  });
});
