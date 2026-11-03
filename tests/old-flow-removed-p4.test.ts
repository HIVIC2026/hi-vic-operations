// Part 4 Task 14 (Jo 2 Nov 2026, touchpoint decisions: "REMOVE old fixes messages (#88–93)", 52, 53, the ESC consent
// moving onto the confirm-and-pay page, and the installer calling to book instead of offering days): the old
// after-acceptance messages and screens are gone. A job already part-way through an old step keeps its old screen
// (fixes quote waiting on the owner, install days offered to the owner) until it moves on.
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { TEMPLATE_ENTRIES, NOT_LISTED_BUILDERS } from "../src/lib/template-hub.core";
import { SMS_MESSAGE_TYPES } from "../src/lib/sms.core";
import { OLD_FLOW_STEPS_P4, jobsApprovingFixesQuote, jobsPickingFixesTime, jobsPickingInstallDays, jobsPickingPiesaTimes, jobsWithElectricianOfferOpen } from "../src/lib/old-flow-steps.core";
import { INSTALLER_WILL_CALL_TO_BOOK_DRAFT, resolveOwnerScreen, ownerAction } from "../src/lib/owner-myjob.core";

const code = (p: string) => readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const exists = (p: string) => existsSync(p);

const RETIRED_TEXTS = ["piesa_offer", "piesa_times_reminder", "safety_check_booked_owner", "installer_planning_notice", "fixes_times_link", "piesa_owner_confirm", "piesa_owner_fixes_confirm", "install_clearance", "veec_sign_reminder"] as const;

test("template hub has no entry for the removed after-acceptance messages", () => {
  const bad = TEMPLATE_ENTRIES.filter((e) =>
    ["E1", "E14", "O26", "I71", "O29", "O33", "I65", "O61"].includes(e.code)
    || /renderElectricianOfferEmail|renderPiesaTimesReminderEmail|renderSafetyCheckTimesEmail|renderSafetyCheckBookedEmail|renderInstallerPlanningEmail|renderFixesQuoteEmail|renderPiesaFixesConfirmEmail|renderInstallDaysEmail|renderInstallClearanceEmail|renderVeecReminderEmail|piesaFixesConfirmText/.test(e.source.fn)
    || (e.gate.kind === "text" && (RETIRED_TEXTS as readonly string[]).includes(e.gate.smsType))
    || e.id === "owner:fixes-confirm" || e.id === "owner:sms-piesa_owner_fixes_confirm");
  expect(bad.map((e) => e.id)).toEqual([]);
  expect("renderPiesaOwnerConfirmEmail" in NOT_LISTED_BUILDERS).toBe(false);
});

test("retired text types keep their key but can never send", () => {
  for (const k of RETIRED_TEXTS) {
    const t = SMS_MESSAGE_TYPES[k];
    expect({ k, defined: !!t }).toEqual({ k, defined: true });
    expect({ k, approved: t.wordingApproved }).toEqual({ k, approved: false });
    expect({ k, label: t.label.startsWith("Retired 2 Nov 2026 —") }).toEqual({ k, label: true });
  }
  // The day-0 rebate-form ask (with the All done email) is not a reminder and stays.
  expect(SMS_MESSAGE_TYPES.veec_sign_request.wordingApproved).toBe(true);
});

test("the removed builders and senders are gone", () => {
  for (const f of [
    "src/lib/electrician-offer-email.core.ts",
    "src/lib/piesa-times-reminder.core.ts", "src/lib/piesa-times-reminder.server.ts",
    "src/lib/safety-check-emails.core.ts",
    "src/lib/installer-planning-notice.core.ts", "src/lib/installer-planning-notice.server.ts",
    "src/lib/fixes-times-link.server.ts",
    "src/lib/rectification-quote-email.core.ts",
    "src/lib/auto-fixes-quote-send.core.ts", "src/lib/auto-fixes-quote-send.server.ts",
    "src/lib/piesa-fixes-confirm-email.core.ts", "src/lib/piesa-fixes-confirm-send.server.ts",
    "src/lib/piesa-owner-confirm-email.core.ts",
    "src/lib/install-clearance.core.ts", "src/lib/install-clearance.server.ts",
  ]) expect({ f, exists: exists(f) }).toEqual({ f, exists: false });
});

