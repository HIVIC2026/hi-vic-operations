// Jo 24 Oct 2026 (decisions 49–53): our-lead Ready Check — office picks one installer, the installer offers 3 times,
// owner takes one or suggests days, back and forth. Pure rules.
import { describe, expect, test } from "bun:test";
import {
  READY_CHECK_OFFER_OPEN_HOURS, READY_CHECK_TIMES, allowedReadyCheckDays, allowedReadyCheckTimes, installerTimesBlockers, ownerDaysBlockers,
  readyCheckOfferExpiry, readyCheckOfferOverdue, readyCheckOfferStartBlockers, readyCheckOfficeItem, readyCheckOfferText, readyCheckStartAt, readyCheckTurn,
  a1ReadyCheckEntryAllowed, a1ReadyCheckTimeBlockers,
} from "../src/lib/ready-check-times.core";
import { isBusinessDay, melbourneYmd } from "../src/lib/piesa-windows.core";

const NOW = new Date("2026-10-26T00:00:00Z"); // Mon 26 Oct, 11am Melbourne

describe("days and times", () => {
  test("business days only, at least 24 hours away, within 21 days", () => {
    const d = allowedReadyCheckDays(NOW);
    expect(d.length).toBeGreaterThan(10);
    expect(d.every(isBusinessDay)).toBe(true);
    expect(d).not.toContain("2026-10-26"); // today
    expect(d[0]).toBe("2026-10-27"); // tomorrow still has times 24h+ away (from 11am)
    expect(d.at(-1)! <= "2026-11-16").toBe(true);
  });
  test("tomorrow only offers times 24h+ away", () => {
    const t = allowedReadyCheckTimes("2026-10-27", NOW);
    expect(t[0]).toBe("11:00");
    expect(allowedReadyCheckTimes("2026-10-28", NOW)).toEqual([...READY_CHECK_TIMES]);
  });
  test("exact Melbourne instant for a day + time", () => {
    expect(readyCheckStartAt("2026-10-28", "07:30").toISOString()).toBe("2026-10-27T20:30:00.000Z"); // AEDT
  });
});

describe("installer offers 3 times", () => {
  const ok = [{ day: "2026-10-28", time: "08:00" }, { day: "2026-10-29", time: "13:30" }, { day: "2026-10-30", time: "07:00" }];
  test("3 times on 3 different days = fine", () => expect(installerTimesBlockers(ok, NOW)).toEqual([]));
  test("not 3", () => expect(installerTimesBlockers(ok.slice(0, 2), NOW)).toContain("Please choose 3 times."));
  test("same day twice", () => expect(installerTimesBlockers([...ok.slice(0, 2), { day: "2026-10-28", time: "15:00" }], NOW)).toContain("Please choose each time on a different day."));
  test("missing or odd time", () => expect(installerTimesBlockers([...ok.slice(0, 2), { day: "2026-10-30", time: "07:15" }], NOW)).toContain("Please choose a time for each day."));
  test("weekend or past the horizon", () => {
    expect(installerTimesBlockers([...ok.slice(0, 2), { day: "2026-10-31", time: "09:00" }], NOW).join(" ")).toMatch(/no longer available/);
    expect(installerTimesBlockers([...ok.slice(0, 2), { day: "2026-12-30", time: "09:00" }], NOW).join(" ")).toMatch(/no longer available/);
  });
  test("under 24 hours away", () => expect(installerTimesBlockers([...ok.slice(0, 2), { day: "2026-10-27", time: "08:00" }], NOW)).toContain("Each time must be at least 24 hours away."));
});

describe("owner suggests days", () => {
  test("1–5 unique allowed days", () => {
    expect(ownerDaysBlockers(["2026-10-28"], NOW)).toEqual([]);
    expect(ownerDaysBlockers([], NOW).join(" ")).toMatch(/at least 1/);
    expect(ownerDaysBlockers(["2026-10-28", "2026-10-29", "2026-10-30", "2026-11-02", "2026-11-04", "2026-11-05"], NOW).join(" ")).toMatch(/no more than 5/);
    expect(ownerDaysBlockers(["2026-10-28", "2026-10-28"], NOW).join(" ")).toMatch(/only be chosen once/);
    expect(ownerDaysBlockers(["2026-11-01"], NOW).join(" ")).toMatch(/no longer available/);
  });
});

