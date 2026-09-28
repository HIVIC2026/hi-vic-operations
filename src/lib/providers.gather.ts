// Optional licensed provider adapters. Network is injected (tests use fixtures); calls only happen when credentials exist.
// Each provider is isolated: failure => source check error, run continues (partial).
import type { Fact } from "./intelligence.core";
import type { SourceCheck } from "./intelligence.gather";
import {
  NEARMAP_BASE, PRICEFINDER_BASE, SOLAR_URL, analyseNearmap, nearmapRoofFact, parsePricefinderExtended, parseSolar, parseStoragePolicy, planFloorplans, resolvePricefinder,
  type FloorplanRow, type NearmapSurvey, type PfExtended, type PfImage, type PfSuggest, type ProviderArea, type ProviderKey, type ProviderState, type SolarInsights, type StoragePolicy,
} from "./providers.core";

export type ProviderHttp = (url: string, init: { method?: "GET" | "POST"; headers?: Record<string, string>; body?: string; timeoutMs: number }) => Promise<{ status: number; json: unknown }>;
export type ProviderConfig = {
  pricefinder: { clientId: string; clientSecret: string; storagePolicy: StoragePolicy } | null;
  solarKey: string | null;
  nearmapKey: string | null;
  vicmapBuildings: null; // licence arrangement with DTP required – no adapter enabled today
};

/** Reads credentials from the server env. Only presence is ever reported, never values. */
export function providerConfigFromEnv(env: Record<string, string | undefined>): ProviderConfig {
  const id = env["PRICEFINDER_CLIENT_ID"], secret = env["PRICEFINDER_CLIENT_SECRET"];
  return {
    pricefinder: id && secret ? { clientId: id, clientSecret: secret, storagePolicy: parseStoragePolicy(env["PRICEFINDER_STORAGE_POLICY"]) } : null,
    solarKey: env["GOOGLE_SOLAR_API_KEY"] || null,
    nearmapKey: env["NEARMAP_API_KEY"] || null,
    vicmapBuildings: null,
  };
}

export type ProviderStatus = { key: ProviderKey; label: string; state: ProviderState; detail: string };
export function providerStatuses(cfg: ProviderConfig, lastChecks: { source_key: string; status: string; error: string | null }[] = []): ProviderStatus[] {
  const last = (k: string) => lastChecks.find((c) => c.source_key === k);
  const st = (k: string, configured: boolean): ProviderState => {
    if (!configured) return "not_configured";
    const c = last(k);
    return c?.status === "error" || c?.status === "timeout" ? "error" : c?.status === "no_coverage" ? "no_coverage" : c?.status === "no_entitlement" ? "no_entitlement" : "configured";
  };
  const vic = lastChecks.filter((c) => c.source_key.startsWith("vicmap_") && c.source_key !== "vicmap_buildings");
  return [
    { key: "vicmap", label: "Vicmap Address/Property/Planning", state: vic.some((c) => c.status === "error" || c.status === "timeout") ? "error" : "ready", detail: "Public open data" },
    { key: "pricefinder", label: "Pricefinder", state: st("pricefinder", !!cfg.pricefinder), detail: cfg.pricefinder ? `Floor-plan storage: ${cfg.pricefinder.storagePolicy === "unknown" ? "licence not set – not stored" : cfg.pricefinder.storagePolicy.replace("_", " ")}` : "Needs PRICEFINDER_CLIENT_ID / PRICEFINDER_CLIENT_SECRET" },
    { key: "google_solar", label: "Google Solar", state: st("google_solar", !!cfg.solarKey), detail: cfg.solarKey ? "buildingInsights" : "Needs GOOGLE_SOLAR_API_KEY" },
    { key: "nearmap", label: "Nearmap", state: st("nearmap", !!cfg.nearmapKey), detail: cfg.nearmapKey ? "Coverage + AI features" : "Needs NEARMAP_API_KEY (subscription)" },
    { key: "vicmap_buildings", label: "Vicmap Buildings (licensed)", state: "not_configured", detail: "Requires DTP data licence" },
  ];
}

export type ProviderContext = { prefix: string | null; postcode: string | null; point: [number, number] | null; referenceDate: string };
export type ProviderResult = { facts: Fact[]; checks: SourceCheck[]; areas: ProviderArea[]; floorplans: FloorplanRow[]; storagePolicy: StoragePolicy };

const check = (source_key: string, status: SourceCheck["status"], t0: number | null, http_status: number | null = null, error: string | null = null): SourceCheck =>
  ({ source_key, status, latency_ms: t0 == null ? null : Date.now() - t0, http_status, error, retry_count: 0 });
