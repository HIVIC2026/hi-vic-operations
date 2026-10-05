// Pure rules for the slim bulk installer import. No database, no network — fully unit-tested.
// Sorting is by Ready Check coverage only: we never judge the installer's price — a price, if
// present, is simply carried into the draft quote. Old / non-geotagged photos are used for
// sorting only, never as official evidence.

export type BulkExtracted = {
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
  address_line?: string | null;
  suburb?: string | null;
  postcode?: string | null;
  area_m2?: number | null;
  existing_insulation?: string | null; // e.g. "none", "old batts ~50mm", "unknown"
  access?: string | null; // e.g. "manhole in hallway, easy", "unknown"
  roof_type?: string | null; // e.g. "tiled", "tin", "unknown"
  hazards?: string | null; // e.g. "none seen", "asbestos suspected", "unknown"
  building_age?: string | null; // e.g. "built 1978", "about 40 years old", "unknown"
  notes?: string | null;
  price_inc_gst?: number | null;
  /** True when the lead was pieced together only from file/folder names, photo text or photo location. */
  unsure?: boolean | null;
  /** Uploaded file names this lead was read from (for the per-file result list). */
  source_files?: string[] | null;
};

export type BulkFile = {
  path: string;
  name: string;
  folder?: string | null;
  type?: string | null;
  gps_lat?: number | null;
  gps_lng?: number | null;
  taken_at?: string | null;
  /** Street address looked up from the photo's GPS (approximate; matching/sorting only, never evidence). */
  geo_address?: string | null;
};

export type SortResult = "covers_ready_check" | "needs_visit" | "office_review";

/** Exact wording of the one required tick before upload. */
export const CONTACT_PERMISSION_WORDING =
  "I confirm these customers are happy for Home Insulation Victoria to contact them.";

export type LeadStage = "not_visited" | "visited" | "visited_quoted";
export const LEAD_STAGE_LABEL: Record<LeadStage, string> = {
  not_visited: "Not visited (contact details only)",
  visited: "Visited (photos/measurements)",
  visited_quoted: "Visited and quoted (price found)",
};

/** Work out the lead's stage from what was uploaded. A price means visited and quoted;
 * any measurement, site detail or matched file means visited; otherwise not visited. */
export function leadStage(e: BulkExtracted, matchedFileCount: number): LeadStage {
  if (e.price_inc_gst && e.price_inc_gst > 0) return "visited_quoted";
  const siteInfo = (e.area_m2 && e.area_m2 > 0)
    || ["existing_insulation", "access", "roof_type", "hazards"].some((k) => KNOWN(e[k as keyof BulkExtracted] as string | null));
  if (siteInfo || matchedFileCount > 0) return "visited";
  return "not_visited";
}

