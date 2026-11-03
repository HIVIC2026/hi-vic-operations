import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

// Claude's nightly listing check. GET = the homes still to look up (street address, no listing check yet), in order.
// POST = the results: one current `listing_check` fact per home; nothing else is written. Cron secret (Bearer).
export const Route = createFileRoute("/api/public/hooks/listing-facts")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const denied = await authenticateCronRequest(request);
        if (denied) return denied;
        const raw = Number(new URL(request.url).searchParams.get("limit"));
        const limit = Number.isInteger(raw) && raw > 0 ? Math.min(raw, 200) : 50;
        try {
          const { listingQueue } = await import("@/lib/listing-facts.server");
          return Response.json(await listingQueue(limit));
        } catch (e) {
          console.error("listing queue failed", (e as Error).message);
          return Response.json({ ok: false, error: "queue failed" }, { status: 500 });
        }
      },
      POST: async ({ request }) => {
        const denied = await authenticateCronRequest(request);
        if (denied) return denied;
        const core = await import("@/lib/listing-facts.core");
        const body = (await request.json().catch(() => null)) as { results?: unknown } | null;
        const results = body?.results;
        if (!Array.isArray(results) || Object.keys(body ?? {}).length !== 1)
          return Response.json(
            { ok: false, error: "expected { results: [...] }" },
            { status: 400 },
          );
        if (results.length > core.MAX_LISTING_RESULTS)
          return Response.json(
            { ok: false, error: `at most ${core.MAX_LISTING_RESULTS} results per call` },
            { status: 400 },
          );
        const bad = results.findIndex((r) => !core.listingResultValid(r));
        if (bad >= 0)
          return Response.json({ ok: false, error: `result ${bad} is not valid` }, { status: 400 });
        try {
          const { saveListingResults } = await import("@/lib/listing-facts.server");
          return Response.json({
            ok: true,
            ...(await saveListingResults(
              results as import("@/lib/listing-facts.core").ListingResult[],
            )),
          });
        } catch (e) {
          console.error("listing results failed", (e as Error).message);
          return Response.json({ ok: false, error: "save failed" }, { status: 500 });
        }
      },
    },
  },
});
