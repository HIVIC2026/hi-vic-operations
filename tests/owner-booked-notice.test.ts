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
  test("PIESA and install need their own facts, else held", () => {
    expect(ownerBookedNotice({ ...f, kind: "piesa" })).toEqual({ held: "No installer on file" });
    expect(ownerBookedNotice({ ...f, kind: "install" })).toEqual({ held: "No balance on file" });
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
  test("piesa / install follow their own flag (Part 4): off → current wording, on → approved wording or held", () => {
    for (const kind of ["piesa", "install"] as const) {
      expect(ownerBookedMessage({ ...base, kind }, { ready_check: true, piesa: false, install: false })).toMatchObject({ version: "v1" });
      expect(ownerBookedMessage({ ...base, kind, installerName: "Rapid Insulation", balanceCents: 100 }, { ready_check: false, piesa: true, install: true })).toMatchObject({ version: "v2" });
    }
    expect(ownerBookedMessage({ ...base, kind: "piesa", business: null }, { ready_check: false, piesa: true, install: false })).toEqual({ held: "No electrician business on file" });
  });
});

// Part 4 Task 1: touchpoints #38 (PIESA) and #46 (install) — Jo 2 Nov 2026.
describe("ownerBookedNotice — PIESA (#38) and install (#46)", () => {
  const viking: TradeContact = { name: "Viking Electrical", tradingName: null, officePhone: "03 9111 1111", email: "jobs@viking.example" };
  const piesa = (o: Partial<BookedFacts> = {}) => ownerBookedNotice({ kind: "piesa", firstName: "Sarah", startIso: "2026-11-06T23:00:00Z", whoName: "Dan Lee", business: viking, changed: false, installDeadline: "2026-12-06", installerName: "Rapid Insulation", ...o });
  const install = (o: Partial<BookedFacts> = {}) => ownerBookedNotice({ kind: "install", firstName: "Sarah", startIso: "2026-11-12T21:00:00Z", whoName: "Tom Ray", business: rapid, changed: false, balanceCents: 141200, ...o });
  test("PIESA wording, word for word", () => {
    const p = piesa() as Msg;
    expect(p.subject).toBe("You're booked for your electrical safety check (PIESA)");
    expect(p.text).toContain("You're booked for your electrical safety check (PIESA)");
    expect(p.text).toContain("Day: Saturday 7 November");
    expect(p.text).toContain("Arriving: 10:00am");
    expect(p.text).toContain("Who's coming: Dan Lee, Viking Electrical");
    expect(p.text).toContain("A licensed electrician checks your switchboard, ceiling wiring and downlights are safe to insulate over. It's already paid for.");
    expect(p.text).toContain("Before they arrive");
    expect(p.text).toContain("someone 18+ home");
    expect(p.text).toContain("The 30-day rule: Your insulation must be installed within 30 days of this check, or it has to be done again. Rapid Insulation will call you to book your install day.");
    expect(p.text).toContain("Need to change it? Call Viking Electrical on 03 9111 1111.");
    expect(p.text).toContain("Viking Electrical · 03 9111 1111 · jobs@viking.example");
    expect(p.text).toContain("Rebate certificates created by Home Insulation Victoria (Accredited Person A003654).");
    expect(p.sms).toBe("Home Insulation Victoria: Hi Sarah, you're booked for your electrical safety check (PIESA): Sat 7 Nov, 10:00am. Dan Lee from Viking Electrical is coming. Need to change it? Call Viking Electrical on 03 9111 1111.");
    for (const s of ["Before they arrive", "The 30-day rule:", "Viking Electrical · 03 9111 1111"]) expect(p.html).toContain(s);
  });
  test("PIESA: the 30-day rule names the installer, the change line names the electrician", () => {
    const p = piesa({ installerName: "Reinsulate" }) as Msg;
    expect(p.text).toContain("Reinsulate will call you to book your install day.");
    expect(p.text).not.toContain("Viking Electrical will call");
    expect(p.text).toContain("Call Viking Electrical on 03 9111 1111.");
  });
  test("PIESA: no electrician office phone or email → held; no installer → held; never a worker's number", () => {
    expect(piesa({ business: { ...viking, officePhone: null } })).toEqual({ held: "No office phone for Viking Electrical" });
    expect(piesa({ business: { ...viking, email: "" } })).toEqual({ held: "No business email for Viking Electrical" });
    expect(piesa({ installerName: null })).toEqual({ held: "No installer on file" });
  });
  test("PIESA change of time → \"Your time has changed\"", () => {
    const p = piesa({ changed: true }) as Msg;
    expect(p.subject).toBe("Your time has changed");
    expect(p.text).toContain("You're booked for your electrical safety check (PIESA)");
  });
  test("install wording, word for word, no duration", () => {
    const i = install() as Msg;
    expect(i.subject).toBe("You're booked for your insulation install");
    expect(i.text).toContain("Day: Friday 13 November");
    expect(i.text).toContain("Arriving: 8:00am");
    expect(i.text).toContain("Lead Installer: Tom Ray");
    expect(i.text).toContain("Your balance: The rest of your payment, $1,412.00, is due on install day. We'll send you a link to pay by card or bank transfer.");
    expect(i.text).not.toMatch(/How long|hours|Wrong time|Change day/);
    expect(i.html).not.toMatch(/How long|hours|Wrong time|Change day/);
    expect(i.text).toContain("Need to change it? Call Rapid Insulation on 03 9000 0000.");
    expect(i.text).toContain("Rapid Insulation · 03 9000 0000 · office@rapid.example");
    expect(i.text).toContain("Accredited Person A003654");
    expect(i.sms).toBe("Home Insulation Victoria: Hi Sarah, you're booked for your insulation install: Fri 13 Nov, 8:00am. Tom Ray from Rapid Insulation is coming. Need to change it? Call Rapid Insulation on 03 9000 0000.");
  });
  test("the four approved ticks", () => {
    const i = install() as Msg;
    for (const t of ["clear the way to the ceiling hatch", "someone 18+ home", "power off while they work in the ceiling", "pets away"]) { expect(i.text).toContain(`✓ ${t}`); expect(i.html).toContain(t); }
    expect(i.text).toContain("Before they arrive");
  });
  test("install: no office phone / email / balance → held", () => {
    expect(install({ business: { ...rapid, officePhone: null } })).toEqual({ held: "No office phone for Rapid Insulation" });
    expect(install({ business: { ...rapid, email: null } })).toEqual({ held: "No business email for Rapid Insulation" });
    expect(install({ balanceCents: null })).toEqual({ held: "No balance on file" });
  });
  test("no owner-facing HIV or lawyer wording", () => {
    for (const n of [piesa(), install()] as Msg[]) expect(n.text + n.html + n.sms).not.toMatch(/\bHIV\b|lawyer/);
  });
});
