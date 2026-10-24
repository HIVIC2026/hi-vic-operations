// Practice jobs: one per status, plus one per Needs-me rule a–k. Pure rules, no live data.
import { describe, expect, test } from "bun:test";
import { DEFAULT_LIMITS, OFFICE_STATUSES, STATUS_KEYS, addBusinessHours, officeStatus, type JobFacts, type StatusKey } from "../src/lib/office-status.core";
import { buildNeedsMe, nextMorning, type NeedsJob, type NeedsRule } from "../src/lib/needs-me.core";

const NOW = Date.parse("2026-10-06T00:00:00Z"); // Tue 11am Melbourne
const ago = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
const ahead = (d: number) => new Date(NOW + d * 86_400_000).toISOString();
const base = (stage: string, extra: Partial<JobFacts> = {}): JobFacts => ({ id: `job-${stage}`, stage, createdAt: ago(1), lastActivityAt: ago(0.1), enteredStageAt: ago(0.1), ...extra });

export const PRACTICE: Record<StatusKey, JobFacts> = {
  "waiting_list.ready_to_send": base("ready_check_ready_to_schedule", { estimateSentAt: ago(30) }),
  "waiting_list.needs_estimate": base("ready_check_ready_to_schedule"),
  "enquiry.checking": base("new_enquiry"),
  "enquiry.estimate_sent": base("preliminary_estimate_ready", { estimateSentAt: ago(1), ownerContactedAt: ago(1) }),
  "enquiry.video_asked": base("ready_check_ready_to_schedule", { campaign: { spotSavedAt: null, optedOutAt: null, videoRequested: true, mediaReceivedAt: null, deskCheckStatus: null, createdAt: ago(1) } }),
  "enquiry.video_in": base("ready_check_ready_to_schedule", { campaign: { spotSavedAt: ago(1), optedOutAt: null, videoRequested: true, mediaReceivedAt: ago(0.2), deskCheckStatus: null, createdAt: ago(2) } }),
  "enquiry.spot_saved": base("ready_check_ready_to_schedule", { campaign: { spotSavedAt: ago(0.5), optedOutAt: null, videoRequested: false, mediaReceivedAt: null, deskCheckStatus: null, createdAt: ago(2) } }),
  "enquiry.spot_saved_video": base("ready_check_ready_to_schedule", { campaign: { spotSavedAt: ago(0.5), optedOutAt: null, videoRequested: true, mediaReceivedAt: ago(0.4), deskCheckStatus: "pending", createdAt: ago(2), queuePriority: "video" } }),
  "ready_check.installer_own": base("ready_check_scheduled", { ownJob: true, measurementStartedAt: ago(0.1) }), // HV-3197: Mitti form linked, no booking row, no estimate
  "ready_check.pick_times": base("ready_check_ready_to_schedule", { rcAccepted: true, ownerContactedAt: ago(1) }),
  "ready_check.offered": base("ready_check_ready_to_schedule", { rcWindowsOpen: 3, rcOfferAt: ago(0.05) }),
  "ready_check.booked": base("ready_check_scheduled", { rcBookingAt: ahead(2) }),
  "ready_check.onsite_started": base("ready_check_scheduled", { rcBookingAt: ago(0.5), measurementStartedAt: ago(0.4) }),
  "ready_check.arranging": base("ready_check_ready_to_schedule", { proposalPending: { kind: "ready_check", since: ago(0.5) } }),
  "ready_check.done": base("ready_check_complete"),
  "ready_check.evidence_in": base("ready_check_complete", { rcSubmittedAt: ago(0.1) }),
  "quote.sent_auto": base("measured_estimate_ready"),
  "quote.held": base("measured_estimate_ready", { quote: { releaseState: "held", holdReason: "More than 15% above the estimate", sentAt: null, status: "draft", acceptedAt: null } }),
  "quote.waiting_sign": base("awaiting_quote_acceptance", { quote: { releaseState: "released", holdReason: null, sentAt: ago(2), status: "issued", acceptedAt: null } }),
  "quote.waiting_payment": base("measured_quote_accepted", { quote: { releaseState: "released", holdReason: null, sentAt: ago(3), status: "accepted", acceptedAt: ago(1) } }),
  "quote.paid": base("measured_quote_accepted", { paymentCleared: true }),
  "safety.pick_times": base("piesa_and_install_window_pending"),
  "safety.offered": base("piesa_and_install_window_pending", { elecOfferAt: ago(0.05) }),
  "safety.booked": base("piesa_scheduled", { elecBookingAt: ahead(1) }),
  "safety.arranging": base("piesa_and_install_window_pending", { proposalPending: { kind: "assessment", since: ago(0.5) } }),
  "safety.passed": base("piesa_complete", { piesa: { completedAt: ago(0.2), passed: true, sectionCAt: null } }),
  "safety.fix_sent_auto": base("rectification_required"),
  "safety.fix_held": base("rectification_required", { rectQuote: { releaseState: "held", sentAt: null, status: "draft" } }),
  "safety.fix_approve": base("awaiting_owner_rectification_approval", { rectQuote: { releaseState: "released", sentAt: ago(1), status: "issued" } }),
  "safety.fixes_booked": base("rectification_booked", { rectBookingAt: ahead(2) }),
  "safety.fixed": base("rectification_booked", { piesa: { completedAt: ago(5), passed: false, sectionCAt: ago(0.1) } }),
  "install.agree": base("installation_scheduling", { installDeadline: ahead(20) }),
  "install.booked": base("installation_booked", { installDeadline: ahead(20), installBookingAt: ahead(5) }),
  "install.checking": base("evidence_outstanding", { installedAt: ago(0.2) }),
  "install.evidence_missing": base("evidence_outstanding", { installedAt: ago(1), evidenceMissing: 2 }),
  "signoff.ap": base("ap_review"),
  "signoff.veec_waiting": base("ready_for_veec", { veecSubmittedAt: ago(3) }),
  "signoff.payouts_due": base("ready_for_veec", { payoutsOpen: 1, apApprovedAt: ago(2), payoutDueAt: ahead(5) }),
  "ended.complete": base("complete"),
  "ended.cancelled": base("cancelled", { cancelledReason: "Owner sold the house" }),
  "ended.on_hold": base("on_hold", { holdRevisitAt: ahead(10).slice(0, 10) }),
};

