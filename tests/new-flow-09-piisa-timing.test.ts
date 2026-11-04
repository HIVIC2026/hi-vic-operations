// Part 9 Task 4: the PIISA (A5 before-work declaration, Q36 signature) must be signed at least 24h after the ESC
// notice was sent and within 30 days of the PIESA (Activity Guide v1.2 §3.3). One pure rule, read at Installation complete.
import { describe, expect, test } from "bun:test";
import { PIISA_FROM_PIESA_DAYS, piisaTimingBlockers } from "../src/lib/esc.core";
import { PIISA_FROM_PIESA_DAYS as FROM_PRESTART } from "../src/lib/prestart.core";
import { installCompletionDecision, type InstallEvidenceSummary } from "../src/lib/install-evidence.core";

// Melbourne AEDT (UTC+11) from Sun 4 Oct 2026; AEST (UTC+10) before.
const SENT_MON_10 = "2026-10-11T23:00:00Z"; // Mon 12 Oct 10:00 AEDT
const PIESA = "2026-10-01";

describe("piisaTimingBlockers — 24h after the ESC notice", () => {
  test("signed one minute short of 24h → blocked, names the Melbourne sent time", () => {
    const b = piisaTimingBlockers({ piisaSignedAt: "2026-10-12T22:59:00Z", noticeSentAt: SENT_MON_10, piesaCompletedAt: PIESA });
    expect(b).toEqual(["PIISA signed less than 24 hours after the ESC notice was sent (sent Mon 12 Oct 2026 10:00 am)."]);
  });
  test("signed exactly 24h after → clear", () => {
    expect(piisaTimingBlockers({ piisaSignedAt: "2026-10-12T23:00:00Z", noticeSentAt: SENT_MON_10, piesaCompletedAt: PIESA })).toEqual([]);
  });
  test("DST crossing: sent Sat 3 Oct 10:00 AEST, signed Sun 4 Oct 10:00 AEDT is only 23h of real time → blocked; 11:00 AEDT → clear", () => {
    const sent = "2026-10-03T00:00:00Z"; // Sat 3 Oct 10:00 AEST
    expect(piisaTimingBlockers({ piisaSignedAt: "2026-10-03T23:00:00Z", noticeSentAt: sent, piesaCompletedAt: PIESA })).toHaveLength(1);
    expect(piisaTimingBlockers({ piisaSignedAt: "2026-10-04T00:00:00Z", noticeSentAt: sent, piesaCompletedAt: PIESA })).toEqual([]);
  });
});

describe("piisaTimingBlockers — within 30 days of the PIESA (Melbourne dates)", () => {
  test("constant is 30 and is the same one prestart.core uses", () => {
    expect(PIISA_FROM_PIESA_DAYS).toBe(30);
    expect(FROM_PRESTART).toBe(PIISA_FROM_PIESA_DAYS);
  });
  test("PIESA 1 Oct, signed 31 Oct 11:30pm Melbourne → clear", () => {
    // 31 Oct 23:30 AEDT = 31 Oct 12:30Z
    expect(piisaTimingBlockers({ piisaSignedAt: "2026-10-31T12:30:00Z", noticeSentAt: "2026-10-20T23:00:00Z", piesaCompletedAt: PIESA })).toEqual([]);
  });
  test("PIESA 1 Oct, signed 1 Nov 12:30am Melbourne (still 31 Oct in UTC) → blocked, names the PIESA date", () => {
    expect(piisaTimingBlockers({ piisaSignedAt: "2026-10-31T13:30:00Z", noticeSentAt: "2026-10-20T23:00:00Z", piesaCompletedAt: PIESA }))
      .toEqual(["PIISA signed more than 30 days after the PIESA (2026-10-01)."]);
  });
  test("PIESA completion stored as a full timestamp is read as its Melbourne date", () => {
    // 1 Oct 2026 08:00 AEST = 30 Sep 22:00Z — the PIESA day is 1 Oct, so 31 Oct is still inside the window.
    expect(piisaTimingBlockers({ piisaSignedAt: "2026-10-31T12:30:00Z", noticeSentAt: "2026-10-20T23:00:00Z", piesaCompletedAt: "2026-09-30T22:00:00Z" })).toEqual([]);
  });
});

describe("piisaTimingBlockers — missing facts fail closed, one line each", () => {
  test("nothing on file → three lines", () => {
    expect(piisaTimingBlockers({ piisaSignedAt: null, noticeSentAt: null, piesaCompletedAt: null })).toEqual([
      "No ESC notice recorded as sent",
      "PIESA completion date missing",
      "PIISA signature time missing",
    ]);
  });
  test("unparseable times count as missing", () => {
    expect(piisaTimingBlockers({ piisaSignedAt: "soon", noticeSentAt: "yesterday", piesaCompletedAt: "last week" })).toHaveLength(3);
  });
  test("both rules can fail at once", () => {
    const b = piisaTimingBlockers({ piisaSignedAt: "2026-11-05T22:30:00Z", noticeSentAt: "2026-11-05T22:00:00Z", piesaCompletedAt: PIESA });
    expect(b).toHaveLength(2);
  });
});

describe("installCompletionDecision holds on PIISA timing", () => {
  const summary: InstallEvidenceSummary = { applies: true, blockers: [], rulerBlockers: [] } as unknown as InstallEvidenceSummary;
  const base = { formCompleted: true, declarationSaved: true, summary, alreadyCompleted: false, allFilledInTicked: true as const };
  test("a timing blocker holds with the first blocker as the Next line", () => {
    const d = installCompletionDecision({ ...base, piisaTiming: ["PIISA signed less than 24 hours after the ESC notice was sent (sent Mon 12 Oct 2026 10:00 am).", "PIISA signature time missing"] });
    expect(d.record).toBe(false);
    expect(d.nextLine).toBe("PIISA signed less than 24 hours after the ESC notice was sent (sent Mon 12 Oct 2026 10:00 am).");
    expect(d.outstanding).toHaveLength(2);
    expect(d.reason).toContain("PIISA timing");
  });
  test("no timing blockers → records as before; older callers that pass nothing are unchanged", () => {
    expect(installCompletionDecision({ ...base, piisaTiming: [] }).record).toBe(true);
    expect(installCompletionDecision(base).record).toBe(true);
  });
  test("an unsigned declaration is reported before timing", () => {
    const d = installCompletionDecision({ ...base, declarationSaved: false, piisaTiming: ["PIISA signature time missing"] });
    expect(d.nextLine).toContain("Sign the safety form (PIISA)");
  });
});
