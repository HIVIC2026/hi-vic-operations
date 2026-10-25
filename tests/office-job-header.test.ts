// Office job header (HV-3197, 25 Oct 2026): an installer's own customer at the Ready Check reads "Ready Check", never
// "Needs estimate"; the More ▾ menu stays inside a 390px phone screen. Pure rules only.
import { describe, expect, test } from "bun:test";
import { officeStatus, type JobFacts } from "../src/lib/office-status.core";
import { nextAction } from "../src/lib/job-next-action.core";
import { buildStageCards, type StageCardFacts } from "../src/lib/office-stage-cards.core";
import { menuOffset } from "../src/lib/portal-presentation.core";

const NOW = Date.parse("2026-10-25T00:00:00Z");
const ago = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
const base = (stage: string, extra: Partial<JobFacts> = {}): JobFacts => ({ id: `job-${stage}`, stage, createdAt: ago(2), lastActivityAt: ago(0.1), enteredStageAt: ago(1), ...extra });
const status = (f: JobFacts) => { const s = officeStatus(f, NOW); return s ? { key: s.key, label: s.label, waitingOn: s.waitingOn, detail: s.detail, dueAt: s.dueAt } : null; };

const cardFacts = (ownJob: boolean): StageCardFacts => ({
  current: "ready_check", closed: null, ownJob,
  enquiry: { receivedAt: ago(2), source: ownJob ? "added by [TEST PARTNER] Reinsulate" : "website Save my spot", estimateTotal: null, estimateRebate: null, linkSentAt: null, linkViewedAt: null, ownerSaid: null, eligibility: null, photos: 0 },
  readyCheck: { installer: "[TEST PARTNER] Reinsulate", chosenAt: null, acceptedAt: null, visitAt: null, mitti: "Started 24 Oct · synced", measured: null, diagramAt: null },
  quote: { sentAt: null, held: null, subtotal: null, incentive: null, ownerPays: null, acceptedAt: null, signer: null, safetyPaidAt: null, declined: null },
  piesa: { electrician: null, offer: null, visitAt: null, outcome: null, fixes: null },
  install: { deadline: null, daysLeft: null, deposit: null, installAt: null, daysOffered: 0, consent: null, escNotice: null },
  finalCheck: { installedAt: null, evidenceMissing: null, veecForm: null, readyForVeecAt: null, lodged: null },
});

describe("installer's own customer (A1) at ready_check_scheduled, Mitti form linked and draft, no booking row", () => {
  const f = base("ready_check_scheduled", { ownJob: true, measurementStartedAt: ago(0.5) });
  test("status chip = Ready Check, waiting on the installer, never late", () => {
    const s = officeStatus(f, NOW);
    expect(s?.key).toBe("ready_check.installer_own");
    expect(s?.label).toBe("Ready Check");
    expect(s?.stage).toBe("ready_check");
    expect(s?.waitingOn).toBe("Installer");
    expect(s?.late).toBe(false);
  });
  test("Next panel line: installer is doing the Ready Check · nothing for the office", () => {
    const n = nextAction({ facts: null, status: status(f), stage: "ready_check", closed: null, onHold: null }, NOW);
    expect(n).toEqual({ who: "installer", sentence: "Installer is doing the Ready Check · nothing for the office", button: null, blocked: null });
  });
  test("same words at every pre-Ready-Check stage an installer job can sit in", () => {
    for (const stage of ["ready_check_ready_to_schedule", "preliminary_estimate_ready", "ready_check_awaiting_acceptance"]) {
      expect(officeStatus(base(stage, { ownJob: true }), NOW)?.key).toBe("ready_check.installer_own");
    }
  });
  test("a real booking still reads booked / started, and a prepared quote still outranks the stage", () => {
    expect(officeStatus(base("ready_check_scheduled", { ownJob: true, rcBookingAt: ago(-1) }), NOW)?.key).toBe("ready_check.booked");
    expect(officeStatus(base("ready_check_scheduled", { ownJob: true, quote: { releaseState: "held", holdReason: "Price not entered by the business owner", sentAt: null, status: "draft", acceptedAt: null } }), NOW)?.key).toBe("quote.held");
  });
  test("Enquiry card has no Estimate row", () => {
    const enquiry = buildStageCards(cardFacts(true))[0]!;
    expect(enquiry.lines.some((l) => l.label === "Estimate")).toBe(false);
    expect(enquiry.lines.map((l) => l.value).join(" ")).not.toContain("Not used for installers");
  });
});

describe("website enquiry (our lead) is unchanged", () => {
  test("no contact yet = waiting list · Needs estimate; the Next panel says nothing for the office", () => {
    const f = base("ready_check_scheduled", {});
    const s = officeStatus(f, NOW);
    expect(s?.key).toBe("waiting_list.needs_estimate");
    expect(s?.label).toBe("Needs estimate");
    const n = nextAction({ facts: null, status: status(f), stage: "ready_check", closed: null, onHold: null }, NOW);
    expect(n.who).toBe("nobody");
    expect(n.sentence).toBe("Needs estimate. Nothing for the office to do — it happens automatically.");
  });
  test("a saved spot still outranks the estimate wording", () => {
    const f = base("preliminary_estimate_ready", { campaign: { spotSavedAt: ago(0.5), optedOutAt: null, videoRequested: false, mediaReceivedAt: null, deskCheckStatus: null, createdAt: ago(2) } });
    expect(officeStatus(f, NOW)?.key).toBe("enquiry.spot_saved");
  });
  test("Enquiry card keeps its Estimate row", () => {
    expect(buildStageCards(cardFacts(false))[0]!.lines.map((l) => l.label)).toEqual(["Received", "Estimate", "Owner said", "Eligibility", "Photos"]);
  });
});

describe("More ▾ / Actions ▾ menu placement (390px iPhone)", () => {
  test("button wrapped to the left edge: the menu opens to the right and is fully visible", () => {
    // Job page More ▾ at x=16, 84px wide, 240px menu: start-aligned fits (16 + 240 < 382).
    expect(menuOffset({ anchorLeft: 16, anchorWidth: 84, menuWidth: 240, viewportWidth: 390 })).toBe(0);
  });
  test("button at the right edge (Enquiries Actions ▾): the menu flips to end-align and stays inside", () => {
    // Button at x=290, 84px wide → start-aligned would end at 530; flipped = anchorWidth − menuWidth = −156 → menu spans 134..374.
    expect(menuOffset({ anchorLeft: 290, anchorWidth: 84, menuWidth: 240, viewportWidth: 390 })).toBe(-156);
  });
  test("button in the middle where neither edge fits: clamped to the 8px gutter", () => {
    // Button at x=200, 60px wide, 300px menu: start ends at 500, flipped starts at −40 → clamp to the gutter (8 − 200).
    expect(menuOffset({ anchorLeft: 200, anchorWidth: 60, menuWidth: 300, viewportWidth: 390 })).toBe(-192);
  });
  test("a menu wider than the phone is capped to the viewport minus gutters", () => {
    expect(menuOffset({ anchorLeft: 100, anchorWidth: 60, menuWidth: 500, viewportWidth: 390 })).toBe(-92); // 374px wide from x=8
  });
  test("desktop: a right-side button end-aligns like before", () => {
    expect(menuOffset({ anchorLeft: 1200, anchorWidth: 90, menuWidth: 240, viewportWidth: 1280 })).toBe(-150);
  });
});