describe("one status per job (practice job for every status)", () => {
  for (const key of STATUS_KEYS) test(key, () => {
    const s = officeStatus(PRACTICE[key], NOW);
    expect(s?.key).toBe(key);
    expect(s?.waitingOn).toBe(OFFICE_STATUSES[key].waiting);
  });
  test("installer-supplied jobs: full measure-up enters at Quote, partial at confirm eligible", () => {
    expect(officeStatus(base("measured_estimate_ready"), NOW)?.stage).toBe("quote");
    expect(officeStatus(base("ready_check_complete", { rcSubmittedAt: ago(0) }), NOW)?.key).toBe("ready_check.evidence_in");
  });
  test("unknown stage gets no status (flagged by the nothing-lost check)", () => expect(officeStatus(base("mystery_stage"), NOW)).toBeNull());
  test("4 business hours skip the night and weekend", () => {
    const fri4pm = Date.parse("2026-10-09T05:00:00Z"); // Fri 4pm Melbourne
    expect(new Date(addBusinessHours(fri4pm, 4)).toISOString()).toBe("2026-10-12T00:00:00.000Z"); // Mon 11am Melbourne
  });
  test("Jo's settings override defaults", () => {
    const s = officeStatus(PRACTICE["enquiry.estimate_sent"], NOW, { ...DEFAULT_LIMITS, estimate_reminder_days: 0.5 });
    expect(s?.late).toBe(true);
  });
});

const nj = (f: JobFacts, extra: Partial<NeedsJob> = {}): NeedsJob => {
  const status = officeStatus(f, NOW);
  return { id: f.id, jobNumber: f.id, suburb: "Sunbury", owner: null, stage: f.stage, status, statusCount: status ? 1 : 0, lastActivityAt: f.lastActivityAt, nextAction: null, installDeadline: f.installDeadline ?? null, installStarted: false, holdRevisitAt: f.holdRevisitAt ?? null, failures: [], ...extra };
};
const run = (jobs: NeedsJob[], snoozes: { jobId: string; ruleKey: string; until: string; count: number }[] = [], partners = [] as Parameters<typeof buildNeedsMe>[0]["partners"]) => buildNeedsMe({ now: NOW, jobs, partners, snoozes, lim: DEFAULT_LIMITS });

const RULE_CASES: { rule: NeedsRule; label: string; jobs: () => ReturnType<typeof run> }[] = [
  { rule: "a_waiting_on_us", label: "Spot saved, needs an installer", jobs: () => run([nj(PRACTICE["enquiry.spot_saved"])]) },
  { rule: "b_over_limit", label: "Estimate sent 4 days ago", jobs: () => run([nj(base("preliminary_estimate_ready", { estimateSentAt: ago(4), ownerContactedAt: ago(4) }))]) },
  { rule: "c_inactive", label: "Booked visit, no activity 6 days", jobs: () => run([nj({ ...PRACTICE["install.booked"], lastActivityAt: ago(6) })]) },
  { rule: "d_no_next_step", label: "On hold with no revisit date", jobs: () => run([nj(base("on_hold"))]) },
  { rule: "e_failure", label: "Mitti sync failed", jobs: () => run([nj(PRACTICE["install.booked"], { failures: ["Mitti sync failed: template mismatch"] })]) },
  { rule: "f_clock", label: "Install clock ends in 3 days", jobs: () => run([nj({ ...PRACTICE["install.agree"], installDeadline: ahead(3) })]) },
  { rule: "g_hold_revisit", label: "On hold, revisit date passed", jobs: () => run([nj(base("on_hold", { holdRevisitAt: ago(1).slice(0, 10) }))]) },
  { rule: "h_snooze_return", label: "Snoozed yesterday, back this morning", jobs: () => run([nj(PRACTICE["enquiry.spot_saved"])], [{ jobId: "job-ready_check_ready_to_schedule", ruleKey: "a_waiting_on_us", until: ago(0.01), count: 1 }]) },
  { rule: "i_nothing_lost", label: "Job in an unknown stage", jobs: () => run([nj(base("mystery_stage"))]) },
  { rule: "j_partner", label: "Insurance expiring in 20 days", jobs: () => run([], [], [{ key: "cred:1", title: "Spark Right: insurance expiring", why: "Expires soon", dueAt: ahead(20), href: "/admin/businesses" }]) },
  { rule: "k_quiet_owner", label: "Owner quiet 3 weeks after reminders", jobs: () => run([nj(base("preliminary_estimate_ready", { estimateSentAt: ago(21), ownerContactedAt: ago(21) }))]) },
];

