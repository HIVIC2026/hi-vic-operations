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
        const { sweepRecOffers, sweepCoordination } = await import("@/lib/allocation.server");
        const out: { ok: boolean; offers?: unknown; coordination?: unknown } = { ok: true };
        try {
          const o = await sweepRecOffers();
          out['offers'] = { expired: o.expired, started: Array.isArray(o.started) ? o.started.length : o.started };
        } catch (e) {
          console.error("allocation tick: offer sweep failed", (e as Error).message);
          out['ok'] = false;
          out['offers'] = "failed";
        }
        try {
          const c = await sweepCoordination();
          out['coordination'] = typeof c === "object" && c ? Object.fromEntries(Object.entries(c).filter(([, v]) => typeof v === "number")) : null;
        } catch (e) {
          console.error("allocation tick: coordination sweep failed", (e as Error).message);
          out['ok'] = false;
          out['coordination'] = "failed";
        }
        try {
          const { sweepQuoteExpiry } = await import("@/lib/quote-expiry.server");
          (out as Record<string, unknown>)['quotes'] = await sweepQuoteExpiry();
        } catch (e) {
          console.error("allocation tick: quote expiry sweep failed", (e as Error).message);
          out['ok'] = false;
          (out as Record<string, unknown>)['quotes'] = "failed";
        }
        try {
          const { sweepRectQuotes, sweepHeldRectWindows } = await import("@/lib/rectification.server");
          (out as Record<string, unknown>)['rectification'] = { ...(await sweepRectQuotes()), ...(await sweepHeldRectWindows()) };
        } catch (e) {
          console.error("allocation tick: electrical fixes sweep failed", (e as Error).message);
          out['ok'] = false;
          (out as Record<string, unknown>)['rectification'] = "failed";
        }
        try {
          // Decision 293: open "A5 – Electrical fixes" Mitti forms — on Complete, Section C is recorded and the files kept.
          const { sweepFixesForms } = await import("@/lib/fixes-day.server");
          (out as Record<string, unknown>)['fixesForms'] = await sweepFixesForms();
        } catch (e) {
          console.error("allocation tick: fixes form sweep failed", (e as Error).message);
          out['ok'] = false;
          (out as Record<string, unknown>)['fixesForms'] = "failed";
        }
        try {
          const { sweepInstallHolds } = await import("@/lib/install-holds.server");
          (out as Record<string, unknown>)['installHolds'] = await sweepInstallHolds();
        } catch (e) {
          console.error("allocation tick: install hold sweep failed", (e as Error).message);
          out['ok'] = false;
          (out as Record<string, unknown>)['installHolds'] = "failed";
        }
        try {
          // Jo 24 Oct (decision 111): signed PIESA copy to the owner and installer once the install day is booked.
          // Real jobs: PIESA_COPY_EMAIL_APPROVED (on, decision 131) + customer_comms_enabled; TEST jobs use the allowlisted test sender.
          const { sweepPiesaCopyDeliveries } = await import("@/lib/piesa-delivery.server");
          (out as Record<string, unknown>)['piesaCopies'] = await sweepPiesaCopyDeliveries();
        } catch (e) {
          console.error("allocation tick: PIESA copy delivery sweep failed", (e as Error).message);
          (out as Record<string, unknown>)['piesaCopies'] = "failed";
        }
        try {
          // Decision 296: owner asked to confirm the PIESA on their secure link (email O71 + text) after the electrician completes it,
          // reminders days 1/3, office alert day 5. DRAFT wording: real owners get nothing until approved; TEST jobs use test-send.
          const { sweepOwnerPiesaConfirmations } = await import("@/lib/piesa-owner-confirm-send.server");
          (out as Record<string, unknown>)['piesaOwnerConfirm'] = await sweepOwnerPiesaConfirmations();
        } catch (e) {
          console.error("allocation tick: PIESA owner confirmation sweep failed", (e as Error).message);
          (out as Record<string, unknown>)['piesaOwnerConfirm'] = "failed";
        }
        try {
          // Decision 120: owner asked to sign the VEEC assignment form (email + text) at install completion, days 1/3/7, office alert day 10.
          const { sweepVeecReminders } = await import("@/lib/veec-reminders.server");
          (out as Record<string, unknown>)['veecReminders'] = await sweepVeecReminders();
        } catch (e) {
          console.error("allocation tick: VEEC reminder sweep failed", (e as Error).message);
          (out as Record<string, unknown>)['veecReminders'] = "failed";
        }
        try {
          // VEU checklist G1 (Jo 25 Oct): completion pack (O47) once the install is complete and the invoice paid in full, with the
          // installed product's manufacturer warranty attached, filed on the job and `warranty_copy_provided` recorded at that send.
          const { sweepCompletionPacks } = await import("@/lib/completion-pack.server");
          (out as Record<string, unknown>)['completionPacks'] = await sweepCompletionPacks();
        } catch (e) {
          console.error("allocation tick: completion pack sweep failed", (e as Error).message);
          (out as Record<string, unknown>)['completionPacks'] = "failed";
        }
        try {
          // Decision 271: Section 3 Part A of the VEEC assignment form signs itself once the installer has signed and every prerequisite is recorded.
          const { sweepAutoApSignatures } = await import("@/lib/veec-ap-auto.server");
          (out as Record<string, unknown>)['veecApAuto'] = await sweepAutoApSignatures();
        } catch (e) {
          console.error("allocation tick: automatic AP signature sweep failed", (e as Error).message);
          (out as Record<string, unknown>)['veecApAuto'] = "failed";
        }
        try {
          const { sweepInstallDays } = await import("@/lib/install-days.server");
          (out as Record<string, unknown>)['installDays'] = await sweepInstallDays();
        } catch (e) {
          console.error("allocation tick: install day sweep failed", (e as Error).message);
          out['ok'] = false;
          (out as Record<string, unknown>)['installDays'] = "failed";
        }
        try {
          // Decision 186: installer told once when electrical clearance is in (text + email, offer 3 install days).
          // Catch-up only: jobs cleared in the last 7 days with nothing booked and no notice yet; the live trigger is
          // the PIESA completion / Section C sign-off itself.
          const { sweepInstallClearance } = await import("@/lib/install-clearance.server");
          (out as Record<string, unknown>)['installClearance'] = await sweepInstallClearance();
        } catch (e) {
          console.error("allocation tick: install clearance sweep failed", (e as Error).message);
          (out as Record<string, unknown>)['installClearance'] = "failed";
        }
        try {
          // Decisions 79/82/99 (built per 193): "Install tomorrow" to the installer from the afternoon before, and a 24h
          // catch-up for the owner-suggested-days and Ready-Check-booked installer texts whose live trigger was missed.
          // One `installer_text_prepared` event per text before sending; TEST → test-send; real → sendRealSms.
          const { sweepInstallerTexts } = await import("@/lib/installer-texts.server");
          (out as Record<string, unknown>)['installerTexts'] = await sweepInstallerTexts();
        } catch (e) {
          console.error("allocation tick: installer texts sweep failed", (e as Error).message);
          (out as Record<string, unknown>)['installerTexts'] = "failed";
        }
        try {
          // Decision 238: estimate-only leads get a reminder on day 2, 7 and 21 after the estimate email, then an
          // automatic close a week after the day-21 email (held until the wording is approved; TEST → test sender).
          const { sweepEstimateFollowups } = await import("@/lib/estimate-followup.server");
          (out as Record<string, unknown>)['estimateFollowups'] = await sweepEstimateFollowups();
        } catch (e) {
          console.error("allocation tick: estimate follow-up sweep failed", (e as Error).message);
          (out as Record<string, unknown>)['estimateFollowups'] = "failed";
        }
        try {
          // Decision 158: 20/10-day reminders to owner + installer (held until approved; TEST → test sender) and the
          // repeat-PIESA payer record when the 30-day window lapses with nothing booked.
          const { sweepInstallWindowRule } = await import("@/lib/thirty-day-rule.server");
          (out as Record<string, unknown>)['installWindowRule'] = await sweepInstallWindowRule();
        } catch (e) {
          console.error("allocation tick: 30-day rule sweep failed", (e as Error).message);
          (out as Record<string, unknown>)['installWindowRule'] = "failed";
        }
        try {
          // Decision 139: Xero payment poll fallback (env XERO_PAYMENT_POLL_ENABLED=true) and the 48h provisional
          // install-booking release (deposit unpaid). Office alerts only; the owner notice is held behind approval.
          const { sweepProvisionalBookings } = await import("@/lib/payments.server");
          const { pollXeroPayments } = await import("@/lib/xero.server");
          (out as Record<string, unknown>)['payments'] = { poll: await pollXeroPayments(), provisional: await sweepProvisionalBookings() };
        } catch (e) {
          console.error("allocation tick: payments sweep failed", (e as Error).message);
          (out as Record<string, unknown>)['payments'] = "failed"; // a Xero outage must not fail the whole tick
        }
        try {
          // Decision 303: ONE REC onboarding invite per electrician an installer named who is not an approved REC
          // (facts recorded by the quote pipeline; sends only through the existing manual invite path, TEST → test inbox).
          const { sweepRecOnboardingInvites } = await import("@/lib/rec-onboarding-invite.server");
          (out as Record<string, unknown>)['recOnboardingInvites'] = await sweepRecOnboardingInvites();
        } catch (e) {
          console.error("allocation tick: REC onboarding invite sweep failed", (e as Error).message);
          (out as Record<string, unknown>)['recOnboardingInvites'] = "failed";
        }
        try {
          const { sweepTradeNoShows } = await import("@/lib/visit-events.server");
          (out as Record<string, unknown>)['tradeNoShows'] = await sweepTradeNoShows();
        } catch (e) {
          console.error("allocation tick: trade no-show sweep failed", (e as Error).message);
          out['ok'] = false;
        }
        try {
          const { sweepReadyCheckOffers } = await import("@/lib/readycheck-booking.server");
          (out as Record<string, unknown>)['readyCheck'] = await sweepReadyCheckOffers();
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
          (out as Record<string, unknown>)['autoOffers'] = await sweepAutoOffers();
        } catch (e) {
          console.error("allocation tick: automatic offers sweep failed", (e as Error).message);
          (out as Record<string, unknown>)['autoOffers'] = "failed";
        }
        try {
          const { sweepPrestart } = await import("@/lib/prestart.server");
          (out as Record<string, unknown>)['prestart'] = await sweepPrestart();
        } catch (e) {
          console.error("allocation tick: pre-start sweep failed", (e as Error).message);
          out['ok'] = false;
          (out as Record<string, unknown>)['prestart'] = "failed";
        }
        try {
          // Jo 24 Oct (decision 121): ESC install-notification reminders — window open (5 days), urgent (48h), blocked
          // (24h), reopened after a date change. Internal Office alerts only; nothing goes to owners or trades.
          const { sweepEscReminders } = await import("@/lib/esc.server");
          (out as Record<string, unknown>)['escReminders'] = await sweepEscReminders();
        } catch (e) {
          console.error("allocation tick: ESC reminder sweep failed", (e as Error).message);
          out['ok'] = false;
          (out as Record<string, unknown>)['escReminders'] = "failed";
        }
        try {
          // Jo 24 Oct: the install-day PIISA Mitti form is created the day(s) before the install (same guarded path as
          // the office button, one per job) so the 6:30am text below can link it. Runs BEFORE the daily text.
          const { sweepPiisaAutoSend } = await import("@/lib/piisa-autosend.server");
          const a = await sweepPiisaAutoSend();
          (out as Record<string, unknown>)['piisaAutoSend'] = { checked: a.checked, created: a.results.filter((x) => x.outcome === "created").length, failed: a.results.filter((x) => x.outcome === "failed").length };
        } catch (e) {
          console.error("allocation tick: PIISA auto-send failed", (e as Error).message);
          (out as Record<string, unknown>)['piisaAutoSend'] = "failed"; // Mitti outages must not fail the whole tick
        }
        try {
          // Daily Mitti links text: switch OFF by default; sends nothing unless ON and form IDs are set.
          const { sweepDailyMittiTexts } = await import("@/lib/daily-mitti-text.server");
          (out as Record<string, unknown>)['dailyMittiText'] = await sweepDailyMittiTexts();
          // Stage 5: one-off "Ready Check booked" text to the installer (same switch, TEST-only, send-once).
          const { sweepReadyCheckBookedTexts } = await import("@/lib/daily-mitti-text.server");
          (out as Record<string, unknown>)['readyCheckBookedText'] = await sweepReadyCheckBookedTexts();
        } catch (e) {
          console.error("allocation tick: daily mitti text failed", (e as Error).message);
          out['ok'] = false;
        }
        try {
          // Decision 130: each installer person's ESC collection notice link (first send, then 3- and 7-day reminders)
          // through the guarded senders; real texts/emails stay held until the wording is approved. Counts only.
          const { sweepCollectionNoticeLinks } = await import("@/lib/esc-collection-notice-send.server");
          (out as Record<string, unknown>)['escNoticeLinks'] = await sweepCollectionNoticeLinks();
        } catch (e) {
          console.error("allocation tick: ESC notice link sweep failed", (e as Error).message);
          (out as Record<string, unknown>)['escNoticeLinks'] = "failed";
        }
        try {
          const { sweepVisitReminders } = await import("@/lib/daily-brief.server");
          (out as Record<string, unknown>)['reminders'] = await sweepVisitReminders();
        } catch (e) {
          console.error("allocation tick: visit reminder sweep failed", (e as Error).message);
          out['ok'] = false;
        }
        try {
          const { sweepDailyBrief } = await import("@/lib/daily-brief.server");
          (out as Record<string, unknown>)['dailyBrief'] = await sweepDailyBrief();
        } catch (e) {
          console.error("allocation tick: daily brief failed", (e as Error).message);
          out['ok'] = false;
        }
        try {
          const { releaseQueuedQuotes } = await import("@/lib/quotes.server");
          (out as Record<string, unknown>)['quotes'] = await releaseQueuedQuotes();
        } catch (e) {
          console.error("allocation tick: queued quote release failed", (e as Error).message);
          out['ok'] = false;
        }
        try {
          // Jo 24 Oct: retry held completed Ready Checks and watch sent ones for form edits (switched off with the auto send).
          const { sweepCompletedMittiReadyChecks } = await import("@/lib/mitti-complete.server");
          (out as Record<string, unknown>)['mittiCompleted'] = await sweepCompletedMittiReadyChecks();
        } catch (e) {
          console.error("allocation tick: completed Ready Check sweep failed", (e as Error).message);
        }
        try {
          // Runs BEFORE the automatic forms (Jo 24 Oct): a form the installer started himself is linked first, so a
          // job never gets a second, blank form. Stage 4: Mitti-first auto-pickup. OFF by default (workflow_settings.mitti_pickup_auto_enabled);
          // when ON, clean forms create installer-sourced jobs and link themselves — nothing is sent.
          const { sweepMittiPickupAuto } = await import("@/lib/mitti-pickup-auto.server");
          const a = await sweepMittiPickupAuto();
          (out as Record<string, unknown>)['mittiPickupAuto'] = { enabled: a.enabled, adopted: a.results.filter((x) => x.action === "created").length, review: a.results.filter((x) => x.action === "review" || x.action === "failed").length };
        } catch (e) {
          console.error("allocation tick: mitti auto-pickup failed", (e as Error).message);
          (out as Record<string, unknown>)['mittiPickupAuto'] = "failed";
        }
        try {
          // Jo 23 Oct: installer jobs get their Mitti Ready Check form automatically (same guarded create path as
          // the office button). Never sends to owners or changes stage.
          const { sweepReadyCheckForms } = await import("@/lib/mitti-autoform.server");
          const f = await sweepReadyCheckForms();
          (out as Record<string, unknown>)['readyCheckForms'] = { checked: f.checked, created: f.results.filter((x) => x.outcome === "created").length, failed: f.results.filter((x) => x.outcome !== "created").length };
        } catch (e) {
          console.error("allocation tick: ready check form sweep failed", (e as Error).message);
          (out as Record<string, unknown>)['readyCheckForms'] = "failed";
        }
        try {
          // Data only: same sync as the manual button. Never completes gates, moves stages or sends quotes.
          const { syncPendingMitti } = await import("@/lib/mitti.server");
          const r = await syncPendingMitti(null);
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
          (out as Record<string, unknown>)['externalActions'] = await processExternalActionOutbox(20);
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
            (out as Record<string, unknown>)['addressCompletion'] = await completeEnquiryAddresses({ batch: 8 });
          } else {
            (out as Record<string, unknown>)['addressCompletion'] = { skipped: "tick already slow", elapsedMs };
          }
        } catch (e) {
          console.error("allocation tick: address completion sweep failed", (e as Error).message);
          (out as Record<string, unknown>)['addressCompletion'] = "failed"; // a lookup outage must not fail the whole tick
        }
        return Response.json(out, { status: out['ok'] ? 200 : 500 });
      },
    },
  },
});
