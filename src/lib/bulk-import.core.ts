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
  /** Free text from the installer's file: what the quoted price includes (R-value/product, area, removal, extras). */
  price_includes?: string | null;
  /** Has the installer ALREADY done the site check / measure-up? null = unclear (asked on the review screen). */
  site_check?: SiteCheck | null;
  /** YYYY-MM-DD when known. */
  site_check_date?: string | null;
  /** Where the answer came from: read from the file, or answered on the review screen. */
  site_check_source?: "file" | "asked" | null;
  /** Installer's own answer to "Quoted? Yes / No" — never preset; a price in the file only prefills the screen. */
  quoted_answer?: "yes" | "no" | null;
  /** True when the lead was pieced together only from file/folder names, photo text or photo location. */
  unsure?: boolean | null;
  /** Uploaded file names this lead was read from (for the per-file result list). */
  source_files?: string[] | null;
  /** Couples (Jo, 7 Oct): the first person is the main contact; an optional second contact. */
  second_contact?: SecondContact | null;
};
export type SecondContact = { name: string | null; phone: string | null; email: string | null };

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

export type SiteCheck = "yes" | "no";

/** Reads a site-check cell/note: "Y", "Yes", "Done", "Visited", "Measured", "Quoted" or a date → yes; "N", "No", "Not yet" → no. Anything else → null (ask). */
export function parseSiteCheck(raw: unknown): { check: SiteCheck | null; date: string | null } {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return { check: null, date: null };
  const date = parseDateish(s);
  if (/^(n|no|nope|not yet|not done|not visited|not measured|false|0|-)$/.test(s) || /\b(not (yet )?(visited|measured|done|checked))\b/.test(s) || /\b(haven'?t|have not|not) (been )?(out|there|visited)( yet)?\b|\byet to (visit|go out|measure)\b/.test(s)) return { check: "no", date: null };
  if (/^(y|yes|done|true|1|✓|x)$/.test(s) || /\b(visited|measured|site check(ed)? done|checked|quoted|measure-?up done)\b/.test(s) || date) return { check: "yes", date };
  return { check: null, date: null };
}

/** d/m/yyyy, d-m-yy, yyyy-mm-dd → yyyy-mm-dd (Australian day-first). */
export function parseDateish(s: string): string | null {
  let m = s.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (m) return iso(+m[1]!, +m[2]!, +m[3]!);
  m = s.match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\b/);
  if (m) return iso(m[3]!.length === 2 ? 2000 + +m[3]! : +m[3]!, +m[2]!, +m[1]!);
  return null;
}
function iso(y: number, mo: number, d: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** The site-check answer from the file only: an explicit answer or a date only. Never guessed from a quoted price, area or photos (Jo, 7 Oct: blank = ask). */
export function siteCheckFromFile(e: BulkExtracted): { check: SiteCheck | null; date: string | null } {
  if (e.site_check === "yes" || e.site_check === "no") return { check: e.site_check, date: e.site_check === "yes" ? e.site_check_date ?? null : null };
  if (e.site_check_date) return { check: "yes", date: e.site_check_date };
  return { check: null, date: null };
}

/** Jo (7 Oct): an uploaded job's price is ONLY the installer's quoted price; none = "Quote needed from installer". */
export const QUOTE_NEEDED_LABEL = "Quote needed from installer";
export const quoteNeeded = (e: BulkExtracted) => !(e.price_inc_gst && e.price_inc_gst > 0);
export function siteCheckLabel(check: SiteCheck | null | undefined, date?: string | null): string {
  if (check === "yes") return date ? `Site check done: Yes (${date.split("-").reverse().join("/")})` : "Site check done: Yes";
  if (check === "no") return "Site check done: No — Ready Check needed";
  return "Site check: unclear — please answer Yes or No";
}

export const QUOTED_ANSWER_NEEDED = "Quoted? – answer needed";
export const QUOTED_QUESTION = "Have you quoted this customer?";
export type InstallerJobFacts = { quoted?: "yes" | "no" | null; site_check: SiteCheck | null; site_check_date: string | null; quoted_price_inc_gst: number | null; price_includes: string | null };
/** Short labels for office/partner lists (presentation only). */
export function installerFactLabels(f: InstallerJobFacts): { siteCheck: string; price: string } {
  const d = f.site_check_date ? ` (${f.site_check_date.split("-").reverse().join("/")})` : "";
  return {
    siteCheck: f.site_check === "yes" ? `Site check done: Yes${d}` : f.site_check === "no" ? "Site check done: No — Ready Check" : "Site check: not recorded",
    price: f.quoted === null ? QUOTED_ANSWER_NEEDED : f.quoted === "no" ? QUOTE_NEEDED_LABEL : f.quoted_price_inc_gst ? `Installer's price $${Number(f.quoted_price_inc_gst).toLocaleString("en-AU")} inc GST` : QUOTE_NEEDED_LABEL,
  };
}

export type SortResult = "covers_ready_check" | "needs_visit" | "office_review";

/** Exact wording of the one required tick before upload. */
export const CONTACT_PERMISSION_WORDING =
  "The owner has given Home Insulation Victoria permission to contact them.";

export type LeadStage = "not_visited" | "visited" | "quoted" | "installed";
export const LEAD_STAGE_LABEL: Record<LeadStage, string> = {
  not_visited: "Not visited",
  visited: "Visited",
  quoted: "Quoted",
  installed: "Installed",
};

/** Visited rule (Jo, 7 Oct 5:45pm): photos, measurements or a quote mean Visited; sentences only mean Not visited.
 * An explicit "No" from the installer stays Not visited. */
export function hasVisitEvidence(e: BulkExtracted, matchedFileCount = 0): boolean {
  return (e.price_inc_gst ?? 0) > 0 || (e.area_m2 ?? 0) > 0 || matchedFileCount > 0;
}
export function effectiveSiteCheck(e: BulkExtracted, matchedFileCount = 0): { check: SiteCheck | null; date: string | null } {
  const sc = siteCheckFromFile(e);
  if (sc.check) return sc;
  return hasVisitEvidence(e, matchedFileCount) ? { check: "yes", date: null } : sc;
}
export function leadStage(e: BulkExtracted, matchedFileCount = 0): LeadStage {
  if (effectiveSiteCheck(e, matchedFileCount).check !== "yes") return "not_visited";
  return e.price_inc_gst && e.price_inc_gst > 0 ? "quoted" : "visited";
}

/** Every customer needs name, full address, email and phone (Jo, 7 Oct) plus the installer's contact-permission tick. */
/** Jo (7 Oct): "Quoted? Yes / No" must be answered by the installer; Yes needs the price inc GST (kept exactly). */
export function quotedGap(answer: "yes" | "no" | null | undefined, price: number | null | undefined): string | null {
  if (answer !== "yes" && answer !== "no") return "Answer \"Quoted?\" Yes or No";
  if (answer === "yes" && !(Number.isFinite(Number(price)) && Number(price) > 0)) return "Enter the quoted price inc GST";
  return null;
}
/** Price to keep: Yes keeps the installer's price exactly (cents), No keeps none ("Quote needed from installer"). */
export const quotedPrice = (answer: "yes" | "no", price: number | null | undefined) => answer === "yes" ? Math.round(Number(price) * 100) / 100 : null;
/** Installer answers "Quoted?" later on the job page (Jo, 5:46pm). Answer once; Yes keeps the price exactly. */
export function planQuotedAnswer(current: "yes" | "no" | null, answer: "yes" | "no", price: number | null | undefined, nextAction: string | null):
  { error: string } | { patch: { installer_quoted: "yes" | "no"; installer_quoted_price_inc_gst: number | null; next_action: string | null } } {
  // No can later become Yes with a price (e.g. after the Ready Check, Jo 6pm); every other change is refused.
  if (current === "yes" || (current === "no" && answer !== "yes")) return { error: "You've already answered this." };
  const gap = quotedGap(answer, price);
  if (gap) return { error: gap };
  const base = (nextAction ?? "").split(" · ").filter((x) => x && x !== QUOTED_ANSWER_NEEDED && x !== QUOTE_NEEDED_LABEL);
  if (answer === "no") base.push(QUOTE_NEEDED_LABEL);
  return { patch: { installer_quoted: answer, installer_quoted_price_inc_gst: quotedPrice(answer, price), next_action: base.join(" · ") || null } };
}
export const CUSTOMER_DETAILS_NEEDED = "Customer details needed";
export function customerDetailsGaps(e: BulkExtracted): string[] {
  const gaps: string[] = [];
  if (!e.full_name?.trim()) gaps.push("name");
  if (!e.address_line?.trim() || !e.suburb?.trim() || !/^\d{4}$/.test((e.postcode ?? "").trim())) gaps.push("full address (street, suburb, postcode)");
  if (!e.email?.trim() || !EMAIL_RE.test(e.email.trim())) gaps.push("email");
  if (!normaliseAuPhone(e.phone).phone) gaps.push("phone number");
  return gaps;
}
export function customerDetailsReason(e: BulkExtracted): string | null {
  const g = customerDetailsGaps(e);
  return g.length ? `${CUSTOMER_DETAILS_NEEDED}: please add the ${g.join(", ")}` : null;
}

/** Stage from a (possibly answered) site check; an explicit "installed" history row stays installed. */
export function stageForSiteCheck(check: SiteCheck | null, priced: boolean, current?: LeadStage | null): LeadStage {
  if (current === "installed") return "installed";
  if (check !== "yes") return "not_visited";
  return priced ? "quoted" : "visited";
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

export type FileMatch = { path: string; name: string; how: "folder" | "filename" | "gps" | "photo_text" | "added" };

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

/** Canonical identity of an uploaded file: its full relative path (folder + name), slashes normalised, case-folded.
 * Two files with the same name in different folders are DIFFERENT files. */
export function canonicalFilePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^(\.\/|\/)+/, "").replace(/\/{2,}/g, "/").trim().toLowerCase();
}
const baseOf = (p: string) => canonicalFilePath(p).split("/").pop()!;

/** Did this lead's text come from this file? Exact canonical path only; a bare name (no folder) counts only when exactly
 * one uploaded file has that name — otherwise it is ambiguous and links nothing. */
export function sourceFileMatches(source: string, filePath: string, allPaths: string[]): boolean {
  const s = canonicalFilePath(source), f = canonicalFilePath(filePath);
  if (s === f) return true;
  if (s.includes("/")) return false;
  return baseOf(f) === s && allPaths.filter((x) => baseOf(x) === s).length === 1;
}

/** Link uploaded files to every lead: folder/filename/GPS first, then files whose own text (photo or PDF) the lead was
 * read from. A file claimed by MORE than one lead is linked to none of them and listed as `ambiguous` for review —
 * one customer's evidence never attaches silently to another. No single-customer fallback. */
export function linkFiles(leads: BulkExtracted[], files: BulkFile[]): { matched: FileMatch[]; confidence: "high" | "low" | "none"; ambiguous: string[] }[] {
  const allPaths = files.map((f) => f.path);
  const out = leads.map((e) => {
    const r = matchFiles(e, files);
    const have = new Set(r.matched.map((m) => m.path));
    for (const f of files) if (!have.has(f.path) && (e.source_files ?? []).some((s) => sourceFileMatches(s, f.path, allPaths))) { r.matched.push({ path: f.path, name: f.name, how: "photo_text" }); have.add(f.path); }
    return r.matched;
  });
  const claims = new Map<string, number>();
  for (const m of out) for (const x of new Set(m.map((y) => y.path))) claims.set(x, (claims.get(x) ?? 0) + 1);
  return out.map((m) => {
    const ambiguous = m.filter((x) => (claims.get(x.path) ?? 0) > 1).map((x) => x.path);
    const matched = m.filter((x) => (claims.get(x.path) ?? 0) === 1);
    const strong = matched.some((x) => x.how === "folder" || x.how === "gps" || x.how === "photo_text");
    return { matched, ambiguous, confidence: ambiguous.length ? (matched.length ? "low" : "none") : strong ? "high" : matched.length ? "low" : "none" };
  });
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
  if (opts.duplicate) reasons.push("Looks like a job that already exists in the portal");
  if (e.unsure) reasons.push("Found from notes, file names, photo text or photo location — please check");
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
  const allPaths = read.map((r) => r.name);
  return read.map((r) => {
    const fed = leads.filter((e) => (e.source_files ?? []).some((s) => sourceFileMatches(s, r.name, allPaths)));
    const hit = matches.flatMap((m, i) => m.filter((x) => canonicalFilePath(x.path) === canonicalFilePath(r.name)).map((x) => ({ x, e: leads[i]! })));
    if (r.status === "error") return r;
    const parts: string[] = [r.message];
    if (fed.length) parts.push(fed.length === 1 ? `customer found: ${label(fed[0]!)}` : `${fed.length} customers found`);
    const g = hit.find((h) => h.x.how === "gps"), o = fed.length ? undefined : hit[0];
    if (g) parts.push(`matched by GPS to ${label(g.e)}`);
    else if (o) parts.push(`matched by ${({ folder: "folder name", filename: "file name", photo_text: "address written in the file", gps: "GPS", added: "you" } as const)[o.x.how]} to ${label(o.e)}`);
    const used = fed.length > 0 || hit.length > 0;
    return { name: r.name, status: used ? r.status : "warn", message: used ? parts.join(" — ") : `${r.message} — not linked to any customer — check before continuing` };
  });
}

// ---------- deterministic clean-up of spreadsheet reads (never guesses; flags instead) ----------
const HEADER_WORDS = /\b(name|customer|owner|client|address|street|suburb|town|postcode|post code|phone|mobile|mob|email|e-mail|area|m2|m²|sqm|size|price|quote|visited|measured|site check|includes)\b/i;

/** First row (within the top 20) that looks like a header: 2+ cells naming known fields. Falls back to the first non-blank row. */
export function findHeaderRow(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const hits = (rows[i] ?? []).filter((c) => c && c.length <= 40 && HEADER_WORDS.test(c)).length;
    if (hits >= 2) return i;
  }
  return Math.max(0, rows.findIndex((r) => r.some((c) => c.trim())));
}

