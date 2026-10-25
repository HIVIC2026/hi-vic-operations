// Round trips per 15-minute tick sweep on a synthetic office (2,200 jobs, a quarter live). Network is blocked and every
// write is refused by the counter database, so a sweep that would send stops at its first write: the counts are the
// READ cost of deciding what is due, which is what each tick pays even when nothing is sent.
// PERF_REPORT=1 prints a table sorted by requests.
import { afterAll, expect, mock, test } from "bun:test";
import { makeCounterDb, officeTables } from "./helpers/query-counter-db";

const N = Number(process.env["PERF_JOBS"] ?? 2200);
let current = makeCounterDb(officeTables(N), { rtt: 1, perRow: 0, maxIn: 300 });
const proxy = { from: (t: string) => current.client.from(t), rpc: (n: string, a?: unknown) => current.client.rpc(n, a), storage: { from: (b: string) => current.client.storage.from(b) } };
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: proxy }));
const realFetch = globalThis.fetch;
globalThis.fetch = (async () => { throw new Error("network blocked in sweep budget test"); }) as unknown as typeof fetch;
afterAll(() => { globalThis.fetch = realFetch; });

const SWEEPS: [string, string][] = [
  ["allocation.server", "sweepRecOffers"], ["allocation.server", "sweepCoordination"], ["quote-expiry.server", "sweepQuoteExpiry"],
  ["owner-email-triggers.server", "sweepQuoteReminders"], ["owner-email-triggers.server", "sweepReviewRequests"], ["owner-email-triggers.server", "sweepFinalInvoices"],
  ["rectification.server", "sweepRectQuotes"], ["rectification.server", "sweepHeldRectWindows"], ["fixes-day.server", "sweepFixesForms"],
  ["install-holds.server", "sweepInstallHolds"], ["piesa-delivery.server", "sweepPiesaCopyDeliveries"], ["electrician-piesa-copy.server", "sweepElectricianPiesaCopies"],
  ["piesa-owner-confirm-send.server", "sweepOwnerPiesaConfirmations"], ["piesa-fixes-confirm-send.server", "sweepOwnerFixesConfirmations"], ["veec-reminders.server", "sweepVeecReminders"],
  ["completion-pack.server", "sweepCompletionPacks"], ["warranty-followup.server", "sweepWarrantyFollowups"], ["veec-ap-auto.server", "sweepAutoApSignatures"],
  ["install-days.server", "sweepInstallDays"], ["install-attendance.server", "sweepElectricianAttendance"], ["install-clearance.server", "sweepInstallClearance"],
  ["installer-texts.server", "sweepInstallerTexts"], ["ready-check-offer-text.server", "sweepJobOfferTexts"], ["estimate-followup.server", "sweepEstimateFollowups"],
  ["thirty-day-rule.server", "sweepInstallWindowRule"], ["payments.server", "sweepProvisionalBookings"], ["xero.server", "pollXeroPayments"],
  ["rec-onboarding-invite.server", "sweepRecOnboardingInvites"], ["visit-events.server", "sweepTradeNoShows"], ["readycheck-booking.server", "sweepReadyCheckOffers"],
  ["auto-offer.server", "sweepAutoOffers"], ["prestart.server", "sweepPrestart"], ["esc.server", "sweepEscReminders"], ["piisa-autosend.server", "sweepPiisaAutoSend"],
  ["daily-mitti-text.server", "sweepDailyMittiTexts"], ["daily-mitti-text.server", "sweepReadyCheckBookedTexts"], ["esc-collection-notice-send.server", "sweepCollectionNoticeLinks"],
  ["approved-texts.server", "sweepApprovedTexts"], ["trade-messages.server", "sweepTradeMessages"], ["auto-fixes-quote-send.server", "sweepAutoFixesQuotes"],
  ["daily-brief.server", "sweepDailyBrief"], ["quotes.server", "releaseQueuedQuotes"], ["mitti-complete.server", "sweepCompletedMittiReadyChecks"],
  ["mitti-pickup-auto.server", "sweepMittiPickupAuto"], ["mitti-autoform.server", "sweepReadyCheckForms"], ["install-day-confirm.server", "sweepInstallDayForms"],
];

const results: { sweep: string; requests: number; waves: number; rows: number; outcome: string; top: string }[] = [];
test("every tick sweep's read cost", async () => {
  for (const [mod, fn] of SWEEPS) {
    current = makeCounterDb(officeTables(N), { rtt: 1, perRow: 0, maxIn: 300 });
    let outcome = "ok";
    try {
      const m = (await import(`@/lib/${mod}`)) as Record<string, (...a: unknown[]) => Promise<unknown>>;
      await Promise.race([m[fn]!(), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout 20s")), 20_000))]);
    } catch (e) { outcome = (e instanceof Error ? e.message : String(e)).slice(0, 60); }
    const s = current.stats;
    const top = Object.entries(s.byTable).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t, c]) => `${t}=${c}`).join(" ");
    results.push({ sweep: `${mod.replace(".server", "")}.${fn}`, requests: s.requests, waves: s.waves, rows: s.rows, outcome, top });
  }
  if (process.env["PERF_REPORT"]) for (const r of [...results].sort((a, b) => b.requests - a.requests)) console.log(`${String(r.requests).padStart(6)} req ${String(r.waves).padStart(5)} waves ${String(r.rows).padStart(7)} rows  ${r.sweep}  [${r.top}]  ${r.outcome}`);
  expect(results.length).toBe(SWEEPS.length);
  // Perf 25 Oct 2026: these sweeps now read their candidates' facts in one batched pass (baseline on this office:
  // completion packs 2,476 requests, PIESA owner confirmations 158, fixes confirmations 236, all one after another).
  const req = (name: string) => results.find((r) => r.sweep.endsWith(name))!.requests;
  expect(req("sweepCompletionPacks")).toBeLessThan(30);
  expect(req("sweepOwnerPiesaConfirmations")).toBeLessThan(20);
  expect(req("sweepOwnerFixesConfirmations")).toBeLessThan(20);
}, 600_000);
