// Mitti Ready Check build Stages 7–8 (Jo 22 Oct 2026): incomplete-form chase, install-day photo lock,
// "Office needs to…" Mitti items and the waiting status for saved spots while booking is OFF.
import { describe, expect, test } from "bun:test";
import {
  incompleteDecision, installDayPhotoBlocker, installerMissing, missingSignature, mittiOfficeItems, readyCheckIncompleteText, type Ev,
} from "../src/lib/ready-check-chase.core";
import type { ReadyCheckFacts } from "../src/lib/ready-check-complete.core";
import { officeStatus } from "../src/lib/office-status.core";

const clean: ReadyCheckFacts = { formComplete: true, belowR2: true, lifeSupportReviewed: true, depthPhoto: true, overviewPhoto: true, contactPermission: true, electricianDecided: true, priceKnown: true };
const now = new Date("2026-10-23T10:00:00Z");
const h = (n: number) => new Date(now.getTime() - n * 3_600_000).toISOString();

describe("Stage 7: incomplete Ready Check form", () => {
  test("clean form: nothing missing, nobody texted", () => {
    expect(installerMissing(clean)).toEqual([]);
    expect(incompleteDecision({ completed: true, modifiedAt: h(1), visitAt: null, now, facts: clean }).notify).toBe(false);
  });
  test("completed form missing photos and price: installer told exactly what", () => {
    const d = incompleteDecision({ completed: true, modifiedAt: h(0), visitAt: null, now, facts: { ...clean, depthPhoto: false, overviewPhoto: false, priceKnown: false } });
    expect(d.notify).toBe(true);
    expect(d.missing).toEqual(["your total quoted price (inc GST)"]); // photos optional (Jo 23 Oct): taken on install day
  });
  test("unfinished form while still being filled in: no text", () => {
    expect(incompleteDecision({ completed: false, modifiedAt: h(1), visitAt: h(2), now, facts: { ...clean, formComplete: false } }).notify).toBe(false);
  });
  test("unfinished form idle 6h after the visit: text", () => {
    expect(incompleteDecision({ completed: false, modifiedAt: h(7), visitAt: h(8), now, facts: { ...clean, formComplete: false } }).notify).toBe(true);
  });
  test("unfinished form before its booked visit: no text even if idle", () => {
    expect(incompleteDecision({ completed: false, modifiedAt: h(30), visitAt: new Date(now.getTime() + 3_600_000).toISOString(), now, facts: { ...clean, formComplete: false } }).notify).toBe(false);
  });
  test("R2-or-above and life support are office matters, never installer chase items", () => {
    expect(installerMissing({ ...clean, belowR2: false, lifeSupportReviewed: false })).toEqual([]);
  });
  test("same gaps in any order share one signature (one text, not one per sync)", () => {
    expect(missingSignature(["b", "a"])).toBe(missingSignature(["a", "b"]));
  });
  test("decision 83 'Nearly there' text verbatim (brand prefix added by the sender); no address → no brackets", () => {
    expect(readyCheckIncompleteText("HV-1", "1 Test St, Testville", ["a photo showing the insulation depth"]))
      .toBe("Nearly there! HV-1 (1 Test St, Testville) still needs: a photo showing the insulation depth. Add them in Mitti and we'll prepare the owner's quote.");
    expect(readyCheckIncompleteText("HV-1", null, ["a", "b"])).toBe("Nearly there! HV-1 still needs: a; b. Add them in Mitti and we'll prepare the owner's quote.");
  });
});

describe("Stage 7: install-day photo lock", () => {
  const req = (category: string, status: string, gate = "installation", required = true) => ({ category, label: category === "access_manhole" ? "Access / manhole photo" : "Before photo of ceiling space", gate, required, status });
  test("outstanding access + before photos lock Installation complete", () => {
    expect(installDayPhotoBlocker([req("access_manhole", "outstanding"), req("before_ceiling_space", "rejected")]))
      .toBe("Installation complete stays locked until these install-day photos are in: Access / manhole photo, Before photo of ceiling space.");
  });
  test("uploaded photos unlock it", () => {
    expect(installDayPhotoBlocker([req("access_manhole", "uploaded"), req("before_ceiling_space", "verified")])).toBeNull();
  });
  test("after-work photos and non-required items never lock completion", () => {
    expect(installDayPhotoBlocker([req("completed_installation", "outstanding"), req("access_manhole", "outstanding", "installation", false), req("before_ceiling_space", "outstanding", "assessment")])).toBeNull();
  });
});

