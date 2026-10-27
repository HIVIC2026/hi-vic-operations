// PIESA evidence rules (decision 178, Jo 24 Oct 2026). PURE: no database, no network.
//
// The Mitti PIESA form captures four evidence items and the portal refuses to count the PIESA as complete
// until the ones that apply are present:
//   q42 geotagged photo of the cables at the switchboard         (always)
//   q43 geotagged photo of the electrician on site with photo ID (always)
//   q44 a photo of each hazard listed                            (only when a hazard was answered Yes)
//   q45 the Certificate of Electrical Safety, photo or PDF        (only once rectification was done)
// Sources: ESC 30 Jul 2026 update (switchboard photo by the licensed electrician during the PIESA), DEECA
// industry pack (electrician identity at the premises), records kept 6 years.
//
// Inputs are the short-form answers (ids from official-short.core `shortAnswersFromEntries("piesa", …)`) and
// the Mitti media files read with the same reader as the PIISA install-day photos (piisa-a3.core
// `mittiMediaFile`: lat/lng only when Mitti actually recorded them — nothing is inferred). The stored
// `assessments.mitti_raw_snapshot` carries the same media metadata per entry (`attachPiesaMedia`), so the
// completion gates re-run the identical rule from the stored snapshot without another Mitti call.
import { applianceRows, CEILING_PROBLEMS, MAINS_PROBLEMS, RECTIFICATION_OUTCOMES, SOLAR_PROBLEMS } from "./official-short.core";

export type PiesaEvidenceId = "switchboard_photo" | "onsite_photo" | "hazard_photos" | "ces_file";

/** One media file on a Mitti audit with ONLY the metadata Mitti actually returned. Unknown stays null (never faked).
 *  capturedAt = a real capture time only; Mitti's `date_created` is the upload time and is kept apart as uploadedAt. */
