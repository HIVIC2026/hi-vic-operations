// The linked Australian (AU1) connection supplies region routing through the gateway.
// Never fall back to the older US1 connection or expose connection credentials.
import { TWILIO_FETCH_TIMEOUT_MS, timeoutSignal } from "./network-timeout.core";

const HOST = "https://connector-gateway.lovable.dev/twilio";

function creds() {
  const appKey = process.env["LOVABLE_API_KEY"], connectionKey = process.env["TWILIO_API_KEY_1"];
  if (!appKey || !connectionKey) return null;
  return { headers: { Authorization: `Bearer ${appKey}`, "X-Connection-Api-Key": connectionKey } };
}
export const au1Configured = () => creds() !== null;

/** POST /Messages.json in AU1. Returns the raw HTTP result so callers keep their own status rules. */
export async function au1SendMessage(params: URLSearchParams): Promise<{ ok: boolean; status: number; text: string }> {
  const c = creds();
  if (!c) return { ok: false, status: 0, text: "Australian SMS connection is not configured" };
  const res = await fetch(`${HOST}/Messages.json`, { method: "POST", headers: { ...c.headers, "Content-Type": "application/x-www-form-urlencoded" }, body: params, signal: timeoutSignal(TWILIO_FETCH_TIMEOUT_MS) });
  return { ok: res.ok, status: res.status, text: await res.text() };
}

export async function au1Get(path: string): Promise<{ ok: boolean; status: number; json: any }> {
  const c = creds();
  if (!c) return { ok: false, status: 0, json: { message: "Twilio AU1 is not set up" } };
  const res = await fetch(`${HOST}${path}`, { headers: c.headers, signal: timeoutSignal(TWILIO_FETCH_TIMEOUT_MS) });
  return { ok: res.ok, status: res.status, json: await res.json().catch(() => null) };
}