test("no sweep or route calls the removed senders", () => {
  const tick = code("src/routes/api/public/hooks/allocation-tick.ts");
  expect(tick).not.toMatch(/sweepInstallClearance|sweepAutoFixesQuotes|sweepOwnerFixesConfirmations|install-clearance|auto-fixes-quote-send|piesa-fixes-confirm-send/);
  expect(code("src/lib/trade-messages.server.ts")).not.toMatch(/textElectricianAboutOffer|emailElectricianAboutOffer|electrician-offer-email|piesaOfferText/);
  expect(code("src/lib/allocation.server.ts")).not.toMatch(/piesa-times-reminder/);
  expect(code("src/lib/booking.server.ts")).not.toMatch(/installer-planning-notice|onSafetyCheckBooked/);
  expect(code("src/lib/mitti.server.ts")).not.toMatch(/fixes-times-link|auto-fixes-quote-send/);
  expect(code("src/lib/fixes-day.server.ts")).not.toMatch(/piesa-fixes-confirm-send|sendFixesConfirmStep/);
  expect(code("src/lib/piesa-complete.server.ts")).not.toMatch(/install-clearance/);
  expect(code("src/lib/piesa-record.server.ts")).not.toMatch(/install-clearance/);
  expect(code("src/lib/piesa-times.server.ts")).not.toMatch(/onSafetyCheckTimesOffered/);
  expect(code("src/lib/install-days.server.ts")).not.toMatch(/onInstallDaysOffered/);
  // Fix round 1: O45 stays wired (install-complete + tick) while ALL_DONE_V2_APPROVED is false; onFinalInvoiceDue checks the flag.
  expect(code("src/lib/owner-email-triggers.server.ts")).toContain('ALL_DONE_V2_APPROVED) return "not due — the balance is in the All done email"');
  const triggers = code("src/lib/owner-email-triggers.server.ts");
  expect(triggers).not.toMatch(/onSafetyCheckTimesOffered|onSafetyCheckBooked|onFixesQuoteIssued|onInstallDaysOffered|safety-check-emails|rectification-quote-email/);
  const approved = code("src/lib/approved-owner-emails.server.ts");
  expect(approved).not.toMatch(/emailOwnerSafetyCheckTimes|emailOwnerSafetyCheckBooked|emailOwnerFixesQuote|emailOwnerInstallDays\b|renderInstallDaysEmail/);
  // Balance day-5 / due-day emails and the separate rebate-form reminders (O61 days 1/3/7) no longer send.
  expect(code("src/lib/balance-q21.server.ts")).not.toMatch(/sendOwnerTemplateEmail|balance_reminder|due in 2 days|due today/);
  const veec = code("src/lib/veec-reminders.server.ts");
  expect(veec).not.toMatch(/renderVeecReminderEmail|veecSignReminderText|"veec_sign_reminder"/);
  expect(code("src/lib/veec-emails.core.ts")).not.toMatch(/renderVeecReminderEmail/);
});

test("no owner screen offers times, pick-a-day, fixes or change links", () => {
  for (const f of ["src/routes/my-job.$token.tsx", "src/lib/owner-myjob.core.ts", "src/lib/owner-fixes.core.ts", "src/lib/confirm-sign-pay.core.ts", "src/lib/sign-and-pay.core.ts"].filter(exists)) {
    const c = code(f);
    for (const re of [/offer you/i, /pick a time/i, /3 install days/i, /Change day/, /Wrong time/, /Pick times/, /Pick one of the times/]) expect({ f, re: String(re), hit: re.test(c) }).toEqual({ f, re: String(re), hit: false });
  }
  const route = code("src/routes/my-job.$token.tsx");
  // The P3 separate consent step, the fixes-confirm page (P6F) and the fixes home card are gone.
  expect(route).not.toMatch(/ConsentCard|FixesConfirmCard|FixesHomeCard|ownerFixesConfirmFn|ownerSignFixesConfirmFn|fixesConfirm\b/);
  // Owner-visible "fixes" wording only survives on the screen kept for a job already mid-way (gated below), never as a home card.
  expect(route).not.toMatch(/See your electrical fixes/);
  // Nothing on the booking screen tells the owner to pick windows or shows "Held for 48 hours while your deposit arrives".
  expect(route).not.toMatch(/Pick 2-hour windows|held for 48 hours|Held for 48 hours/i);
  expect(code("src/lib/install-booked-email.core.ts")).not.toMatch(/48 hours/);
  expect(code("src/lib/owner-myjob.server.ts")).not.toMatch(/fixesConfirm:|consent: consent/);
});

