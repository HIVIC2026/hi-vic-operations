// Decisions 214/215 (Jo 24 Oct 2026): "Couldn't get in?" on install days — pure decision, owner notice drafts, office alert rule.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { COULDNT_GET_IN, couldntGetInBlocker, couldntGetInMessage, couldntGetInPlan } from "../src/lib/trade-view.core";
import { installDayTurn } from "../src/lib/install-days.core";
import { INSTALL_NO_ACCESS_NOTICE_APPROVED, INSTALL_NO_ACCESS_SMS_TYPE, installNoAccessAlertsOffice, installNoAccessKeys, installNoAccessText, renderInstallNoAccessEmail } from "../src/lib/install-no-access-notice.core";
import { SMS_FRESHNESS, SMS_MESSAGE_TYPES, smsBlocker } from "../src/lib/sms.core";

const now = new Date("2026-10-26T23:00:00Z"); // Tue 27 Oct 10am Melbourne

describe("decision 214 — couldn't get in on an install day", () => {
  test("same reasons list; a booked install day today or earlier is reportable, a future one is not", () => {
    expect(COULDNT_GET_IN).toEqual(["No one home", "Couldn't reach the manhole", "Not safe to go up", "Something else"]);
    expect(couldntGetInPlan({ stage: "installation_booked", readyCheckStart: null, installStart: "2026-10-26T21:00:00Z", now })).toEqual({ visit: "install" });
    expect(couldntGetInPlan({ stage: "installation_booked", readyCheckStart: null, installStart: "2026-10-28T21:00:00Z", now })).toEqual({ blocker: "You can only report this on or after the install day." });
    expect(couldntGetInPlan({ stage: "installation_booked", readyCheckStart: null, installStart: null, now })).toEqual({ blocker: "There's no booked install day to report." });
  });
  test("Ready Check rule unchanged; other stages refused", () => {
    expect(couldntGetInPlan({ stage: "ready_check_scheduled", readyCheckStart: "2026-10-26T21:00:00Z", installStart: null, now })).toEqual({ visit: "ready_check" });
    expect(couldntGetInPlan({ stage: "installation_scheduling", readyCheckStart: null, installStart: null, now })).toEqual({ blocker: "This job doesn't have a booked Ready Check or install day." });
    expect(couldntGetInBlocker("installation_booked", "2026-10-26T21:00:00Z", now)).toMatch(/booked Ready Check/); // legacy helper untouched
  });
  test("after the report the install booking is back to 'offer 3 install days' by installDayTurn (30-day rule untouched)", () => {
    // Booking cancelled + stage back to installation_scheduling (changeInstallDay) → ready, not booked → installer_to_offer.
    expect(installDayTurn({ ready: true, booked: false, expired: false, rows: [], now }).turn).toBe("installer_to_offer");
    expect(installDayTurn({ ready: true, booked: false, expired: true, rows: [], now }).turn).toBe("expired");
    const server = readFileSync("src/lib/trade-view.server.ts", "utf8");
    expect(server).toContain('changeInstallDay(jobId, userId, "installer", { couldntGetIn: reason })');
    expect(readFileSync("src/lib/install-days.server.ts", "utf8")).toContain("if (!opts.couldntGetIn && c.bookedAt && Date.parse(c.bookedAt) <= Date.now())");
    expect(readFileSync("src/lib/thirty-day-rule.core.ts", "utf8")).not.toContain("couldntGetIn"); // decision 158 payer logic not touched
  });
  test("messages per visit", () => {
    expect(couldntGetInMessage("No one home")).toBe("Thanks for letting us know. No one home. We'll rebook with the owner and offer it back to you first.");
    expect(couldntGetInMessage("No one home", "install")).toContain("Offer the owner 3 new install days");
  });
  test("day page offers the row on install days too", () => {
    expect(readFileSync("src/routes/_authenticated/field.day.$jobId.tsx", "utf8")).toContain('(data.kind === "ready_check" || data.kind === "install") && <LinkRow');
  });
});