/** Grid → records keyed by the detected header row; blank rows dropped; extra/unnamed columns kept as "Column N". */
export function gridToRecords(grid: unknown[][]): Record<string, string>[] {
  const rows = grid.map((r) => (r ?? []).map((c) => String(c ?? "").trim()));
  const h = findHeaderRow(rows);
  const header = (rows[h] ?? []).map((c, i) => c || `Column ${i + 1}`);
  const seen = new Map<string, number>();
  const keys = header.map((k) => { const n = (seen.get(k) ?? 0) + 1; seen.set(k, n); return n > 1 ? `${k} (${n})` : k; });
  const out: Record<string, string>[] = [];
  for (const r of rows.slice(h + 1)) {
    if (!r.some((c) => c)) continue;
    const rec: Record<string, string> = {};
    const width = Math.max(keys.length, r.length);
    for (let i = 0; i < width; i++) { const v = r[i] ?? ""; if (v) rec[keys[i] ?? `Column ${i + 1}`] = v; }
    out.push(rec);
  }
  return out;
}

/** Australian phone → "0412 345 678" / "03 9123 4567". Unknown shapes are kept as written and reported. */
export function normaliseAuPhone(raw: string | null | undefined): { phone: string | null; ok: boolean } {
  if (!raw || !raw.trim()) return { phone: null, ok: true };
  let d = raw.replace(/[^\d+]/g, "");
  if (d.startsWith("+61")) d = "0" + d.slice(3);
  else if (d.startsWith("61") && d.length === 11) d = "0" + d.slice(2);
  d = d.replace(/\D/g, "");
  if (d.length === 9 && /^[2-478]/.test(d)) d = "0" + d;
  if (/^04\d{8}$/.test(d)) return { phone: `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}`, ok: true };
  if (/^0[2378]\d{8}$/.test(d)) return { phone: `${d.slice(0, 2)} ${d.slice(2, 6)} ${d.slice(6)}`, ok: true };
  return { phone: raw.trim(), ok: false };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Tidies phone/email/postcode/area on an AI-mapped lead and lists anything the office must check. */
/** Common misspelt email domains (e.g. gmai.com) -> the likely intended domain; null when it looks fine. */
const DOMAIN_TYPOS: Record<string, string> = { "gmai.com": "gmail.com", "gmial.com": "gmail.com", "gmal.com": "gmail.com", "gmil.com": "gmail.com", "gamil.com": "gmail.com", "gmail.co": "gmail.com", "gmail.con": "gmail.com", "gmail.cm": "gmail.com",
  "hotmial.com": "hotmail.com", "hotmai.com": "hotmail.com", "hotmail.con": "hotmail.com", "outlook.con": "outlook.com", "yahoo.con": "yahoo.com", "bigpond.con": "bigpond.com", "bigpond.com.au.au": "bigpond.com.au", "icloud.con": "icloud.com" };
export function emailDomainTypo(email: string | null | undefined): string | null {
  const d = (email ?? "").trim().toLowerCase().split("@")[1];
  return d && DOMAIN_TYPOS[d] ? DOMAIN_TYPOS[d]! : null;
}
/** Couples (Jo, 7 Oct): "0491 570 156 M 0491 570 157 G", "a@x.com; b@y.com", "Alex Example & Sam Sample" → main + second contact. */
const PHONE_FIND = /(?:\+?61[\s-]?|0)[2-478](?:[\s-]?\d){8}/g;
export function splitContacts(e: Pick<BulkExtracted, "full_name" | "phone" | "email" | "second_contact">): { full_name: string | null; phone: string | null; email: string | null; second: SecondContact | null } {
  const phones = (e.phone ?? "").match(PHONE_FIND) ?? [];
  const emails = (e.email ?? "").split(/[;,/\s]+|\band\b/i).map((x) => x.trim()).filter((x) => x.includes("@"));
  const names = (e.full_name ?? "").split(/\s*(?:&|\band\b|\/|;|\+)\s*/i).map((x) => x.trim()).filter(Boolean);
  // "Alex & Sam Sample" -> second name borrows the surname.
  if (names.length === 2 && !/\s/.test(names[0]!) && /\s/.test(names[1]!)) names[0] = `${names[0]} ${names[1]!.split(/\s+/).slice(1).join(" ")}`;
  const prev = e.second_contact ?? null;
  const second: SecondContact = { name: prev?.name ?? names[1] ?? null, phone: prev?.phone ?? phones[1]?.trim() ?? null, email: prev?.email ?? emails[1] ?? null };
  return {
    full_name: names.length > 1 ? names[0]! : e.full_name ?? null,
    phone: phones.length ? phones[0]!.trim() : e.phone ?? null,
    email: emails.length ? emails[0]! : e.email ?? null,
    second: second.name || second.phone || second.email ? second : null,
  };
}

/** A valid 4-digit postcode outside Victoria: the job can't be taken at all. */
export const outsideVictoria = (postcode: string | null | undefined) => { const pc = (postcode ?? "").replace(/\D/g, ""); return pc.length === 4 && !/^3\d{3}$/.test(pc) && !/^8\d{3}$/.test(pc); };
export const OUTSIDE_VIC_MESSAGE = "We can only take Victorian jobs — this one can't be added.";

/** One problem per field, shown next to that field (Jo, 7 Oct). null = fine. */
export function fieldProblems(e: BulkExtracted): { name: string | null; phone: string | null; email: string | null; address: string | null } {
  const p = normaliseAuPhone(e.phone);
  const em = (e.email ?? "").trim();
  return {
    name: e.full_name?.trim() ? null : "Add the customer's name",
    phone: !e.phone?.trim() ? "Add a phone number" : p.ok ? null : "This doesn't look like an Australian number",
    email: !em ? "Add an email" : !EMAIL_RE.test(em.toLowerCase()) ? "This doesn't look like an email" : emailDomainTypo(em) ? `Did you mean …@${emailDomainTypo(em)}?` : null,
    address: outsideVictoria(e.postcode) ? OUTSIDE_VIC_MESSAGE : !e.address_line?.trim() || !e.suburb?.trim() || !/^\d{4}$/.test((e.postcode ?? "").trim()) ? "Add the street, suburb and postcode" : null,
  };
}

/** One status line for a review card: "Ready" or "Needs: email, quoted price". */
export function rowStatusLine(x: { lead: BulkExtracted; consent: boolean; quoted: "yes" | "no" | null; quotedPrice: number | null; siteCheck: "yes" | "no" | null; installed?: boolean; duplicate?: string | null }): { ready: boolean; text: string; excluded: boolean } {
  if (x.duplicate) return { ready: false, excluded: true, text: `Not added: ${x.duplicate}` };
  if (outsideVictoria(x.lead.postcode)) return { ready: false, excluded: true, text: OUTSIDE_VIC_MESSAGE };
  const f = fieldProblems(x.lead);
  const needs: string[] = [];
  if (f.name) needs.push("name");
  if (f.address) needs.push("address");
  if (f.phone) needs.push("phone");
  if (f.email) needs.push("email");
  if (!x.consent) needs.push("owner consent tick");
  if (x.quoted === "yes" && !(x.quotedPrice && x.quotedPrice > 0)) needs.push("quoted price");
  if (!x.installed && !x.siteCheck) needs.push("site check answer");
  return needs.length ? { ready: false, excluded: false, text: `Needs: ${needs.join(", ")}` } : { ready: true, excluded: false, text: "Ready" };
}

export const jobsFound = (n: number) => `${n} job${n === 1 ? "" : "s"} found`;

/** Plain file note: "We attached Job Sheet.docx to this customer — is that right?" */
export function attachedFilesNote(files: { name: string; how: string }[]): string | null {
  const guessed = files.filter((f) => f.how !== "folder" && f.how !== "added");
  if (!guessed.length) return null;
  const names = guessed.map((f) => f.name.split("/").pop()!);
  return `We attached ${names.length > 2 ? `${names.slice(0, 2).join(", ")} and ${names.length - 2} more` : names.join(" and ")} to this customer — is that right?`;
}

export function cleanLead<T extends BulkExtracted>(e0: T): { lead: T; issues: string[] } {
  const sc = splitContacts(e0);
  const e = { ...e0, full_name: sc.full_name, phone: sc.phone, email: sc.email, second_contact: sc.second } as T;
  if (sc.second && !(e.notes ?? "").includes("Second contact:")) e.notes = [e.notes, `Second contact: ${[sc.second.name, sc.second.phone, sc.second.email].filter(Boolean).join(", ")}`].filter(Boolean).join(" · ");
  const issues: string[] = [];
  const p = normaliseAuPhone(e.phone);
  if (!p.ok) issues.push(`Phone "${e.phone}" doesn't look like an Australian number — please check`);
  const email = e.email?.trim().toLowerCase() || null;
  if (email && !EMAIL_RE.test(email)) issues.push(`Email "${e.email}" doesn't look right — please check`);
  else if (email) { const fix = emailDomainTypo(email); if (fix) issues.push(`Email "${e.email}" looks like a typo — did you mean ${fix}? Please check`); }
  const pc = e.postcode?.replace(/\D/g, "") || null;
  if (e.postcode && (!pc || pc.length !== 4)) issues.push(`Postcode "${e.postcode}" isn't 4 digits — please check`);
  else if (pc && !/^3\d{3}$/.test(pc) && !/^8\d{3}$/.test(pc)) issues.push(OUTSIDE_VIC_MESSAGE);
  if (e.area_m2 != null && (e.area_m2 < 10 || e.area_m2 > 1000)) issues.push(`Ceiling size ${e.area_m2} m² looks unusual — please check`);
  return { lead: { ...e, phone: p.phone, email: email && EMAIL_RE.test(email) ? email : e.email ?? null, postcode: pc && pc.length === 4 ? pc : e.postcode ?? null }, issues };
}

/** Review-screen tag + notes for one row (presentation only, Jo 7 Oct): the tag follows the site-check answer,
 * and only notes that need the installer's attention are shown (no Ready Check gaps when site check = Yes). */
export function reviewRowNotes(sort: SortResult | null, reasons: string[], check: SiteCheck | null, installed = false): { tag: string; tone: "ok" | "info" | "alert"; notes: string[] } {
  const noise = (r: string) => /^Stage: /.test(r) || /^Site check/.test(r) || r === QUOTE_NEEDED_LABEL || /^Missing: /.test(r) || /^Measurements, existing insulation/.test(r) || /^Small items for the install-day list/.test(r);
  const notes = reasons.filter((r) => !noise(r));
  if (sort === "office_review") return { tag: "Held for the office to check", tone: "alert", notes };
  if (reasons.some((r) => r.startsWith(CUSTOMER_DETAILS_NEEDED))) return { tag: CUSTOMER_DETAILS_NEEDED, tone: "alert", notes };
  if (installed) return { tag: "Already installed — history only", tone: "info", notes };
  if (check === "yes") return { tag: "Site check done — no Ready Check needed", tone: "ok", notes };
  if (check === "no") return { tag: "Ready Check to be booked with the owner", tone: "info", notes };
  return { tag: "Please answer: site check done?", tone: "alert", notes };
}

// ---------- large uploads (Jo, 7 Oct): read big lists in small chunks, retry, report which rows failed ----------
export const READ_CHUNK_ROWS = 25;
export type RowChunk<T> = { from: number; to: number; rows: T[] }; // from/to are 1-based row numbers in the file
export function chunkRows<T>(rows: T[], size = READ_CHUNK_ROWS): RowChunk<T>[] {
  const out: RowChunk<T>[] = [];
  for (let i = 0; i < rows.length; i += size) out.push({ from: i + 1, to: Math.min(rows.length, i + size), rows: rows.slice(i, i + size) });
  return out;
}
export const rowRangeLabel = (c: { from: number; to: number }) => (c.from === c.to ? `Row ${c.from}` : `Rows ${c.from}–${c.to}`);
export const readingProgress = (total: number, done: number) => `Reading ${total} customer${total === 1 ? "" : "s"}… ${done} done`;
/** Runs every chunk (a few at a time), retrying each failed chunk. Never throws: returns what was read and which chunks failed. */
export async function readInChunks<T, R>(chunks: RowChunk<T>[], read: (c: RowChunk<T>) => Promise<R[]>, opts: { tries?: number; parallel?: number; onDone?: (rowsDone: number) => void; wait?: (ms: number) => Promise<void> } = {}) {
  const tries = opts.tries ?? 3, wait = opts.wait ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const results: (R[] | null)[] = chunks.map(() => null);
  let next = 0, rowsDone = 0;
  async function worker() {
    while (next < chunks.length) {
      const i = next++, c = chunks[i]!;
      for (let t = 1; t <= tries && !results[i]; t++) {
        try { results[i] = await read(c); } catch { if (t < tries) await wait(1500 * t); }
      }
      if (results[i]) { rowsDone += c.rows.length; opts.onDone?.(rowsDone); }
    }
  }
  await Promise.all(Array.from({ length: Math.min(opts.parallel ?? 3, chunks.length) }, worker));
  return { leads: results.flatMap((r) => r ?? []), failed: chunks.filter((_, i) => !results[i]), rowsDone };
}

// ---------- ZIP/folder members: kept as their own private job files ----------
export const MAX_MEMBER_BYTES = 50_000_000;
/** The safe relative identity of a ZIP member or folder file, or null when it must be refused (absolute, "..",
 * hidden/system entries). Keeps the full folder path so same-name files in different folders stay separate. */
export function safeMemberPath(raw: string): string | null {
  const p = raw.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  if (!p || p.startsWith("/") || /^[a-z]:/i.test(p)) return null;
  const parts = p.split("/").filter(Boolean);
  if (!parts.length || parts.some((x) => x === ".." || x === "." || x.startsWith(".") || x.startsWith("__MACOSX"))) return null;
  return parts.join("/");
}
/** Two uploads with the exact same relative path get "name (2).ext" so neither overwrites the other. */
export function uniqueManifestPath(path: string, taken: Set<string>): string {
  if (!taken.has(path)) { taken.add(path); return path; }
  const dot = path.lastIndexOf("."); const slash = path.lastIndexOf("/");
  const [stem, ext] = dot > slash + 0 && dot > 0 ? [path.slice(0, dot), path.slice(dot)] : [path, ""];
  for (let n = 2; ; n++) { const c = `${stem} (${n})${ext}`; if (!taken.has(c)) { taken.add(c); return c; } }
}
