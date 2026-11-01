import { describe, expect, test } from "bun:test";
import { waitingOn, endOfMelbourneDay, type WaitingFacts } from "../src/lib/waiting.core";
import { STAGE_ORDER as STAGES } from "../src/lib/workflow";

const now = new Date("2026-10-06T10:00:00Z");
const f = (p: Partial<WaitingFacts> = {}): WaitingFacts => ({ now, stageEnteredAt: "2026-10-05T10:00:00Z", electricianName: "Sparky Co", installerName: "Batts Bros", proposals: [], bookings: [], depositRequestRaised: false, ...p });

describe("waitingOn", () => {
  test("every stage gives a party (or terminal) and a sentence", () => {
    for (const s of STAGES) {
      const w = waitingOn({ stage: s, eligibility_outcome: "likely_eligible" }, f());
      expect(w.sentence.length).toBeGreaterThan(5);
      if (!w.terminal) expect(w.parties.length).toBeGreaterThan(0);
    }
  });
  test("PIESA booked: electrician, due end of booking day, overdue after", () => {
    const b = [{ kind: "assessment", status: "confirmed", scheduled_start: "2026-10-04T22:00:00Z", scheduled_end: null }];
    const w = waitingOn({ stage: "assessment_booked" }, f({ bookings: b }));
    expect(w.parties).toEqual(["Electrician"]);
    expect(w.sentence).toContain("Sparky Co");
    expect(w.status).toBe("overdue");
  });
  test("arranging a date shows both parties and who owes the reply", () => {
    const w = waitingOn({ stage: "installation_scheduling" }, f({ proposals: [{ kind: "installation", status: "proposed", proposer_role: "installer", created_at: "2026-10-06T09:00:00Z", starts_at: "2026-10-09T22:00:00Z", responded_at: null }] }));
    expect(w.arranging).toBe(true);
    expect(w.parties).toContain("Owner");
    expect(w.sentence).toContain("waiting on the owner");
    expect(w.status).toBe("ok");
  });
  test("deposit: Home Insulation Victoria until request raised, then owner", () => {
    expect(waitingOn({ stage: "awaiting_deposit_payment" }, f()).parties).toEqual(["Home Insulation Victoria"]);
    expect(waitingOn({ stage: "awaiting_deposit_payment" }, f({ depositRequestRaised: true })).parties).toEqual(["Owner"]);
  });
  test("review required is Home Insulation Victoria on eligibility tab", () => {
    const w = waitingOn({ stage: "new_enquiry", eligibility_review_required: true }, f());
    expect(w.parties).toEqual(["Home Insulation Victoria"]);
    expect(w.action.tab).toBe("eligibility");
  });
  test("end of Melbourne day", () => {
    expect(endOfMelbourneDay("2026-10-06T22:00:00Z")).toBe("2026-10-07T12:59:59.999Z");
  });
});
