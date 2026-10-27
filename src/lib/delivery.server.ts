// Base44 delivery bridge adapter. Config lives only in the service-role-only customer_delivery_settings row (id=1),
// read per call. Disabled/missing/invalid config => null (nothing can be delivered). The secret is never logged.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { base44BridgeConfig, bridgeAdapter, type DeliveryAdapter } from "./delivery.core";

export async function configuredDeliveryAdapter(): Promise<DeliveryAdapter | null> {
  if ((await import("./qa-context.server")).qaContextActive()) return null;
  const { data, error } = await admin.from("customer_delivery_settings").select("provider, endpoint_url, hmac_secret, enabled").eq("id", 1).maybeSingle();
  if (error || !data) return null;
  const cfg = base44BridgeConfig(data);
  if (!cfg) return null;
  const adapter = bridgeAdapter(cfg);
  return { ...adapter, async deliver(msg) {
    if ((await import("./qa-context.server")).qaContextActive() || (await import("./qa-request.core")).qaPerson(msg.to)) throw new (await import("./delivery.core")).DeliveryRejectedError("TEST preview delivery blocked; no email service called");
    return adapter.deliver(msg);
  } };
}
