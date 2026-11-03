import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { piesaBookerOf, type PiesaBooker } from "./piesa-booker.core";

/** Fail closed: a missing column (pending SQL not applied) or any read error gives "office". */
export async function readPiesaBooker(businessId: string): Promise<PiesaBooker> {
  try {
    // Local schema overlay until Jo applies the pending SQL; generated types are not deployment proof.
    const db = admin as unknown as SupabaseClient;
    const { data, error } = await db.from("businesses").select("piesa_booked_by").eq("id", businessId).maybeSingle();
    if (error) return "office";
    return piesaBookerOf((data as { piesa_booked_by?: unknown } | null)?.piesa_booked_by);
  } catch {
    return "office";
  }
}
