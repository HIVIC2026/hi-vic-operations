// Who books the safety check (PIESA) and the upgrades day for an installer business — ONE reader for the Part 5 setting
// `businesses.piesa_booked_by` (My business › Who books; installer-business-settings.sql). Used by the Job page / My work
// (trade-view.server), the electrician's no-login link (electrician-link.server) and main's Part 2 own-job readers.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { whoBooksOf, type WhoBooks } from "./business-screen.core";
import { isMissingDbObject } from "./schema-compat.core";

/** The pending column missing, a failed read, no business or an unknown value → "office" (the link then never books). */
export async function whoBooksFor(businessId: string | null): Promise<WhoBooks> {
  if (!businessId) return "office";
  const r = await ((admin as unknown as { from: (t: string) => any }).from("businesses").select("piesa_booked_by").eq("id", businessId).maybeSingle() as Promise<{ data: { piesa_booked_by?: unknown } | null; error: { code?: string; message: string } | null }>); // eslint-disable-line @typescript-eslint/no-explicit-any
  if (r.error && !isMissingDbObject(r.error) && !["42703", "PGRST204"].includes(r.error.code ?? "")) console.error("whoBooksFor: who-books could not be read", r.error.code ?? "unknown");
  return whoBooksOf(r.error ? undefined : r.data?.piesa_booked_by);
}
