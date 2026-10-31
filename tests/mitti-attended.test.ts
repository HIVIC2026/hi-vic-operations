// A finished Mitti Ready Check on an installer-added job means the installer attended: Attended = Yes.
import { describe, expect, test } from "bun:test";
import { mittiAttendedPatch } from "../src/lib/mitti-attended.core";

const base = { channel: "installer_sourced", siteCheck: "no" as string | null, completed: true, modifiedAt: "2026-10-27T21:17:53.631Z" as string | null, alreadyRecorded: false };

describe("mittiAttendedPatch", () => {
  test("installer job, completed, not yet yes: Yes with the Melbourne date", () =>
    expect(mittiAttendedPatch(base)).toEqual({ installer_site_check: "yes", installer_site_check_date: "2026-10-28" }));
  test("an unset answer counts as not yes", () => expect(mittiAttendedPatch({ ...base, siteCheck: null })).not.toBeNull());
  test("our own lead (hivic_sourced): untouched", () => expect(mittiAttendedPatch({ ...base, channel: "hivic_sourced" })).toBeNull());
  test("not completed: untouched", () => expect(mittiAttendedPatch({ ...base, completed: false })).toBeNull());
  test("already yes: untouched", () => expect(mittiAttendedPatch({ ...base, siteCheck: "yes" })).toBeNull());
  test("already recorded once: never again (a hand-set No stays No)", () => expect(mittiAttendedPatch({ ...base, alreadyRecorded: true })).toBeNull());
  test("no or bad finish time: Yes, no date", () => {
    expect(mittiAttendedPatch({ ...base, modifiedAt: null })).toEqual({ installer_site_check: "yes", installer_site_check_date: null });
    expect(mittiAttendedPatch({ ...base, modifiedAt: "bad" })).toEqual({ installer_site_check: "yes", installer_site_check_date: null });
  });
});
