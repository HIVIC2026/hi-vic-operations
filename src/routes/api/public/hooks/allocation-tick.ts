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
          const { sweepInstallHolds } = await import("@/lib/install-holds.server");
          (out as Record<string, unknown>)['installHolds'] = await sweepInstallHolds();
        } catch (e) {
          console.error("allocation tick: install hold sweep failed", (e as Error).message);
          out['ok'] = false;
          (out as Record<string, unknown>)['installHolds'] = "failed";
        }
        try {
          // Jo 24 Oct (decision 111): signed PIESA copy to the owner and installer once the install day is booked.
          // Held behind PIESA_COPY_EMAIL_APPROVED (false) for real jobs; TEST jobs use the allowlisted test sender.
          const { sweepPiesaCopyDeliveries } = await import("@/lib/piesa-delivery.server");
          (out as Record<string, unknown>)['piesaCopies'] = await sweepPiesaCopyDeliveries();
        } catch (e) {
          console.error("allocation tick: PIESA copy delivery sweep failed", (e as Error).message);
          (out as Record<string, unknown>)['piesaCopies'] = "failed";
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
          const { sweepInstallDays } = await import("@/lib/install-days.server");
          (out as Record<string, unknown>)['installDays'] = await sweepInstallDays();
        } catch (e) {
          console.error("allocation tick: install day sweep failed", (e as Error).message);
          out['ok'] = false;
          (out as Record<string, unknown>)['installDays'] = "failed";
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
        return Response.json(out, { status: out['ok'] ? 200 : 500 });
      },
    },
  },
});
