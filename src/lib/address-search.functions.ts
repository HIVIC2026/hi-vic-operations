// Proxy to the existing Home Insulation Victoria website address-search service (Base44, Google Places, AU-only).
// Public like the website form; no secrets here. Read-only lookups, bounded input and output. The fetch itself lives
// in address-lookup.server.ts so the enquiry address completion (decision 281) shares exactly the same provider.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const searchAddresses = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ query: z.string().trim().min(4).max(200) }).parse(d))
  .handler(async ({ data }) => {
    const { searchAddressSuggestions } = await import("./address-lookup.server");
    return searchAddressSuggestions(data.query);
  });

export const addressDetails = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ placeId: z.string().min(1).max(600) }).parse(d))
  .handler(async ({ data }) => {
    const { lookupAddressDetails } = await import("./address-lookup.server");
    return lookupAddressDetails(data.placeId);
  });
