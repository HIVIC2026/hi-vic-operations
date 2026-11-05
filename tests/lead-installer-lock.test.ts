// Deep Part 5a (Jo 4–5 Nov 2026): the Lead Installer and the install day lock TWO DAYS before the install start —
// same time of day, two calendar days earlier, Melbourne wall-clock (DST-safe). The reminder clock (3 days before) and
// the red Needs me flag (2 days before = the lock) hang off the same rule. Every installer business, own customers and
// Home Insulation Victoria leads alike. ONE rule in lead-installer-lock.core, re-exported by prestart.core.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as lockCore from "../src/lib/lead-installer-lock.core";
import * as prestartCore from "../src/lib/prestart.core";
import { LEAD_LOCKED_MESSAGE, LEAD_LOCK_DAYS_BEFORE, LEAD_REMINDER_DAYS_BEFORE, leadInstallerLock, leadInstallerLocked } from "../src/lib/prestart.core";
import { leadLockBlocker } from "../src/lib/visit-allocation.core";

const START = "2026-11-12T20:30:00Z"; // Fri 13 Nov 2026 7:30am Melbourne (AEDT, UTC+11)
const at = (iso: string) => new Date(iso);
// Wed 11 Nov 7:29am AEDT = 20:29Z Tue 10 Nov; 7:30am = 20:30Z.
const WED_0729 = "2026-11-10T20:29:00Z", WED_0730 = "2026-11-10T20:30:00Z", WED_1700 = "2026-11-11T06:00:00Z";

describe("the ONE Lead Installer lock: 2 days before the install start, Melbourne wall-clock", () => {
  test("Fri 13 Nov 7:30am install → reminder Tue 10 Nov 7:30am, lock Wed 11 Nov 7:30am, label 'Wed 11 Nov, 7:30am'", () => {
    expect(LEAD_LOCK_DAYS_BEFORE).toBe(2);
    expect(LEAD_REMINDER_DAYS_BEFORE).toBe(3);
    expect(leadInstallerLock(START)).toEqual({ reminderAt: "2026-11-09T20:30:00.000Z", lockAt: "2026-11-10T20:30:00.000Z", lockLabel: "Wed 11 Nov, 7:30am" });
  });
  test("locked from the instant, not a second before; a completed install is never locked", () => {
    expect(leadInstallerLocked(START, at(WED_0729))).toBe(false);
    expect(leadInstallerLocked(START, at(WED_0730))).toBe(true);
    expect(leadInstallerLocked(START, at(WED_1700))).toBe(true);
    expect(leadInstallerLocked(START, at(WED_1700), { installCompleted: true })).toBe(false);
  });
  test("the approved line names Home Insulation Victoria and the Lead Installer in full", () => {
    expect(LEAD_LOCKED_MESSAGE).toBe("Locked — call Home Insulation Victoria to change the Lead Installer or the day");
  });
  test("DST (AEST → AEDT, Sun 4 Oct 2026 2am): Mon 5 Oct 8am AEDT install locks Sat 3 Oct 8am AEST (same wall-clock, 49 real hours)", () => {
    const start = "2026-10-04T21:00:00Z"; // Mon 5 Oct 8:00am AEDT
    const l = leadInstallerLock(start);
    expect(l.lockAt).toBe("2026-10-02T22:00:00.000Z"); // Sat 3 Oct 8:00am AEST (UTC+10)
    expect(l.reminderAt).toBe("2026-10-01T22:00:00.000Z"); // Fri 2 Oct 8:00am AEST
    expect(l.lockLabel).toBe("Sat 3 Oct, 8am");
  });
  test("DST (AEDT → AEST, Sun 5 Apr 2026 3am): Tue 7 Apr 7:30am AEST install locks Sun 5 Apr 7:30am AEST; reminder Sat 4 Apr 7:30am AEDT", () => {
    const start = "2026-04-06T21:30:00Z"; // Tue 7 Apr 7:30am AEST (UTC+10)
    const l = leadInstallerLock(start);
    expect(l.lockAt).toBe("2026-04-04T21:30:00.000Z"); // Sun 5 Apr 7:30am AEST (after the 3am change)
    expect(l.reminderAt).toBe("2026-04-03T20:30:00.000Z"); // Sat 4 Apr 7:30am AEDT (UTC+11)
    expect(l.lockLabel).toBe("Sun 5 Apr, 7:30am");
  });
  test("whole-hour and half-hour labels", () => {
    expect(leadInstallerLock("2026-11-12T22:00:00Z").lockLabel).toBe("Wed 11 Nov, 9am");
    expect(leadInstallerLock("2026-11-13T02:15:00Z").lockLabel).toBe("Wed 11 Nov, 1:15pm");
  });
  test("same names everywhere; Parts import the clock, nobody re-implements it", () => {
    expect(prestartCore.leadInstallerLock).toBe(lockCore.leadInstallerLock);
    expect(prestartCore.leadInstallerLocked).toBe(lockCore.leadInstallerLocked);
    expect(prestartCore.LEAD_LOCKED_MESSAGE).toBe(lockCore.LEAD_LOCKED_MESSAGE);
    for (const f of ["src/lib/next-step-box.core.ts", "src/lib/lead-installer-reminder.core.ts", "src/lib/lead-installer-confirm.server.ts", "src/lib/visit-allocation.core.ts"]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).toMatch(/from "\.\/(prestart|lead-installer-lock)\.core"/);
      expect(src, f).not.toMatch(/17 \* 3600|- 7 \* 3600_000|48 \* 3600/);
    }
  });
});

describe("leadLockBlocker (the crew writers' rule)", () => {
  test("after the lock a different Lead is refused; same Lead, first Lead, crew-only and no booking pass", () => {
    expect(leadLockBlocker({ startIso: START, now: at(WED_0730), currentLeadId: "w1", newLeadId: "w2" })).toBe(LEAD_LOCKED_MESSAGE);
    expect(leadLockBlocker({ startIso: START, now: at(WED_0729), currentLeadId: "w1", newLeadId: "w2" })).toBeNull();
    expect(leadLockBlocker({ startIso: START, now: at(WED_0730), currentLeadId: "w1", newLeadId: "w1" })).toBeNull();
    expect(leadLockBlocker({ startIso: START, now: at(WED_0730), currentLeadId: null, newLeadId: "w2" })).toBeNull();
    expect(leadLockBlocker({ startIso: START, now: at(WED_0730), currentLeadId: "w1", newLeadId: null })).toBeNull();
    expect(leadLockBlocker({ startIso: null, now: at(WED_0730), currentLeadId: "w1", newLeadId: "w2" })).toBeNull();
  });
});
