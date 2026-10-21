// Evidence gathering orchestration. No database; the network call is injected (tests use fixtures).
// Each source is isolated: a failure yields a source-check error and "unknown" facts, never a thrown run.
import { runProviders, type ProviderConfig, type ProviderHttp } from "./providers.gather";
import { solarAreaConflict } from "./providers.core";
import type { FloorplanRow, StoragePolicy } from "./providers.core";
import { cqlString, normaliseAddress, parseAddress, parseProperty, parseZone, TIER_CONFIDENCE, VICMAP_WFS, type AreaTier, type Fact } from "./intelligence.core";

export type FetchJson = (url: string, opts: { timeoutMs: number }) => Promise<{ status: number; json: unknown }>;
export type SourceCheck = { source_key: string; status: "ok" | "no_match" | "error" | "timeout" | "not_configured" | "skipped" | "no_coverage" | "no_entitlement" | "rejected"; latency_ms: number | null; http_status: number | null; error: string | null; retry_count: number };
export type AreaCandidate = { tier: AreaTier; method: string; source_name: string; source_url: string | null; gross_m2: number | null; excluded_m2: number | null; net_m2: number; confidence: string; notes: string | null; calculation?: Record<string, unknown> };

/** Optional provider slot for floor plans / listings / historical imagery. Not configured by default. */
export interface EvidenceProvider {
  key: string;
  find(address: string): Promise<{ floorplan?: { url: string; area_m2?: number | null; ties_to_relevant_ceiling: boolean }; listing?: { url: string; floor_area_m2?: number | null; year_built?: number | null; storeys?: number | null }; historicalImagery?: { url: string; date: string; sameFootprint: boolean } } | null>;
}

export type GatherInput = {
  addressLine: string; suburb: string | null; postcode: string | null; state: string | null;
  ownerEstimateM2: number | null;
  partnerMeasurement: { net_m2: number; source: string; external_id: string | null } | null;
  provider: EvidenceProvider | null;
  /** Optional licensed providers (Pricefinder / Google Solar / Nearmap). Absent = Vicmap only. */
  providers?: { cfg: ProviderConfig; http: ProviderHttp; referenceDate: string } | null;
};

const wfs = (typeName: string, cql: string, props: string, count = 5) =>
  `${VICMAP_WFS}?${new URLSearchParams({ service: "WFS", version: "2.0.0", request: "GetFeature", typeNames: typeName, outputFormat: "application/json", count: String(count), srsName: "EPSG:4326", cql_filter: cql, propertyName: props })}`;

async function call(key: string, url: string, fetchJson: FetchJson, checks: SourceCheck[], retries = 1): Promise<unknown | null> {
  const t0 = Date.now();
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await fetchJson(url, { timeoutMs: 8000 });
      if (r.status >= 500 && attempt < retries) continue;
      if (r.status !== 200 || typeof r.json !== "object" || r.json === null) {
        checks.push({ source_key: key, status: "error", latency_ms: Date.now() - t0, http_status: r.status, error: `HTTP ${r.status}`, retry_count: attempt });
        return null;
      }
      const n = ((r.json as { features?: unknown[] }).features ?? []).length;
      checks.push({ source_key: key, status: n ? "ok" : "no_match", latency_ms: Date.now() - t0, http_status: 200, error: null, retry_count: attempt });
      return r.json;
    } catch (e) {
      if (attempt < retries) continue;
      const msg = (e as Error).message ?? "error";
      checks.push({ source_key: key, status: /abort|timeout/i.test(msg) ? "timeout" : "error", latency_ms: Date.now() - t0, http_status: null, error: msg.slice(0, 300), retry_count: attempt });
      return null;
    }
  }
  return null;
}

const nc = (key: string, note: string): Fact => ({ key, value: key === "floorplan_status" ? "provider_not_configured" : "unknown", status: "unknown", sourceType: "not_configured", sourceName: "No provider configured", confidence: "unknown", evidence: "none", note });

