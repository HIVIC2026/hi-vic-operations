import { describe, expect, test } from "bun:test";
import { placeWorkJob, workCounts, type WorkJobInput } from "../src/lib/work-places.core";

const STAGES = ["new_enquiry","eligibility_review","awaiting_electrician","assessment_booking","assessment_booked","assessment_complete","rectification_required","awaiting_owner_rectification_approval","awaiting_deposit_payment","rectification_scheduling","rectification_booked","ready_for_installer_quotes","awaiting_quote_acceptance","installation_scheduling","installation_booked","evidence_outstanding","ap_review","ready_for_veec","complete","on_hold","preliminary_estimate_ready","ready_check_awaiting_acceptance","ready_check_awaiting_payment","ready_check_ready_to_schedule","ready_check_scheduled","ready_check_complete","measured_estimate_ready","measured_quote_accepted","piesa_and_install_window_pending","piesa_scheduled","piesa_complete","electrical_variation_pending"];
const base = (o: Partial<WorkJobInput>): WorkJobInput => ({ jobId: "j", stage: "ready_check_complete", trade: "installer", installerSourced: false, missingPhotos: 0, pendingOffer: false, upcoming: [], ...o });
const soon = [{ kind: "installation", scheduled_start: new Date(Date.now() + 86_400_000).toISOString() }];

describe("My work: one place per job", () => {
  test("every stage, both trades, with and without bookings, lands in exactly one valid place", () => {
    for (const trade of ["installer", "electrician"] as const) for (const stage of STAGES) for (const upcoming of [[], soon]) {
      const p = placeWorkJob(base({ stage, trade, upcoming }));
      expect(["offers", "needs_me", "coming_up", "moving"]).toContain(p.place);
      expect(p.title.length).toBeGreaterThan(0);
    }
  });
  test("decisions 34/115/185: no Quoted?/Site check? questions in any stage — the Mitti form carries them", () => {
    for (const stage of STAGES) for (const installerSourced of [true, false]) {
      const p = placeWorkJob(base({ stage, installerSourced, upcoming: soon }));
      expect(p.title).not.toMatch(/Quoted\?|Site check\?|answer needed/);
    }
  });
  test("pending offer wins", () => expect(placeWorkJob(base({ pendingOffer: true, installerSourced: true, quoted: null })).place).toBe("offers"));
  test("installer action stages", () => {
    expect(placeWorkJob(base({ stage: "ready_check_ready_to_schedule" })).place).toBe("needs_me");
    expect(placeWorkJob(base({ stage: "installation_scheduling" })).place).toBe("needs_me");
    expect(placeWorkJob(base({ stage: "evidence_outstanding", missingPhotos: 2 })).title).toBe("2 photos missing");
    expect(placeWorkJob(base({ stage: "evidence_outstanding" })).place).toBe("moving");
  });
  test("booked visits are Coming up; booked stage with no future visit is Needs me", () => {
    expect(placeWorkJob(base({ stage: "installation_booked", upcoming: soon })).place).toBe("coming_up");
    expect(placeWorkJob(base({ stage: "installation_booked" })).place).toBe("needs_me");
  });
  test("waiting on owner/office/electrician is Moving automatically", () => {
    for (const stage of ["measured_estimate_ready","awaiting_deposit_payment","piesa_scheduled","assessment_booking","ap_review","ready_check_complete"]) expect(placeWorkJob(base({ stage })).place).toBe("moving");
  });
  test("counts equal the jobs in each place and add up to the total", () => {
    const jobs = STAGES.map((stage, i) => base({ jobId: String(i), stage, installerSourced: i % 3 === 0, quoted: i % 3 === 0 ? null : "yes", pendingOffer: i === 5, upcoming: i % 4 === 0 ? soon : [] }));
    const ps = jobs.map(placeWorkJob); const c = workCounts(ps);
    expect(c.offers + c.needs_me + c.coming_up + c.moving).toBe(jobs.length);
    for (const k of Object.keys(c) as (keyof typeof c)[]) expect(c[k]).toBe(ps.filter((p) => p.place === k).length);
  });
});

test("an installer-sourced job with no Mitti form yet is never an installer question", () => {
  const j: WorkJobInput = { jobId: "j", stage: "ready_check_ready_to_schedule", trade: "installer", installerSourced: true, missingPhotos: 0, pendingOffer: false, upcoming: [] };
  expect(placeWorkJob(j)).toEqual({ place: "needs_me", title: "Book the Ready Check with the owner" });
  expect(placeWorkJob({ ...j, stage: "measured_quote_accepted" }).title).not.toMatch(/Quoted\?/);
});
