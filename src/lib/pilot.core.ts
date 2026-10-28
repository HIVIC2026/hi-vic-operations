import { PROVISIONAL_FLAG_REASON, parseMethod, parsePurpose } from "./measurement.core";
// Pure rules for the ReInsulate pilot: partner onboarding, job import, electrician choice,
// appointment SLA, partner offers, relationship owner, partner pricing and co-branded quotes.
// No I/O here — persistence lives in pilot.server.ts.

export const ONBOARDING_STATUSES = ["draft", "submitted", "needs_info", "approved", "suspended", "expired"] as const;
export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number];
export const AP_ENTITY = "DC Construction Solutions Pty Ltd t/a Home Insulation Victoria";

// ---------- Onboarding / credentials ----------
export type Credential = { kind: string; label: string; expires_at: string | null; critical: boolean; verification: string; profile_id?: string | null };
export type BusinessLike = {
  onboarding_status: string; is_active: boolean; business_type: string; capabilities?: string[] | null;
  legal_name?: string | null; abn?: string | null; email?: string | null; phone?: string | null;
  service_postcodes?: string[] | null; service_regions?: string[] | null; rec_number?: string | null;
  coverage_verified_at?: string | null; free_measureups_for_hivic_quote_leads?: boolean | null;
  commercial_route?: string | null;
};

const day = 86_400_000;
export function credentialState(c: Pick<Credential, "expires_at">, now = new Date()): "valid" | "expiring" | "expired" | "no_expiry" {
  if (!c.expires_at) return "no_expiry";
  const t = Date.parse(c.expires_at + (c.expires_at.length === 10 ? "T23:59:59+10:00" : ""));
  if (t < now.getTime()) return "expired";
  return t - now.getTime() < 30 * day ? "expiring" : "valid";
}

export const isInstallerBiz = (b: Pick<BusinessLike, "business_type" | "capabilities">) => b.business_type === "eec_installer" || !!b.capabilities?.includes("installer");
export const isElectricianBiz = (b: Pick<BusinessLike, "business_type" | "capabilities">) => b.business_type === "rec" || !!b.capabilities?.includes("electrician");

/** Credentials a business must hold (verified, unexpired) before it may do compliance-critical work. */
export function requiredCredentialKinds(b: Pick<BusinessLike, "business_type" | "capabilities">): string[] {
  const k = ["public_liability_insurance"];
  if (isInstallerBiz(b)) k.push("installer_certification");
  if (isElectricianBiz(b)) k.push("electrical_licence", "rec_registration");
  return k;
}

/** Everything still stopping approval (checklist). Empty => may be approved. */
export function onboardingChecklist(b: BusinessLike, creds: Credential[], hasAgreement: boolean, now = new Date()) {
  const items: { key: string; label: string; done: boolean }[] = [
    { key: "legal", label: "Legal name and ABN", done: !!b.legal_name && !!b.abn },
    { key: "contact", label: "Business email and phone", done: !!b.email && !!b.phone },
    { key: "areas", label: "Service areas", done: !!(b.service_postcodes?.length || b.service_regions?.length) },
    ...requiredCredentialKinds(b).map((kind) => {
      const ok = creds.some((c) => c.kind === kind && c.verification === "verified" && credentialState(c, now) !== "expired");
      return { key: `cred:${kind}`, label: `${kind.replace(/_/g, " ")} (verified, current)`, done: ok };
    }),
    ...(isElectricianBiz(b) ? [{ key: "rec", label: "REC number", done: !!b.rec_number }] : []),
    { key: "agreement", label: "Signed Home Insulation Victoria participation agreement", done: hasAgreement },
  ];
  return items;
}

/** Blocks compliance-critical work: not approved, suspended, or any critical credential expired. */
/** Expired critical credentials that no renewal replaces. Phase 3 path 4 (27 Oct): an uploaded renewal of the same
 *  document (same kind, same person) that is current supersedes the lapsed one, as trade-expiry.core already assumes. */
export function lapsedCriticalCredentials(creds: Credential[], now = new Date()): Credential[] {
  const renewed = (c: Credential) => creds.some((o) => o !== c && o.kind === c.kind && (o.profile_id ?? null) === (c.profile_id ?? null) && credentialState(o, now) !== "expired" && (!o.expires_at || (o.expires_at ?? "") > (c.expires_at ?? "")));
  return creds.filter((c) => c.critical && credentialState(c, now) === "expired" && !renewed(c));
}