export async function gatherEvidence(i: GatherInput, fetchJson: FetchJson): Promise<{ facts: Fact[]; checks: SourceCheck[]; areas: AreaCandidate[]; floorplans: FloorplanRow[]; storagePolicy: StoragePolicy }> {
  const facts: Fact[] = []; const checks: SourceCheck[] = []; const areas: AreaCandidate[] = [];
  const q = normaliseAddress(i.addressLine, i.suburb, i.postcode);

  // 1. Address
  let point: [number, number] | null = null; let pfi: string | null = null;
  if (!q) {
    facts.push({ key: "address_verified", value: false, status: "review", sourceType: "derived", sourceName: "Address parser", confidence: "unknown", evidence: "none", note: "Could not parse street number/name" });
    checks.push({ source_key: "vicmap_address", status: "skipped", latency_ms: null, http_status: null, error: "unparseable address", retry_count: 0 });
  } else {
    const cql = `ezi_address LIKE '${cqlString(q.prefix)} %'${q.postcode ? ` AND postcode='${cqlString(q.postcode)}'` : ""}`;
    const json = await call("vicmap_address", wfs("open-data-platform:address", cql, "ezi_address,pfi,property_pfi,state,postcode,locality_name,is_primary,source_verified,geom", 10), fetchJson, checks);
    if (json) { const a = parseAddress(json as never, q); facts.push(...a.facts); point = a.point; pfi = a.propertyPfi; }
    else facts.push({ key: "address_verified", value: null, status: "unknown", sourceType: "public_gis", sourceName: "Vicmap Address", sourceUrl: VICMAP_WFS, confidence: "unknown", evidence: "none", note: "Source unavailable" });
  }
  if (!facts.some((f) => f.key === "in_victoria")) {
    // Fallback from the enquiry itself: only a positive postcode-range indicator, never proof.
    const pc = q?.postcode ?? i.postcode;
    facts.push({ key: "in_victoria", value: pc && /^(3|8)\d{3}$/.test(pc) ? true : null, status: pc && /^(3|8)\d{3}$/.test(pc) ? "review" : "unknown", sourceType: "owner", sourceName: "Enquiry postcode", confidence: "low", evidence: "inferred" });
  }

  // 2. Property + planning (independent; each can fail alone)
  if (pfi) {
    const pj = await call("vicmap_property", wfs("open-data-platform:v_property_mp", `prop_pfi='${cqlString(pfi)}'`, "prop_pfi,prop_propnum,prop_lga_code,prop_multi_assessment,prop_status", 1), fetchJson, checks);
    facts.push(...parseProperty(pj as never));
  } else checks.push({ source_key: "vicmap_property", status: "skipped", latency_ms: null, http_status: null, error: "no unique property match", retry_count: 0 });
  if (point) {
    const zj = await call("vicmap_planning", wfs("open-data-platform:plan_zone", `INTERSECTS(geom,SRID=4326;POINT(${point[0]} ${point[1]}))`, "zone_code,zone_description,lga,zone_status", 1), fetchJson, checks);
    facts.push(...parseZone(zj as never));
  } else {
    checks.push({ source_key: "vicmap_planning", status: "skipped", latency_ms: null, http_status: null, error: "no coordinates", retry_count: 0 });
    facts.push(...parseZone(null));
  }

  // 3. NCC class: only direct evidence may set a class. Zoning never does.
  facts.push({ key: "ncc_class_evidence", value: "unknown", status: "unknown", sourceType: "derived", sourceName: "No direct NCC class evidence", confidence: "unknown", evidence: "none", note: "Planning zone is not proof of Class 1 / Class 2 SOU" });

  // 4. Provider slot (floor plan / listing / historical imagery). Never fabricated.
  let prov: Awaited<ReturnType<EvidenceProvider["find"]>> = null;
  if (i.provider) {
    try { prov = await i.provider.find(`${i.addressLine} ${i.suburb ?? ""} ${i.postcode ?? ""}`); checks.push({ source_key: `provider:${i.provider.key}`, status: prov ? "ok" : "no_match", latency_ms: null, http_status: null, error: null, retry_count: 0 }); }
    catch (e) { checks.push({ source_key: `provider:${i.provider.key}`, status: "error", latency_ms: null, http_status: null, error: (e as Error).message.slice(0, 300), retry_count: 0 }); }
  } else checks.push({ source_key: "evidence_provider", status: "not_configured", latency_ms: null, http_status: null, error: null, retry_count: 0 });

  if (i.partnerMeasurement) facts.push({ key: "floorplan_status", value: "partner_supplied", status: "pass", sourceType: "partner", sourceName: i.partnerMeasurement.source, sourceRecordId: i.partnerMeasurement.external_id, confidence: "very_high", evidence: "direct" });
  else if (prov?.floorplan) facts.push({ key: "floorplan_status", value: "public_sourced", status: "review", sourceType: "provider", sourceName: i.provider!.key, sourceUrl: prov.floorplan.url, confidence: "medium", evidence: "direct", note: "Sourced floor plan – admin review" });
  else if (i.provider) facts.push({ key: "floorplan_status", value: "not_found", status: "unknown", sourceType: "provider", sourceName: i.provider.key, confidence: "unknown", evidence: "none", note: "No sourced floor plan found" });
  else facts.push(nc("floorplan_status", "No sourced floor plan found – no floor-plan provider configured"));

  if (prov?.historicalImagery) {
    facts.push({ key: "age_evidence", value: { date: prov.historicalImagery.date, kind: prov.historicalImagery.sameFootprint ? "historical_imagery_same_footprint" : "none" }, status: "review", sourceType: "provider", sourceName: i.provider!.key, sourceUrl: prov.historicalImagery.url, sourceDate: prov.historicalImagery.date, confidence: prov.historicalImagery.sameFootprint ? "high" : "unknown", evidence: prov.historicalImagery.sameFootprint ? "direct" : "none", note: `Same footprint assessment: ${prov.historicalImagery.sameFootprint ? "yes" : "no/unclear"}` });
  } else if (prov?.listing?.year_built) {
    facts.push({ key: "age_evidence", value: { date: `${prov.listing.year_built}-12-31`, kind: "listing_year_built" }, status: "review", sourceType: "provider", sourceName: i.provider!.key, sourceUrl: prov.listing.url, confidence: "low", evidence: "inferred", note: "Listing year built is supporting evidence only" });
  } else facts.push({ key: "age_evidence", value: { date: null, kind: "none" }, status: "unknown", sourceType: i.provider ? "provider" : "not_configured", sourceName: i.provider ? i.provider.key : "No historical imagery source configured", confidence: "unknown", evidence: "none", note: "Ceiling age needs confirmation" });

  for (const k of ["recent_extension_or_added_storey_risk", "roof_form", "roof_cavity_or_exposed_roof_likelihood", "another_storey_above_relevant_ceiling", "activity48_previous_installation_check", "veu_location_zone"])
    facts.push({ key: k, value: "unknown", status: "unknown", sourceType: "not_configured", sourceName: k === "veu_location_zone" ? "VEU v25 location list not loaded" : "No reliable remote source configured", confidence: "unknown", evidence: "none" });
  facts.push({ key: "onsite_existing_insulation_check_required", value: true, status: "info", sourceType: "portal", sourceName: "Activity 48 rule (onsite)", confidence: "very_high", evidence: "direct" });
  facts.push({ key: "onsite_luminaire_check_required", value: true, status: "info", sourceType: "portal", sourceName: "Activity 48 rule (onsite / PIESA)", confidence: "very_high", evidence: "direct" });

  // 5. Area candidates (hierarchy). Parcel area is NEVER used.
  if (i.partnerMeasurement) areas.push({ tier: "A", method: "Partner/imported measured ceiling", source_name: i.partnerMeasurement.source, source_url: null, gross_m2: i.partnerMeasurement.net_m2, excluded_m2: null, net_m2: i.partnerMeasurement.net_m2, confidence: TIER_CONFIDENCE.A, notes: null });
  else {
    if (prov?.floorplan?.area_m2 && prov.floorplan.ties_to_relevant_ceiling) areas.push({ tier: "B", method: "Sourced floor plan", source_name: i.provider!.key, source_url: prov.floorplan.url, gross_m2: prov.floorplan.area_m2, excluded_m2: null, net_m2: prov.floorplan.area_m2, confidence: TIER_CONFIDENCE.B, notes: null });
    if (prov?.listing?.floor_area_m2 && (prov.listing.storeys ?? 0) === 1) areas.push({ tier: "D", method: "Sourced listing floor area (single storey)", source_name: i.provider!.key, source_url: prov.listing.url, gross_m2: prov.listing.floor_area_m2, excluded_m2: null, net_m2: prov.listing.floor_area_m2, confidence: TIER_CONFIDENCE.D, notes: "Listing floor area – may include garage/alfresco" });
    if (i.ownerEstimateM2 && i.ownerEstimateM2 > 0) areas.push({ tier: "F", method: "Owner estimate (enquiry)", source_name: "Owner enquiry", source_url: null, gross_m2: i.ownerEstimateM2, excluded_m2: null, net_m2: i.ownerEstimateM2, confidence: TIER_CONFIDENCE.F, notes: null });
  }
  // 6. Licensed providers (isolated; each may fail alone). Merge by purpose priority; never overwrite partner evidence.
  let floorplans: FloorplanRow[] = []; let storagePolicy: StoragePolicy = "unknown";
  if (i.providers) {
    const r = await runProviders(i.providers.cfg, { prefix: q?.prefix ?? null, postcode: q?.postcode ?? i.postcode, point, referenceDate: i.providers.referenceDate }, i.providers.http);
    checks.push(...r.checks); floorplans = r.floorplans; storagePolicy = r.storagePolicy;
    const put = (f: Fact) => { const k = facts.findIndex((x) => x.key === f.key); if (k >= 0) facts[k] = f; else facts.push(f); };
    const cur = (k: string) => facts.find((x) => x.key === k);
    for (const f of r.facts) {
      if (f.key === "floorplan_status") { if (cur(k0(f))?.value !== "partner_supplied") put(f); continue; }
      if (f.key === "age_evidence") { if (f.evidence === "direct" || cur("age_evidence")?.evidence === "none") put(f); continue; }
      if (f.key === "roof_form") { const c = cur("roof_form"); if (c?.sourceName === "Nearmap roof geometry") continue; put(f); continue; }
      if (f.key === "recent_extension_or_added_storey_risk") { put(f); continue; }
      put(f);
    }
    // Supporting-only age evidence fills an otherwise empty age slot, never upgrades it.
    const age = cur("age_evidence");
    if (age && (age.value as { kind?: string } | null)?.kind === "none") {
      const sup = cur("age_supporting_pricefinder") ?? cur("age_supporting_solar");
      if (sup && (sup.value as { date?: string | null }).date) put({ ...sup, key: "age_evidence", status: "review" });
    }
    const solar = r.areas.find((a) => a.source_name === "Google Solar buildingInsights");
    if (solar) {
      const others = [...areas, ...r.areas.filter((a) => a !== solar), ...(i.partnerMeasurement ? [{ tier: "A", net_m2: i.partnerMeasurement.net_m2, source_name: i.partnerMeasurement.source }] : [])];
      const c = solarAreaConflict(solar.net_m2, others as { tier: string; net_m2: number; source_name: string }[]);
      if (c) put(c);
    }
    if (!i.partnerMeasurement) areas.push(...r.areas.map((a) => ({ ...a })));
  }
  return { facts, checks, areas, floorplans, storagePolicy };
}
const k0 = (f: Fact) => f.key;

/** Default network fetcher with timeout (server only). */
export const defaultFetchJson: FetchJson = async (url, { timeoutMs }) => {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { Accept: "application/json" } });
    const text = await r.text();
    let json: unknown = null; try { json = JSON.parse(text); } catch { json = null; }
    return { status: r.ok && json ? r.status : r.ok ? 502 : r.status, json };
  } finally { clearTimeout(t); }
};
