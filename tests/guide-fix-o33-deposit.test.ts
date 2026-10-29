/**
 * Guide fix 2 (Jo, 29 Oct 2026): the "Pick your install day" email (O33) says the 10% deposit is paid to book the
 * day — no "we hold it for 48 hours". Would fail if the old lock-in wording came back.
 */
import { describe, expect, test } from "bun:test";
import { renderInstallDaysEmail } from "../src/lib/install-days-email.core";

const base = { firstName: "Helen", installerName: "Reinsulate", days: ["Tuesday 11 November at 8:00am"], myJobUrl: "https://estimate.homeinsulationvictoria.com.au/my-job/tok", installBy: "4 December" };

describe("guide fix 2 — O33 deposit wording", () => {
  test("with a known balance it names the deposit and the rest", () => {
    const m = renderInstallDaysEmail({ ...base, balanceIncGst: 3379 });
    for (const s of [m.html, m.text]) {
      expect(s).toContain("To book your day, sign your install consent and pay your 10% deposit of $337.90. Once it's in, your day is locked in.");
      expect(s).toContain("The rest, $3,041.10, is due on install day. Or you can pay in full now.");
      expect(s).not.toContain("48 hours");
      expect(s).not.toContain("When you tap a day");
    }
  });
  test("with no balance known it still reads cleanly", () => {
    const m = renderInstallDaysEmail({ ...base, balanceIncGst: null });
    for (const s of [m.html, m.text]) {
      expect(s).toContain("To book your day, sign your install consent and pay your 10% deposit. Once it's in, your day is locked in.");
      expect(s).toContain("The rest is due on install day. Or you can pay in full now.");
      expect(s).not.toContain("48 hours");
    }
  });
});
