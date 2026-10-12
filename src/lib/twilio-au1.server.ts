// Twilio Australian region (edge sydney, region au1). Jo's account lives in AU1, which the connector gateway
// cannot reach, so every text goes direct with her AU1 API key (secrets read per call, never logged).
import { TWILIO_FETCH_TIMEOUT_MS, timeoutSignal } from "./network-timeout.core";

const HOST = "https://api.sydney.au1.twilio.com/2010-04-01";

function creds() {
  const account = process.env["TWILIO_AU1_ACCOUNT_SID"], keySid = process.env["TWILIO_AU1_API_KEY_SID"], secret = process.env["TWILIO_AU1_API_KEY_SECRET"];
  if (!account || !keySid || !secret) return null;
  return { account, auth: `Basic ${btoa(`${keySid}:${secret}`)}` };
}
export const au1Configured = () => creds() !== null;

/** POST /Messages.json in AU1. Returns the raw HTTP result so callers keep their own status rules. */
export async function au1SendMessage(params: URLSearchParams): Promise<{ ok: boolean; status: number; text: string }> {
  const c = creds();
  if (!c) return { ok: false, status: 0, text: "Twilio AU1 is not set up (TWILIO_AU1_ACCOUNT_SID / TWILIO_AU1_API_KEY_SID / TWILIO_AU1_API_KEY_SECRET missing)" };
  const res = await fetch(`${HOST}/Accounts/${c.account}/Messages.json`, { method: "POST", headers: { Authorization: c.auth, "Content-Type": "application/x-www-form-urlencoded" }, body: params, signal: timeoutSignal(TWILIO_FETCH_TIMEOUT_MS) });
  return { ok: res.ok, status: res.status, text: await res.text() };
}

export async function au1Get(path: string): Promise<{ ok: boolean; status: number; json: any }> {
  const c = creds();
  if (!c) return { ok: false, status: 0, json: { message: "Twilio AU1 is not set up" } };
  const res = await fetch(`${HOST}/Accounts/${c.account}${path}`, { headers: { Authorization: c.auth }, signal: timeoutSignal(TWILIO_FETCH_TIMEOUT_MS) });
  return { ok: res.ok, status: res.status, json: await res.json().catch(() => null) };
}
