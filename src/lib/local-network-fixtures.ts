// D-7: deterministic FICTIONAL responses for the keyless address lookups used in local functional UAT.
// Only used by local-network-guard.ts when LOCAL UAT is on. Every place here is invented (Testville / Mockton /
// Stubbington, postcodes 3997–3999, matching local-supabase/supabase/seed.sql). Anything not matched returns null,
// which the guard turns into a blocked request — never a real call.
export type FixtureAddress = { id: string; number: string; road: string; suburb: string; postcode: string; lat: number; lon: number };

export const FIXTURE_ADDRESSES: readonly FixtureAddress[] = [
  { id: "local-fixture-1", number: "1", road: "Example Street", suburb: "Testville", postcode: "3999", lat: -37.9001, lon: 145.0001 },
  { id: "local-fixture-2", number: "12", road: "Example Street", suburb: "Testville", postcode: "3999", lat: -37.9002, lon: 145.0002 },
  { id: "local-fixture-3", number: "2", road: "Sample Avenue", suburb: "Mockton", postcode: "3998", lat: -37.9003, lon: 145.0003 },
  { id: "local-fixture-4", number: "3", road: "Fixture Road", suburb: "Stubbington", postcode: "3997", lat: -37.9004, lon: 145.0004 },
];
export const FIXTURE_REVERSE = FIXTURE_ADDRESSES[0]!;

const BASE44_HOST = "base44.app";
const BASE44_ADDRESS_PATH = "/api/apps/6ab0c47ee6cd14456bf15362/functions/address-search";
const NOMINATIM_HOST = "nominatim.openstreetmap.org";

const label = (a: FixtureAddress) => `${a.number} ${a.road}, ${a.suburb} VIC ${a.postcode}`;
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", "x-hivic-local-mock": "1" } });

/** Deterministic: addresses whose street/suburb/postcode contain a query word (3+ chars); all of them when none match. */
export function fixtureMatches(query: string): FixtureAddress[] {
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
  const hit = FIXTURE_ADDRESSES.filter((a) => words.some((w) => `${a.road} ${a.suburb} ${a.postcode}`.toLowerCase().includes(w)));
  return hit.length ? hit : [...FIXTURE_ADDRESSES];
}

const nominatimRow = (a: FixtureAddress, i: number) => ({
  place_id: 900000 + i, osm_type: "node", osm_id: 900000 + i, lat: String(a.lat), lon: String(a.lon), category: "place", type: "house",
  display_name: `${a.number}, ${a.road}, ${a.suburb}, Victoria, ${a.postcode}, Australia`,
  address: { house_number: a.number, road: a.road, suburb: a.suburb, state: "Victoria", postcode: a.postcode, country: "Australia", country_code: "au" },
});

function parseBody(body: string | null): Record<string, unknown> | null {
  if (!body) return null;
  try { const v = JSON.parse(body) as unknown; return v && typeof v === "object" ? (v as Record<string, unknown>) : null; } catch { return null; }
}

/** A mock Response for a recognised request, or null (the guard then blocks it). */
export async function localMockResponse(url: URL, method: string, body: string | null): Promise<Response | null> {
  const host = url.hostname.toLowerCase();
  if (host === BASE44_HOST && url.pathname === BASE44_ADDRESS_PATH && method === "POST") {
    const b = parseBody(body);
    if (b?.["action"] === "autocomplete" && typeof b["query"] === "string")
      return json({ suggestions: fixtureMatches(b["query"]).map((a) => ({ id: a.id, label: label(a) })) });
    if (b?.["action"] === "details" && typeof b["placeId"] === "string") {
      const a = FIXTURE_ADDRESSES.find((x) => x.id === b["placeId"]);
      if (!a) return null;
      return json({ address: { label: label(a), street: `${a.number} ${a.road}`, suburb: a.suburb, postcode: a.postcode, state: "VIC", latitude: a.lat, longitude: a.lon } });
    }
    return null;
  }
  if (host === NOMINATIM_HOST && method === "GET") {
    if (url.pathname === "/search") return json(fixtureMatches(url.searchParams.get("q") ?? "").map(nominatimRow));
    if (url.pathname === "/reverse") return json(nominatimRow(FIXTURE_REVERSE, 0));
    return null;
  }
  return null;
}