describe("back and forth (whose move)", () => {
  const at = (d: string) => `${d}T00:00:00.000Z`;
  const row = (id: string, by: string, d: string, status = "proposed") => ({ id, proposer_role: by, status, starts_at: at(d) });
  test("no installer yet", () => expect(readyCheckTurn({ booked: false, hasInstaller: false, rows: [], now: NOW }).turn).toBe("no_installer"));
  test("installer's 3 times open → owner's move", () => {
    const r = readyCheckTurn({ booked: false, hasInstaller: true, rows: [row("a", "installer", "2026-10-28"), row("b", "installer", "2026-10-29"), row("c", "installer", "2026-10-30")], now: NOW });
    expect(r.turn).toBe("owner_to_answer");
    expect(r.open.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });
  test("owner suggested days → installer's move", () => {
    const r = readyCheckTurn({ booked: false, hasInstaller: true, rows: [row("a", "installer", "2026-10-28", "superseded"), row("o", "owner", "2026-11-02")], now: NOW });
    expect(r.turn).toBe("installer_to_answer");
    expect(r.open.map((x) => x.id)).toEqual(["o"]);
  });
  test("every time passed → installer offers again", () => expect(readyCheckTurn({ booked: false, hasInstaller: true, rows: [row("a", "installer", "2026-10-20")], now: NOW }).turn).toBe("installer_to_offer"));
  test("booked wins", () => expect(readyCheckTurn({ booked: true, hasInstaller: true, rows: [row("a", "installer", "2026-10-28")], now: NOW }).turn).toBe("booked"));
});

describe("offer: office picks one installer, open 24 hours", () => {
  const base = { channel: "hivic_sourced", stage: "ready_check_ready_to_schedule", deleted: false, hasInstaller: false, openOffers: 0, picks: 1 };
  test("our lead, waiting, nobody assigned, one pick = fine", () => expect(readyCheckOfferStartBlockers(base)).toEqual([]));
  test("never to several installers at once", () => expect(readyCheckOfferStartBlockers({ ...base, picks: 3 })).toContain("Choose one installer."));
  test("installer's own customers are never offered", () => expect(readyCheckOfferStartBlockers({ ...base, channel: "installer_sourced" }).join(" ")).toMatch(/directly/));
  test("one open offer at a time; deleted and assigned jobs refused", () => {
    expect(readyCheckOfferStartBlockers({ ...base, openOffers: 1 })).toContain("A Ready Check offer is already open.");
    expect(readyCheckOfferStartBlockers({ ...base, deleted: true })).toContain("This job has been deleted.");
    expect(readyCheckOfferStartBlockers({ ...base, hasInstaller: true })).toContain("An installer is already assigned.");
  });
  test("24 hours", () => {
    expect(READY_CHECK_OFFER_OPEN_HOURS).toBe(24);
    expect(readyCheckOfferExpiry(NOW)).toBe("2026-10-27T00:00:00.000Z");
    expect(readyCheckOfferOverdue({ offered_at: NOW.toISOString(), expires_at: readyCheckOfferExpiry(NOW) }, new Date("2026-10-26T23:59:00Z"))).toBe(false);
    expect(readyCheckOfferOverdue({ offered_at: NOW.toISOString(), expires_at: readyCheckOfferExpiry(NOW) }, new Date("2026-10-27T00:00:00Z"))).toBe(true);
    // offers made before 24 Oct with a longer expiry still close at 24 hours
    expect(readyCheckOfferOverdue({ offered_at: NOW.toISOString(), expires_at: "2026-10-30T00:00:00Z" }, new Date("2026-10-27T01:00:00Z"))).toBe(true);
  });
});

describe("one office item per job", () => {
  const f = { channel: "hivic_sourced", stage: "ready_check_ready_to_schedule", hasInstaller: false };
  const o = (status: string, at: string, business_name: string | null = "TEST Alpha") => ({ status, offered_at: at, business_name });
  test("nothing sent yet → choose installer", () => expect(readyCheckOfficeItem({ ...f, offers: [] })).toEqual({ code: "choose_installer" }));
  test("offer open → nothing", () => expect(readyCheckOfficeItem({ ...f, offers: [o("pending", "2026-10-26T00:00:00Z")] })).toBeNull());
  test("Not for me → back to the office once", () => expect(readyCheckOfficeItem({ ...f, offers: [o("declined", "2026-10-26T00:00:00Z")] })).toEqual({ code: "offer_returned", status: "declined", name: "TEST Alpha" }));
  test("24 hours passed → back to the office", () => expect(readyCheckOfficeItem({ ...f, offers: [o("declined", "2026-10-25T00:00:00Z", "A"), o("expired", "2026-10-26T00:00:00Z", "B")] })).toEqual({ code: "offer_returned", status: "expired", name: "B" }));
  test("new offer after a return → nothing", () => expect(readyCheckOfficeItem({ ...f, offers: [o("declined", "2026-10-25T00:00:00Z"), o("pending", "2026-10-26T00:00:00Z")] })).toBeNull());
  test("installer's own customers, other stages, or assigned → nothing", () => {
    expect(readyCheckOfficeItem({ ...f, channel: "installer_sourced", offers: [] })).toBeNull();
    expect(readyCheckOfficeItem({ ...f, stage: "ready_check_scheduled", offers: [] })).toBeNull();
    expect(readyCheckOfficeItem({ ...f, hasInstaller: true, offers: [] })).toBeNull();
  });
});

test("installer text: short, suburb, link straight to the offer (draft wording)", () => {
  // Decision 76 wording, switched on by decision 154 (Jo 24 Oct 2026). No STOP line: partner job texts don't carry one.
  expect(readyCheckOfferText("Frankston", "https://x/field/offer/1", 120)).toBe("Home Insulation Victoria: New Ready Check job near Frankston (about 120 m²). Offer the owner 3 times within 24 hours to take it: https://x/field/offer/1");
  expect(readyCheckOfferText("Frankston", "u")).toBe("Home Insulation Victoria: New Ready Check job near Frankston. Offer the owner 3 times within 24 hours to take it: u");
  expect(readyCheckOfferText(null, "u")).toContain("near you");
  expect(readyCheckOfferText(null, "u", 0)).not.toContain("about");
});

test("melbourne date sanity for the fixed clock", () => expect(melbourneYmd(NOW)).toBe("2026-10-26"));

describe("A1 Ready Check day + time entered by the installer (decision 110)", () => {
  test("only the installer's own customers while waiting for a Ready Check booking", () => {
    expect(a1ReadyCheckEntryAllowed({ channel: "installer_sourced", stage: "ready_check_ready_to_schedule" })).toBe(true);
    expect(a1ReadyCheckEntryAllowed({ channel: "hivic_sourced", stage: "ready_check_ready_to_schedule" })).toBe(false);
    expect(a1ReadyCheckEntryAllowed({ channel: "installer_sourced", stage: "ready_check_scheduled" })).toBe(false);
  });
  test("same rules as our-lead offers: exact time, business day, 24h+ ahead, within 21 days", () => {
    const days = allowedReadyCheckDays(NOW);
    expect(a1ReadyCheckTimeBlockers({ day: days[1]!, time: "09:30" }, NOW)).toEqual([]);
    expect(a1ReadyCheckTimeBlockers({ day: days[1]!, time: "09:15" }, NOW)).toEqual(["Please choose a time."]);
    expect(a1ReadyCheckTimeBlockers({ day: "2026-10-31", time: "09:00" }, NOW)).toEqual(["That day is not available. Please choose again."]); // Saturday
    expect(a1ReadyCheckTimeBlockers({ day: "2026-10-27", time: "07:00" }, NOW)).toEqual(["The time must be at least 24 hours away."]); // tomorrow 7am < 24h from 11am
    expect(a1ReadyCheckTimeBlockers({ day: "2026-12-01", time: "09:00" }, NOW)).toEqual(["That day is not available. Please choose again."]); // past 21 days
  });
  test("server: saved through confirmBooking as the ready_check booking the 6:30am text reads; nothing to the owner", () => {
    const src = require("node:fs").readFileSync(new URL("../src/lib/trade-view.server.ts", import.meta.url), "utf8") as string;
    const fn = src.slice(src.indexOf("export async function tradeSetReadyCheckTime"), src.indexOf("export async function setMittiInvited"));
    expect(fn).toContain('confirmBooking(jobId, "ready_check"');
    expect(fn).toContain("originating_installer_business_id !== c.biz.id");
    expect(fn).toContain("a1ReadyCheckTimeBlockers(pick, now)");
    expect(fn).not.toMatch(/sendTestEmail|sendRealSms|sendOfficeEmail|sendGuardedOwnerEmail|tellOwner/);
  });
});
