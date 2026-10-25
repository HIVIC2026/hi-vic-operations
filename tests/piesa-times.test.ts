// Decision 333 (Jo, 25 Oct 2026): safety check (PIESA) times work like install days — the electrician offers 3 times,
// the owner taps one or suggests 1–5 days, back and forth; the 30-day tick sits on the owner's pick. Pure rules + source
// pins (old jobs still finish the old way; O26 on offer; confirmBooking kind assessment on agreement).
// Run: bun test tests/piesa-times.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  OWNER_DAY_ANCHOR_TIME, PIESA_OFFER_TIMES, PIESA_OWNER_SUGGEST_MAX, PIESA_TIMES, PIESA_TIMES_NEXT_ACTION, PIESA_TIME_NOTE, allowedPiesaTimeDays, allowedPiesaTimes,
  electricianPiesaTimesBlockers, electricianTakeDayBlocker, isPiesaTimeRow, oldOwnerPickerOpen, ownerPiesaDaysBlockers, ownerPiesaMoveBlocker, piesaStartAt, piesaTimeTurn, type PiesaProposalRow,
} from "../src/lib/piesa-times.core";
import { THIRTY_DAY_ACK_REFUSAL } from "../src/lib/thirty-day-ack.core";

// Monday 2 November 2026, 9am Melbourne (AEDT, UTC+11). Tuesday 3 Nov is Melbourne Cup (public holiday).
const NOW = new Date("2026-11-01T22:00:00Z");
const src = (p: string) => readFileSync(p, "utf8");

describe("allowed days and times (24h+ ahead, business days, normal hours, 3-week horizon)", () => {
  const days = allowedPiesaTimeDays(NOW);
  test("business days only, no public holiday, within 21 days", () => {
    expect(days).not.toContain("2026-11-03"); // Melbourne Cup
    expect(days).not.toContain("2026-11-07"); // Saturday
    expect(days.every((d) => d <= "2026-11-23")).toBe(true);
    expect(days).not.toContain("2026-11-02"); // every time today is under 24h away
  });
  test("today's times are all inside 24 hours, so today offers nothing", () => {
    expect(allowedPiesaTimes("2026-11-02", NOW)).toEqual([]);
  });
  test("normal hours: 8am to 3pm arrival", () => {
    expect(PIESA_TIMES[0]).toBe("08:00");
    expect(PIESA_TIMES[PIESA_TIMES.length - 1]).toBe("15:00");
    expect(allowedPiesaTimes("2026-11-04", NOW)).toEqual([...PIESA_TIMES]);
    // Wednesday 4 Nov from Tuesday 2pm: only times from 2pm on are 24h away.
    expect(allowedPiesaTimes("2026-11-04", new Date("2026-11-03T03:00:00Z"))).toEqual(["14:00", "14:30", "15:00"]);
  });
});

// Fix the first-day expectation: the first allowed day is the first business day with a 24h+ time.
test("first allowed day is the next business day with a time 24h away (Wed 4 Nov after the Cup)", () => {
  expect(allowedPiesaTimeDays(NOW)[0]).toBe("2026-11-04");
});

describe("electrician offer: exactly 3 times, 3 different days", () => {
  const ok = [{ day: "2026-11-04", time: "09:00" }, { day: "2026-11-05", time: "10:30" }, { day: "2026-11-06", time: "15:00" }];
  test("a good offer passes", () => {
    expect(PIESA_OFFER_TIMES).toBe(3);
    expect(electricianPiesaTimesBlockers(ok, NOW)).toEqual([]);
  });
  test("wrong count, same day, outside hours, unavailable day, under 24h", () => {
    expect(electricianPiesaTimesBlockers(ok.slice(0, 2), NOW).join(" ")).toMatch(/choose 3 times/);
    expect(electricianPiesaTimesBlockers([ok[0]!, { day: "2026-11-04", time: "11:00" }, ok[2]!], NOW).join(" ")).toMatch(/different day/);
    expect(electricianPiesaTimesBlockers([ok[0]!, ok[1]!, { day: "2026-11-06", time: "16:00" }], NOW).join(" ")).toMatch(/8am and 3pm/);
    expect(electricianPiesaTimesBlockers([ok[0]!, ok[1]!, { day: "2026-11-07", time: "09:00" }], NOW).join(" ")).toMatch(/no longer available/);
    expect(electricianPiesaTimesBlockers([{ day: "2026-11-04", time: "08:00" }, ok[1]!, ok[2]!], new Date("2026-11-03T03:00:00Z")).join(" ")).toMatch(/24 hours/);
  });
  test("taking an owner's day needs a time inside hours and 24h+ away", () => {
    expect(electricianTakeDayBlocker("2026-11-05", "09:00", NOW)).toBeNull();
    expect(electricianTakeDayBlocker("2026-11-05", "17:00", NOW)).toMatch(/8am and 3pm/);
    expect(electricianTakeDayBlocker("2026-11-04", "08:00", new Date("2026-11-03T03:00:00Z"))).toMatch(/24 hours/);
  });
});

