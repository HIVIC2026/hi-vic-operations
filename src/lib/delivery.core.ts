// Provider-independent customer email delivery contract. Pure. No provider is connected.
export type DeliveryMessage = { to: string; subject: string; html: string; text: string; idempotencyKey: string; purpose: string };
export interface DeliveryAdapter { provider: string; deliver(msg: DeliveryMessage): Promise<{ providerMessageId: string | null }>; }

export type Base44BridgeConfig = { url: string; secret: string };
/** Base44 delivery bridge is configured only when BOTH an https endpoint URL and a signing secret exist. */
export function base44BridgeConfig(env: Record<string, string | undefined>): Base44BridgeConfig | null {
  const url = env["BASE44_DELIVERY_URL"]?.trim();
  const secret = env["BASE44_DELIVERY_SECRET"]?.trim();
  if (!url || !secret || secret.length < 32) return null;
  try { if (new URL(url).protocol !== "https:") return null; } catch { return null; }
  return { url, secret };
}