export type MittiMediaFile = { mediaId: string | null; capturedAt: string | null; uploadedAt?: string | null; lat: number | null; lng: number | null; /** File size when Mitti reports it (decision 205: videos ≤250 MB); null = not reported. */ sizeBytes?: number | null };
const num = (v: unknown) => { const x = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN; return Number.isFinite(x) ? x : null; };
/** Shared reader for PIESA evidence and the PIISA install-day photos (piisa-a3.core delegates here). */
export function mittiMediaFile(raw: unknown): MittiMediaFile {
  const m = (raw ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const loc = m["location"] ?? m["geo"] ?? m["metadata"]?.location ?? null;
  const coords = Array.isArray(loc?.geometry?.coordinates) ? loc.geometry.coordinates : null;
  let lat = num(loc?.lat ?? loc?.latitude ?? m["lat"] ?? m["latitude"] ?? (coords ? coords[1] : undefined));
  let lng = num(loc?.lng ?? loc?.lon ?? loc?.longitude ?? m["lng"] ?? m["longitude"] ?? (coords ? coords[0] : undefined));
  if (lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) { lat = null; lng = null; }
  const ts = [m["captured_at"], m["date_taken"], m["metadata"]?.captured_at].find((t) => typeof t === "string" && !Number.isNaN(Date.parse(t))) as string | undefined;
  const id = m["media_id"] ?? m["id"] ?? null;
  const up = typeof m["date_created"] === "string" && !Number.isNaN(Date.parse(m["date_created"])) ? m["date_created"] : null;
  const size = num(m["file_size"] ?? m["size_bytes"] ?? m["size"] ?? m["metadata"]?.file_size ?? m["metadata"]?.size);
  // sizeBytes only when Mitti reported one, so stored snapshots and existing readers keep their exact shape.
  return { mediaId: id == null ? null : String(id), capturedAt: ts ?? null, uploadedAt: up, lat, lng, ...(size != null && size > 0 ? { sizeBytes: size } : {}) };
}
export type PiesaMediaFile = MittiMediaFile;
export type PiesaEvidenceMedia = Record<PiesaEvidenceId, PiesaMediaFile[]>;

export type PiesaEvidenceSpec = {
  id: PiesaEvidenceId;
  /** Exact Mitti question wording (docs/MITTI_PIESA_FORM_SPEC.md). */
  label: string;
  /** Earlier wordings still accepted when reading an audit. */
  aliases: string[];
  geotagged: boolean;
  /** Short name used in blocker messages. */
  short: string;
  /** Spec question number. */
  q: number;
};

export const PIESA_EVIDENCE: PiesaEvidenceSpec[] = [
  { id: "switchboard_photo", q: 42, label: "Photo of the cables at the switchboard (geotagged)", aliases: ["Switchboard cable photo"], geotagged: true, short: "Switchboard photo" },
  { id: "onsite_photo", q: 43, label: "Photo showing you on site at the property, holding your licence / photo ID (geotagged)", aliases: ["Photo showing you on site at the property (geotagged)", "Electrician photo at front of premises with photo ID"], geotagged: true, short: "On-site photo" },
  // Decision 297 (Jo 25 Oct 2026): one "Photo of the problem" question sits under each hazard section (mains, solar, ceiling
  // wiring, downlights); every occurrence feeds this one evidence id. The old single end-of-form question is an alias.
  { id: "hazard_photos", q: 44, label: "Photo of the problem", aliases: ["Photo of each hazard listed (one per hazard; geotagged)"], geotagged: true, short: "Hazard photo" },
  { id: "ces_file", q: 45, label: "Certificate of Electrical Safety (photo or PDF)", aliases: [], geotagged: false, short: "Certificate of Electrical Safety" },
];
export const PIESA_EVIDENCE_BY_ID: Record<PiesaEvidenceId, PiesaEvidenceSpec> = Object.fromEntries(PIESA_EVIDENCE.map((e) => [e.id, e])) as Record<PiesaEvidenceId, PiesaEvidenceSpec>;

const nrm = (x: unknown) => String(x ?? "").split("\n")[0]!.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const isYes = (v: unknown) => /^\s*yes\b/i.test(String(v ?? ""));
const isNo = (v: unknown) => /^\s*no\b/i.test(String(v ?? ""));
const REPAIR_NEEDED = RECTIFICATION_OUTCOMES[1];

export type PiesaEvidenceAnswers = Record<string, string | null | undefined>;

/** Every hazard the electrician listed on the form, in form order, in the form's own words. */
export function piesaHazardsListed(a: PiesaEvidenceAnswers): string[] {
  const out: string[] = [];
  const ticked = (answer: unknown, options: readonly string[]) => options.filter((o) => String(answer ?? "").includes(o));
  if (isNo(a["mainsSafe"])) out.push(...ticked(a["mainsProblems"], MAINS_PROBLEMS));
  if (isYes(a["solarPresent"]) && isNo(a["solarSafe"])) out.push(...ticked(a["solarProblems"], SOLAR_PROBLEMS));
  if (isNo(a["ceilingSafe"])) out.push(...ticked(a["ceilingProblems"], CEILING_PROBLEMS));
  if (isYes(a["downlightsPresent"]) && isYes(a["downlightsNonIc"])) out.push("Downlights that are not IC or IC-4 rated");
  if (isYes(a["appliancesPresent"])) {
    // Decision 295: only an item the electrician says is NOT safe as it is counts as a hazard (each has its own photo).
    const rows = applianceRows(a as Record<string, unknown>);
    // Decision 336: a typed row names its type and where it is; a decision-295 row keeps the old wording.
    if (rows.length) for (const r of rows) { if (r.safe === "No") out.push(r.legacy ? `Appliance or flue needs work: ${(r.what || "(not described)").slice(0, 120)}` : `${r.type ?? "Item"} needs work${r.what ? `: ${r.what.slice(0, 120)}` : ""}${r.where ? ` (${r.where.slice(0, 80)})` : ""}`); }
    else { const d = String(a["applianceDetails"] ?? "").trim(); out.push(d ? `Appliances, exhaust fans or flues: ${d.slice(0, 120)}${d.length > 120 ? "…" : ""}` : "Appliances, exhaust fans or flues in the ceiling space"); }
  }
  return out;
}

/** Any hazard answered Yes (or safe answered No) without a ticked detail still needs a photo. */
function hazardAnsweredYes(a: PiesaEvidenceAnswers): boolean {
  return isNo(a["mainsSafe"]) || (isYes(a["solarPresent"]) && isNo(a["solarSafe"])) || isNo(a["ceilingSafe"]) || (isYes(a["downlightsPresent"]) && isYes(a["downlightsNonIc"])) || (isYes(a["appliancesPresent"]) && (applianceRows(a as Record<string, unknown>).some((r) => r.safe === "No") || (!applianceRows(a as Record<string, unknown>).length)));
}

/** Rectification was done on this form (Section C answered): the CES must be attached. */
export function piesaRectificationDone(a: PiesaEvidenceAnswers): boolean {
  return String(a["rectificationOutcome"] ?? "").trim() === REPAIR_NEEDED && isYes(a["rectificationComplete"]);
}

export type PiesaEvidenceRequirement = PiesaEvidenceSpec & { /** Minimum number of files. */ count: number; hazards: string[] };

/** Which of the four items this form must carry, from the answers alone. Deterministic. */
export function piesaEvidenceRequirements(a: PiesaEvidenceAnswers): PiesaEvidenceRequirement[] {
  const out: PiesaEvidenceRequirement[] = [
    { ...PIESA_EVIDENCE_BY_ID.switchboard_photo, count: 1, hazards: [] },
    { ...PIESA_EVIDENCE_BY_ID.onsite_photo, count: 1, hazards: [] },
  ];
  if (hazardAnsweredYes(a)) {
    const hazards = piesaHazardsListed(a);
    out.push({ ...PIESA_EVIDENCE_BY_ID.hazard_photos, count: Math.max(1, hazards.length), hazards });
  }
  if (piesaRectificationDone(a)) out.push({ ...PIESA_EVIDENCE_BY_ID.ces_file, count: 1, hazards: [] });
  return out;
}

export const emptyPiesaEvidenceMedia = (): PiesaEvidenceMedia => ({ switchboard_photo: [], onsite_photo: [], hazard_photos: [], ces_file: [] });

/** Evidence id for a Mitti question label (exact wording or an accepted earlier wording), else null. */
export function piesaEvidenceIdForLabel(label: unknown): PiesaEvidenceId | null {
  const k = nrm(label);
  if (!k) return null;
  for (const e of PIESA_EVIDENCE) if ([e.label, ...e.aliases].some((l) => nrm(l) === k)) return e.id;
  return null;
}

type Any = Record<string, unknown>;
const mediaOf = (o: Any): unknown[] => {
  const r = (o["responses"] ?? {}) as Any;
  const m = o["media"] ?? r["media"] ?? r["attachments"];
  return Array.isArray(m) ? m : [];
};
/** Walks a raw Mitti audit (header_items/items, nested or flat) and returns every labelled item by id. */
function auditItems(audit: unknown): Any[] {
  const out: Any[] = [];
  const walk = (x: unknown) => {
    if (Array.isArray(x)) { x.forEach(walk); return; }
    if (!x || typeof x !== "object") return;
    const o = x as Any;
    if ("label" in o && (o["item_id"] != null || o["id"] != null)) out.push(o);
    for (const v of Object.values(o)) if (v && typeof v === "object") walk(v);
  };
  walk(audit);
  return out;
}

/** Media per evidence item, read straight from a raw Mitti audit. */
export function piesaMediaFromAudit(audit: unknown): PiesaEvidenceMedia {
  const out = emptyPiesaEvidenceMedia();
  for (const o of auditItems(audit)) {
    const id = piesaEvidenceIdForLabel(o["label"]);
    if (!id) continue;
    out[id].push(...mediaOf(o).map(mittiMediaFile));
  }
  return out;
}

export type PiesaSnapshotEntry = { id?: string; label: string; value: string | null; section?: string; media?: PiesaMediaFile[] };

/** Adds the evidence media metadata (id, capture time, lat/lng — only what Mitti recorded) to the stored snapshot
 *  entries for the four evidence questions, matched by item id, else by label. Other entries are untouched. */
export function attachPiesaMedia<T extends PiesaSnapshotEntry>(audit: unknown, snapshot: T[]): T[] {
  const byId = new Map<string, Any>();
  for (const o of auditItems(audit)) byId.set(String(o["item_id"] ?? o["id"]), o);
  return snapshot.map((e) => {
    if (!piesaEvidenceIdForLabel(e.label)) return e;
    const o = (e.id ? byId.get(String(e.id)) : undefined) ?? auditItems(audit).find((x) => nrm(x["label"]) === nrm(e.label));
    return { ...e, media: o ? mediaOf(o).map(mittiMediaFile) : [] };
  });
}

/** Media per evidence item from a stored snapshot (entries written by `attachPiesaMedia`). */
export function piesaMediaFromSnapshot(snapshot: PiesaSnapshotEntry[] | null | undefined): PiesaEvidenceMedia {
  const out = emptyPiesaEvidenceMedia();
  for (const e of snapshot ?? []) {
    const id = piesaEvidenceIdForLabel(e.label);
    if (!id) continue;
    out[id].push(...(e.media ?? []));
  }
  return out;
}

const geotagged = (f: PiesaMediaFile) => f.lat != null && f.lng != null;

/** Plain blocker messages. Empty = every required evidence item is present (and geotagged where required). */
export function piesaEvidenceBlockers(a: PiesaEvidenceAnswers, media: PiesaEvidenceMedia): string[] {
  const out: string[] = [];
  for (const req of piesaEvidenceRequirements(a)) {
    const files = media[req.id] ?? [];
    if (req.id === "hazard_photos") {
      if (files.length < req.count) {
        const missingFor = req.hazards.slice(files.length);
        out.push(missingFor.length ? `Hazard photo missing for: ${missingFor.join("; ")}` : "Hazard photo missing");
      }
      const untagged = files.filter((f) => !geotagged(f)).length;
      if (files.length && untagged) out.push(`Hazard photos must be geotagged (${untagged} without a location)`);
      continue;
    }
    if (!files.length) { out.push(req.id === "ces_file" ? "Certificate of Electrical Safety missing (photo or PDF)" : `${req.short} missing`); continue; }
    if (req.geotagged && !files.some(geotagged)) out.push(`${req.short} must be geotagged`);
  }
  return out;
}

/** Issue prefix used in the sync and completion gates (same family as the printed-rule blockers). */
export const PIESA_EVIDENCE_ISSUE_PREFIX = "Official form: ";
export const PIESA_NOT_SYNCED = "PIESA form answers have not been read from Mitti yet — sync the form first.";

/** Blockers from a stored `assessments.mitti_raw_snapshot`. A Mitti PIESA with no snapshot fails closed. */
export function piesaEvidenceBlockersFromSnapshot(snapshot: unknown, shortAnswers: (entries: { label: string; value: string | null }[]) => PiesaEvidenceAnswers): string[] {
  const entries = Array.isArray(snapshot) ? (snapshot as PiesaSnapshotEntry[]).filter((e) => e && typeof e.label === "string") : [];
  if (!entries.length) return [PIESA_NOT_SYNCED];
  return piesaEvidenceBlockers(shortAnswers(entries), piesaMediaFromSnapshot(entries));
}

/** Files to keep with the AP record (6 years): every stored evidence file with a Mitti media id, by item. */
export function piesaEvidenceFilesToStore(media: PiesaEvidenceMedia): { id: PiesaEvidenceId; label: string; file: PiesaMediaFile & { mediaId: string } }[] {
  const out: { id: PiesaEvidenceId; label: string; file: PiesaMediaFile & { mediaId: string } }[] = [];
  for (const e of PIESA_EVIDENCE) for (const f of media[e.id] ?? []) if (f.mediaId) out.push({ id: e.id, label: e.label, file: { ...f, mediaId: f.mediaId } });
  return out;
}
