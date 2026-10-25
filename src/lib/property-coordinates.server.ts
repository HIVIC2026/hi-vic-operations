// Fill a property's missing `coordinates` fact once, from the address search Add a job already uses, so the photo
// location check (geo.core) can run on installer / imported jobs. Read-only lookup; any failure → null (the photo check
// then refuses exactly as before). Never overwrites an existing current fact.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { coordinatesFromLookup, propertySearchText, type PropertyAddress } from "./property-coordinates.core";

export async function ensurePropertyCoordinates(jobId: string, propertyId: string, timeoutMs = 6000): Promise<[number, number] | null> {
  try {
    const { data: p } = await admin.from("properties").select("address_line, suburb, state, postcode").eq("id", propertyId).maybeSingle();
    const text = p ? propertySearchText(p as PropertyAddress) : null;
    if (!text) return null;
    const { searchAddressSuggestions, lookupAddressDetails } = await import("./address-lookup.server");
    const first = (await searchAddressSuggestions(text, timeoutMs))[0];
    if (!first) return null;
    const coords = coordinatesFromLookup(p as PropertyAddress, await lookupAddressDetails(first.id, timeoutMs));
    if (!coords) return null;
    const { data: existing } = await admin.from("property_facts").select("value").eq("property_id", propertyId).eq("fact_key", "coordinates").eq("is_current", true).limit(1).maybeSingle();
    if (existing) return Array.isArray(existing.value) ? (existing.value as [number, number]) : coords;
    await admin.from("property_facts").insert({
      job_id: jobId, property_id: propertyId, fact_key: "coordinates", value: coords as never, check_status: "info",
      source_type: "address_search", source_name: "Google Places (website address search)", confidence: "medium", evidence_kind: "direct",
      note: "Filled for the photo location check (night run 25 Oct 2026): same postcode and suburb as the job address.",
    });
    return coords;
  } catch (e) {
    console.error("property coordinates lookup skipped", (e as Error).message);
    return null;
  }
}
