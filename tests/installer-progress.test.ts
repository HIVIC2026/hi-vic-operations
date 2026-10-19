import { describe, expect, test } from "bun:test";
import { installerProgress, installerTab, intakeProgressApplies, type ProgressFacts } from "../src/lib/installer-progress.core";

const base: ProgressFacts = { coordination: "hivic_managed", quoted: "no", eligibility: "unresolved", quoteHeld: [], quoteStatus: "none", reconfirmationRequired: false, electricianPayer: "hivic", electricalCleared: false, installationCompleted: false, quoteDelivery: "none", evidence: [], evidenceApprovedAt: null, veecStatus: null, stage: "new_enquiry" };
const st = (f: ProgressFacts) => Object.fromEntries(installerProgress(f).steps.map((s) => [s.key, s.state]));

describe("four next actions by coordination × quoted (eligibility pending)", () => {
  test("managed + not quoted → HIV checks eligibility then Ready Check", () => expect(installerProgress(base).next.text).toMatch(/arrange the Ready Check/));
  test("self + not quoted → installer measures and quotes", () => expect(installerProgress({ ...base, coordination: "self_managed" }).next.text).toMatch(/you measure and quote/));
  test("managed + quoted → owner quote, no forced visit", () => expect(installerProgress({ ...base, quoted: "yes" }).next.text).not.toMatch(/Ready Check/));
  test("self + quoted → owner quote", () => expect(installerProgress({ ...base, coordination: "self_managed", quoted: "yes" }).next.text).toMatch(/prepare the owner quote/));
  test("eligible self not quoted → You", () => expect(installerProgress({ ...base, coordination: "self_managed", eligibility: "eligible" }).next.who).toBe("You"));
});

describe("steps only from their own facts", () => {
  test("uploaded quote is not accepted", () => expect(st({ ...base, quoted: "yes", eligibility: "eligible", quoteStatus: "issued" }).quote).toBe("current"));
  test("late stage alone marks nothing done", () => expect(st({ ...base, stage: "ready_for_veec" }).review).toBe("current"));
  test("electrical not cleared without sign-off fact", () => expect(st({ ...base, eligibility: "eligible", quoteStatus: "accepted" }).electrical).toBe("current"));
  test("evidence approved ≠ VEEC submitted", () => { const s = st({ ...base, eligibility: "eligible", quoteStatus: "accepted", electricalCleared: true, installationCompleted: true, evidenceApprovedAt: "2026-10-01" }); expect(s.evidence).toBe("done"); expect(s.veec).toBe("current"); });
  test("submitted ≠ registered", () => {
    const f = { ...base, eligibility: "eligible" as const, quoteStatus: "accepted" as const, electricalCleared: true, installationCompleted: true, evidenceApprovedAt: "x" };
    expect(installerProgress({ ...f, veecStatus: "submitted" }).steps.at(-1)!.note).toBe("Submitted — awaiting registration");
    expect(installerProgress({ ...f, veecStatus: "approved" }).steps.at(-1)!.note).toBe("Registered");
  });
  test("reconfirmation keeps quote open", () => expect(st({ ...base, eligibility: "eligible", quoteStatus: "accepted", reconfirmationRequired: true }).quote).toBe("current"));
});

describe("Jobs tabs", () => {
  test("Done only from final stage", () => { expect(installerTab("moving", "complete")).toBe("done"); expect(installerTab("moving", "ready_for_veec")).toBe("progress"); });
  test("needs_me/offers → Action needed", () => { expect(installerTab("needs_me", "new_enquiry")).toBe("action"); expect(installerTab("offers", "x")).toBe("action"); });
  test("held/moving → In progress, never Done", () => expect(installerTab("moving", "on_hold")).toBe("progress"));
});

describe("W3 A3 — intake progress read applies only to installer-sourced intake jobs (guards 'Couldn't load current job progress')", () => {
  test("installer-sourced with an originating business → applies, so the supplying-installer guard still runs", () =>
    expect(intakeProgressApplies({ channel: "installer_sourced", originating_installer_business_id: "biz-1" })).toBe(true));
  test("standard HIV-sourced job → does NOT apply (would otherwise throw 'Only the installer who supplied this job can update it')", () =>
    expect(intakeProgressApplies({ channel: "hivic_sourced", originating_installer_business_id: null })).toBe(false));
  test("installer-sourced but null originating business → does NOT apply", () =>
    expect(intakeProgressApplies({ channel: "installer_sourced", originating_installer_business_id: null })).toBe(false));
  test("missing/failed job row → does NOT apply, never throws", () => {
    expect(intakeProgressApplies(null)).toBe(false);
    expect(intakeProgressApplies(undefined)).toBe(false);
  });
});