test("?screen=fixes and ?screen=book fall through to the job's current single-action screen unless the job is at that step", () => {
  expect(resolveOwnerScreen("fixes", { currentAction: "clear" })).toBe("clear");
  expect(resolveOwnerScreen("book", { currentAction: "pay" })).toBe("pay");
  expect(resolveOwnerScreen("fixes", { currentAction: null })).toBe("all_set");
  expect(resolveOwnerScreen("book", { currentAction: null })).toBe("all_set");
  // A job mid-way through an old step keeps its old screen.
  expect(resolveOwnerScreen("fixes", { currentAction: "fixes" })).toBe("fixes");
  expect(resolveOwnerScreen("book", { currentAction: "book" })).toBe("book");
  // The home action never sends the owner to pick times any more, and never shows the spot-saved line to an accepted owner (fix round 1).
  for (const stage of ["measured_quote_accepted", "piesa_and_install_window_pending", "installation_scheduling"]) {
    const a = ownerAction({ stage, readyCheckRequested: true, visit: null, quoteOpen: null, bookingOpen: true, installerName: "Rapid Insulation" });
    expect({ stage, button: a.button, kicker: a.kicker }).toEqual({ stage, button: null, kicker: "Nothing for you to do" });
    expect({ stage, spot: /Spot saved/i.test(a.title) }).toEqual({ stage, spot: false });
  }
  expect(ownerAction({ stage: "measured_quote_accepted", readyCheckRequested: true, visit: null, quoteOpen: null, bookingOpen: true }).title).toBe("Quote accepted – complete your payment");
  const sched = ownerAction({ stage: "installation_scheduling", readyCheckRequested: true, visit: null, quoteOpen: null, bookingOpen: true, installerName: "Rapid Insulation" });
  expect(sched.title).toBe(INSTALLER_WILL_CALL_TO_BOOK_DRAFT("Rapid Insulation"));
  expect(sched.title).toBe("Rapid Insulation will call you to book your install day.");
  expect(ownerAction({ stage: "installation_scheduling", readyCheckRequested: true, visit: null, quoteOpen: null, bookingOpen: true }).title).toBe("Your installer will call you to book your install day.");
});

test("old step list covers the after-acceptance steps and the readers are read-only", () => {
  const steps = OLD_FLOW_STEPS_P4.map((s) => s.step);
  expect(steps).toEqual(["electrician offer open", "owner picking safety check times", "owner approving an electrical fixes quote", "owner picking a fixes time", "owner picking install days"]);
  for (const s of OLD_FLOW_STEPS_P4) expect(s.stages.length + s.events.length).toBeGreaterThan(0);
  const now = new Date("2026-11-03T00:00:00Z");
  expect(jobsWithElectricianOfferOpen([{ job_id: "a", status: "pending", expires_at: "2026-11-04T00:00:00Z" }, { job_id: "b", status: "pending", expires_at: "2026-11-01T00:00:00Z" }, { job_id: "c", status: "accepted", expires_at: null }, { job_id: "d", status: "pending", expires_at: null }], now)).toEqual(["a", "d"]);
  expect(jobsPickingPiesaTimes([
    { job_id: "a", proposer_role: "electrician", status: "proposed", starts_at: "2026-11-05T00:00:00Z", piesa_window_round: null, electrician_window: null, install_day: null },
    { job_id: "b", proposer_role: "owner", status: "proposed", starts_at: "2026-11-05T00:00:00Z", piesa_window_round: null, electrician_window: null, install_day: null },
    { job_id: "c", proposer_role: "electrician", status: "proposed", starts_at: "2026-11-01T00:00:00Z", piesa_window_round: null, electrician_window: null, install_day: null },
    { job_id: "d", proposer_role: "electrician", status: "proposed", starts_at: "2026-11-05T00:00:00Z", piesa_window_round: 1, electrician_window: null, install_day: null },
  ], now)).toEqual(["a"]);
  expect(jobsApprovingFixesQuote([{ job_id: "a", kind: "rectification", status: "issued" }, { job_id: "b", kind: "rectification", status: "accepted" }, { job_id: "c", kind: "installation", status: "issued" }])).toEqual(["a"]);
  expect(jobsPickingFixesTime([{ job_id: "a", status: "proposed", starts_at: "2026-11-05T00:00:00Z" }, { job_id: "b", status: "accepted", starts_at: "2026-11-05T00:00:00Z" }], now)).toEqual(["a"]);
  expect(jobsPickingInstallDays([{ job_id: "a", proposer_role: "installer", status: "proposed", starts_at: "2026-11-05T00:00:00Z" }, { job_id: "b", proposer_role: "owner", status: "proposed", starts_at: "2026-11-05T00:00:00Z" }], now)).toEqual(["a"]);
  const script = code("scripts/old-flow-inflight-count.ts");
  expect(script).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(/);
  expect(script).toContain("oldStepJobs");
  const reader = code("src/lib/old-flow-inflight.server.ts");
  expect(reader).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(/);
  expect(reader).toContain("OLD_FLOW_STEPS_P4");
  expect(reader).toMatch(/partner_offers/);
  expect(reader).toMatch(/install_day/);
});

test("the Part 3 steps are still counted alongside the Part 4 ones", () => {
  const p3 = code("src/lib/old-flow-inflight.server.ts");
  expect(p3).toContain("OLD_FLOW_STEPS_P3");
});
