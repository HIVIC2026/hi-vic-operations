// Proxy to the existing Home Insulation Victoria website address-search service (Base44, Google Places, AU-only).
// Public like the website form; no secrets here. Read-only lookups, bounded input and output.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const BASE44_ADDRESS_SEARCH = "https://base44.app/api/apps/6ab0c47ee6cd14456bf15362/functions/address-search";

async function call(body: unknown) {
  const res = await fetch(BASE44_ADDRESS_SEARCH, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Address search failed [${res.status}]`);
  return (await res.json()) as Record<string, unknown>;
}

const str = (v: unknown, max = 300) => (typeof v === "string" ? v.slice(0, max) : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export const searchAddresses = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ query: z.string().trim().min(4).max(200) }).parse(d))
  .handler(async ({ data }) => {
    const r = await call({ action: "autocomplete", query: data.query });
    const list = Array.isArray(r.suggestions) ? r.suggestions : [];
    return list.slice(0, 6).flatMap((s) => {
      const o = s as Record<string, unknown>;
      const id = str(o.id, 600), label = str(o.label);
      return id && label ? [{ id, label }] : [];
    });
  });

export const addressDetails = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ placeId: z.string().min(1).max(600) }).parse(d))
  .handler(async ({ data }) => {
    const r = await call({ action: "details", placeId: data.placeId });
    const a = (r.address ?? null) as Record<string, unknown> | null;
    if (!a) return null;
    return { label: str(a.label) ?? "", street: str(a.street), suburb: str(a.suburb), postcode: str(a.postcode, 10), state: str(a.state, 20), latitude: num(a.latitude), longitude: num(a.longitude) };
  });
