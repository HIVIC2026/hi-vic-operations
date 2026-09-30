import {
  credentialState,
  isElectricianBiz,
  isInstallerBiz,
  requiredCredentialKinds,
  serviceAreaMatch,
  type BusinessLike,
  type Credential,
} from "./pilot.core";

export type CoverageTrade = "rec" | "installer";
export type CoverageState = "serviceable" | "partial" | "unserviceable" | "not_configured";

export type CoveragePartner = BusinessLike & {
  id: string;
  name: string;
  coverage_verified_at?: string | null;
  declared_service_origin?: string | null;
  declared_travel_radius_km?: number | null;
  declared_excluded_areas?: string | null;
  free_measureups_for_hivic_quote_leads?: boolean | null;
  credentials: Credential[];
};

export type TradeCoverage = {
  state: CoverageState;
  matches: Array<{ id: string; name: string }>;
  declared: Array<{ id: string; name: string; description: string }>;
  blocked: Array<{ id: string; name: string; reason: string }>;
};

export function coveragePartnerBlocker(partner: CoveragePartner, trade: CoverageTrade, now = new Date()): string | null {
  if (!partner.is_active) return "Inactive";
  if (partner.onboarding_status !== "approved") return `Onboarding ${partner.onboarding_status.replace(/_/g, " ")}`;
  if (trade === "rec" && !isElectricianBiz(partner)) return "Not an REC/electrician business";
  if (trade === "installer" && !isInstallerBiz(partner)) return "Not an installer business";
  const missing = requiredCredentialKinds(partner).filter((kind) => !partner.credentials.some((credential) => credential.kind === kind && credential.verification === "verified" && credentialState(credential, now) !== "expired"));
  return missing.length ? `Missing current verified ${missing.map((kind) => kind.replace(/_/g, " ")).join(", ")}` : null;
}

function declaredDescription(partner: CoveragePartner) {
  const radius = partner.declared_travel_radius_km === 9999 ? "Anywhere in Victoria" : partner.declared_travel_radius_km ? `${partner.declared_travel_radius_km} km radius` : null;
  return [partner.declared_service_origin, radius, partner.declared_excluded_areas ? `Excludes: ${partner.declared_excluded_areas}` : null].filter(Boolean).join(" · ") || "Coverage not configured";
}

export function tradeCoverage(partners: CoveragePartner[], trade: CoverageTrade, site: { postcode: string | null; suburb?: string | null }, now = new Date()): TradeCoverage {
  const relevant = partners.filter((partner) => trade === "rec" ? isElectricianBiz(partner) : isInstallerBiz(partner));
  const matches: TradeCoverage["matches"] = [];
  const declared: TradeCoverage["declared"] = [];
  const blocked: TradeCoverage["blocked"] = [];
  for (const partner of relevant) {
    const blocker = coveragePartnerBlocker(partner, trade, now);
    if (blocker) { blocked.push({ id: partner.id, name: partner.name, reason: blocker }); continue; }
    const verified = !!partner.coverage_verified_at && !!partner.service_postcodes?.length;
    if (verified && serviceAreaMatch(partner, site.postcode, site.suburb)) matches.push({ id: partner.id, name: partner.name });
    else if (!verified && (partner.declared_service_origin || partner.declared_travel_radius_km || partner.service_regions?.length)) declared.push({ id: partner.id, name: partner.name, description: declaredDescription(partner) });
  }
  const configured = relevant.some((partner) => !!partner.coverage_verified_at && !!partner.service_postcodes?.length);
  const state: CoverageState = matches.length ? "serviceable" : declared.length ? "partial" : configured ? "unserviceable" : "not_configured";
  return { state, matches, declared, blocked };
}

export function overallCoverage(rec: TradeCoverage, installer: TradeCoverage): CoverageState {
  if (rec.state === "serviceable" && installer.state === "serviceable") return "serviceable";
  if (rec.state === "not_configured" || installer.state === "not_configured") return "not_configured";
  if (rec.state === "unserviceable" && installer.state === "unserviceable") return "unserviceable";
  return "partial";
}