import { describe, expect, test } from "bun:test";
import { chosenTradeNoAnswer, rankChoices } from "../src/lib/trade-choice.core";
import { buildNeedsMe } from "../src/lib/needs-me.core";

describe("choose a trade", () => {
  test("only an office pick that said no / ran out is flagged", () => {
    const pick = { kind: "piesa", status: "declined", offered_at: "2026-10-05T01:00:00Z", summary: { office_choice: true }, business_name: "Spark Co" };
    expect(chosenTradeNoAnswer([pick], "piesa")).toEqual({ name: "Spark Co", status: "declined" });
    expect(chosenTradeNoAnswer([{ ...pick, status: "expired" }], "piesa")?.status).toBe("expired");
    expect(chosenTradeNoAnswer([{ ...pick, status: "pending" }], "piesa")).toBeNull();
    expect(chosenTradeNoAnswer([{ ...pick, summary: {} }], "piesa")).toBeNull(); // normal send-to-all
    expect(chosenTradeNoAnswer([pick, { kind: "piesa", status: "pending", offered_at: "2026-10-05T02:00:00Z", summary: {} }], "piesa")).toBeNull(); // widened
  });
  test("eligible only, nearest first, then lightest load", () => {
    const r = rankChoices([
      { business_id: "a", name: "Far", blocker: null, exact_postcode: false, service_postcodes: ["3500"], open_jobs: 0 },
      { business_id: "b", name: "Exact busy", blocker: null, exact_postcode: true, service_postcodes: ["3150"], open_jobs: 5 },
      { business_id: "c", name: "Exact quiet", blocker: null, exact_postcode: true, service_postcodes: ["3150"], open_jobs: 1 },
      { business_id: "d", name: "Blocked", blocker: "No insurance", exact_postcode: true, service_postcodes: ["3150"], open_jobs: 0 },
      { business_id: "e", name: "Near", blocker: null, exact_postcode: false, service_postcodes: ["3152"], open_jobs: 0 },
    ], "3150");
    expect(r.map((x) => x.business_id)).toEqual(["c", "b", "e", "a"]);
  });
  test("Needs me shows Pick another / Send to all", () => {
    const { items } = buildNeedsMe({ now: Date.now(), partners: [], snoozes: [], lim: {}, jobs: [{ id: "j", jobNumber: "HV-1", suburb: "X", owner: null, stage: "piesa_and_install_window_pending", status: null, statusCount: 1, lastActivityAt: new Date().toISOString(), nextAction: null, installDeadline: null, installStarted: false, holdRevisitAt: null, failures: [], tradeChoice: { kind: "piesa", name: "Spark Co", status: "expired" } }] });
    const it = items.find((x) => x.why.includes("Spark Co"));
    expect(it?.choiceKind).toBe("piesa");
  });
});