describe("Stage 8: Office needs to… Mitti items", () => {
  const ev = (job_id: string | null, event_type: string, hoursAgo: number, extra: Partial<Ev> = {}): Ev => ({ job_id, event_type, created_at: h(hoursAgo), details: {}, summary: null, ...extra });
  const codes = (e: Ev[]) => mittiOfficeItems(e, now).map((i) => `${i.code}:${i.jobId ?? i.key}`).sort();

  test("each of the seven items is raised", () => {
    const out = codes([
      ev("j1", "mitti_measureup_sync_failed", 2, { summary: "Ready Check sync failed: Mitti record not found." }),
      ev(null, "mitti_pickup_needs_review", 2, { details: { audit_id: "audit_x", reasons: ["missing owner phone"] } }),
      ev("j2", "ready_check_needs_office", 2, { details: { reasons: ["no depth photo"] }, summary: "Ready Check finished — the office must act" }),
      ev("j3", "installer_quote_held", 2),
      ev("j4", "ready_check_needs_office", 2, { summary: "Quote released to the owner — no approved quote email wording on file" }),
      ev("j5", "mitti_access_needed", 2),
      ev("j6", "ready_check_incomplete", 25, { details: { missing: ["a photo showing the insulation depth"] } }),
    ]);
    expect(out).toEqual(["mitti_fix_form:j1", "mitti_review_pickup:mitti_review_pickup:audit_x", "mitti_setup_installer:j5", "quote_held_review:j3", "quote_not_delivered:j4", "ready_check_chase_installer:j6", "ready_check_held:j2"]);
  });
  test("chase waits 24 hours", () => {
    expect(codes([ev("j6", "ready_check_incomplete", 23)])).toEqual([]);
  });
  test("later events clear each item", () => {
    expect(codes([
      ev("j1", "mitti_measureup_sync_failed", 3), ev("j1", "mitti_measureup_synced", 1),
      ev(null, "mitti_pickup_needs_review", 3, { details: { audit_id: "audit_x" } }), ev("jx", "mitti_audit_linked", 1, { details: { audit_id: "audit_x" } }),
      ev("j2", "ready_check_needs_office", 3, { summary: "Ready Check finished" }), ev("j2", "installer_quote_queued", 1),
      ev("j3", "installer_quote_held", 3), ev("j3", "quote_hold_stopped", 1),
      ev("j5", "mitti_access_needed", 3), ev("j5", "mitti_synced", 1),
      ev("j6", "ready_check_incomplete", 30), ev("j6", "ready_check_incomplete_cleared", 1),
    ])).toEqual([]);
  });
  test("a pickup form is listed once however many times it is reviewed", () => {
    expect(codes([ev(null, "mitti_pickup_needs_review", 3, { details: { audit_id: "a" } }), ev(null, "mitti_pickup_needs_review", 1, { details: { audit_id: "a" } })])).toHaveLength(1);
  });
});

describe("Stage 8: saved spot while Ready Check booking is OFF", () => {
  const base = { id: "j", stage: "preliminary_estimate_ready", createdAt: h(100), lastActivityAt: h(1), enteredStageAt: h(50), holdRevisitAt: null, cancelledReason: null,
    campaign: { spotSavedAt: h(10), optedOutAt: null, videoRequested: false, mediaReceivedAt: null, deskCheckStatus: null, createdAt: h(60), queuePriority: null }, ownerContactedAt: h(20) } as never;
  test("booking OFF: waiting, no office action", () => {
    const s = officeStatus({ ...(base as object), readyCheckBookingOpen: false } as never, now.getTime());
    expect(s!.label).toBe("Waiting – Ready Checks not open yet");
    expect(s!.waitingOn).toBe("Nobody");
    expect(s!.action).toBeNull();
  });
  test("booking ON: unchanged Spot saved office action", () => {
    expect(officeStatus({ ...(base as object), readyCheckBookingOpen: true } as never, now.getTime())!.label).toBe("Spot saved");
  });
});

import { SMS_MESSAGE_TYPES as __T } from "../src/lib/sms.core";
import { readyCheckIncompleteText as __txt } from "../src/lib/ready-check-chase.core";
describe("Jo 22 Oct approval, wording superseded by decision 83 (24 Oct)", () => {
  test("installer 'form incomplete' text is approved with Jo's exact 24 Oct wording", () => {
    expect((__T as Record<string, { wordingApproved: boolean }>)["ready_check_incomplete"]!.wordingApproved).toBe(true);
    expect(__txt("HV-1234", "2A Chatfield St, Kingsville", ["a photo showing the insulation depth"])).toBe("Nearly there! HV-1234 (2A Chatfield St, Kingsville) still needs: a photo showing the insulation depth. Add them in Mitti and we'll prepare the owner's quote.");
  });
});