export function partnerWorkBlocker(b: BusinessLike | null, creds: Credential[], now = new Date()): string | null {
  if (!b) return "No partner business linked.";
  if (!b.is_active) return "Partner business is inactive.";
  if (b.onboarding_status !== "approved") return `Partner onboarding is ${b.onboarding_status.replace(/_/g, " ")} – Home Insulation Victoria approval required.`;
  const expired = lapsedCriticalCredentials(creds, now);
  if (expired.length) return `Expired: ${expired.map((c) => c.label).join(", ")}. Upload a current document.`;
  return null;
}

/** Full work-eligibility check for regulated assignments (electrician/REC).
 * Blocks on: missing required credentials, unverified credentials, expired critical credentials,
 * missing REC number, or no approved licensed workers.
 * This is the authoritative gate for electrician assignment paths. */
export function electricianWorkEligibility(b: BusinessLike | null, creds: Credential[], workers: { trade_role: string; licence_expires_on: string | null; approval_status: string; removed_at: string | null }[], now = new Date()): string | null {
  if (!b) return "No partner business linked.";
  if (!b.is_active) return "Partner business is inactive.";
  if (b.onboarding_status !== "approved") return `Partner onboarding is ${b.onboarding_status.replace(/_/g, " ")} – Home Insulation Victoria approval required.`;
  if (!b.rec_number) return "REC number not recorded for this business.";
  
  // Check required credential kinds for electrician/REC businesses
  const requiredKinds = requiredCredentialKinds(b);
  for (const kind of requiredKinds) {
    const matching = creds.filter((c) => c.kind === kind);
    if (!matching.length) return `Missing mandatory credential: ${kind.replace(/_/g, " ")}.`;
    const verifiedCurrent = matching.some((c) => c.verification === "verified" && credentialState(c, now) !== "expired");
    if (!verifiedCurrent) return `Mandatory credential not verified and current: ${kind.replace(/_/g, " ")}.`;
  }
  
  // Check approved licensed workers
  const approvedElectricians = workers.filter((w) => 
    w.trade_role === "electrician" && 
    w.approval_status === "approved" && 
    !w.removed_at &&
    (!w.licence_expires_on || new Date(w.licence_expires_on) >= now)
  );
  if (approvedElectricians.length === 0) return "No approved licensed electrician available.";
  
  return null;
}

/** Automatic expiry: an approved business with an expired critical credential becomes 'expired'. */
export function derivedOnboardingStatus(b: BusinessLike, creds: Credential[], now = new Date()): OnboardingStatus {
  const s = b.onboarding_status as OnboardingStatus;
  if (s === "approved" && lapsedCriticalCredentials(creds, now).length) return "expired";
  return s;
}

export function splitInvoicingBlocker(route: string | null | undefined): string | null {
  return route === "split_invoicing" ? "Split invoicing is not enabled – configuration required pending regulatory/commercial verification." : null;
}

