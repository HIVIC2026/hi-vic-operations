/**
 * Public address type-ahead for the calculator and the "register your interest"
 * band.
 *
 * The browser cannot search OpenStreetMap itself (it must send a proper
 * User-Agent and the free service allows one request per second), so the
 * portal's own server does the lookup and hands back the raw rows. The
 * client-side rules that decide what is a usable suggestion live in
 * src/lib/address.core.ts, where they are tested.
 *
 * Nothing is stored: no address, no query, no result.
 */
import { createFileRoute } from "@tanstack/react-router";

const UPSTREAM = "https://nominatim.openstreetmap.org/search";
const USER_AGENT =
  "HomeInsulationVictoria-OperationsPortal/1.0 (https://homeinsulationvictoria.com.au)";

/** Letters, numbers and the punctuation an Australian address actually uses. */
const SAFE_QUERY = /^[\p{L}\p{N}\s,.'#/-]{4,100}$/u;

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export const Route = createFileRoute("/api/public/address-search")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const q = (url.searchParams.get("q") ?? "").replace(/\s+/g, " ").trim();
        if (!SAFE_QUERY.test(q)) return json({ error: "Please enter a valid address to search." }, { status: 400 });

        const params = new URLSearchParams({
          q,
          format: "jsonv2",
          limit: "6",
          countrycodes: "au",
          addressdetails: "1",
          "accept-language": "en",
        });

        try {
          const upstream = await fetch(`${UPSTREAM}?${params}`, {
            headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
            signal: AbortSignal.timeout(4000),
          });
          if (!upstream.ok) return json({ results: [] }, 502);
          const data = (await upstream.json()) as unknown;
          return json({ results: Array.isArray(data) ? data : [] });
        } catch {
          return json({ results: [] }, 502);
        }
      },
    },
  },
});
