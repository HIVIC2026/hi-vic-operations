import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { installerJobOfferBlocker, installerReadyCheckAction, ownBookingBlocker } from "../src/lib/installer-ready-check.core";
import { planQuotedAnswer } from "../src/lib/bulk-import.core";

const base = { channel: "installer_sourced", stage: "ready_check_ready_to_schedule", quoted: "no" as const, attended: "no" as "yes" | "no" | null, booked: false };
describe("Ready Check for unquoted installer customers (Jo, 7 Oct 6pm)", () => {
  test("Not attended + waiting for a Ready Check = Book a Ready Check", () => {
    expect(installerReadyCheckAction(base)).toBe("book");
    expect(installerReadyCheckAction({ ...base, stage: "ready_check_scheduled" })).toBe("booked");
  });
  test("not shown for quoted/blank answers, HIV jobs, or jobs already visited", () => {
    // Attendance drives the visit (Jo 20 Oct): quoted but not visited STILL needs it; visited never repeats it;
    // unknown attendance is asked, never assumed.
    expect(installerReadyCheckAction({ ...base, quoted: "yes" as never, attended: "no" })).toBe("book");
    expect(installerReadyCheckAction({ ...base, quoted: "no", attended: "yes" })).toBe("none");
    expect(installerReadyCheckAction({ ...base, quoted: null as never, attended: null })).toBe("confirm_attendance");
    expect(installerReadyCheckAction({ ...base, attended: null, onsiteDone: true })).toBe("none");
    expect(installerReadyCheckAction({ ...base, channel: "hivic_sourced" })).toBe("none");
    expect(installerReadyCheckAction({ ...base, attended: "no", stage: "ready_check_complete" })).toBe("none");
  });
  test("an installer-supplied customer is never offered to another trade", () => {
    const job = { channel: "installer_sourced", originating_installer_business_id: "A" };
    expect(installerJobOfferBlocker(job, "A")).toBeNull();
    expect(installerJobOfferBlocker(job, "B")).toMatch(/another installer/);
    expect(installerJobOfferBlocker({ ...job, originating_installer_business_id: null }, "A")).toMatch(/another installer/);
    expect(installerJobOfferBlocker({ channel: "hivic_sourced", originating_installer_business_id: null }, "B")).toBeNull();
  });
  test("own booking needs a future time", () => {
    const now = new Date("2026-10-07T00:00:00Z");
    expect(ownBookingBlocker("2026-10-06T00:00:00Z", now)).toMatch(/passed/);
    expect(ownBookingBlocker("nope", now)).toMatch(/Enter/);
    expect(ownBookingBlocker("2026-10-09T23:00:00Z", now)).toBeNull();
  });
  test("decision 180: the owner 'choose 3-5 times' email, its link and the waiting/pick states are gone", () => {
    const core = readFileSync("src/lib/installer-ready-check.core.ts", "utf8");
    const server = readFileSync("src/lib/installer-ready-check.server.ts", "utf8");
    for (const gone of ["renderRcTimesEmail", "RC_TIMES_EMAIL_APPROVED", "WAITING_FOR_OWNER_TIMES", "OWNER_TIMES_READY", "ready_check_times", "choose 3 to 5 times", "waiting_for_owner", "pick_owner_time"]) {
      expect(core).not.toContain(gone); expect(server).not.toContain(gone);
    }
    expect(server).not.toMatch(/sendTestEmail|customer_estimate_links|\/times\//);
    expect(existsSync("src/routes/times.$token.tsx")).toBe(false);
  });
  test("No can become Yes with an exact price after the Ready Check; Yes is final", () => {
    expect(planQuotedAnswer("no", "yes", 3187.55, "Ready Check booked")).toEqual({ patch: { installer_quoted: "yes", installer_quoted_price_inc_gst: 3187.55, next_action: "Ready Check booked" } });
    expect(planQuotedAnswer("no", "no", null, null)).toEqual({ error: "You've already answered this." });
    expect(planQuotedAnswer("yes", "yes", 1, null)).toEqual({ error: "You've already answered this." });
  });
});
