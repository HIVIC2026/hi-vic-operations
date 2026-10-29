// Pure parts of scripts/register-mitti-webhook.ts. No I/O.
import { MITTI_NOTICE_EVENTS } from "../src/lib/mitti-webhook.core";

// CONFIRM BEFORE --apply: the exact body field names and event names below must be checked against
// Mitti's developer docs (developer.mitti.com -> Webhooks). If Mitti rejects the call, this constant
// and buildRegistration() are the only things to change.
export const WEBHOOK_EVENTS: readonly string[] = MITTI_NOTICE_EVENTS;

// Same host as MITTI_BASE_URL in src/lib/mitti.server.ts (not exported there). Webhook path is unconfirmed.
export const MITTI_WEBHOOK_ENDPOINT = "https://api.mitti.com/webhooks/v1";

export function maskToken(t: string): string {
  return t.length <= 4 ? "…" : `${t.slice(0, 4)}…`;
}

export function buildRegistration(portalUrl: string, webhookToken: string) {
  const base = portalUrl.replace(/\/+$/, "");
  const url = `${base}/api/public/hooks/mitti-audit?t=${encodeURIComponent(webhookToken)}`;
  const body = { url, trigger_events: [...WEBHOOK_EVENTS] };
  const maskedBody = { ...body, url: url.replace(encodeURIComponent(webhookToken), maskToken(webhookToken)) };
  return { endpoint: MITTI_WEBHOOK_ENDPOINT, body, maskedBody };
}

export function missingEnv(env: Record<string, string | undefined>): string[] {
  return ["MITTI_API_TOKEN", "MITTI_WEBHOOK_TOKEN", "PORTAL_PUBLIC_URL"].filter((k) => !env[k]);
}
