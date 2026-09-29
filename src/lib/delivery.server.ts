// Base44 delivery bridge adapter. Config lives only in the service-role-only customer_delivery_settings row (id=1),
// read per call. Disabled/missing/invalid config => null (nothing can be delivered). The secret is never logged.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { base44BridgeConfig, bridgeAdapter, type DeliveryAdapter } from "./delivery.core";

export async function configuredDeliveryAdapter(): Promise<DeliveryAdapter | null> {
  const { data, error } = await admin.from("customer_delivery_settings").select("provider, endpoint_url, hmac_secret, enabled").eq("id", 1).maybeSingle();
  if (error || !data) return null;
  const cfg = base44BridgeConfig(data);
  return cfg ? bridgeAdapter(cfg) : null;
}