/** Normalise an address for matching: lowercase, strip punctuation, collapse spaces. */
export function normaliseAddress(addr: string | null | undefined): string {
  return (addr ?? "")
    .toLowerCase()
    .replace(/[,\.]/g, " ")
    .replace(/\b(street|st|road|rd|avenue|ave|drive|dr|court|ct|place|pl|lane|ln|parade|pde|crescent|cres)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Distinctive tokens of an address (street number + name words, len > 2). */
export function addressTokens(addr: string | null | undefined): string[] {
  return normaliseAddress(addr)
    .split(" ")
    .filter((t) => t.length > 2 || /^\d+$/.test(t));
}

/** Stable dedupe key: normalised address line + postcode, else email, else null. */
export function dedupeKey(e: BulkExtracted): string | null {
  const a = normaliseAddress(e.address_line);
  if (a && e.postcode) return `addr:${a}|${e.postcode}`;
  if (e.email) return `email:${e.email.toLowerCase().trim()}`;
  return null;
}

export type FileMatch = { path: string; name: string; how: "folder" | "filename" | "gps" };

/** Match files to a row by folder name, then filename, against the address tokens. */
export function matchFiles(
  row: BulkExtracted,
  files: BulkFile[],
): { matched: FileMatch[]; confidence: "high" | "low" | "none" } {
  const tokens = addressTokens(row.address_line);
  if (tokens.length === 0) return { matched: [], confidence: "none" };
  const num = tokens.find((t) => /^\d+$/.test(t));
  const words = tokens.filter((t) => !/^\d+$/.test(t));
  const matched: FileMatch[] = [];
  for (const f of files) {
    const hay = `${f.folder ?? ""} ${f.name}`.toLowerCase();
    const normHay = normaliseAddress(hay.replace(/[-_]/g, " "));
    const hasNum = num ? normHay.split(" ").includes(num) : false;
    const wordHits = words.filter((w) => normHay.includes(w)).length;
    const geo = normaliseAddress(f.geo_address ?? "");
    const geoHit = !!geo && (num ? geo.split(" ").includes(num) : true) && words.filter((w) => geo.includes(w)).length > 0;
    if (f.folder && hasNum && wordHits > 0) matched.push({ path: f.path, name: f.name, how: "folder" });
    else if (hasNum && wordHits > 0) matched.push({ path: f.path, name: f.name, how: "filename" });
    else if (geoHit) matched.push({ path: f.path, name: f.name, how: "gps" });
  }
  const confidence = matched.some((m) => m.how === "folder" || m.how === "gps") ? "high" : matched.length > 0 ? "low" : "none";
  return { matched, confidence };
}

const KNOWN = (v: string | null | undefined) => {
  const s = (v ?? "").trim().toLowerCase();
  return s.length > 0 && !["unknown", "not sure", "unsure", "n/a", "na", "?", "none known"].includes(s);
};

/** The Ready Check items the upload can cover. Key items decide whether a visit is needed;
 * small items, when missing, become the install-day list instead of forcing a visit. */
export const READY_CHECK_KEY_ITEMS = [
  { key: "area_m2", label: "ceiling area / measurements" },
  { key: "existing_insulation", label: "existing insulation type/depth" },
  { key: "access", label: "ceiling access" },
] as const;
export const READY_CHECK_SMALL_ITEMS = [
  { key: "roof_type", label: "roof type" },
  { key: "hazards", label: "hazards" },
  { key: "building_age", label: "building age" },
] as const;

function itemKnown(e: BulkExtracted, key: string): boolean {
  if (key === "area_m2") return !!(e.area_m2 && e.area_m2 > 0);
  return KNOWN(e[key as keyof BulkExtracted] as string | null | undefined);
}

/** Ready Check items the upload does not cover, split into key (visit-deciding) and small. */
export function readyCheckGaps(e: BulkExtracted): { key: string[]; small: string[] } {
  return {
    key: READY_CHECK_KEY_ITEMS.filter((i) => !itemKnown(e, i.key)).map((i) => i.label),
    small: READY_CHECK_SMALL_ITEMS.filter((i) => !itemKnown(e, i.key)).map((i) => i.label),
  };
}

/** Official Ready Check evidence still missing — becomes the install-day task list later.
 * Uploaded photos never count as official evidence here (no verified GPS/date at this stage). */
export function missingEvidence(e: BulkExtracted, matched: FileMatch[]): string[] {
  void matched; // matched files exist, but GPS/recency unverified → never counts as official
  const missing: string[] = [
    "Geotagged photo of ceiling area with tape measure (depth)",
    KNOWN(e.existing_insulation) ? "Geotagged photo confirming existing insulation" : "Geotagged photo showing existing insulation",
    "Geotagged photo of ceiling access / manhole",
    "Geotagged photo of front of property",
  ];
  const { small } = readyCheckGaps(e);
  for (const s of small) missing.push(`Confirm ${s} on the day`);
  return missing;
}

/** Sort one extracted job by how much of the Ready Check the upload covers.
 * Price is never a factor — it is simply carried into the draft quote when present. */
export function sortJob(
  e: BulkExtracted,
  opts: { matchConfidence: "high" | "low" | "none"; duplicate: boolean },
): { result: SortResult; reasons: string[] } {
  const reasons: string[] = [];
  if (!e.address_line || !e.postcode) reasons.push("No usable address");
  if (opts.duplicate) reasons.push("Looks like a job that already exists in the portal");
  if (!e.full_name && !e.phone && !e.email) reasons.push("No customer name or contact details");
  if (e.unsure) reasons.push("Found only from file names, photo text or photo location — please check");
  if (reasons.length > 0) return { result: "office_review", reasons };

  const gaps = readyCheckGaps(e);
  if (gaps.key.length > 0) {
    return { result: "needs_visit", reasons: [`Missing: ${gaps.key.join("; ")} — a Ready Check visit is needed`] };
  }
  const out = ["Measurements, existing insulation and access all supplied — covers the Ready Check, no visit needed"];
  if (gaps.small.length > 0) out.push(`Small items for the install-day list: ${gaps.small.join("; ")}`);
  if (opts.matchConfidence === "low") out.push("Some files matched by filename only — check them");
  return { result: "covers_ready_check", reasons: out };
}

/** Mark duplicates within the batch and against existing portal keys. Returns a note per row index. */
export function findDuplicates(
  rows: BulkExtracted[],
  existingKeys: Set<string>,
): Map<number, string> {
  const notes = new Map<number, string>();
  const seen = new Map<string, number>();
  rows.forEach((r, i) => {
    const key = dedupeKey(r);
    if (!key) return;
    if (existingKeys.has(key)) {
      notes.set(i, "Already in the portal (same address or email) — will be skipped unless you untick skip");
      return;
    }
    const first = seen.get(key);
    if (first !== undefined) {
      notes.set(i, `Same address as row ${first + 1} in this upload — will be skipped`);
    } else seen.set(key, i);
  });
  return notes;
}

export type FileResult = { name: string; status: "ok" | "warn" | "error"; message: string };
/** Plain-English result per uploaded file, after leads are found and files matched. Reading results from the
 * upload step (e.g. "read 12 rows") are kept; files that fed or matched a lead say which one. */
export function fileResults(read: FileResult[], leads: BulkExtracted[], matches: FileMatch[][]): FileResult[] {
  const label = (e: BulkExtracted) => [e.address_line, e.suburb].filter(Boolean).join(", ") || e.full_name || "an unnamed lead";
  const base = (n: string) => n.split("/").pop()!.toLowerCase();
  return read.map((r) => {
    const fed = leads.filter((e) => (e.source_files ?? []).some((s) => base(s) === base(r.name)));
    const hit = matches.flatMap((m, i) => m.filter((x) => base(x.path) === base(r.name)).map((x) => ({ x, e: leads[i]! })));
    if (r.status === "error") return r;
    const parts: string[] = [r.message];
    if (fed.length) parts.push(fed.length === 1 ? `customer found: ${label(fed[0]!)}` : `${fed.length} customers found`);
    const g = hit.find((h) => h.x.how === "gps"), o = hit[0];
    if (g) parts.push(`matched by GPS to ${label(g.e)}`);
    else if (o) parts.push(`matched by ${o.x.how === "folder" ? "folder name" : "file name"} to ${label(o.e)}`);
    const used = fed.length > 0 || hit.length > 0;
    return { name: r.name, status: used ? r.status : "warn", message: used ? parts.join(" — ") : `${r.message} — not linked to any customer` };
  });
}