const entitlement = (s: number) => s === 401 || s === 403;

async function get(http: ProviderHttp, url: string, headers: Record<string, string> = {}) {
  const r = await http(url, { method: "GET", headers: { Accept: "application/json", ...headers }, timeoutMs: 10000 });
  return r;
}

async function runPricefinder(cfg: NonNullable<ProviderConfig["pricefinder"]>, ctx: ProviderContext, http: ProviderHttp, out: ProviderResult) {
  const t0 = Date.now();
  if (!ctx.prefix) { out.checks.push(check("pricefinder", "skipped", null, null, "no parsed address")); return; }
  const tok = await http(`${PRICEFINDER_BASE}/oauth2/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "client_credentials", client_id: cfg.clientId, client_secret: cfg.clientSecret }).toString(), timeoutMs: 10000 });
  const access = (tok.json as { access_token?: string } | null)?.access_token;
  if (tok.status !== 200 || !access) { out.checks.push(check("pricefinder", entitlement(tok.status) ? "no_entitlement" : "error", t0, tok.status, "token request failed")); return; }
  const auth = { Authorization: `Bearer ${access}` };
  const s = await get(http, `${PRICEFINDER_BASE}/suggest/properties?${new URLSearchParams({ q: `${ctx.prefix} ${ctx.postcode ?? ""}`.trim() })}`, auth);
  if (s.status !== 200) { out.checks.push(check("pricefinder", entitlement(s.status) ? "no_entitlement" : "error", t0, s.status, `suggest HTTP ${s.status}`)); return; }
  const res = resolvePricefinder(s.json as PfSuggest, ctx.prefix, ctx.postcode);
  if (!res.id) { out.checks.push(check("pricefinder", "no_match", t0, 200, res.reason)); return; }
  const ext = await get(http, `${PRICEFINDER_BASE}/properties/${res.id}/extended`, auth);
  if (ext.status === 200 && ext.json) {
    const p = parsePricefinderExtended(ext.json as PfExtended, res.id);
    out.facts.push(...p.facts); if (p.area) out.areas.push(p.area);
    out.facts.push({ key: "pricefinder_single_storey", value: p.singleStorey, status: "info", sourceType: "provider", sourceName: "Pricefinder extended property", sourceRecordId: res.id, confidence: "low", evidence: "inferred" });
  }
  const fp = await get(http, `${PRICEFINDER_BASE}/properties/${res.id}/images/floorplans`, auth);
  if (fp.status === 200) {
    const imgs = (Array.isArray(fp.json) ? fp.json : (fp.json as { images?: PfImage[] } | null)?.images ?? []) as PfImage[];
    const plan = planFloorplans(imgs, res.id); out.floorplans.push(...plan.rows); out.facts.push(plan.fact);
  }
  out.checks.push(check("pricefinder", "ok", t0, 200, ext.status !== 200 ? `extended HTTP ${ext.status}` : fp.status !== 200 ? `floorplans HTTP ${fp.status}` : null));
}

/** Solar: requiredQuality is a floor, so BASE returns the best imagery available. One controlled retry
 *  (MEDIUM) only on a transient 429/5xx; never on 403/404. No other retries. */
export async function runSolar(key: string, ctx: ProviderContext, http: ProviderHttp, out: ProviderResult) {
  const t0 = Date.now();
  if (!ctx.point) { out.checks.push(check("google_solar", "skipped", null, null, "no verified address point")); return; }
  const url = (q: string) => `${SOLAR_URL}?${new URLSearchParams({ "location.latitude": String(ctx.point![1]), "location.longitude": String(ctx.point![0]), requiredQuality: q, key })}`;
  let r = await get(http, url("BASE")); let retries = 0;
  if (r.status === 429 || r.status >= 500) { retries = 1; r = await get(http, url("MEDIUM")); }
  const done = (c: SourceCheck) => out.checks.push({ ...c, retry_count: retries });
  if (r.status === 404) { done(check("google_solar", "no_coverage", t0, 404, "No Solar building data for this location")); return; }
  if (r.status !== 200 || !r.json) {
    const msg = (r.json as { error?: { status?: string; message?: string } } | null)?.error;
    const hint = r.status === 403 ? "API key rejected or restricted (check Solar API is enabled and key restrictions allow server calls)" : `HTTP ${r.status}`;
    done(check("google_solar", entitlement(r.status) ? "no_entitlement" : "error", t0, r.status, `${hint}${msg?.status ? ` · ${msg.status}` : ""}`)); return;
  }
  const single = out.facts.some((f) => f.key === "pricefinder_single_storey" && f.value === true);
  const p = parseSolar(r.json as SolarInsights, ctx.point, single);
  out.facts.push(...p.facts); if (p.area) out.areas.push(p.area);
  done(check("google_solar", p.match.ok ? "ok" : "rejected", t0, 200, p.match.ok ? null : p.match.reason));
}

/** Nearmap adapter: coverage (survey dates) then AI features per survey; normalised to NearmapSurvey for pure analysis. */
async function runNearmap(key: string, ctx: ProviderContext, http: ProviderHttp, out: ProviderResult) {
  const t0 = Date.now();
  if (!ctx.point) { out.checks.push(check("nearmap", "skipped", null, null, "no verified address point")); return; }
  const [lng, lat] = ctx.point;
  const cov = await get(http, `${NEARMAP_BASE}/coverage/v2/point/${lng},${lat}?${new URLSearchParams({ apikey: key, limit: "50" })}`);
  if (entitlement(cov.status)) { out.checks.push(check("nearmap", "no_entitlement", t0, cov.status, "API key lacks entitlement")); return; }
  if (cov.status !== 200) { out.checks.push(check("nearmap", "error", t0, cov.status, `coverage HTTP ${cov.status}`)); return; }
  const surveysRaw = ((cov.json as { surveys?: { id: string; captureDate: string }[] } | null)?.surveys ?? []);
  if (!surveysRaw.length) { out.checks.push(check("nearmap", "no_coverage", t0, 200, "No surveys at this location")); return; }
  const surveys: NearmapSurvey[] = [];
  for (const s of surveysRaw.slice(0, 12)) {
    const f = await get(http, `${NEARMAP_BASE}/ai/features/v4/features.json?${new URLSearchParams({ point: `${lng},${lat}`, surveyResourceId: s.id, apikey: key })}`);
    if (entitlement(f.status)) { out.checks.push(check("nearmap", "no_entitlement", t0, f.status, "AI features not entitled")); return; }
    if (f.status !== 200) continue;
    const feats = ((f.json as { features?: { description?: string; areaSqm?: number; attributes?: { pitch?: number }[] }[] } | null)?.features ?? []);
    const b = feats.find((x) => /building/i.test(x.description ?? ""));
    const roof = feats.find((x) => /roof/i.test(x.description ?? ""));
    surveys.push({ id: s.id, captureDate: s.captureDate, buildingFootprintM2: b?.areaSqm ?? null, roofPitchDeg: roof?.attributes?.[0]?.pitch ?? null, product: "ai/features/v4" });
  }
  out.facts.push(...analyseNearmap(surveys, ctx.referenceDate));
  const roofF = nearmapRoofFact([...surveys].sort((a, b) => b.captureDate.localeCompare(a.captureDate))[0]);
  if (roofF) out.facts.push(roofF);
  out.checks.push(check("nearmap", "ok", t0, 200, null));
}

export async function runProviders(cfg: ProviderConfig, ctx: ProviderContext, http: ProviderHttp): Promise<ProviderResult> {
  const out: ProviderResult = { facts: [], checks: [], areas: [], floorplans: [], storagePolicy: cfg.pricefinder?.storagePolicy ?? "unknown" };
  const guard = async (k: string, fn: () => Promise<void>) => { try { await fn(); } catch (e) { const m = (e as Error).message ?? "error"; out.checks.push(check(k, /abort|timeout/i.test(m) ? "timeout" : "error", null, null, m.slice(0, 300))); } };
  if (cfg.pricefinder) await guard("pricefinder", () => runPricefinder(cfg.pricefinder!, ctx, http, out)); else out.checks.push(check("pricefinder", "not_configured", null));
  if (cfg.solarKey) await guard("google_solar", () => runSolar(cfg.solarKey!, ctx, http, out)); else out.checks.push(check("google_solar", "not_configured", null));
  if (cfg.nearmapKey) await guard("nearmap", () => runNearmap(cfg.nearmapKey!, ctx, http, out)); else out.checks.push(check("nearmap", "not_configured", null));
  out.checks.push(check("vicmap_buildings", "not_configured", null, null, "DTP licence arrangement required"));
  return out;
}

export const defaultProviderHttp: ProviderHttp = async (url, { method = "GET", headers, body, timeoutMs }) => {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { method, headers: headers ?? {}, body: body ?? null, signal: ctl.signal });
    const text = await r.text(); let json: unknown = null; try { json = JSON.parse(text); } catch { json = null; }
    return { status: r.status, json };
  } finally { clearTimeout(t); }
};