describe("owner suggests 1–5 days", () => {
  test("bounds and availability", () => {
    expect(PIESA_OWNER_SUGGEST_MAX).toBe(5);
    expect(ownerPiesaDaysBlockers(["2026-11-04"], NOW)).toEqual([]);
    expect(ownerPiesaDaysBlockers([], NOW).join(" ")).toMatch(/at least 1/);
    expect(ownerPiesaDaysBlockers(["2026-11-04", "2026-11-05", "2026-11-06", "2026-11-09", "2026-11-10", "2026-11-11"], NOW).join(" ")).toMatch(/no more than 5/);
    expect(ownerPiesaDaysBlockers(["2026-11-04", "2026-11-04"], NOW).join(" ")).toMatch(/only be chosen once/);
    expect(ownerPiesaDaysBlockers(["2026-11-03"], NOW).join(" ")).toMatch(/no longer available/);
  });
  test("owner days are stored at the first arrival time; the electrician sets the real time", () => {
    expect(OWNER_DAY_ANCHOR_TIME).toBe("08:00");
    expect(piesaStartAt("2026-11-04", "08:00").toISOString()).toBe("2026-11-03T21:00:00.000Z");
  });
});

describe("whose move (piesaTimeTurn) — reads both the new rows and old single proposals", () => {
  const row = (p: Partial<PiesaProposalRow>): PiesaProposalRow => ({ id: Math.random().toString(36).slice(2), proposer_role: "electrician", status: "proposed", starts_at: "2026-11-05T22:00:00Z", note: PIESA_TIME_NOTE, piesa_window_round: null, electrician_window: false, install_day: false, ...p });
  const t = (rows: PiesaProposalRow[], o: { booked?: boolean; hasElectrician?: boolean; legacy?: number } = {}) => piesaTimeTurn({ booked: !!o.booked, hasElectrician: o.hasElectrician ?? true, legacyOwnerWindowsOpen: o.legacy ?? 0, rows, now: NOW }).turn;
  test("electrician offers first; owner answers; electrician answers owner days; booked", () => {
    expect(t([])).toBe("electrician_to_offer");
    expect(t([row({}), row({}), row({})])).toBe("owner_to_answer");
    expect(t([row({ proposer_role: "owner" })])).toBe("electrician_to_answer");
    expect(t([row({})], { booked: true })).toBe("booked");
  });
  test("no electrician yet: old owner windows still with the electricians, else waiting", () => {
    expect(t([], { hasElectrician: false })).toBe("no_electrician");
    expect(t([], { hasElectrician: false, legacy: 3 })).toBe("legacy_owner_windows");
  });
  test("old owner windows (round), fixes windows and install days are never this flow's times", () => {
    expect(isPiesaTimeRow(row({ piesa_window_round: 1, proposer_role: "owner" }))).toBe(false);
    expect(isPiesaTimeRow(row({ electrician_window: true }))).toBe(false);
    expect(isPiesaTimeRow(row({ install_day: true }))).toBe(false);
    expect(t([row({ piesa_window_round: 1, proposer_role: "owner" })])).toBe("electrician_to_offer");
  });
  test("an old single time from the old propose-a-time panel reads the same way (no note)", () => {
    expect(t([row({ note: null })])).toBe("owner_to_answer");
    expect(t([row({ note: null, proposer_role: "admin" })])).toBe("electrician_to_answer");
  });
  test("passed or answered times are not open", () => {
    expect(t([row({ starts_at: "2026-11-01T00:00:00Z" })])).toBe("electrician_to_offer");
    expect(t([row({ status: "superseded" })])).toBe("electrician_to_offer");
  });
});

