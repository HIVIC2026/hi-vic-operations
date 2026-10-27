// Jo authorised the linked US1 messaging connection on 21 Oct 23:56 UTC.
// Keep legacy export names for callers; never retry/fall back to another connection.
import { TWILIO_FETCH_TIMEOUT_MS, timeoutSignal } from "./network-timeout.core";

const HOST = "https://connector-gateway.lovable.dev/twilio";

function creds() {
  const appKey = process.env["LOVABLE_API_KEY"], connectionKey = process.env["TWILIO_API_KEY"];
  if (!appKey || !connectionKey) return null;
  return { headers: { Authorization: `Bearer ${appKey}`, "X-Connection-Api-Key": connectionKey } };
}
export const au1Configured = () => creds() !== null;

/** POST /Messages.json through the explicitly selected US1 connection; preserve caller status rules. */
export async function au1SendMessage(params: URLSearchParams): Promise<{ ok: boolean; status: number; text: string }> {
  if ((await import("./qa-context.server")).qaContextActive()) return { ok: false, status: 0, text: "TEST preview delivery blocked; no SMS service called" };
  const c = creds();
  if (!c) return { ok: false, status: 0, text: "SMS connection is not configured" };
  const res = await fetch(`${HOST}/Messages.json`, { method: "POST", headers: { ...c.headers, "Content-Type": "application/x-www-form-urlencoded" }, body: params, signal: timeoutSignal(TWILIO_FETCH_TIMEOUT_MS) });
  return { ok: res.ok, status: res.status, text: await res.text() };
}

export async function au1Get(path: string): Promise<{ ok: boolean; status: number; json: any }> {
  const c = creds();
  if (!c) return { ok: false, status: 0, json: { message: "Twilio SMS is not set up" } };
  const res = await fetch(`${HOST}${path}`, { headers: c.headers, signal: timeoutSignal(TWILIO_FETCH_TIMEOUT_MS) });
  return { ok: res.ok, status: res.status, json: await res.json().catch(() => null) };
}