// ---------- Import extraction ----------
export type FactConfidence = "found" | "uncertain" | "missing";
export type Fact<T = string | number | boolean> = { value: T | null; confidence: FactConfidence; source: string };
export const IMPORT_FIELDS = [
  "full_name", "email", "phone", "address_line", "suburb", "postcode", "external_reference",
  "measured_area_m2", "removal_required", "removal_m2", "existing_r_value", "product", "r_value",
  "access_notes", "inspection_status", "electrical_status", "swms_status", "electrician_name", "notes",
  "measurement_purpose", "measurement_method", "measured_by", "measured_on", "gross_area_m2", "excluded_area_m2",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export type Extracted = Partial<Record<ImportField, Fact>> & { quote_lines?: { description: string; amount: number | null }[] };

/** Required to create a job; everything else is optional context. */
// Every customer needs name, full address, email and phone (Jo, 7 Oct) — plus the installer's contact-permission tick.
export const REQUIRED_IMPORT_FIELDS: ImportField[] = ["full_name", "email", "phone", "address_line", "suburb", "postcode"];
export const ONE_JOB_PERMISSION_WORDING = "The owner has given Home Insulation Victoria permission to contact them.";
export const FIELD_LABEL: Record<ImportField, string> = {
  full_name: "Owner name", email: "Owner email", phone: "Owner phone", address_line: "Street address", suburb: "Suburb", postcode: "Postcode",
  external_reference: "Your job / lead reference", measured_area_m2: "Measured ceiling area (m²)", removal_required: "Removal required",
  removal_m2: "Removal area (m²)", existing_r_value: "Existing insulation R-value", product: "Proposed product", r_value: "Proposed R-value",
  access_notes: "Roof access / special access", inspection_status: "Inspection / Ready Check status", electrical_status: "Pre Insulation Electrical Safety Assessment (PIESA) status",
  swms_status: "SWMS / evidence status", electrician_name: "Named electrician", notes: "Notes",
  measurement_purpose: "Measurement purpose (sales estimate / onsite / final)", measurement_method: "Measurement method (laser, tape, floor plan, aerial…)",
  measured_by: "Measured by", measured_on: "Measured date", gross_area_m2: "Gross area (m²)", excluded_area_m2: "Excluded / non-ceiling area (m²)",
};

const num = (s: string | undefined) => { if (!s) return null; const n = Number(s.replace(/,/g, "")); return Number.isFinite(n) ? n : null; };
const f = <T,>(value: T | null, source: string, confidence: FactConfidence = value == null ? "missing" : "found"): Fact<T> => ({ value, confidence, source });

/** Deterministic label-based extraction from pasted text / forwarded email. Never guesses: unmatched = missing. */
export function extractFromText(text: string): Extracted {
  const t = text.replace(/\r/g, "");
  const label = (re: RegExp) => { const m = t.match(re); return m?.[1]?.trim() || null; };
  const out: Extracted = {};
  const email = t.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? null;
  const phone = t.match(/(?:\+?61\s?|0)[2-478](?:[ -]?\d){8}/)?.[0]?.replace(/\s+/g, " ") ?? null;
  const name = label(/^(?:customer|client|owner|name|customer name)\s*[:\-]\s*(.+)$/im);
  const addr = label(/^(?:address|property|site address|property address)\s*[:\-]\s*(.+)$/im);
  out.full_name = f(name, "label"); out.email = f(email, "pattern"); out.phone = f(phone, "pattern");
  if (addr) {
    const m = addr.match(/^(.*?),?\s+([A-Za-z][A-Za-z \-']+?)\s+(?:VIC|Vic|Victoria)?\s*(3\d{3})$/);
    if (m) { out.address_line = f(m[1]!.replace(/,$/, ""), "label"); out.suburb = f(m[2]!.trim(), "label"); out.postcode = f(m[3]!, "label"); }
    else { out.address_line = f(addr, "label", "uncertain"); out.postcode = f(addr.match(/\b3\d{3}\b/)?.[0] ?? null, "pattern", "uncertain"); }
  }
  out.external_reference = f(label(/^(?:job|lead|ref|reference|job no\.?|job number|quote no\.?)\s*[:#\-]\s*([A-Z0-9\-_/]+)/im), "label");
  const area = label(/(?:ceiling area|measured area|area|total m2|total m²|m2|m²)\s*[:\-]?\s*([\d.,]+)\s*(?:m2|m²|sqm)?/i);
  out.measured_area_m2 = f(num(area ?? undefined), "label", area ? "uncertain" : "missing"); // needs confirmation: which area?
  const removal = label(/(?:removal|remove existing)\s*[:\-]\s*(yes|no|y|n|true|false)/i);
  out.removal_required = f(removal == null ? null : /^(y|yes|true)$/i.test(removal), "label");
  const rm = label(/removal (?:area|m2|m²)\s*[:\-]\s*([\d.,]+)/i);
  out.removal_m2 = f(num(rm ?? undefined), "label");
  const ex = label(/existing (?:insulation )?(?:r[- ]?value)?\s*[:\-]\s*R?\s*([\d.]+)/i);
  out.existing_r_value = f(num(ex ?? undefined), "label");
  out.product = f(label(/^(?:product|insulation|proposed product)\s*[:\-]\s*(.+)$/im), "label");
  // Proposed R: an explicitly labelled "proposed/new" value is found; an unlabelled R-value is uncertain;
  // an "existing ..." R-value is never captured as the proposal (the word "proposed" elsewhere does not count).
  const rvExplicit = label(/(?:proposed|new)\s+(?:product\s+)?r[- ]?(?:value|rating)\s*[:\-]\s*R?\s*([\d.]+)/i);
  const rvBare = rvExplicit ? null : label(/(?<!existing\s(?:insulation\s)?)(?<![a-z])r[- ]?value\s*[:\-]\s*R?\s*([\d.]+)/i);
  const rv = rvExplicit ?? rvBare;
  out.r_value = f(num(rv ?? undefined), "label", rvExplicit ? "found" : rvBare ? "uncertain" : "missing");
  out.access_notes = f(label(/^(?:access|roof access|roof)\s*[:\-]\s*(.+)$/im), "label");
  out.inspection_status = f(label(/^(?:inspection|measure[- ]?up)(?: status)?\s*[:\-]\s*(.+)$/im), "label");
  out.electrical_status = f(label(/^(?:electrical|electrical safety|piesa)(?: status)?\s*[:\-]\s*(.+)$/im), "label");
  out.swms_status = f(label(/^(?:swms)(?: status)?\s*[:\-]\s*(.+)$/im), "label");
  out.electrician_name = f(label(/^(?:electrician|sparky)\s*[:\-]\s*(.+)$/im), "label");
  out.notes = f(label(/^(?:notes?|comments?)\s*[:\-]\s*([\s\S]+?)(?:\n\s*\n|$)/im), "label");
  const lines = [...t.matchAll(/^\s*[-*•]?\s*([A-Za-z][^\n$]{2,80}?)\s*[:\-]?\s*\$\s*([\d,]+(?:\.\d{1,2})?)\s*$/gm)].map((m) => ({ description: m[1]!.trim(), amount: num(m[2]) }));
  if (lines.length) out.quote_lines = lines.slice(0, 40);
  return out;
}

/** Minimal CSV parser (quoted fields supported). */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true; else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((c) => c.trim()));
  if (!head) return [];
  const keys = head.map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""));
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}

const CSV_ALIASES: Record<ImportField, string[]> = {
  full_name: ["customer_name", "name", "client", "owner", "customer", "contact_name"], email: ["email", "customer_email", "email_address"],
  phone: ["phone", "mobile", "customer_phone", "phone_number"], address_line: ["address", "street", "address_line", "site_address", "property_address"],
  suburb: ["suburb", "city"], postcode: ["postcode", "post_code", "zip"], external_reference: ["job_id", "lead_id", "reference", "job_number", "ref", "id"],
  measured_area_m2: ["ceiling_area", "measured_area", "area_m2", "m2", "sqm", "area"], removal_required: ["removal", "removal_required"],
  removal_m2: ["removal_m2", "removal_area"], existing_r_value: ["existing_r_value", "existing_r"], product: ["product", "insulation_product"],
  r_value: ["r_value", "proposed_r_value"], access_notes: ["access", "roof_access", "access_notes"], inspection_status: ["inspection_status", "measure_up_status", "status"],
  electrical_status: ["electrical_status", "piesa_status"], swms_status: ["swms", "swms_status"], electrician_name: ["electrician"], notes: ["notes", "comments"],
  measurement_purpose: ["measurement_purpose", "measure_type"], measurement_method: ["measurement_method", "method", "measure_method"],
  measured_by: ["measured_by", "measurer"], measured_on: ["measured_on", "measure_date", "measured_date"], gross_area_m2: ["gross_area", "gross_area_m2"], excluded_area_m2: ["excluded_area", "excluded_area_m2"],
};

/** Map one CSV row to facts. Column-mapped values are 'found'; nothing is inferred. */
export function extractFromCsvRow(r: Record<string, string>): Extracted {
  const out: Extracted = {};
  for (const k of IMPORT_FIELDS) {
    const col = CSV_ALIASES[k].find((a) => r[a] != null && r[a] !== "");
    const raw = col ? r[col] : null;
    let v: string | number | boolean | null = raw ?? null;
    if (raw != null && ["measured_area_m2", "removal_m2", "existing_r_value", "r_value", "gross_area_m2", "excluded_area_m2"].includes(k)) v = num(raw.replace(/[^\d.,]/g, ""));
    if (raw != null && k === "removal_required") v = /^(y|yes|true|1)$/i.test(raw);
    out[k] = f(v, col ? `csv:${col}` : "csv", v == null ? "missing" : "found");
  }
  return out;
}

/** Merge facts: later sources only fill gaps, never overwrite a found value; conflicts become uncertain. */
export function mergeExtracted(...parts: Extracted[]): Extracted {
  const out: Extracted = {};
  for (const p of parts) for (const k of IMPORT_FIELDS) {
    const n = p[k]; if (!n || n.value == null) { out[k] ??= (n ?? f(null, "none")) as Fact; continue; }
    const cur = out[k];
    if (!cur || cur.value == null) out[k] = n;
    else if (String(cur.value).toLowerCase() !== String(n.value).toLowerCase()) out[k] = { ...cur, confidence: "uncertain", source: `${cur.source} vs ${n.source}` };
  }
  const lines = parts.flatMap((p) => p.quote_lines ?? []);
  if (lines.length) out.quote_lines = lines;
  return out;
}

/** Review screen: what the user must still look at. Uncertain and missing-required fields are flagged; nothing is committed. */
export function reviewItems(x: Extracted) {
  return IMPORT_FIELDS.map((k) => {
    const fact = x[k] ?? { value: null, confidence: "missing" as const, source: "none" };
    const required = REQUIRED_IMPORT_FIELDS.includes(k);
    return { key: k, label: FIELD_LABEL[k], value: fact.value, confidence: fact.confidence, source: fact.source, required, flagged: fact.confidence === "uncertain" || (required && fact.value == null) };
  });
}

export type ConfirmedFacts = Partial<Record<ImportField, string | number | boolean | null>>;
/** The explicit confirmation step: the user's confirmed values are the ONLY values committed. */
export function confirmBlockers(c: ConfirmedFacts): string[] {
  const b: string[] = [];
  for (const k of REQUIRED_IMPORT_FIELDS) if (c[k] == null || c[k] === "") b.push(`${FIELD_LABEL[k]} is required`);
  if (c.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(c.email))) b.push("Owner email looks invalid");
  const a = c.measured_area_m2; if (a != null && a !== "" && !(Number(a) > 0 && Number(a) < 5000)) b.push("Measured area must be between 0 and 5000 m²");
  return b;
}

/** Imported measure-up → PROVISIONAL installer-supplied ceiling_measurement. The supplied figures are preserved
 *  permanently (supplied_*), but the relevant ceiling area is left for an independent onsite measurement: it is
 *  never accepted automatically and never makes the visit electrical-only on its own. */
export function planImportedMeasurement(c: ConfirmedFacts, importId: string, meta: { businessId?: string | null; standardApproved?: boolean } = {}) {
  const n = (v: unknown) => (v == null || v === "" ? null : Number(v));
  const area = n(c.measured_area_m2);
  const removal = c.removal_required == null ? null : !!c.removal_required;
  const existingR = n(c.existing_r_value);
  if (area == null && removal == null && existingR == null) return null;
  const removalM2 = c.removal_m2 == null || c.removal_m2 === "" ? (removal === false ? 0 : null) : Number(c.removal_m2);
  const method = parseMethod(c.measurement_method);
  const purpose = parsePurpose(c.measurement_purpose) ?? (method === "aerial_remote" ? "sales_estimate" : null);
  const supplied = { measured_area_m2: area, removal_required: removal, removal_m2: removalM2, existing_r_value: existingR, method, purpose,
    measured_by: c.measured_by ?? null, measured_on: c.measured_on ?? null, gross_area_m2: n(c.gross_area_m2), excluded_area_m2: n(c.excluded_area_m2), import_id: importId };
  const at = new Date().toISOString();
  const flags = ["measured_area_m2", ...(removal ? ["removal_m2"] : [])].map((field) => ({ field, reason: PROVISIONAL_FLAG_REASON, by: "system", at }));
  const onDate = c.measured_on && /^\d{4}-\d{2}-\d{2}$/.test(String(c.measured_on)) ? String(c.measured_on) : null;
  return {
    source_role: "installer" as const, external_source: "installer_import", external_id: importId,
    provenance: "installer_supplied_provisional" as const,
    // Relevant ceiling area stays empty until measured onsite (pilot dual verification); other facts prefill.
    measured_area_m2: meta.standardApproved ? area : null, removal_required: removal, removal_m2: removalM2,
    existing_r_value: existingR, insulation_present: existingR == null ? null : existingR > 0,
    supplied_area_m2: area, supplied_removal_m2: removalM2, supplied_snapshot: supplied,
    measurement_method: method, measurement_purpose: purpose, measured_by_name: c.measured_by == null ? null : String(c.measured_by), measured_by_role: "installer",
    measured_by_business_id: meta.businessId ?? null, measured_on: onDate, gross_area_m2: n(c.gross_area_m2), excluded_area_m2: n(c.excluded_area_m2),
    confidence: "low" as const, review_flags: flags,
    evidence_notes: [c.inspection_status && `Imported status: ${c.inspection_status}`, c.access_notes && `Access: ${c.access_notes}`, area != null && `Installer-supplied area ${area} m² (provisional)`].filter(Boolean).join(" · ") || null,
    status: "needs_review" as const,
  };
}

// ---------- Relationship owner / attribution ----------
export function relationshipOwnerFor(channel: "hivic_sourced" | "installer_sourced", partnerDefault?: string | null): "hivic" | "installer" {
  if (channel === "hivic_sourced") return "hivic"; // offers never change this by default
  return partnerDefault === "hivic" ? "hivic" : "installer";
}

// ---------- Electrician matching ----------
export type ElecCandidate = BusinessLike & {
  id: string; name: string; weekly_capacity?: number | null; lead_time_days?: number | null;
  credentials: Credential[]; preferred?: boolean; hasRates?: boolean; activeJobs?: number;
};
export type ElectricianChoice = "preferred" | "approved_other" | "nominated" | "hivic_organise";

export function serviceAreaMatch(b: Pick<BusinessLike, "service_postcodes" | "service_regions">, postcode: string | null, suburb?: string | null): boolean {
  if (!postcode && !suburb) return false;
  if (postcode && b.service_postcodes?.some((p) => p === postcode || (p.endsWith("*") && postcode.startsWith(p.slice(0, -1))))) return true;
  return !!suburb && !!b.service_regions?.some((r) => r.toLowerCase() === suburb.toLowerCase());
}

/** Verified postcode coverage is required before the portal may claim a partner services a job. */
export function verifiedServiceAreaMatch(b: Pick<BusinessLike, "service_postcodes"> & { coverage_verified_at?: string | null }, postcode: string | null): boolean {
  return !!b.coverage_verified_at && !!postcode && !!b.service_postcodes?.some((entry) => entry === postcode || (entry.endsWith("*") && postcode.startsWith(entry.slice(0, -1))));
}

/** Ranked suggestions — never auto-selects. Ineligible candidates are returned with the reason. */
export function rankElectricians(cands: ElecCandidate[], site: { postcode: string | null; suburb?: string | null }, now = new Date()) {
  return cands.filter(isElectricianBiz).map((c) => {
    const blocker = partnerWorkBlocker(c, c.credentials, now);
    const inArea = serviceAreaMatch(c, site.postcode, site.suburb);
    const expiring = c.credentials.some((x) => x.critical && credentialState(x, now) === "expiring");
    const score = (blocker ? -1000 : 0) + (c.preferred ? 40 : 0) + (inArea ? 30 : 0) + (c.hasRates ? 10 : 0) - (expiring ? 5 : 0) - Math.min(c.lead_time_days ?? 7, 21);
    const reasons = [c.preferred && "Preferred by installer", inArea ? "Services this area" : "Outside listed service area", c.hasRates ? "Agreed rates on file" : "No agreed rates", expiring && "Credential expiring within 30 days", c.lead_time_days != null && `Lead time ${c.lead_time_days} days`].filter(Boolean) as string[];
    return { id: c.id, name: c.name, eligible: !blocker, blocker, inArea, score, reasons };
  }).sort((a, b) => b.score - a.score);
}

/** Validate an electrician selection. Unapproved/nominated electricians may never do compliance-critical work. */
export function electricianSelectionBlocker(choice: ElectricianChoice, cand: ElecCandidate | null, now = new Date()): string | null {
  if (choice === "hivic_organise" || choice === "nominated") return null; // no assignment made yet
  if (!cand) return "Choose an electrician.";
  if (!isElectricianBiz(cand)) return `${cand.name} is not an electrician/REC business.`;
  if (choice === "preferred" && !cand.preferred) return `${cand.name} is not a preferred electrician for this installer.`;
  return partnerWorkBlocker(cand, cand.credentials, now);
}

// ---------- Appointment SLA ----------
export const SLA_WARN_H = 24, SLA_BREACH_H = 48;
export type SlaInput = { assigned_at: string; first_response_at?: string | null; booking_confirmed_at?: string | null; cannot_attend_at?: string | null };
export function appointmentSla(a: SlaInput, now = new Date()) {
  const since = (now.getTime() - Date.parse(a.assigned_at)) / 3_600_000;
  const responded = !!a.first_response_at;
  if (a.cannot_attend_at) return { state: "exception" as const, hours: since, canRequestAnother: true, message: "Electrician can't attend in time — request another electrician" };
  // A confirmed booking (including one entered by the office) clears the 48h flag.
  if (a.booking_confirmed_at) return { state: "booked" as const, hours: 0, canRequestAnother: false, message: "Confirmed" };
  if (since >= SLA_BREACH_H && !responded) return { state: "exception" as const, hours: since, canRequestAnother: true, message: "No meaningful contact after 48 hours — request another electrician" };
  // 48h rule is about a CONFIRMED booking: a reply alone does not stop the clock.
  if (since >= SLA_BREACH_H) return { state: "exception" as const, hours: since, canRequestAnother: true, message: "No booking confirmed after 48 hours — request another electrician" };
  if (since >= SLA_WARN_H && !responded) return { state: "attention" as const, hours: since, canRequestAnother: false, message: "No response for 24 hours — Home Insulation Victoria is monitoring this" };
  return { state: "ok" as const, hours: since, canRequestAnother: false, message: responded ? "Electrician made contact" : "Waiting for electrician" };
}

/**
 * Assessment visits have ONE normal scheduling path: proposals accepted in AppointmentPanel.
 * A direct assessment (PIESA) or Ready Check booking is an admin-only override and needs a reason (audited;
 * decision 220: one hidden office override for phone bookings).
 * Rectification/installation direct bookings keep their existing rules.
 */
export function directBookingBlocker(kind: "assessment" | "ready_check" | "rectification" | "installation", role: string, overrideReason?: string | null): string | null {
  if (kind !== "assessment" && kind !== "ready_check") return null;
  if (role !== "admin") return kind === "ready_check" ? "Ready Check times are agreed between the owner and the installer." : "Assessment visits are arranged by proposing a time and having the other party accept it.";
  if (!overrideReason || overrideReason.trim().length < 5) return "An admin override needs a reason (at least 5 characters).";
  return null;
}

/**
 * Owner/installer electrician reassignment route. `release` removes the electrician immediately
 * (only after 48h without a booking or when they said they can't attend); otherwise the request goes to Home Insulation Victoria review
 * and the electrician stays assigned.
 */
export function electricianReassignmentRoute(role: string, sla: { canRequestAnother: boolean }): "release" | "review" {
  if (role === "admin") return "release";
  return sla.canRequestAnother ? "release" : "review";
}

export type Proposal = { id: string; status: string; proposer_role: string; starts_at: string };
/** Responding to a proposal: accepting confirms the booking; any new proposal supersedes open ones. */
export function proposalResponse(p: Proposal, responderRole: string, action: "accept" | "decline", now = new Date()): string | null {
  if (p.status !== "proposed") return "This time is no longer open.";
  if (p.proposer_role === responderRole) return "The other party must respond to your proposed time.";
  if (action === "accept" && Date.parse(p.starts_at) <= now.getTime()) return "That time has already passed – propose a new one.";
  return null;
}

// ---------- Partner offers ----------
export type OfferStatus = "pending" | "accepted" | "declined" | "expired" | "withdrawn";
export type OfferPartnerPrefs = { onboarding_status?: string | null | undefined; is_active?: boolean | null | undefined; receives_hivic_leads?: boolean | null | undefined; accepting_new_jobs?: boolean | null | undefined };
export function offerBlocker(job: { channel: string; stage: string; hasActiveInstaller: boolean; hasPendingOffer: boolean }, partner?: OfferPartnerPrefs): string | null {
  if (job.channel !== "hivic_sourced") return "Only Home Insulation Victoria-sourced jobs can be offered to a partner.";
  if (["complete", "cancelled", "ready_for_veec", "ap_review", "evidence_outstanding", "installation_booked"].includes(job.stage)) return "Job is too far through the workflow to offer.";
  if (job.hasActiveInstaller) return "Job already has an installer.";
  if (job.hasPendingOffer) return "Job already has a pending offer.";
  if (partner) {
    if (partner.onboarding_status != null && partner.onboarding_status !== "approved") return "Partner is not approved yet.";
    if (partner.is_active === false) return "Partner is inactive.";
    // Approval is not availability: an approved partner can still be own-customers-only or paused.
    if (partner.receives_hivic_leads === false) return "Partner works with their own customers only and does not receive Home Insulation Victoria leads.";
    if (partner.accepting_new_jobs === false) return "Partner is not accepting new jobs right now.";
  }
  return null;
}
/** Only summary facts are shown before acceptance (no owner name/contact/street number). */
export function offerSummary(j: { job_number: string; stage: string; suburb: string | null; postcode: string | null; estimated_area_m2: number | null; measured_area_m2?: number | null; eligibility_outcome: string | null }) {
  return { job_number: j.job_number, stage: j.stage, suburb: j.suburb, postcode: j.postcode, area_m2: j.measured_area_m2 ?? j.estimated_area_m2, area_basis: j.measured_area_m2 ? "measured" : j.estimated_area_m2 ? "owner estimate" : "unknown", eligibility: j.eligibility_outcome };
}
export function offerRespondBlocker(o: { status: string; expires_at: string | null }, now = new Date()): string | null {
  if (o.status !== "pending") return `Offer is already ${o.status}.`;
  if (o.expires_at && Date.parse(o.expires_at) < now.getTime()) return "Offer has expired.";
  return null;
}

// ---------- Partner pricing ----------
export type PartnerLine = { code?: string | null | undefined; description: string; category: string; unit: string; quantity: number; supplier_unit_ex_gst: number; justification?: string | null | undefined };
export const EXTRA_CATEGORIES = ["tile_lift", "metal_sheet_access", "removal", "difficult_access", "other"] as const;
export function partnerLineBlockers(lines: PartnerLine[]): string[] {
  const b: string[] = [];
  lines.forEach((l, i) => {
    if (!(l.quantity > 0)) b.push(`Line ${i + 1}: quantity must be above 0`);
    if (!(l.supplier_unit_ex_gst >= 0)) b.push(`Line ${i + 1}: price must be 0 or more`);
    if ((l.category === "other" || l.category === "difficult_access") && !l.justification?.trim()) b.push(`Line ${i + 1}: explain why this extra is needed`);
  });
  if (!lines.length) b.push("Add at least one line");
  return b;
}
export const supplierTotal = (lines: PartnerLine[]) => Math.round(lines.reduce((s, l) => s + l.quantity * l.supplier_unit_ex_gst, 0) * 100) / 100;
/** Every revision after the first needs a reason (actor/time come from the server). */
export function revisionBlocker(version: number, reason: string | null | undefined) {
  return version > 1 && !(reason && reason.trim().length >= 5) ? "Give a reason for changing the proposed price (min 5 characters)." : null;
}

/** Customer-facing co-branded snapshot. Never includes supplier cost or margin. */
export function cobrandSnapshot(p: { partnerName: string; partnerLogoUrl?: string | null | undefined; partnerAbn?: string | null | undefined; relationshipOwner: "hivic" | "installer" }) {
  return {
    installation_partner: { name: p.partnerName, logo_url: p.partnerLogoUrl ?? null, abn: p.partnerAbn ?? null },
    accredited_provider: { name: AP_ENTITY, role: "Accredited Person (VEU Activity 48)" },
    customer_contact: p.relationshipOwner === "installer" ? p.partnerName : "Home Insulation Victoria",
  };
}
/** Guard: the customer-facing quote payload must never carry cost/margin keys. */
export function customerSafe<T extends Record<string, unknown>>(o: T): T {
  const bad = /cost|margin|supplier|ap_fee|internal/i;
  const walk = (v: unknown): unknown => Array.isArray(v) ? v.map(walk) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).filter(([k]) => !bad.test(k)).map(([k, x]) => [k, walk(x)])) : v;
  return walk(o) as T;
}

