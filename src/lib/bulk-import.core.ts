// Pure rules for the slim bulk installer import. No database, no network — fully unit-tested.
// Old / non-geotagged photos are used for sorting and quoting only, never as official evidence.

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
  notes?: string | null;
  price_inc_gst?: number | null;
};

export type BulkFile = {
  path: string;
  name: string;
  folder?: string | null;
  type?: string | null;
  gps_lat?: number | null;
  gps_lng?: number | null;
  taken_at?: string | null;
};

export type SortResult = "ready_to_quote" | "needs_visit" | "office_review";

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
    if (f.folder && hasNum && wordHits > 0) matched.push({ path: f.path, name: f.name, how: "folder" });
    else if (hasNum && wordHits > 0) matched.push({ path: f.path, name: f.name, how: "filename" });
  }
  const confidence = matched.some((m) => m.how === "folder") ? "high" : matched.length > 0 ? "low" : "none";
  return { matched, confidence };
}

const KNOWN = (v: string | null | undefined) => {
  const s = (v ?? "").trim().toLowerCase();
  return s.length > 0 && !["unknown", "not sure", "unsure", "n/a", "na", "?"].includes(s);
};

/** Official Ready Check evidence still missing — becomes the install-day task list later.
 * Uploaded photos never count as official evidence here (no verified GPS/date at this stage). */
export function missingEvidence(e: BulkExtracted, matched: FileMatch[]): string[] {
  const missing: string[] = [];
  const hasGeotagged = matched.length > 0; // matched files exist, but GPS/recency unverified → never counts
  void hasGeotagged;
  missing.push("Geotagged photo of ceiling area with tape measure (depth)");
  if (!KNOWN(e.existing_insulation)) missing.push("Geotagged photo showing existing insulation");
  else missing.push("Geotagged photo confirming existing insulation");
  missing.push("Geotagged photo of ceiling access / manhole");
  missing.push("Geotagged photo of front of property");
  return missing;
}

/** Sort one extracted job against the Ready Check requirements. */
export function sortJob(
  e: BulkExtracted,
  opts: { matchConfidence: "high" | "low" | "none"; duplicate: boolean },
): { result: SortResult; reasons: string[] } {
  const reasons: string[] = [];
  if (!e.address_line || !e.postcode) reasons.push("No usable address");
  if (opts.duplicate) reasons.push("Looks like a job that already exists in the portal");
  if (!e.full_name && !e.phone && !e.email) reasons.push("No customer name or contact details");
  if (reasons.length > 0) return { result: "office_review", reasons };

  const gaps: string[] = [];
  if (!(e.area_m2 && e.area_m2 > 0)) gaps.push("no ceiling area / measurements");
  if (!KNOWN(e.existing_insulation)) gaps.push("existing insulation not known");
  if (!KNOWN(e.access)) gaps.push("ceiling access not known");
  if (gaps.length > 0) {
    return { result: "needs_visit", reasons: [`Missing: ${gaps.join("; ")} — a visit is needed before quoting`] };
  }
  const out = ["Area, existing insulation and access all supplied — enough to quote without a revisit"];
  if (opts.matchConfidence === "low") out.push("Some files matched by filename only — check them");
  if (e.price_inc_gst == null) out.push("No price in the upload — quote will wait for the installer's price");
  return { result: "ready_to_quote", reasons: out };
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
