// D-7: LOCAL UAT network isolation. Inert in production.
//
// When the app runs against the isolated local Supabase (local-supabase/dev-local.ts sets HIVIC_LOCAL_UAT=1 and
// VITE_HIVIC_LOCAL_UAT=1; a loopback Supabase URL also switches it on), the global `fetch` is wrapped on the server
// AND in the browser:
//   * loopback (127.0.0.1 / localhost / ::1 / *.localhost) and same-origin relative URLs pass through unchanged;
//   * the keyless lookups that functional UAT needs (Base44 address search, Nominatim search + reverse) get
//     deterministic FICTIONAL responses from local-network-fixtures.ts;
//   * EVERYTHING else is refused with an error before any network access (fail closed). A host that has a mock but
//     a request the mock does not recognise is also refused — there is no fall-through to the real service.
// Production never sets these flags and never has a loopback Supabase URL, so nothing is installed there.
import { localMockResponse } from "./local-network-fixtures";

export type GuardOutcome = "local" | "mocked" | "blocked";
export type GuardEntry = { method: string; host: string; path: string; outcome: GuardOutcome; reason?: string };
type Env = Record<string, string | undefined>;
type FetchFn = typeof fetch;

export const LOCAL_UAT_BLOCKED = "LOCAL UAT: external network request blocked";

export function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return h === "127.0.0.1" || h === "localhost" || h === "::1" || h.endsWith(".localhost");
}

function loopbackUrl(u: string | undefined): boolean {
  if (!u) return false;
  try { return isLoopbackHost(new URL(u).hostname); } catch { return false; }
}

/** On when explicitly flagged, or whenever the app is pointed at a loopback Supabase (never the case in production). */
export function localUatEnabled(env: Env): boolean {
  return env["HIVIC_LOCAL_UAT"] === "1" || env["VITE_HIVIC_LOCAL_UAT"] === "1" || env["HIVIC_LOCAL_SUPABASE"] === "1"
    || loopbackUrl(env["SUPABASE_URL"]) || loopbackUrl(env["VITE_SUPABASE_URL"]);
}

function requestParts(input: RequestInfo | URL, init?: RequestInit): { url: string; method: string } {
  if (typeof input === "string") return { url: input, method: (init?.method ?? "GET").toUpperCase() };
  if (input instanceof URL) return { url: input.href, method: (init?.method ?? "GET").toUpperCase() };
  return { url: input.url, method: (init?.method ?? input.method ?? "GET").toUpperCase() };
}

async function requestBody(input: RequestInfo | URL, init?: RequestInit): Promise<string | null> {
  if (typeof init?.body === "string") return init.body;
  if (init?.body == null && typeof input === "object" && !(input instanceof URL)) { try { return await input.clone().text(); } catch { return null; } }
  return null;
}

export type MockSource = (url: URL, method: string, body: string | null) => Promise<Response | null>;

/** Wraps a fetch implementation. Never calls `original` for a non-loopback absolute URL. `mocks` returning null (or
 *  throwing) means "no mock": the request is blocked. */
export function guardFetch(original: FetchFn, log: GuardEntry[] = [], mocks: MockSource = localMockResponse): FetchFn {
  const record = (e: GuardEntry) => { log.push(e); if (log.length > 500) log.shift(); };
  const guarded = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const { url, method } = requestParts(input, init);
    let parsed: URL | null = null;
    try { parsed = new URL(url); } catch { parsed = null; }
    // Relative URL (browser same-origin, i.e. the local app itself).
    if (!parsed) { record({ method, host: "(same-origin)", path: url.slice(0, 200), outcome: "local" }); return original(input, init); }
    if (parsed.protocol === "data:" || parsed.protocol === "blob:") return original(input, init);
    if ((parsed.protocol === "http:" || parsed.protocol === "https:") && isLoopbackHost(parsed.hostname)) {
      record({ method, host: parsed.host, path: parsed.pathname, outcome: "local" });
      return original(input, init);
    }
    let mocked: Response | null = null;
    try { mocked = await mocks(parsed, method, await requestBody(input, init)); } catch { mocked = null; }
    if (mocked) { record({ method, host: parsed.host, path: parsed.pathname, outcome: "mocked" }); return mocked; }
    const reason = `${LOCAL_UAT_BLOCKED}: ${method} ${parsed.host}${parsed.pathname}`;
    record({ method, host: parsed.host, path: parsed.pathname, outcome: "blocked", reason });
    console.warn(`[local-uat] ${reason}`);
    throw new TypeError(reason);
  };
  return Object.assign(guarded, { __hivicLocalGuard: true }) as unknown as FetchFn;
}

type GuardHost = { fetch: FetchFn; __hivicLocalNetworkLog?: GuardEntry[] };

/** Idempotent. Returns true when the guard is (now) active on `target`. */
export function installLocalNetworkGuard(env: Env, target: GuardHost = globalThis as unknown as GuardHost): boolean {
  if (!localUatEnabled(env)) return false;
  if ((target.fetch as unknown as { __hivicLocalGuard?: boolean })?.__hivicLocalGuard) return true;
  if (typeof target.fetch !== "function") throw new Error("LOCAL UAT: no fetch to guard — refusing to run without network isolation.");
  const log: GuardEntry[] = (target.__hivicLocalNetworkLog ??= []);
  target.fetch = guardFetch(target.fetch.bind(target), log);
  return true;
}

/** What the guard saw (server: globalThis; browser: window). For tests and manual UAT checks. */
export function localNetworkLog(target: GuardHost = globalThis as unknown as GuardHost): GuardEntry[] {
  return target.__hivicLocalNetworkLog ?? [];
}