// ---------- Dashboard buckets ----------
export const PARTNER_BUCKETS = ["waiting_electrician", "assessment_to_book", "quote_action", "deposit", "installation_to_book", "evidence", "ap_veec", "complete", "other"] as const;
export type PartnerBucket = (typeof PARTNER_BUCKETS)[number];
export const BUCKET_LABEL: Record<PartnerBucket, string> = {
  waiting_electrician: "Waiting for electrician", assessment_to_book: "Assessment to book", quote_action: "Quote / action required", deposit: "Deposit",
  installation_to_book: "Installation to book", evidence: "Evidence / action required", ap_veec: "AP / VEEC status", complete: "Complete", other: "Other",
};
export function bucketFor(stage: string): PartnerBucket {
  if (["new_enquiry", "eligibility_review", "awaiting_electrician"].includes(stage)) return "waiting_electrician";
  if (["assessment_booking", "assessment_booked"].includes(stage)) return "assessment_to_book";
  if (["assessment_complete", "rectification_required", "awaiting_owner_rectification_approval", "ready_for_installer_quotes", "awaiting_quote_acceptance"].includes(stage)) return "quote_action";
  if (stage === "awaiting_deposit_payment") return "deposit";
  if (["rectification_scheduling", "rectification_booked", "installation_scheduling", "installation_booked"].includes(stage)) return "installation_to_book";
  if (stage === "evidence_outstanding") return "evidence";
  if (["ap_review", "ready_for_veec"].includes(stage)) return "ap_veec";
  if (stage === "complete") return "complete";
  return "other";
}