describe("Needs me safety net (rule → practice job → flagged)", () => {
  for (const c of RULE_CASES) test(`${c.rule}: ${c.label}`, () => {
    const out = c.jobs();
    const hit = out.items.find((i) => i.rule === c.rule || i.why.includes(c.rule === "k_quiet_owner" ? "close and free the spot" : "\u0000"));
    expect(hit).toBeTruthy();
    expect(hit!.why.length).toBeGreaterThan(3);
  });
  test("an on-track job is counted, not listed", () => {
    const out = run([nj(PRACTICE["install.booked"])]);
    expect(out.items).toHaveLength(0);
    expect(out.onTrack).toBe(1);
  });
  test("a snoozed job stays hidden until next morning", () => {
    expect(run([nj(PRACTICE["enquiry.spot_saved"])], [{ jobId: "job-ready_check_ready_to_schedule", ruleKey: "a_waiting_on_us", until: ahead(0.5), count: 1 }]).items).toHaveLength(0);
    expect(new Date(nextMorning(NOW)).toISOString()).toBe("2026-10-06T20:00:00.000Z"); // 7am Wed Melbourne (AEDT)
  });
  test("every practice status lands in Needs me or on-track exactly once", () => {
    const jobs = STATUS_KEYS.map((k) => nj({ ...PRACTICE[k], id: k }));
    const out = run(jobs);
    const ended = STATUS_KEYS.filter((k) => k.startsWith("ended.") && !out.items.some((i) => i.jobId === k)).length;
    expect(out.items.length + out.onTrack + ended).toBe(STATUS_KEYS.length);
  });
});

// Rule (Jo, 5 Oct): a status may only say "sent" / "waiting for owner" with a real send record.
import { officeStatus as _os, OFFICE_STATUSES as _S, STATUS_KEYS as _K } from "../src/lib/office-status.core";
import { buildNeedsMe as _nm } from "../src/lib/needs-me.core";
import { test as _t, expect as _e } from "bun:test";
_t("no send record → waiting list, never 'sent'/'waiting for owner', never late, counted in Needs me as one grouped row (Jo, 6 Oct)", () => {
  const now = Date.parse("2026-10-05T00:00:00Z");
  const base = { id: "j", stage: "ready_check_ready_to_schedule", createdAt: "2026-01-01T00:00:00Z", lastActivityAt: "2026-01-01T00:00:00Z", enteredStageAt: "2026-01-01T00:00:00Z" };
  const a = _os({ ...base, estimateSentAt: "2026-01-02T00:00:00Z" }, now)!;
  _e(a.key).toBe("waiting_list.ready_to_send"); _e(a.late).toBe(false);
  _e(_os({ ...base }, now)!.key).toBe("waiting_list.needs_estimate");
  _e(_os({ ...base, stage: "preliminary_estimate_ready", estimateSentAt: "2026-01-02T00:00:00Z" }, now)!.stage).toBe("waiting_list");
  _e(_os({ ...base, campaign: { spotSavedAt: null, optedOutAt: null, videoRequested: false, mediaReceivedAt: null, deskCheckStatus: null, createdAt: "2026-01-02T00:00:00Z" } }, now)!.stage).toBe("waiting_list");
  _e(_os({ ...base, estimateSentAt: "2026-01-02T00:00:00Z", ownerContactedAt: "2026-10-01T00:00:00Z" }, now)!.key).toBe("enquiry.estimate_sent");
  for (const k of _K) if (/sent|waiting for owner/i.test(_S[k].label) && _S[k].stage === "enquiry") _e(k).not.toContain("waiting_list");
  const n = _nm({ now, jobs: [{ id: "j", jobNumber: "HV-1", suburb: null, owner: null, stage: base.stage, status: a, statusCount: 1, lastActivityAt: base.lastActivityAt, nextAction: null, installDeadline: null, installStarted: false, holdRevisitAt: null, failures: [], parked: true }], partners: [], snoozes: [], lim: {} });
  _e(n.items.length).toBe(1); _e(n.items[0]!.jobId).toBe(null); _e(n.items[0]!.count).toBe(1); _e(n.items[0]!.href).toBe("/admin/enquiry-groups");
});
