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
          console.error("allocation tick: rectification sweep failed", (e as Error).message);
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
          const { sweepInstallDays } = await import("@/lib/install-days.server");
          (out as Record<string, unknown>)['installDays'] = await sweepInstallDays();
        } catch (e) {
          console.error("allocation tick: install day sweep failed", (e as Error).message);
          out['ok'] = false;
          (out as Record<string, unknown>)['installDays'] = "failed";
        }
        try {
          const { sweepPrestart } = await import("@/lib/prestart.server");
          (out as Record<string, unknown>)['prestart'] = await sweepPrestart();
        } catch (e) {
          console.error("allocation tick: pre-start sweep failed", (e as Error).message);
          out['ok'] = false;
          (out as Record<string, unknown>)['prestart'] = "failed";
        }
        return Response.json(out, { status: out['ok'] ? 200 : 500 });
      },
    },
  },
});