describe("30-day tick sits on the owner's pick (decision 307 kept)", () => {
  test("refused until ticked; allowed once ticked or already recorded this cycle", () => {
    expect(ownerPiesaMoveBlocker({ turn: "owner_to_answer", ackNeeded: true, understandsThirtyDays: false })).toBe(THIRTY_DAY_ACK_REFUSAL);
    expect(ownerPiesaMoveBlocker({ turn: "owner_to_answer", ackNeeded: true, understandsThirtyDays: true })).toBeNull();
    expect(ownerPiesaMoveBlocker({ turn: "owner_to_answer", ackNeeded: false, understandsThirtyDays: undefined })).toBeNull();
    expect(ownerPiesaMoveBlocker({ turn: "electrician_to_offer", ackNeeded: false, understandsThirtyDays: true })).toMatch(/can't be chosen/);
  });
});

describe("old owner window picker: old jobs only", () => {
  test("new jobs (round 0) never see it; round 1 asked for more times or reopened do", () => {
    expect(oldOwnerPickerOpen({ round: 0, moreTimesAsked: false, reopened: false })).toBe(false);
    expect(oldOwnerPickerOpen({ round: 0, moreTimesAsked: false, reopened: true })).toBe(false);
    expect(oldOwnerPickerOpen({ round: 1, moreTimesAsked: true, reopened: false })).toBe(true);
    expect(oldOwnerPickerOpen({ round: 1, moreTimesAsked: false, reopened: false })).toBe(false);
    expect(oldOwnerPickerOpen({ round: 2, moreTimesAsked: true, reopened: true })).toBe(true);
  });
});

describe("source pins", () => {
  const server = src("src/lib/piesa-times.server.ts");
  test("agreement books through confirmBooking kind assessment; offering sends O26 once, best-effort", () => {
    expect(server).toContain('confirmBooking(jobId, "assessment", startsAt');
    expect(server.split("onSafetyCheckTimesOffered(jobId, starts)").length - 1).toBe(1);
    expect(server.split("\n").find((l) => l.includes("onSafetyCheckTimesOffered(jobId, starts)"))).toMatch(/\.catch\(/);
    expect(server).not.toMatch(/sendRealSms|sendGuardedOwnerEmail|sendTestEmail|fetch\(/);
  });
  test("the owner's take/suggest checks the 30-day tick and records it once per cycle", () => {
    expect(server).toContain("ownerPiesaMoveBlocker(");
    expect(server).toContain("requireOwnerThirtyDayAck(");
    expect(src("src/lib/owner-link.functions.ts")).toContain("ownerTakePiesaTimeLinkFn");
    expect(src("src/lib/owner-link.functions.ts")).toContain("understandsThirtyDays: data.understandsThirtyDays");
  });
  test("compare-and-swap take; times checked before an offer is accepted", () => {
    expect(server).toContain('.eq("status", "proposed").gt("starts_at", nowIso)');
    const accept = server.slice(server.indexOf("export async function acceptPiesaOfferWithTimes"));
    expect(accept.indexOf("electricianPiesaTimesBlockers(")).toBeLessThan(accept.indexOf("respondToRecOffer("));
  });
  test("old jobs: the old picker only for jobs with a round; new jobs refused the old picker", () => {
    const al = src("src/lib/allocation.server.ts");
    expect(al).toContain("oldOwnerPickerOpen({ round: w.round");
    expect(al).toContain("if (w.round === 0) throw new WorkflowError(");
    expect(al).toContain("PIESA_TIMES_NEXT_ACTION.electrician_to_offer");
    expect(PIESA_TIMES_NEXT_ACTION.electrician_to_offer).toMatch(/within 24 hours/);
  });
  test("screens: My job owner card, electrician job page card, offer page form", () => {
    expect(src("src/routes/my-job.$token.tsx")).toContain("data-piesa-times-owner");
    expect(src("src/routes/_authenticated/field.$jobId.tsx")).toContain("<ElectricianPiesaTimesCard jobId={jobId} />");
    expect(src("src/routes/_authenticated/field.offer.$offerId.tsx")).toContain("data-piesa-offer-times");
  });
});
