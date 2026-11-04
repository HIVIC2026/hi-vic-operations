// G8 (4), Jo 4 Nov 2026: the all-set screen shows the next booked visit; ?screen=piesa before a safety check and an old
// ?screen=turn link while the taps are live land on the job's current screen; the owner's Ready Check window message is a
// DRAFT behind OWNER_WINDOW_CONFIRM_APPROVED. Pure.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { NEXT_VISIT_WORDS, nextVisitCard, resolveOwnerScreen, visitWhen } from "../src/lib/owner-myjob.core";
import { OWNER_WINDOW_CONFIRM_APPROVED, READY_CHECK_WINDOW_SMS_TYPE, readyCheckWindowEmail, readyCheckWindowText } from "../src/lib/ready-check-window-notice.core";
import { SMS_FRESHNESS, SMS_MESSAGE_TYPES } from "../src/lib/sms.core";

// Mon 9 Nov 2026 8:00am and Tue 10 Nov 10:00am Melbourne (AEDT, UTC+11).
const INSTALL = "2026-11-08T21:00:00Z";
const PIESA = "2026-11-09T23:00:00Z";

describe("nextVisitCard", () => {
  test("Melbourne day and time", () => {
    expect(visitWhen(INSTALL)).toBe("Mon 9 Nov, 8:00am");
    expect(visitWhen(PIESA)).toBe("Tue 10 Nov, 10:00am");
  });
  test("the safety check names the electrician and their business", () => {
    expect(nextVisitCard({ kind: "assessment", startsAt: PIESA, person: "Will", company: "Rapid Insulation" })).toEqual({ title: NEXT_VISIT_WORDS.assessment, line: "Tue 10 Nov, 10:00am — Will from Rapid Insulation", note: null });
    expect(nextVisitCard({ kind: "assessment", startsAt: PIESA, person: null, company: "Rapid Insulation" })?.line).toBe("Tue 10 Nov, 10:00am — Rapid Insulation");
    expect(nextVisitCard({ kind: "assessment", startsAt: PIESA, person: "Your electrician", company: null })?.line).toBe("Tue 10 Nov, 10:00am"); // never a placeholder name
  });
  test("the install names the business and says someone 18 or over must be home", () => {
    expect(nextVisitCard({ kind: "installation", startsAt: INSTALL, person: "Dan", company: "Rapid Insulation" })).toEqual({ title: "Your insulation install", line: "Mon 9 Nov, 8:00am — Rapid Insulation", note: "Someone 18 or over needs to be home." });
    expect(nextVisitCard({ kind: "ready_check", startsAt: INSTALL, person: null, company: "Rapid Insulation" })?.title).toBe("Your Ready Check");
    expect(nextVisitCard({ kind: "rectification", startsAt: PIESA, person: "Will", company: "Volt Co" })?.line).toBe("Tue 10 Nov, 10:00am — Will from Volt Co");
  });
  test("no day or an unnamed kind → nothing", () => {
    expect(nextVisitCard({ kind: "installation", startsAt: null, person: null, company: "X" })).toBeNull();
    expect(nextVisitCard({ kind: "installation", startsAt: "nope", person: null, company: "X" })).toBeNull();
    expect(nextVisitCard({ kind: "site_visit", startsAt: INSTALL, person: null, company: "X" })).toBeNull();
  });
  test("the all-set screen renders it (route wiring)", () => {
    const src = readFileSync("src/routes/my-job.$token.tsx", "utf8");
    expect(src).toContain("data-testid=\"owner-next-visit\"");
    expect(src).toContain("readyCheckWindow) return <><Back token={token} /><OwnerRunTime token={token} /></>");
  });
});

describe("resolveOwnerScreen (G8 fixes 8 and 13)", () => {
  test("?screen=piesa before a safety check → the current screen, never blank", () => {
    expect(resolveOwnerScreen("piesa", { currentAction: "book", piesaConfirm: false })).toBe("book");
    expect(resolveOwnerScreen("piesa", { currentAction: null, piesaConfirm: false })).toBe("all_set");
    expect(resolveOwnerScreen("piesa", { currentAction: "piesa", piesaConfirm: true })).toBe("piesa");
    expect(resolveOwnerScreen("piesa", { currentAction: null, piesaConfirm: true })).toBe("piesa"); // a confirmed check still shows
  });
  test("?screen=turn while the taps are the live step → the taps; otherwise the turn page", () => {
    expect(resolveOwnerScreen("turn", { currentAction: "taps" })).toBe("taps");
    expect(resolveOwnerScreen("turn", { currentAction: "turn" })).toBe("turn");
    expect(resolveOwnerScreen("turn", { currentAction: null })).toBe("turn");
  });
});

describe("the owner's Ready Check window message (DRAFT)", () => {
  const f = { name: "Harriet Journey", day: "Tuesday 10 November", time: "between 9:00 and 10:00am", installer: "Rapid Insulation", link: "https://estimate.homeinsulationvictoria.com.au/my-job/T?screen=book", team: false };
  test("ships off; its text type is an unapproved owner text with quiet hours and a window key", () => {
    expect(OWNER_WINDOW_CONFIRM_APPROVED).toBe(false);
    const t = SMS_MESSAGE_TYPES[READY_CHECK_WINDOW_SMS_TYPE];
    expect({ audience: t.audience, approved: t.wordingApproved, quiet: t.quietHours }).toEqual({ audience: "owner", approved: false, quiet: true });
    expect(SMS_FRESHNESS[READY_CHECK_WINDOW_SMS_TYPE]).toEqual({ kind: "window" });
  });
  test("text and email carry the day, the window, the installer and the link", () => {
    expect(readyCheckWindowText(f)).toBe("Hi Harriet, your free Ready Check is Tuesday 10 November between 9:00 and 10:00am with Rapid Insulation. Tap to confirm or pick another time: https://estimate.homeinsulationvictoria.com.au/my-job/T?screen=book - Home Insulation Victoria");
    expect(readyCheckWindowText({ ...f, team: true })).toContain("Tap to confirm: ");
    const m = readyCheckWindowEmail(f);
    expect(m.subject).toBe("Your free Ready Check: Tuesday 10 November");
    for (const s of ["Rapid Insulation can do your free Ready Check Tuesday 10 November between 9:00 and 10:00am.", f.link]) { expect(m.text).toContain(s); expect(m.html).toContain(s.replace(/&/g, "&amp;")); }
    expect(m.html).toContain("Confirm my Ready Check");
  });
  test("the sender uses the new type and the flag (wiring)", () => {
    const src = readFileSync("src/lib/installer-run.server.ts", "utf8");
    expect(src).toContain("READY_CHECK_WINDOW_SMS_TYPE : RUN_TIME_REMINDER_SMS_TYPE");
    expect(src).toContain("off(READY_CHECK_WINDOW_SMS_TYPE, OWNER_WINDOW_CONFIRM_APPROVED)");
    expect(src).toContain("async function emailSlot(");
  });
});