describe("decision 215 — owner told at once; office alerted on the second no-access only", () => {
  const f = { firstName: "Helen", installerName: "Reinsulate", day: "Tuesday 27 October", newDays: [], installBy: "21 November", link: "https://estimate.homeinsulationvictoria.com.au/my-job/abc" };
  test("office alert rule", () => {
    expect(installNoAccessAlertsOffice(0)).toBe(false);
    expect(installNoAccessAlertsOffice(1)).toBe(true);
    expect(installNoAccessAlertsOffice(3)).toBe(true);
    const server = readFileSync("src/lib/trade-view.server.ts", "utf8");
    expect(server).toContain("needs_office: alertOffice");
  });
  test("DRAFT text: nobody charged, new days or 'will send', STOP last, under 2 segments", () => {
    const t = installNoAccessText(f);
    expect(t).toBe("Hi Helen, we couldn't get in today for your insulation install. You're not charged anything. Reinsulate will send you new days shortly – see your job: https://estimate.homeinsulationvictoria.com.au/my-job/abc Reply STOP to opt out.");
    expect(installNoAccessText({ ...f, newDays: [{ day: "Thu 29 Oct", time: "8am" }, { day: "Fri 30 Oct", time: "8am" }, { day: "Mon 2 Nov", time: "8am" }] })).toContain("has offered 3 new days – pick one here");
    expect(t.length).toBeLessThan(306);
  });
  test("DRAFT email O65: not charged, end date of the 30-day window, days when offered, otherwise 'will send'", () => {
    const e = renderInstallNoAccessEmail(f);
    expect(e.subject).toBe("Helen, we couldn't get in today");
    expect(e.text).toContain("nothing is charged for today");
    expect(e.text).toContain("by 21 November");
    expect(e.text).toContain("will send you three new days shortly");
    const d = renderInstallNoAccessEmail({ ...f, newDays: [{ day: "Thursday 29 October", time: "8am", href: f.link }] });
    expect(d.text).toContain("PICK A NEW INSTALL DAY");
    expect(d.html).toContain("Thursday 29 October");
    expect(renderInstallNoAccessEmail({ ...f, installBy: null }).text).toContain("within 30 days of your safety check");
  });
  test("both held until Jo approves: email flag off, SMS type unapproved (never sends), behind customer_comms_enabled", () => {
    expect(INSTALL_NO_ACCESS_NOTICE_APPROVED).toBe(false);
    expect(SMS_MESSAGE_TYPES[INSTALL_NO_ACCESS_SMS_TYPE as keyof typeof SMS_MESSAGE_TYPES]).toMatchObject({ audience: "owner", wordingApproved: false, quietHours: true });
    expect(SMS_FRESHNESS[INSTALL_NO_ACCESS_SMS_TYPE as keyof typeof SMS_FRESHNESS]).toEqual({ kind: "event", maxAgeMinutes: 24 * 60 });
    expect(smsBlocker({ type: INSTALL_NO_ACCESS_SMS_TYPE, to: "0400000000", commsEnabled: true, typeSwitchOn: true, senderConfigured: true, optedOut: false, consent: true, isTestRecord: false, nowIso: "2026-10-27T00:00:00Z" })).toBe("Wording not approved yet");
    const server = readFileSync("src/lib/install-no-access-notice.server.ts", "utf8");
    expect(server).toContain("sendGuardedOwnerEmail");
    expect(server).toContain("sendRealSms");
    expect(server).toContain("assertCustomerDeliveryAllowed");
    expect(installNoAccessKeys("b1")).toEqual({ email: "install-no-access:v1:b1:email", sms: "install-no-access:v1:b1:sms" });
  });
  test("draft design is filed", () => {
    const html = readFileSync("docs/templates/drafts/O65-install-no-access.html", "utf8");
    expect(html).toContain("couldn't get in today");
    expect(html).toContain("DRAFT");
  });
});
