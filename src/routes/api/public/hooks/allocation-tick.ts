import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

// Scheduled allocation timer (pg_cron, every 15 min). Runs exactly the sweeps the office queue already runs:
// expire overdue electrician offers + next batch, 24h coordination reminders (queued only). Counts only — never PII.
export const Route = createFileRoute("/api/public/hooks/allocation-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const nonce = request.headers.get("x-hivic-cron-nonce");
        if (nonce) {
          if (!/^[0-9a-f]{64}$/.test(nonce)) return new Response("Unauthorized", { status: 401 });
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: ok } = await supabaseAdmin.rpc("consume_cron_nonce", { _nonce: nonce, _purpose: "allocation_tick" });
          if (ok !== true) return new Response("Unauthorized", { status: 401 });
        } else {
          const denied = await authenticateCronRequest(request);
          if (denied) return denied;
        }
        const tickStartedAt = Date.now();
        // Perf 25 Oct 2026: milliseconds per sweep in the tick's own response (counts only, never PII), so the slow sweeps
        // are visible from the cron log instead of guessed.
        const timingsMs: Record<string, number> = {};
        const timed = async <T,>(name: string, run: () => Promise<T>): Promise<T> => {
          const t = Date.now();
          try { return await run(); } finally { timingsMs[name] = (timingsMs[name] ?? 0) + (Date.now() - t); }
        };
        const { sweepRecOffers, sweepCoordination } = await import("@/lib/allocation.server");
        const out: { ok: boolean; offers?: unknown; coordination?: unknown } = { ok: true };
        try {
          const o = await timed("sweepRecOffers", () => sweepRecOffers());
          out['offers'] = { expired: o.expired, started: Array.isArray(o.started) ? o.started.length : o.started };
        } catch (e) {
          console.error("allocation tick: offer sweep failed", (e as Error).message);
          out['ok'] = false;
          out['offers'] = "failed";
        }
        try {
          const c = await timed("sweepCoordination", () => sweepCoordination());
          out['coordination'] = typeof c === "object" && c ? Object.fromEntries(Object.entries(c).filter(([, v]) => typeof v === "number")) : null;
        } catch (e) {
          console.error("allocation tick: coordination sweep failed", (e as Error).message);
          out['ok'] = false;
          out['coordination'] = "failed";
        }
        try {
          const { sweepQuoteExpiry } = await import("@/lib/quote-expiry.server");
          (out as Record<string, unknown>)['quotes'] = await timed("sweepQuoteExpiry", () => sweepQuoteExpiry());
        } catch (e) {
          console.error("allocation tick: quote expiry sweep failed", (e as Error).message);
          out['ok'] = false;
          (out as Record<string, unknown>)['quotes'] = "failed";
        }
        try {
          // Decision 325: O19 quote reminder emails (3 days after the quote, 2 days before the price expires) and the O51
          // review request a week after the install (held until the review screen + Google link exist). One
          // `owner_email_triggered` event per email before sending; TEST → test-send; real → guarded owner path.
          const { sweepQuoteReminders, sweepReviewRequests, sweepFinalInvoices } = await import("@/lib/owner-email-triggers.server");
          (out as Record<string, unknown>)['ownerEmails'] = { quoteReminders: await timed("sweepQuoteReminders", () => sweepQuoteReminders()), reviewRequests: await timed("sweepReviewRequests", () => sweepReviewRequests()), finalInvoices: await timed("sweepFinalInvoices", () => sweepFinalInvoices()) };
        } catch (e) {
          console.error("allocation tick: owner email sweep failed", (e as Error).message);
          (out as Record<string, unknown>)['ownerEmails'] = "failed";
        }
        try {
          const { sweepRectQuotes, sweepHeldRectWindows } = await import("@/lib/rectification.server");
          (out as Record<string, unknown>)['rectification'] = { ...(await timed("sweepRectQuotes", () => sweepRectQuotes())), ...(await timed("sweepHeldRectWindows", () => sweepHeldRectWindows())) };
        } catch (e) {
          console.error("allocation tick: electrical fixes sweep failed", (e as Error).message);
          out['ok'] = false;
          (out as Record<string, unknown>)['rectification'] = "failed";
        }
        try {
          // Decision 293: open "A4 – Electrical fixes" Mitti forms — on Complete, Section C is recorded and the files kept.
          const { sweepFixesForms } = await import("@/lib/fixes-day.server");
          (out as Record<string, unknown>)['fixesForms'] = await timed("sweepFixesForms", () => sweepFixesForms());
        } catch (e) {
          console.error("allocation tick: fixes form sweep failed", (e as Error).message);
          out['ok'] = false;
          (out as Record<string, unknown>)['fixesForms'] = "failed";
        }
        try {
          const { sweepInstallHolds } = await import("@/lib/install-holds.server");
          (out as Record<string, unknown>)['installHolds'] = await timed("sweepInstallHolds", () => sweepInstallHolds());
        } catch (e) {
          console.error("allocation tick: install hold sweep failed", (e as Error).message);
          out['ok'] = false;
          (out as Record<string, unknown>)['installHolds'] = "failed";
        }
        try {
          // Jo 24 Oct (decision 111): signed PIESA copy to the owner and installer once the install day is booked.
          // Real jobs: PIESA_COPY_EMAIL_APPROVED (on, decision 131) + customer_comms_enabled; TEST jobs use the allowlisted test sender.
          const { sweepPiesaCopyDeliveries } = await import("@/lib/piesa-delivery.server");
          (out as Record<string, unknown>)['piesaCopies'] = await timed("sweepPiesaCopyDeliveries", () => sweepPiesaCopyDeliveries());
        } catch (e) {
          console.error("allocation tick: PIESA copy delivery sweep failed", (e as Error).message);
          (out as Record<string, unknown>)['piesaCopies'] = "failed";
        }
        try {
          // Decision 317: the assigned electrician gets the official PIESA (PDF attached) once per PIESA record — first
          // official PIESA, then the post-fixes version. TEST → test-send; real → partner sender (paused with the master switch).
          const { sweepElectricianPiesaCopies } = await import("@/lib/electrician-piesa-copy.server");
          (out as Record<string, unknown>)['electricianPiesa'] = await timed("sweepElectricianPiesaCopies", () => sweepElectricianPiesaCopies());
        } catch (e) {
          console.error("allocation tick: electrician PIESA sweep failed", (e as Error).message);
          (out as Record<string, unknown>)['electricianPiesa'] = "failed";
        }
        try {
          // Decision 296: owner asked to confirm the PIESA on their secure link (email O71 + text) after the electrician completes it,
          // reminders days 1/3, office alert day 5. DRAFT wording: real owners get nothing until approved; TEST jobs use test-send.
          const { sweepOwnerPiesaConfirmations } = await import("@/lib/piesa-owner-confirm-send.server");
          (out as Record<string, unknown>)['piesaOwnerConfirm'] = await timed("sweepOwnerPiesaConfirmations", () => sweepOwnerPiesaConfirmations());
        } catch (e) {
          console.error("allocation tick: PIESA owner confirmation sweep failed", (e as Error).message);
          (out as Record<string, unknown>)['piesaOwnerConfirm'] = "failed";
        }
        try {
          // Decision 389: released spots — day-2 "Just checking — it's your turn" reminder (email + text), the 7am release text
          // when Jo released during quiet hours, and the day-5 lapse (one Needs me row, nothing sent). Batched reads.
          const { sweepSpotReleases } = await import("@/lib/spot-release.server");
          (out as Record<string, unknown>)['spotReleases'] = await timed("sweepSpotReleases", () => sweepSpotReleases());
        } catch (e) {
          console.error("allocation tick: spot release sweep failed", (e as Error).message);
          (out as Record<string, unknown>)['spotReleases'] = "failed";
        }
        try {
          // Decision 330: owner asked to confirm the ELECTRICAL FIXES (email O72 + text) after the A4 fixes form; days 1/3, office day 5.
          const { sweepOwnerFixesConfirmations } = await import("@/lib/piesa-fixes-confirm-send.server");
          (out as Record<string, unknown>)['piesaFixesConfirm'] = await timed("sweepOwnerFixesConfirmations", () => sweepOwnerFixesConfirmations());
        } catch (e) {
          console.error("allocation tick: electrical fixes owner confirmation sweep failed", (e as Error).message);
          (out as Record<string, unknown>)['piesaFixesConfirm'] = "failed";
        }
        try {
          // Decision 376: ONE copy of the owner's signed Gate B paperwork per signing sitting (email O75, PDFs attached).
          // DRAFT wording: real owners get nothing until approved; TEST jobs use test-send.
          const { sweepOwnerPaperworkCopies } = await import("@/lib/paperwork-copy-email.server");
          (out as Record<string, unknown>)['paperworkCopies'] = await sweepOwnerPaperworkCopies();
        } catch (e) {
          console.error("allocation tick: signed paperwork copy sweep failed", (e as Error).message);
          (out as Record<string, unknown>)['paperworkCopies'] = "failed";
        }
        try {
          // Decision 120: owner asked to sign the VEEC assignment form (email + text) at install completion, days 1/3/7, office alert day 10.
          const { sweepVeecReminders } = await import("@/lib/veec-reminders.server");
          (out as Record<string, unknown>)['veecReminders'] = await timed("sweepVeecReminders", () => sweepVeecReminders());
        } catch (e) {
          console.error("allocation tick: VEEC reminder sweep failed", (e as Error).message);
          (out as Record<string, unknown>)['veecReminders'] = "failed";
        }
        try {
          // VEU checklist G1 (Jo 25 Oct): completion pack (O47) once the install is complete and the invoice paid in full, with the
          // installed product's manufacturer warranty attached, filed on the job and `warranty_copy_provided` recorded at that send.
          const { sweepCompletionPacks } = await import("@/lib/completion-pack.server");
          (out as Record<string, unknown>)['completionPacks'] = await timed("sweepCompletionPacks", () => sweepCompletionPacks());
        } catch (e) {
          console.error("allocation tick: completion pack sweep failed", (e as Error).message);
          (out as Record<string, unknown>)['completionPacks'] = "failed";
        }
        try {
          // Decision 363: a warranty PDF added after the pack went without it → ONE owner email (O73, draft until approved)
          // with the PDF, then `warranty_copy_provided` so the AP auto-signature can proceed. Before the AP sweep below.
          const { sweepWarrantyFollowups } = await import("@/lib/warranty-followup.server");
          (out as Record<string, unknown>)['warrantyFollowups'] = await timed("sweepWarrantyFollowups", () => sweepWarrantyFollowups());
        } catch (e) {
          console.error("allocation tick: warranty follow-up sweep failed", (e as Error).message);
          (out as Record<string, unknown>)['warrantyFollowups'] = "failed";
        }
        try {
          // Decision 370: the AP part (Section 3) of the ESC owner consent signs itself once the owner has signed and every check passes.
          const { sweepAutoConsentApSignatures } = await import("@/lib/consent-ap-auto.server");
          (out as Record<string, unknown>)['consentApAuto'] = await timed("sweepAutoConsentApSignatures", () => sweepAutoConsentApSignatures());
        } catch (e) {
          console.error("allocation tick: automatic consent AP signature sweep failed", (e as Error).message);
          (out as Record<string, unknown>)['consentApAuto'] = "failed";
        }
        try {
          // Decision 271: Section 3 Part A of the VEEC assignment form signs itself once the installer has signed and every prerequisite is recorded.
          const { sweepAutoApSignatures } = await import("@/lib/veec-ap-auto.server");
          (out as Record<string, unknown>)['veecApAuto'] = await timed("sweepAutoApSignatures", () => sweepAutoApSignatures());
        } catch (e) {
          console.error("allocation tick: automatic AP signature sweep failed", (e as Error).message);
          (out as Record<string, unknown>)['veecApAuto'] = "failed";
        }
        try {
          const { sweepInstallDays } = await import("@/lib/install-days.server");
          (out as Record<string, unknown>)['installDays'] = await timed("sweepInstallDays", () => sweepInstallDays());
        } catch (e) {
          console.error("allocation tick: install day sweep failed", (e as Error).message);
          out['ok'] = false;
          (out as Record<string, unknown>)['installDays'] = "failed";
        }
        try {
          // Decision 327: electrician needed at the start of the install day — ask any booking not yet asked, re-offer a held
          // request (quiet hours), one reminder at 24h. Office row only at 48h (Needs me).
          const { sweepElectricianAttendance } = await import("@/lib/install-attendance.server");
          (out as Record<string, unknown>)['electricianAttendance'] = await timed("sweepElectricianAttendance", () => sweepElectricianAttendance());
        } catch (e) {
          console.error("allocation tick: electrician attendance sweep failed", (e as Error).message);
          (out as Record<string, unknown>)['electricianAttendance'] = "failed";
        }
        try {
          // Decision 186: installer told once when electrical clearance is in (text + email, offer 3 install days).
          // Catch-up only: jobs cleared in the last 7 days with nothing booked and no notice yet; the live trigger is
          // the PIESA completion / Section C sign-off itself.
          const { sweepInstallClearance } = await import("@/lib/install-clearance.server");
          (out as Record<string, unknown>)['installClearance'] = await timed("sweepInstallClearance", () => sweepInstallClearance());
        } catch (e) {
          console.error("allocation tick: install clearance sweep failed", (e as Error).message);
          (out as Record<string, unknown>)['installClearance'] = "failed";
        }
        try {
          // Decisions 79/82/99 (built per 193): "Install tomorrow" to the installer from the afternoon before, and a 24h
          // catch-up for the owner-suggested-days and Ready-Check-booked installer texts whose live trigger was missed.
          // One `installer_text_prepared` event per text before sending; TEST → test-send; real → sendRealSms.
          const { sweepInstallerTexts } = await import("@/lib/installer-texts.server");
          (out as Record<string, unknown>)['installerTexts'] = await timed("sweepInstallerTexts", () => sweepInstallerTexts());
        } catch (e) {
          console.error("allocation tick: installer texts sweep failed", (e as Error).message);
          (out as Record<string, unknown>)['installerTexts'] = "failed";
        }
        try {
          // Decision 361: Ready Check job offers made after 8pm are texted at 7am (job_offer keeps quiet hours; a held
          // text never claims its key). The offer's 24 hours still run from when it was made.
          const { sweepJobOfferTexts } = await import("@/lib/ready-check-offer-text.server");
          (out as Record<string, unknown>)['jobOfferTexts'] = await timed("sweepJobOfferTexts", () => sweepJobOfferTexts());
        } catch (e) {
          console.error("allocation tick: job offer text catch-up failed", (e as Error).message);
          (out as Record<string, unknown>)['jobOfferTexts'] = "failed";
        }
        try {
          // Decision 238: estimate-only leads get a reminder on day 2, 7 and 21 after the estimate email, then an
          // automatic close a week after the day-21 email (held until the wording is approved; TEST → test sender).
          const { sweepEstimateFollowups } = await import("@/lib/estimate-followup.server");
          (out as Record<string, unknown>)['estimateFollowups'] = await timed("sweepEstimateFollowups", () => sweepEstimateFollowups());
        } catch (e) {
          console.error("allocation tick: estimate follow-up sweep failed", (e as Error).message);
          (out as Record<string, unknown>)['estimateFollowups'] = "failed";
        }
        try {
          // Decision 158: 20/10-day reminders to owner + installer (held until approved; TEST → test sender) and the
          // repeat-PIESA payer record when the 30-day window lapses with nothing booked.
          const { sweepInstallWindowRule } = await import("@/lib/thirty-day-rule.server");
          (out as Record<string, unknown>)['installWindowRule'] = await timed("sweepInstallWindowRule", () => sweepInstallWindowRule());
        } catch (e) {
          console.error("allocation tick: 30-day rule sweep failed", (e as Error).message);
          (out as Record<string, unknown>)['installWindowRule'] = "failed";
        }
        try {
          // Decision 139: Xero payment poll fallback (env XERO_PAYMENT_POLL_ENABLED=true) and the 48h provisional
          // install-booking release (deposit unpaid). Office alerts only; the owner notice is held behind approval.
          const { sweepProvisionalBookings } = await import("@/lib/payments.server");
          const { pollXeroPayments } = await import("@/lib/xero.server");
          (out as Record<string, unknown>)['payments'] = { poll: await timed("pollXeroPayments", () => pollXeroPayments()), provisional: await timed("sweepProvisionalBookings", () => sweepProvisionalBookings()) };
        } catch (e) {
          console.error("allocation tick: payments sweep failed", (e as Error).message);
          (out as Record<string, unknown>)['payments'] = "failed"; // a Xero outage must not fail the whole tick
        }
        try {
          // Decision 303: ONE REC onboarding invite per electrician an installer named who is not an approved REC
          // (facts recorded by the quote pipeline; sends only through the existing manual invite path, TEST → test inbox).
          const { sweepRecOnboardingInvites } = await import("@/lib/rec-onboarding-invite.server");
          (out as Record<string, unknown>)['recOnboardingInvites'] = await timed("sweepRecOnboardingInvites", () => sweepRecOnboardingInvites());
        } catch (e) {
          console.error("allocation tick: REC onboarding invite sweep failed", (e as Error).message);
          (out as Record<string, unknown>)['recOnboardingInvites'] = "failed";
        }
        try {
          const { sweepTradeNoShows } = await import("@/lib/visit-events.server");
          (out as Record<string, unknown>)['tradeNoShows'] = await timed("sweepTradeNoShows", () => sweepTradeNoShows());
        } catch (e) {
          console.error("allocation tick: trade no-show sweep failed", (e as Error).message);
          out['ok'] = false;
        }
        try {
          const { sweepReadyCheckOffers } = await import("@/lib/readycheck-booking.server");
          (out as Record<string, unknown>)['readyCheck'] = await timed("sweepReadyCheckOffers", () => sweepReadyCheckOffers());
        } catch (e) {
          console.error("allocation tick: ready check sweep failed", (e as Error).message);
          out['ok'] = false;
          (out as Record<string, unknown>)['readyCheck'] = "failed";
        }
        try {
          // Decision 246: automatic offers by coverage (installer Ready Check / PIESA electrician). Both switches OFF
          // by default and read fail-closed; runs AFTER the offer expiry sweeps so a lapsed offer goes to the next match
          // (or back to the office after 2 misses) in the same tick. Sends only through the existing guarded senders.
          const { sweepAutoOffers } = await import("@/lib/auto-offer.server");
          (out as Record<string, unknown>)['autoOffers'] = await timed("sweepAutoOffers", () => sweepAutoOffers());
        } catch (e) {
          console.error("allocation tick: automatic offers sweep failed", (e as Error).message);
          (out as Record<string, unknown>)['autoOffers'] = "failed";
        }
        try {
          const { sweepPrestart } = await import("@/lib/prestart.server");
          (out as Record<string, unknown>)['prestart'] = await timed("sweepPrestart", () => sweepPrestart());
        } catch (e) {
          console.error("allocation tick: pre-start sweep failed", (e as Error).message);
          out['ok'] = false;
          (out as Record<string, unknown>)['prestart'] = "failed";
        }
        try {
          // Jo 24 Oct (decision 121): ESC install-notification reminders — window open (5 days), urgent (48h), blocked
          // (24h), reopened after a date change. Internal Office alerts only; nothing goes to owners or trades.
          const { sweepEscReminders } = await import("@/lib/esc.server");
          (out as Record<string, unknown>)['escReminders'] = await timed("sweepEscReminders", () => sweepEscReminders());
        } catch (e) {
          console.error("allocation tick: ESC reminder sweep failed", (e as Error).message);
          out['ok'] = false;
          (out as Record<string, unknown>)['escReminders'] = "failed";
        }
        try {
          // Jo 24 Oct: the install-day PIISA Mitti form is created the day(s) before the install (same guarded path as
          // the office button, one per job) so the 6:30am text below can link it. Runs BEFORE the daily text.
          const { sweepPiisaAutoSend } = await import("@/lib/piisa-autosend.server");
          const a = await timed("sweepPiisaAutoSend", () => sweepPiisaAutoSend());
          (out as Record<string, unknown>)['piisaAutoSend'] = { checked: a.checked, created: a.results.filter((x) => x.outcome === "created").length, failed: a.results.filter((x) => x.outcome === "failed").length };
        } catch (e) {
          console.error("allocation tick: PIISA auto-send failed", (e as Error).message);
          (out as Record<string, unknown>)['piisaAutoSend'] = "failed"; // Mitti outages must not fail the whole tick
        }
        try {
          // Daily Mitti links text: switch OFF by default; sends nothing unless ON and form IDs are set.
          const { sweepDailyMittiTexts } = await import("@/lib/daily-mitti-text.server");
          (out as Record<string, unknown>)['dailyMittiText'] = await timed("sweepDailyMittiTexts", () => sweepDailyMittiTexts());
          // Stage 5: one-off "Ready Check booked" text to the installer (same switch, TEST-only, send-once).
          const { sweepReadyCheckBookedTexts } = await import("@/lib/daily-mitti-text.server");
          (out as Record<string, unknown>)['readyCheckBookedText'] = await timed("sweepReadyCheckBookedTexts", () => sweepReadyCheckBookedTexts());
        } catch (e) {
          console.error("allocation tick: daily mitti text failed", (e as Error).message);
          out['ok'] = false;
        }
        try {
          // Decision 130: each installer person's ESC collection notice link (first send, then 3- and 7-day reminders)
          // through the guarded senders; real texts/emails stay held until the wording is approved. Counts only.
          const { sweepCollectionNoticeLinks } = await import("@/lib/esc-collection-notice-send.server");
          (out as Record<string, unknown>)['escNoticeLinks'] = await timed("sweepCollectionNoticeLinks", () => sweepCollectionNoticeLinks());
        } catch (e) {
          console.error("allocation tick: ESC notice link sweep failed", (e as Error).message);
          (out as Record<string, unknown>)['escNoticeLinks'] = "failed";
        }
        try {
          // Decision 326: the approved owner texts (78 Ready Check times, 82 booked + see you tomorrow, 89 quote reminders,
          // 93 safety check booked + see you tomorrow, 99 install see you tomorrow, 135 install moved). Replaces the old
          // queued-only 24h/2h visit reminders (no approved 2h or trade day-before wording). One event per text; TEST → test-send.
          const { sweepApprovedTexts } = await import("@/lib/approved-texts.server");
          (out as Record<string, unknown>)['approvedTexts'] = await timed("sweepApprovedTexts", () => sweepApprovedTexts());
        } catch (e) {
          console.error("allocation tick: approved texts sweep failed", (e as Error).message);
          (out as Record<string, unknown>)['approvedTexts'] = "failed";
        }
        try {
          // Decision 326: electrician PIESA offer text (93) + email (E1), installer "owner declined" email (I24) and the
          // applicant "We've got your application" email (I53) — catch-up for anything the live triggers missed.
          const { sweepTradeMessages } = await import("@/lib/trade-messages.server");
          (out as Record<string, unknown>)['tradeMessages'] = await timed("sweepTradeMessages", () => sweepTradeMessages());
        } catch (e) {
          console.error("allocation tick: trade messages sweep failed", (e as Error).message);
          (out as Record<string, unknown>)['tradeMessages'] = "failed";
        }
        try {
          // Decision 354: catch-up for the automatic electrical fixes quote send (A3 complete + every check passed).
          const { sweepAutoFixesQuotes } = await import("@/lib/auto-fixes-quote-send.server");
          (out as Record<string, unknown>)['autoFixesQuotes'] = await timed("sweepAutoFixesQuotes", () => sweepAutoFixesQuotes());
        } catch (e) {
          console.error("allocation tick: automatic fixes quote sweep failed", (e as Error).message);
          (out as Record<string, unknown>)['autoFixesQuotes'] = "failed";
        }
        try {
          const { sweepDailyBrief } = await import("@/lib/daily-brief.server");
          (out as Record<string, unknown>)['dailyBrief'] = await timed("sweepDailyBrief", () => sweepDailyBrief());
        } catch (e) {
          console.error("allocation tick: daily brief failed", (e as Error).message);
          out['ok'] = false;
        }
        try {
          const { releaseQueuedQuotes } = await import("@/lib/quotes.server");
          (out as Record<string, unknown>)['quotes'] = await timed("releaseQueuedQuotes", () => releaseQueuedQuotes());
        } catch (e) {
          console.error("allocation tick: queued quote release failed", (e as Error).message);
          out['ok'] = false;
        }
        try {
          // Jo 24 Oct: retry held completed Ready Checks and watch sent ones for form edits (switched off with the auto send).
          const { sweepCompletedMittiReadyChecks } = await import("@/lib/mitti-complete.server");
          (out as Record<string, unknown>)['mittiCompleted'] = await timed("sweepCompletedMittiReadyChecks", () => sweepCompletedMittiReadyChecks());
        } catch (e) {
          console.error("allocation tick: completed Ready Check sweep failed", (e as Error).message);
        }
        try {
          // Runs BEFORE the automatic forms (Jo 24 Oct): a form the installer started himself is linked first, so a
          // job never gets a second, blank form. Stage 4: Mitti-first auto-pickup. OFF by default (workflow_settings.mitti_pickup_auto_enabled);
          // when ON, clean forms create installer-sourced jobs and link themselves — nothing is sent.
          const { sweepMittiPickupAuto } = await import("@/lib/mitti-pickup-auto.server");
          const a = await timed("sweepMittiPickupAuto", () => sweepMittiPickupAuto());
          (out as Record<string, unknown>)['mittiPickupAuto'] = { enabled: a.enabled, adopted: a.results.filter((x) => x.action === "created").length, review: a.results.filter((x) => x.action === "review" || x.action === "failed").length };
        } catch (e) {
          console.error("allocation tick: mitti auto-pickup failed", (e as Error).message);
          (out as Record<string, unknown>)['mittiPickupAuto'] = "failed";
        }
        try {
          // Jo 23 Oct: installer jobs get their Mitti Ready Check form automatically (same guarded create path as
          // the office button). Never sends to owners or changes stage.
          const { sweepReadyCheckForms } = await import("@/lib/mitti-autoform.server");
          const f = await timed("sweepReadyCheckForms", () => sweepReadyCheckForms());
          (out as Record<string, unknown>)['readyCheckForms'] = { checked: f.checked, created: f.results.filter((x) => x.outcome === "created").length, failed: f.results.filter((x) => x.outcome !== "created").length };
        } catch (e) {
          console.error("allocation tick: ready check form sweep failed", (e as Error).message);
          (out as Record<string, unknown>)['readyCheckForms'] = "failed";
        }
        try {
          // Decision 328: today's installs only — an A5 Install day form newly marked Complete is checked and the lead
          // installer texted the result once per form revision; at 5pm a still-incomplete form gets ONE reminder.
          // Runs before the long Mitti sync so today's sites are never starved. Events recorded before any send.
          const { sweepInstallDayForms } = await import("@/lib/install-day-confirm.server");
          (out as Record<string, unknown>)['installDayForms'] = await timed("sweepInstallDayForms", () => sweepInstallDayForms());
        } catch (e) {
          console.error("allocation tick: install day form check failed", (e as Error).message);
          (out as Record<string, unknown>)['installDayForms'] = "failed";
        }
        try {
          // Data only: same sync as the manual button. Never completes gates, moves stages or sends quotes.
          const { syncPendingMitti } = await import("@/lib/mitti.server");
          const r = await timed("syncPendingMitti", () => syncPendingMitti(null));
          (out as Record<string, unknown>)['mitti'] = { checked: r.length, failed: r.filter((x) => !x.ok).length };
        } catch (e) {
          console.error("allocation tick: mitti sync failed", (e as Error).message);
          (out as Record<string, unknown>)['mitti'] = "failed"; // Mitti outages must not fail the whole tick
        }
        try {
          // T6 Outbox executor worker entry point (leased claiming, same executor as the external-actions cron hook).
          // Claim uses SKIP LOCKED + leases, so running both entry points cannot double-send. While staged migration
          // 0204 is not applied the executor reports unavailable instead of failing the tick (fail closed).
          const { processExternalActionOutbox } = await import("@/lib/external-action-outbox.server");
          (out as Record<string, unknown>)['externalActions'] = await timed("processExternalActionOutbox", () => processExternalActionOutbox(20));
        } catch (e) {
          console.error("allocation tick: external action outbox failed", (e as Error).message);
          out['ok'] = false;
          (out as Record<string, unknown>)['externalActions'] = "failed";
        }
        try {
          // Decision 281: enquiries missing a suburb / postcode are completed from the address lookup (same provider as
          // Add a job), oldest first, one lookup per job per 7 days recorded as a workflow event. No sends. Runs LAST and
          // only with time to spare: on 25 Oct 2026 50 lookups per tick pushed the whole tick past the 55 s cron limit and
          // starved the Mitti sweeps above, so the batch is small and skipped when the tick is already slow.
          const elapsedMs = Date.now() - tickStartedAt;
          if (elapsedMs < 25_000) {
            const { completeEnquiryAddresses } = await import("@/lib/address-complete.server");
            (out as Record<string, unknown>)['addressCompletion'] = await timed("completeEnquiryAddresses", () => completeEnquiryAddresses({ batch: 8 }));
          } else {
            (out as Record<string, unknown>)['addressCompletion'] = { skipped: "tick already slow", elapsedMs };
          }
        } catch (e) {
          console.error("allocation tick: address completion sweep failed", (e as Error).message);
          (out as Record<string, unknown>)['addressCompletion'] = "failed"; // a lookup outage must not fail the whole tick
        }
        // Decision 382: refresh the saved Needs me copy last, after every sweep has moved jobs on.
        try {
          const { refreshNeedsMeSnapshot } = await import("@/lib/office-needs-snapshot.server");
          (out as Record<string, unknown>)['needsMeSnapshot'] = await timed("refreshNeedsMeSnapshot", () => refreshNeedsMeSnapshot());
        } catch (e) {
          console.error("allocation tick: Needs me copy not refreshed", (e as Error).message);
          (out as Record<string, unknown>)['needsMeSnapshot'] = "failed";
        }
        // Decision 383: and the saved default first pages of Jobs › Active and Enquiries.
        try {
          const { refreshListSnapshots } = await import("@/lib/office-needs-snapshot.server");
          (out as Record<string, unknown>)['listSnapshots'] = await timed("refreshListSnapshots", () => refreshListSnapshots());
        } catch (e) {
          console.error("allocation tick: list copies not refreshed", (e as Error).message);
          (out as Record<string, unknown>)['listSnapshots'] = "failed";
        }
        (out as Record<string, unknown>)['timingsMs'] = { total: Date.now() - tickStartedAt, ...timingsMs };
        return Response.json(out, { status: out['ok'] ? 200 : 500 });
      },
    },
  },
});