/** Electrician (REC) dashboard groups, in source-of-truth wording. Presentation only. */
export const REC_BUCKETS = ["Accepted · Arrange visit", "Awaiting owner confirmation", "Booked", "PIESA complete", "Electrical fixes required", "Electrically cleared", "Other"] as const;
export function recBucketFor(label: string): (typeof REC_BUCKETS)[number] {
  if (label === "Electrical fixes required · Arrange visit") return "Electrical fixes required";
  return (REC_BUCKETS as readonly string[]).includes(label) ? (label as (typeof REC_BUCKETS)[number]) : "Other";
}

/** Electrician dashboard: the generic "Waiting for electrician" SLA text is meaningless to the assigned electrician
 *  (their status line already says what to do). Only warnings/exceptions are shown to them. */
export function recSlaForAssigned<T extends { state: string } | null>(sla: T): T | null {
  return sla && (sla.state === "attention" || sla.state === "exception") ? sla : null;
}

/** Decision 220: which visit the office's "Set a visit time by hand" sets at this job stage (null = none can be set). */
export function manualVisitKind(stage: string): "ready_check" | "assessment" | null {
  if (stage === "ready_check_ready_to_schedule" || stage === "ready_check_scheduled") return "ready_check";
  if (stage === "piesa_and_install_window_pending" || stage === "piesa_scheduled") return "assessment";
  return null;
}
