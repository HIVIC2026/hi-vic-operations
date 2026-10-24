/* eslint-disable @typescript-eslint/no-explicit-any */
// Install-day evidence and safety record on the Mitti Install day form (the native A3 PIISA template). PURE: no
// database, no network. Jo 24 Oct 2026, decisions 205 (Activity Guide v1.2 §4.2 + Table 4), 206 (SWMS section inside
// the form), 210 (audit must-haves: lock-out removal / re-energise, lead present + finish time + signature, foil /
// conductive existing insulation, product + m² per zone, zone names from the Ready Check) and 211 (no plan upload:
// the final diagram is drawn by the portal from the per-zone product + m² answers).
//
// The portal reads every new item BY EXACT QUESTION WORDING — the constants below are the wording Jo types into Mitti
// (docs/MITTI_INSTALL_FORM_CHATGPT_PROMPT.md is built from them and a test checks the two never drift). Form health
// lists any wording the published template lacks; the stage gates fail closed for installs from the effective date.
//
// Grandfathering: installs that started before INSTALL_EVIDENCE_EFFECTIVE_DATE keep the seven original A3 items only
// (piisa-a3.core); nothing here applies to them, so history is untouched.
import { norm } from "./mitti.core";
import { melbourneToday } from "./melbourne-time.core";
import { mittiMediaFile, type MittiMediaFile } from "./piesa-evidence.core";
import { activity48ProductProblems, modelsForMittiOption } from "./esc-approved-products.core";
import { APPROVED_PRODUCTS } from "./insulation-product.core";

/** Melbourne date from which the new items are required (install start date on or after). Earlier installs = old rule. */
export const INSTALL_EVIDENCE_EFFECTIVE_DATE = "2026-11-01";
export const INSTALL_EVIDENCE_RULE = "install-day-v2-2026-10-24";
/** Zone blocks on the Mitti form. */
export const MAX_FORM_ZONES = 3;
/** Crew sign-on rows on the SWMS section (lead + 3 additional, same as PIISA Part 2). */
export const SWMS_CREW_ROWS = 4;
/** Table 4: "Each video should not exceed 250MB in file size." */
export const VIDEO_MAX_BYTES = 250 * 1024 * 1024;
export const ZONE_COUNT_OPTIONS = ["1", "2", "3"] as const;
/** The same eight options as the Ready Check "Insulation product" question (decision 150). */
export const ZONE_PRODUCT_OPTIONS: readonly string[] = APPROVED_PRODUCTS.map((p) => p.option);

/** Does the rule apply to an installation that starts on `installDate` (YYYY-MM-DD, Melbourne)? Unknown date = applies
 *  once the effective date has arrived (`today`, Melbourne) — never silently exempt. */
export function installEvidenceApplies(installDate: string | null | undefined, today: string = melbourneToday()): boolean {
  const d = typeof installDate === "string" ? installDate.slice(0, 10) : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return today >= INSTALL_EVIDENCE_EFFECTIVE_DATE;
  return d >= INSTALL_EVIDENCE_EFFECTIVE_DATE;
}

// ======================================================================================================
// Exact Mitti question wording (character for character)
// ======================================================================================================

/** Part B — zones and Table 4 evidence (decision 205) + per-zone product and m² (decision 210 d). */
export const INSTALL_EVIDENCE_QUESTIONS = {
  zoneCount: "How many upgrade zones are you insulating on this job?",
  zoneName: (z: number) => `Zone ${z} — name of this ceiling area (use the same name as the Ready Check and floor plan)`,
  zoneUnderInsulated: (z: number) => `Zone ${z} — is there existing insulation in this area (under-insulated)?`,
  zoneExistingPhoto: (z: number) => `Zone ${z} — photo of the existing insulation with a ruler placed vertically showing its depth, and any brand, model or R-value markings (geotagged)`,
  zoneBeforeVideo: (z: number) => `Zone ${z} — before 360° video of this ceiling area, lit and clearly labelled, showing any existing insulation (geotagged, under 250 MB)`,
  zoneAfterVideo: (z: number) => `Zone ${z} — after 360° video of this ceiling area, lit and clearly labelled, showing full coverage, depth without compression and no waste left (geotagged, under 250 MB)`,
  zoneDepthPhoto: (z: number) => `Zone ${z} — after-install photo of the new insulation with a ruler placed vertically showing its depth (geotagged)`,
  zoneProduct: (z: number) => `Zone ${z} — insulation product installed`,
  zoneAreaM2: (z: number) => `Zone ${z} — area insulated (m²)`,
  multiDay: "Will this installation run over more than one day?",
  dailyRecheck: "Before starting work each day, I re-checked every item on this safety assessment and they all still hold.",
} as const;

/** Part A — reworded labels for the four EXISTING A3 photo items (same Mitti items, same position; wording only). */
export const INSTALL_EVIDENCE_RELABELS = {
  installer_photos: "Photo of each installer at the front of the premises with photo ID clearly visible — one photo per installer (geotagged)",
  electrician_photo: "Photo of the electrician at the front of the premises with photo ID clearly visible (geotagged)",
  isolation_photo: "Before work starts: photo of the power isolated — lock-out tag on the switchboard, and the solar and battery isolators switched off where the home has them (geotagged)",
  product_photos: "Photo of the product packaging on site showing the brand, model and R-value label — one per product (geotagged)",
} as const;
/** Alias used by the Mitti build prompt. */
export const A3_RELABELS = INSTALL_EVIDENCE_RELABELS;

/** Part C — SWMS section (decision 206; audit §8.3 SW-1…SW-20). */
export const SWMS_QUESTIONS = {
  preparedBy: "SWMS — prepared by (installer business name)",
  preparedFor: "SWMS — prepared for (principal contractor / accredited person)",
  work: "SWMS — work being done at this address",
  preparedAt: "SWMS — date this SWMS was prepared",
  hrcw: "SWMS — which high-risk construction work applies to this job? (tick all)",
  hrcwNone: "SWMS — if none of the high-risk work types apply, explain why",
  hazardPresent: (h: string) => `SWMS — ${h}: present on this job?`,
  hazardControls: (h: string) => `SWMS — ${h}: controls in place (tick all)`,
  hazardOtherControl: (h: string) => `SWMS — ${h}: other control (describe)`,
  hazardPerson: (h: string) => `SWMS — ${h}: person responsible`,
  hazardOtherPerson: (h: string) => `SWMS — ${h}: other person responsible (name)`,
  controlsCheck: "SWMS — how the controls will be checked during the job",
  changes: "SWMS — changes to hazards or controls during this job (write 'None' if none)",
  firstAidKit: "SWMS — first aid kit location on site",
  firstAider: "SWMS — first aider on site (name)",
  hospital: "SWMS — nearest hospital emergency department",
  reception: "SWMS — mobile phone reception at the property?",
  noReception: "SWMS — how emergency services will be called if there is no reception",
  assembly: "SWMS — emergency assembly point",
  electricalEmergency: "SWMS — electrical emergency: who isolates and how (switchboard location)",
  workerName: (n: number) => `SWMS — worker ${n}: name`,
  workerRead: (n: number) => `SWMS — worker ${n}: I have read this SWMS, understand the hazards and controls, and will follow it`,
  workerSignature: (n: number) => `SWMS — worker ${n}: signature`,
  leadDeclaration: "SWMS — I am the lead installer. This SWMS was prepared for this address before work started, every hazard above was assessed with the crew, the controls are in place, and work will stop if the SWMS cannot be followed.",
  leadSignature: "SWMS — lead installer signature",
  signedAt: "SWMS — signed at (date and time)",
  day2Recheck: "SWMS — day 2 re-check: date, time and lead installer initials (and any change to the SWMS)",
  day3Recheck: "SWMS — day 3 or later re-checks: one line per day (date, time, initials, changes)",
} as const;
export const SWMS_HRCW_OPTIONS = [
  "Risk of a person falling more than 2 metres (ladder, manhole, roof, ceiling joists)",
  "Work on or near energised electrical installations or services (ceiling cables, switchboard, solar/battery)",
  "Work in or near a confined space",
  "Work that may disturb asbestos (home built before 1990, or asbestos suspected)",
  "Work on or near a roadway or in an area with powered mobile plant",
  "None of these apply (explain in the next box)",
] as const;
export const SWMS_HRCW_NONE = SWMS_HRCW_OPTIONS[5];
export const SWMS_PERSON_OPTIONS = ["Lead installer", "All crew", "Attending electrician", "Other (name in next box)"] as const;
export const SWMS_PERSON_OTHER = SWMS_PERSON_OPTIONS[3];
export const SWMS_OTHER_CONTROL = "Other control";
export const SWMS_CONTROL_CHECK_OPTIONS = [
  "Lead installer checks each control before the first entry",
  "Lead installer re-checks at the start of each day",
  "Any crew member can stop work and call the lead",
  "Changed conditions are recorded below before work continues",
] as const;
/** Hazard blocks in form order (PIISA Table 1 + Activity Guide §2.1). Every block has the same four/five items. */
export const SWMS_HAZARDS: readonly { name: string; controls: readonly string[] }[] = [
  { name: "Electrical", controls: ["Power isolated, locked out and tagged at the switchboard before entry", "Solar, battery or generator isolated per the instructions", "PIESA read and its conditions followed", "Test for dead before touching cables", "No work within 400 mm of cables unless treated per AS 3999", "Electrician on site as the PIESA requires", SWMS_OTHER_CONTROL] },
  { name: "Heat and heat stress", controls: ["Work early or late; stop in extreme heat", "Rest breaks and water every 30 minutes", "Roof space temperature checked before entry", "Buddy checks for heat illness", SWMS_OTHER_CONTROL] },
  { name: "Falls and falling through the ceiling", controls: ["Walk only on joists or crawl boards", "Ladder secured and footed at the manhole", "Three points of contact on the ladder", "Harness or edge protection for external roof access", "No work on the roof in wind or rain", SWMS_OTHER_CONTROL] },
  { name: "Manual handling", controls: ["Bales split; two-person lifts over 20 kg", "Mechanical lift or roof hoist for bales", "Correct lifting technique; rotate tasks", SWMS_OTHER_CONTROL] },
  { name: "Dust, fibres and PPE", controls: ["P2 respirator, goggles, gloves, long sleeves worn in the ceiling", "Disposable coveralls for removal work", "Removed material bagged in the ceiling, not dropped through the house", "Vacuum or wet methods, no dry sweeping", SWMS_OTHER_CONTROL] },
  { name: "Enclosed or restricted ceiling space", controls: ["Entry and exit points identified and kept clear", "Lighting set up before entry", "Communication with a person outside the ceiling at all times", "Confined-space entry procedure used if the space is confined", SWMS_OTHER_CONTROL] },
  { name: "Asbestos (homes built before 1990, or suspected)", controls: ["Asbestos register or owner information checked", "Suspected material not disturbed; work stopped and office called", "Licensed removalist engaged before work resumes", "No cutting, drilling or sanding of suspect sheeting", SWMS_OTHER_CONTROL] },
  { name: "Vermin, droppings, mould and biological hazards", controls: ["Area inspected before entry; droppings not disturbed dry", "P2 respirator and gloves; hands washed before eating", "Pest treatment arranged before install if infestation found", SWMS_OTHER_CONTROL] },
  { name: "Lighting", controls: ["Portable lighting set up to light the whole work area", "Head torch for every person in the ceiling", SWMS_OTHER_CONTROL] },
  { name: "Solar and battery systems", controls: ["Shutdown and restart instructions located and followed", "DC isolator and inverter isolated and tagged", "Battery isolator off; no work near battery cables", "Electrician isolates where the instructions are missing", SWMS_OTHER_CONTROL] },
  { name: "Heat and ignition sources (flues, chimneys, heat lamps, exhaust fans, downlights, hot water units)", controls: ["Clearances to flues and chimneys kept per AS 3999 and the manufacturer", "Downlights confirmed IC/IC-4 by the PIESA; guards fitted where required", "Exhaust fans and heat lamps kept clear", "Gas appliances in the ceiling identified and kept clear", SWMS_OTHER_CONTROL] },
  { name: "Noise and vibration", controls: ["Hearing protection for blowers, saws and compressors", "Noisy tasks kept short; tools maintained", SWMS_OTHER_CONTROL] },
  { name: "Working alone", controls: ["Nobody works in the ceiling alone", "Check-in calls every 30 minutes where alone on site", SWMS_OTHER_CONTROL] },
];
/** Prefilled texts (SW-2, SW-3). */
export const SWMS_PREPARED_FOR = "Home Insulation Victoria (DC Construction Solutions Pty Ltd)";
export const SWMS_WORK_DEFAULT = "Ceiling insulation removal (if required) and installation of bulk ceiling insulation – VEU Activity 48";

/** Part D — after-install sign-off (decision 210 a, b; audit A3-1…A3-7). */
export const AFTER_INSTALL_QUESTIONS = {
  lockoutRemoved: "After installation: have all lock-out devices been removed and the premises safely re-energised?",
  lockoutRemovedBy: "Who removed the lock-out and re-energised the premises? (name and role — the person who applied the lock, or the attending electrician)",
  switchboardAfterPhoto: "Photo of the switchboard after re-energising — lock-out tag removed, main switch on (geotagged)",
  solarRestarted: "Solar, battery or generator restarted following the shutdown/restart instructions?",
  finishedAt: "Installation finished at (date and time)",
  leadPresent: "I, the lead installer, was on site for the whole installation, supervised every other installer and confirm the installation complies with the VEU program requirements.",
  completionSignature: "Lead installer signature at completion",
} as const;
export const SOLAR_RESTARTED_OPTIONS = ["Yes", "No", "N/A – none at this property"] as const;

/** Part E — foil / conductive existing insulation (decision 210 c; audit A3-10), feeding the official P6 foil rule. */
export const FOIL_QUESTIONS = {
  foil: "Is any of the existing insulation foil-backed, metallic or electrically conductive?",
  foilPhoto: "Photo of the existing insulation showing the facing (geotagged)",
} as const;

/** Zone name convention (audit §6): "Area N – <name>"; a one-area job is "Main ceiling". */
export const DEFAULT_SINGLE_AREA_NAME = "Main ceiling";
export const zoneNameValue = (z: number, name: string | null | undefined) => `Area ${z} – ${name?.trim() || (z === 1 ? DEFAULT_SINGLE_AREA_NAME : `Area ${z}`)}`;
/** The human part of a zone name, for comparing records that may or may not carry the "Area N –" prefix. */
export const zoneNameCore = (v: string | null | undefined) => norm(String(v ?? "").replace(/^\s*area\s*\d+\s*[–—-]\s*/i, ""));

// ======================================================================================================
// Question list (form order) — drives the build prompt, form health and the drift test
// ======================================================================================================
export type QuestionType = "pick_one" | "tick_all" | "text" | "yes_no" | "photo" | "video" | "checkbox" | "number" | "date_time" | "signature";
export type QuestionSpec = { part: "B" | "C" | "D" | "E"; label: string; type: QuestionType; zone?: number | null; options?: readonly string[]; showWhen?: string | undefined; prefill?: string | undefined };

export function installEvidenceQuestionList(): QuestionSpec[] {
  const Q = INSTALL_EVIDENCE_QUESTIONS, S = SWMS_QUESTIONS, A = AFTER_INSTALL_QUESTIONS, F = FOIL_QUESTIONS;
  const out: QuestionSpec[] = [];
  // Part C — SWMS (before Part 3 of the PIISA, so it is signed before isolation).
  out.push(
    { part: "C", label: S.preparedBy, type: "text", prefill: "installer business name" },
    { part: "C", label: S.preparedFor, type: "text", prefill: SWMS_PREPARED_FOR },
    { part: "C", label: S.work, type: "text", prefill: SWMS_WORK_DEFAULT },
    { part: "C", label: S.preparedAt, type: "date_time" },
    { part: "C", label: S.hrcw, type: "tick_all", options: SWMS_HRCW_OPTIONS },
    { part: "C", label: S.hrcwNone, type: "text", showWhen: `${S.hrcw} has "${SWMS_HRCW_NONE}" ticked` },
  );
  for (const h of SWMS_HAZARDS) out.push(
    { part: "C", label: S.hazardPresent(h.name), type: "yes_no" },
    { part: "C", label: S.hazardControls(h.name), type: "tick_all", options: h.controls, showWhen: `${S.hazardPresent(h.name)} = Yes` },
    { part: "C", label: S.hazardOtherControl(h.name), type: "text", showWhen: `${S.hazardControls(h.name)} has "${SWMS_OTHER_CONTROL}" ticked` },
    { part: "C", label: S.hazardPerson(h.name), type: "pick_one", options: SWMS_PERSON_OPTIONS, showWhen: `${S.hazardPresent(h.name)} = Yes` },
    { part: "C", label: S.hazardOtherPerson(h.name), type: "text", showWhen: `${S.hazardPerson(h.name)} = ${SWMS_PERSON_OTHER}` },
  );
  out.push(
    { part: "C", label: S.controlsCheck, type: "tick_all", options: SWMS_CONTROL_CHECK_OPTIONS },
    { part: "C", label: S.changes, type: "text" },
    { part: "C", label: S.firstAidKit, type: "text" },
    { part: "C", label: S.firstAider, type: "text" },
    { part: "C", label: S.hospital, type: "text" },
    { part: "C", label: S.reception, type: "yes_no" },
    { part: "C", label: S.noReception, type: "text", showWhen: `${S.reception} = No` },
    { part: "C", label: S.assembly, type: "text" },
    { part: "C", label: S.electricalEmergency, type: "text" },
  );
  for (let n = 1; n <= SWMS_CREW_ROWS; n++) out.push(
    { part: "C", label: S.workerName(n), type: "text", prefill: n === 1 ? "lead installer name" : `additional installer ${n - 1} name` },
    { part: "C", label: S.workerRead(n), type: "checkbox" },
    { part: "C", label: S.workerSignature(n), type: "signature" },
  );
  out.push(
    { part: "C", label: S.leadDeclaration, type: "checkbox" },
    { part: "C", label: S.leadSignature, type: "signature" },
    { part: "C", label: S.signedAt, type: "date_time" },
  );
  // Part B — zones.
  out.push({ part: "B", label: Q.zoneCount, type: "pick_one", zone: null, options: ZONE_COUNT_OPTIONS });
  for (let z = 1; z <= MAX_FORM_ZONES; z++) {
    const show = z === 1 ? undefined : `${Q.zoneCount} is ${ZONE_COUNT_OPTIONS.slice(z - 1).join(" or ")}`;
    out.push(
      { part: "B", label: Q.zoneName(z), type: "text", zone: z, showWhen: show, prefill: `"${zoneNameValue(z, "<Ready Check area name>")}"` },
      { part: "B", label: Q.zoneUnderInsulated(z), type: "yes_no", zone: z, showWhen: show },
      { part: "B", label: Q.zoneExistingPhoto(z), type: "photo", zone: z, showWhen: `${Q.zoneUnderInsulated(z)} = Yes` },
      { part: "B", label: Q.zoneBeforeVideo(z), type: "video", zone: z, showWhen: show },
      { part: "B", label: Q.zoneProduct(z), type: "pick_one", zone: z, options: ZONE_PRODUCT_OPTIONS, showWhen: show },
      { part: "B", label: Q.zoneAreaM2(z), type: "number", zone: z, showWhen: show },
      { part: "B", label: Q.zoneAfterVideo(z), type: "video", zone: z, showWhen: show },
      { part: "B", label: Q.zoneDepthPhoto(z), type: "photo", zone: z, showWhen: show },
    );
  }
  out.push(
    { part: "B", label: Q.multiDay, type: "yes_no", zone: null },
    { part: "B", label: Q.dailyRecheck, type: "checkbox", zone: null, showWhen: `${Q.multiDay} = Yes` },
    { part: "B", label: S.day2Recheck, type: "text", showWhen: `${Q.multiDay} = Yes` },
    { part: "B", label: S.day3Recheck, type: "text", showWhen: `${Q.multiDay} = Yes` },
  );
  // Part E — foil (with the existing-insulation part of the PIISA).
  out.push(
    { part: "E", label: F.foil, type: "yes_no", showWhen: "Is there existing insulation in the ceiling? = Yes" },
    { part: "E", label: F.foilPhoto, type: "photo", showWhen: `${F.foil} = Yes` },
  );
  // Part D — after-install sign-off (end of the form).
  out.push(
    { part: "D", label: A.lockoutRemoved, type: "yes_no" },
    { part: "D", label: A.lockoutRemovedBy, type: "text", showWhen: `${A.lockoutRemoved} = Yes` },
    { part: "D", label: A.switchboardAfterPhoto, type: "photo", showWhen: `${A.lockoutRemoved} = Yes` },
    { part: "D", label: A.solarRestarted, type: "pick_one", options: SOLAR_RESTARTED_OPTIONS },
    { part: "D", label: A.finishedAt, type: "date_time" },
    { part: "D", label: A.leadPresent, type: "checkbox" },
    { part: "D", label: A.completionSignature, type: "signature" },
  );
  return out;
}

// ======================================================================================================
// Reading the audit / template by label
// ======================================================================================================
/** First line of a Mitti label, normalised (Mitti appends help text after a line break). */
const key = (label: unknown) => norm(String(label ?? "").split("\n")[0]);

export type ReadSignature = { present: boolean; name: string | null; signedAt: string | null; mediaId: string | null };
type Labelled = { label: string; value: string | null; values: string[]; media: MittiMediaFile[]; signature: ReadSignature };

function signatureOf(r: Record<string, any>): ReadSignature {
  const m = r["image"] ?? r["media"] ?? r["media_id"] ?? r["signature"];
  const pick = (x: any): string | null => typeof x === "string" ? (/^[0-9a-f-]{16,}$/i.test(x.trim()) || /^https:\/\//.test(x.trim()) ? x.trim() : null) : x && typeof x === "object" ? pick(Array.isArray(x) ? x[0] : (x.media_id ?? x.id ?? x.href)) : null;
  const mediaId = pick(m);
  const captured = m && typeof m === "object" && !Array.isArray(m) ? m : {};
  const ts = [r["timestamp"], r["signed_at"], r["datetime"], captured.timestamp, captured.signed_at, captured.metadata?.signed_at].find((t) => typeof t === "string" && !Number.isNaN(Date.parse(t))) as string | undefined;
  const name = r["name"] ?? captured.name ?? captured.metadata?.signer_name;
  return { present: !!mediaId, name: typeof name === "string" && name.trim() ? name.trim() : null, signedAt: ts ?? null, mediaId };
}
function labelledItems(doc: unknown): Labelled[] {
  const out: Labelled[] = [];
  const walk = (x: unknown) => {
    if (Array.isArray(x)) { x.forEach(walk); return; }
    if (!x || typeof x !== "object") return;
    const o = x as Record<string, any>;
    if (typeof o["label"] === "string") {
      const r = (o["responses"] ?? {}) as Record<string, any>;
      const selected: string[] = Array.isArray(r["selected"]) ? r["selected"].map((s: any) => String(s?.label ?? s)) : [];
      const sel = selected.length ? selected.join(", ") : null;
      // Same answer keys as mitti.core responseValue (text / number / datetime items), plus the item-level value.
      const txt = [sel, r["text"], r["value"], r["number"], r["numeric"], r["datetime"], r["date"], o["value"]].map((v) => (typeof v === "number" ? String(v) : v)).find((v) => typeof v === "string" && v.trim()) as string | undefined;
      const ticked = r["value"] === true || r["checked"] === true ? "Yes" : null;
      const media = o["media"] ?? r["media"] ?? r["attachments"] ?? [];
      out.push({ label: o["label"], value: txt ?? ticked ?? null, values: selected, media: Array.isArray(media) ? media.map(mittiMediaFile) : [], signature: signatureOf(r) });
    }
    for (const v of Object.values(o)) if (v && typeof v === "object") walk(v);
  };
  walk((doc as any)?.template ?? doc);
  return out;
}
const find = (items: Labelled[], label: string) => items.find((i) => key(i.label) === key(label));
const yn = (v: string | null): boolean | null => (v == null ? null : /^yes\b/i.test(v.trim()) ? true : /^no\b/i.test(v.trim()) ? false : null);
const numberOf = (v: string | null): number | null => { if (v == null) return null; const n = Number(String(v).replace(/[^0-9.]/g, "")); return Number.isFinite(n) ? n : null; };
/** Ticked options of a tick-all answer: the selected labels, else the comma-joined text matched against the option list. */
function ticks(it: Labelled | undefined, options: readonly string[]): string[] {
  if (!it) return [];
  if (it.values.length) return options.filter((o) => it.values.some((v) => norm(v) === norm(o)));
  const v = it.value ?? "";
  return options.filter((o) => v.includes(o));
}

/** Which of the new questions the template does NOT yet carry (exact wording). Empty = the form is built. */
export function installEvidenceMissingQuestions(template: unknown): string[] {
  const items = labelledItems(template);
  return installEvidenceQuestionList().filter((q) => !find(items, q.label)).map((q) => q.label);
}

export type InstallEvidenceZoneRead = { zone: number; name: string | null; underInsulated: boolean | null; existingPhoto: MittiMediaFile[]; beforeVideo: MittiMediaFile[]; afterVideo: MittiMediaFile[]; depthPhoto: MittiMediaFile[]; product: string | null; areaM2: number | null };
export type SwmsHazardRead = { name: string; present: boolean | null; controls: string[]; otherControl: string | null; person: string | null; otherPerson: string | null };
export type SwmsWorkerRead = { row: number; name: string | null; read: boolean; signature: ReadSignature };
export type SwmsRead = {
  onForm: boolean; preparedBy: string | null; preparedFor: string | null; work: string | null; preparedAt: string | null;
  hrcw: string[]; hrcwNone: string | null; hazards: SwmsHazardRead[]; controlsCheck: string[]; changes: string | null;
  firstAidKit: string | null; firstAider: string | null; hospital: string | null; reception: boolean | null; noReception: string | null; assembly: string | null; electricalEmergency: string | null;
  workers: SwmsWorkerRead[]; leadDeclaration: boolean; leadSignature: ReadSignature; signedAt: string | null; day2Recheck: string | null; day3Recheck: string | null;
};
export type AfterInstallRead = { onForm: boolean; lockoutRemoved: boolean | null; lockoutRemovedBy: string | null; switchboardAfterPhoto: MittiMediaFile[]; solarRestarted: string | null; finishedAt: string | null; leadPresent: boolean; completionSignature: ReadSignature };
export type FoilRead = { onForm: boolean; foil: boolean | null; foilPhoto: MittiMediaFile[] };
export type InstallEvidenceRead = { formZoneCount: number | null; zones: InstallEvidenceZoneRead[]; multiDay: boolean | null; dailyRecheck: boolean; questionsOnForm: boolean; swms: SwmsRead; after: AfterInstallRead; foil: FoilRead };

/** Everything the Install day audit holds for the new items. Missing question = nothing read, never a neighbour's answer. */
export function readInstallEvidence(audit: unknown): InstallEvidenceRead {
  const items = labelledItems(audit);
  const Q = INSTALL_EVIDENCE_QUESTIONS, S = SWMS_QUESTIONS, A = AFTER_INSTALL_QUESTIONS, F = FOIL_QUESTIONS;
  const v = (label: string) => find(items, label)?.value ?? null;
  const t = (label: string) => { const x = v(label); return x && x.trim() ? x.trim() : null; };
  const m = (label: string) => find(items, label)?.media ?? [];
  const sig = (label: string): ReadSignature => find(items, label)?.signature ?? { present: false, name: null, signedAt: null, mediaId: null };
  const zc = v(Q.zoneCount);
  const n = zc == null ? NaN : Number(String(zc).trim());
  const zones: InstallEvidenceZoneRead[] = [];
  for (let z = 1; z <= MAX_FORM_ZONES; z++) zones.push({
    zone: z, name: t(Q.zoneName(z)), underInsulated: yn(v(Q.zoneUnderInsulated(z))),
    existingPhoto: m(Q.zoneExistingPhoto(z)), beforeVideo: m(Q.zoneBeforeVideo(z)), afterVideo: m(Q.zoneAfterVideo(z)), depthPhoto: m(Q.zoneDepthPhoto(z)),
    product: t(Q.zoneProduct(z)), areaM2: numberOf(v(Q.zoneAreaM2(z))),
  });
  const swms: SwmsRead = {
    onForm: !!find(items, S.preparedBy), preparedBy: t(S.preparedBy), preparedFor: t(S.preparedFor), work: t(S.work), preparedAt: t(S.preparedAt),
    hrcw: ticks(find(items, S.hrcw), SWMS_HRCW_OPTIONS), hrcwNone: t(S.hrcwNone),
    hazards: SWMS_HAZARDS.map((h) => ({ name: h.name, present: yn(v(S.hazardPresent(h.name))), controls: ticks(find(items, S.hazardControls(h.name)), h.controls), otherControl: t(S.hazardOtherControl(h.name)), person: t(S.hazardPerson(h.name)), otherPerson: t(S.hazardOtherPerson(h.name)) })),
    controlsCheck: ticks(find(items, S.controlsCheck), SWMS_CONTROL_CHECK_OPTIONS), changes: t(S.changes),
    firstAidKit: t(S.firstAidKit), firstAider: t(S.firstAider), hospital: t(S.hospital), reception: yn(v(S.reception)), noReception: t(S.noReception), assembly: t(S.assembly), electricalEmergency: t(S.electricalEmergency),
    workers: Array.from({ length: SWMS_CREW_ROWS }, (_, i) => ({ row: i + 1, name: t(S.workerName(i + 1)), read: !!v(S.workerRead(i + 1)), signature: sig(S.workerSignature(i + 1)) })),
    leadDeclaration: !!v(S.leadDeclaration), leadSignature: sig(S.leadSignature), signedAt: t(S.signedAt), day2Recheck: t(S.day2Recheck), day3Recheck: t(S.day3Recheck),
  };
  const after: AfterInstallRead = { onForm: !!find(items, A.lockoutRemoved), lockoutRemoved: yn(v(A.lockoutRemoved)), lockoutRemovedBy: t(A.lockoutRemovedBy), switchboardAfterPhoto: m(A.switchboardAfterPhoto), solarRestarted: t(A.solarRestarted), finishedAt: t(A.finishedAt), leadPresent: !!v(A.leadPresent), completionSignature: sig(A.completionSignature) };
  const foil: FoilRead = { onForm: !!find(items, F.foil), foil: yn(v(F.foil)), foilPhoto: m(F.foilPhoto) };
  return { formZoneCount: Number.isInteger(n) && n > 0 ? n : null, zones, multiDay: yn(v(Q.multiDay)), dailyRecheck: !!v(Q.dailyRecheck), questionsOnForm: !!find(items, Q.zoneCount), swms, after, foil };
}

// ======================================================================================================
// The rules
// ======================================================================================================
/** One upgrade zone the JOB records (Ready Check / final plan). */
export type JobZone = { name: string | null; /** existing insulation present = under-insulated (Table 4 R-value photo applies). null = not established. */ underInsulated: boolean | null };
export type InstallEvidenceCtx = {
  /** Installation start date (Melbourne YYYY-MM-DD). null = unknown → rule applies. */
  installDate: string | null;
  zones: JobZone[];
  /** Installation runs over more than one day (booked days, or form start ≠ completion date). */
  multiDay: boolean;
  /** Expected days on site (start → completion inclusive); 3+ asks for the day-3 re-check lines. */
  daysOnSite?: number | null;
  /** Lead installer's recorded name (Part 2) — SWMS and completion signatures must carry it. null = not checked. */
  leadName?: string | null;
  /** Additional crew names (Part 2) — each needs a SWMS sign-on row. */
  crewNames?: string[];
  /** Capture time of the isolation photo — the SWMS must be signed before it. */
  isolationCapturedAt?: string | null;
  /** PIISA Part 4 "solar, battery or other supply present" answer. */
  solarPresent?: boolean | null;
  /** PIISA Part 6 "existing insulation present" answer (foil question applies). */
  existingInsulation?: boolean | null;
  /** The official Part 3 ticks, cross-checked against the SWMS section (never removed from the form). */
  p3Swms?: "Yes" | "No" | null; p3Table1?: "Yes" | "No" | null;
};

export type InstallEvidenceItem = { id: string; zone: number | null; label: string; state: "met" | "missing" | "review" | "not_required"; count: number; problems: string[] };
export type InstallEvidenceSummary = {
  rule: typeof INSTALL_EVIDENCE_RULE; applies: boolean; installDate: string | null; zoneCount: number;
  items: InstallEvidenceItem[];
  /** Everything outstanding, plain words, one line per item. */
  blockers: string[];
  /** The before-work subset (reg 327 SWMS, zone before-items, foil) for the prestart snapshot. */
  prestartBlockers: string[];
  /** Per-zone installed product + m² as answered (drives the generated final diagram, decision 211). */
  zoneProducts: { zone: number; name: string | null; product: string | null; areaM2: number | null }[];
  /** The SWMS section is complete (filed as the 6-year record when true). */
  swmsComplete: boolean;
  /** Foil / conductive answer for the official P6 rule: true / false / null (not answered or not asked). */
  foil: boolean | null; foilPhotoMediaId: string | null;
};

type Phase = "before" | "after";
function mediaProblems(label: string, files: MittiMediaFile[], opts: { min: number; video: boolean; workStartAt?: string | null | undefined; phase: Phase }): { state: InstallEvidenceItem["state"]; problems: string[] } {
  const problems: string[] = [];
  if (files.length < opts.min) return { state: "missing", problems: [`${label}: ${files.length} of ${opts.min} uploaded`] };
  const noGeo = files.filter((f) => f.lat == null || f.lng == null).length;
  if (noGeo) problems.push(`${label}: location (GPS) not recorded on ${noGeo} of ${files.length} — take it again with location on`);
  const noTime = files.filter((f) => !f.capturedAt).length;
  if (noTime) problems.push(`${label}: capture time not recorded on ${noTime} of ${files.length} — office review`);
  if (opts.video) for (const f of files.filter((f) => f.sizeBytes != null && f.sizeBytes > VIDEO_MAX_BYTES)) problems.push(`${label}: video is ${Math.round(f.sizeBytes! / (1024 * 1024))} MB — over the 250 MB limit, record a shorter one`);
  if (opts.phase === "before" && opts.workStartAt) {
    const late = files.filter((f) => f.capturedAt && Date.parse(f.capturedAt) > Date.parse(opts.workStartAt!)).length;
    if (late) problems.push(`${label}: ${late} taken after work started — must be taken before work starts`);
  }
  return { state: problems.length ? "review" : "met", problems };
}
const sameName = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && norm(a) === norm(b);

/** SWMS section (decision 206): what is still missing before work may start. Empty = complete. */
export function swmsBlockers(s: SwmsRead, ctx: Pick<InstallEvidenceCtx, "leadName" | "crewNames" | "isolationCapturedAt" | "multiDay" | "daysOnSite">): string[] {
  const S = SWMS_QUESTIONS;
  if (!s.onForm) return [`The Mitti Install day form has no SWMS section yet ("${S.preparedBy}" not found) — add it to the template (docs/MITTI_INSTALL_FORM_CHATGPT_PROMPT.md).`];
  const b: string[] = [];
  const need = (ok: unknown, line: string) => { if (!ok) b.push(line); };
  need(s.preparedBy, `${S.preparedBy}: not entered`);
  need(s.preparedFor, `${S.preparedFor}: not entered`);
  need(s.work, `${S.work}: not entered`);
  need(s.preparedAt, `${S.preparedAt}: not entered`);
  if (!s.hrcw.length) b.push(`${S.hrcw}: nothing ticked`);
  else if (s.hrcw.includes(SWMS_HRCW_NONE)) { if (s.hrcw.length > 1) b.push("SWMS — high-risk work: \"None of these apply\" cannot be ticked with another type"); need(s.hrcwNone, `${S.hrcwNone}: not entered`); }
  let anyPresent = false, allAnswered = true;
  for (const h of s.hazards) {
    if (h.present == null) { allAnswered = false; b.push(`SWMS — ${h.name}: present on this job? not answered`); continue; }
    if (!h.present) continue;
    anyPresent = true;
    if (!h.controls.length) b.push(`SWMS — ${h.name}: present but no control ticked`);
    if (h.controls.includes(SWMS_OTHER_CONTROL) && !h.otherControl) b.push(`SWMS — ${h.name}: "${SWMS_OTHER_CONTROL}" ticked but not described`);
    if (!h.person) b.push(`SWMS — ${h.name}: person responsible not chosen`);
    else if (norm(h.person) === norm(SWMS_PERSON_OTHER) && !h.otherPerson) b.push(`SWMS — ${h.name}: other person responsible not named`);
  }
  // Reg 327: the SWMS must reflect THIS site — a blank sheet (every hazard No and no high-risk work) is not one.
  if (allAnswered && !anyPresent && s.hrcw.includes(SWMS_HRCW_NONE)) b.push("SWMS: every hazard is No and no high-risk work applies — a ceiling insulation job always has at least the electrical, heat and falls hazards; office review");
  if (!s.controlsCheck.length) b.push(`${S.controlsCheck}: nothing ticked`);
  need(s.firstAidKit, `${S.firstAidKit}: not entered`);
  need(s.firstAider, `${S.firstAider}: not entered`);
  need(s.hospital, `${S.hospital}: not entered`);
  if (s.reception == null) b.push(`${S.reception}: not answered`);
  else if (s.reception === false) need(s.noReception, `${S.noReception}: not entered`);
  need(s.assembly, `${S.assembly}: not entered`);
  need(s.electricalEmergency, `${S.electricalEmergency}: not entered`);
  const crew = [ctx.leadName ?? null, ...(ctx.crewNames ?? [])];
  const rows = Math.max(1, Math.min(SWMS_CREW_ROWS, crew.filter((c) => c != null).length || 1));
  for (let n = 1; n <= rows; n++) {
    const w = s.workers[n - 1]!;
    const who = n === 1 ? "lead installer" : `additional installer ${n - 1}`;
    if (!w.name) b.push(`SWMS — worker ${n} (${who}): name not entered`);
    else if (crew[n - 1] && !sameName(w.name, crew[n - 1])) b.push(`SWMS — worker ${n}: name "${w.name}" is not the ${who} on the safety form (${crew[n - 1]})`);
    if (!w.read) b.push(`SWMS — worker ${n} (${who}): has not ticked that they read the SWMS`);
    if (!w.signature.present) b.push(`SWMS — worker ${n} (${who}): signature missing`);
    else if (!w.signature.signedAt) b.push(`SWMS — worker ${n} (${who}): signature has no time recorded`);
  }
  if (!s.leadDeclaration) b.push("SWMS — lead installer declaration not ticked");
  if (!s.leadSignature.present) b.push(`${S.leadSignature}: missing`);
  else {
    if (!s.leadSignature.signedAt) b.push(`${S.leadSignature}: no time recorded`);
    if (ctx.leadName && s.leadSignature.name && !sameName(s.leadSignature.name, ctx.leadName)) b.push(`${S.leadSignature}: signed by "${s.leadSignature.name}", not the lead installer (${ctx.leadName}) — signing on behalf is not accepted`);
    if (s.leadSignature.signedAt && ctx.isolationCapturedAt && Date.parse(s.leadSignature.signedAt) > Date.parse(ctx.isolationCapturedAt)) b.push("SWMS was signed after the power-isolation photo was taken — the SWMS must be completed before work starts; office review");
  }
  need(s.signedAt, `${S.signedAt}: not entered`);
  if (ctx.multiDay) {
    need(s.day2Recheck, `${S.day2Recheck}: not entered for this multi-day installation`);
    if ((ctx.daysOnSite ?? 0) >= 3) need(s.day3Recheck, `${S.day3Recheck}: not entered`);
  }
  return b;
}

/** Official Part 3 ticks must agree with the section: a Yes on a half-done SWMS is a contradiction, never a pass. */
export function swmsCrossCheck(s: SwmsRead, swmsProblems: string[], p3Swms: "Yes" | "No" | null | undefined, p3Table1: "Yes" | "No" | null | undefined): string[] {
  const out: string[] = [];
  if (!s.onForm) return out;
  const complete = swmsProblems.length === 0;
  const tableOneDone = s.hazards.every((h) => h.present != null) && s.hazards.filter((h) => h.present).every((h) => h.controls.length > 0);
  if (p3Swms === "Yes" && !complete) out.push("PIISA Part 3 says the SWMS is complete, but the SWMS section on the form is not — finish the SWMS section");
  if (p3Table1 === "Yes" && !tableOneDone) out.push("PIISA Part 3 says every Table 1 hazard is controlled, but the SWMS hazard blocks are not all answered with a control");
  if (p3Swms === "No" && complete) out.push("PIISA Part 3 says the SWMS is not complete although the SWMS section is — the installer must correct Part 3");
  return out;
}

/** After-install sign-off (decision 210 a, b). Empty = complete. */
export function afterInstallBlockers(a: AfterInstallRead, ctx: Pick<InstallEvidenceCtx, "leadName" | "solarPresent">, workStartAt?: string | null): string[] {
  const A = AFTER_INSTALL_QUESTIONS;
  if (!a.onForm) return [`The Mitti Install day form has no after-install sign-off yet ("${A.lockoutRemoved}" not found) — add it to the template.`];
  const b: string[] = [];
  if (a.lockoutRemoved == null) b.push(`${A.lockoutRemoved}: not answered`);
  else if (a.lockoutRemoved === false) b.push("Lock-out still in place — the premises must be re-energised and the lock-out removed before leaving site");
  else {
    if (!a.lockoutRemovedBy) b.push(`${A.lockoutRemovedBy}: not entered`);
    const p = mediaProblems("Switchboard photo after re-energising", a.switchboardAfterPhoto, { min: 1, video: false, phase: "after" });
    b.push(...p.problems);
    if (workStartAt && a.switchboardAfterPhoto.some((f) => f.capturedAt && Date.parse(f.capturedAt) < Date.parse(workStartAt))) b.push("Switchboard photo after re-energising: taken before work started — take it after the lock-out is removed");
  }
  if (!a.solarRestarted) b.push(`${A.solarRestarted}: not answered`);
  else if (/^no\b/i.test(a.solarRestarted)) b.push("Solar, battery or generator not restarted — restart it per the instructions (or have the electrician do it) before leaving site");
  else if (/^n\/?a/i.test(a.solarRestarted) && ctx.solarPresent === true) b.push("Solar/battery restart answered N/A but the safety form says the home has solar, a battery or another supply — office review");
  if (!a.finishedAt) b.push(`${A.finishedAt}: not entered`);
  else if (Number.isNaN(Date.parse(a.finishedAt))) b.push(`${A.finishedAt}: not a readable date and time`);
  if (!a.leadPresent) b.push("Lead installer has not confirmed being on site for the whole installation");
  if (!a.completionSignature.present) b.push(`${A.completionSignature}: missing`);
  else {
    if (!a.completionSignature.signedAt) b.push(`${A.completionSignature}: no time recorded`);
    if (ctx.leadName && a.completionSignature.name && !sameName(a.completionSignature.name, ctx.leadName)) b.push(`${A.completionSignature}: signed by "${a.completionSignature.name}", not the lead installer (${ctx.leadName})`);
  }
  return b;
}

/** Foil / conductive (decision 210 c): asked whenever existing insulation is present; Yes needs the facing photo. */
export function foilBlockers(f: FoilRead, existingInsulation: boolean, workStartAt?: string | null): string[] {
  if (!existingInsulation) return [];
  const F = FOIL_QUESTIONS;
  if (!f.onForm) return [`The Mitti Install day form has no "${F.foil}" question yet — add it to the template.`];
  if (f.foil == null) return [`${F.foil}: not answered`];
  if (!f.foil) return [];
  return mediaProblems("Existing insulation facing photo (foil / conductive)", f.foilPhoto, { min: 1, video: false, workStartAt, phase: "before" }).problems;
}

/**
 * Required items for the job's zones against what the form holds. Every applicable item is listed with its real state;
 * `blockers` are the plain-words lines the office sees (missing / not geotagged / oversized / not answered).
 */
export function evaluateInstallEvidence(read: InstallEvidenceRead, ctx: InstallEvidenceCtx, workStartAt?: string | null): InstallEvidenceSummary {
  const Q = INSTALL_EVIDENCE_QUESTIONS;
  const applies = installEvidenceApplies(ctx.installDate);
  const zoneCount = Math.max(1, ctx.zones.length);
  const zoneProducts = read.zones.slice(0, Math.min(zoneCount, MAX_FORM_ZONES)).map((z) => ({ zone: z.zone, name: z.name, product: z.product, areaM2: z.areaM2 }));
  const base = { rule: INSTALL_EVIDENCE_RULE, applies, installDate: ctx.installDate, zoneCount, zoneProducts, foil: read.foil.foil, foilPhotoMediaId: read.foil.foilPhoto[0]?.mediaId ?? null } as const;
  if (!applies) return { ...base, items: [], blockers: [], prestartBlockers: [], swmsComplete: false };
  const items: InstallEvidenceItem[] = [];
  const before: string[] = [], after: string[] = [];
  if (!read.questionsOnForm) before.push(`The Mitti Install day form has no "${Q.zoneCount}" question yet — add the new items to the template (docs/MITTI_INSTALL_FORM_CHATGPT_PROMPT.md).`);
  else {
    if (zoneCount > MAX_FORM_ZONES) before.push(`This job records ${zoneCount} upgrade zones but the Mitti form holds ${MAX_FORM_ZONES} — office review (extra zones need their own evidence).`);
    if (read.formZoneCount == null) before.push(`${Q.zoneCount}: not answered`);
    else if (read.formZoneCount !== zoneCount) before.push(`The form says ${read.formZoneCount} upgrade zone${read.formZoneCount === 1 ? "" : "s"} but the job records ${zoneCount} — office review`);
    const add = (list: string[], id: string, zone: number | null, label: string, r: { state: InstallEvidenceItem["state"]; problems: string[] }, count: number) => { items.push({ id, zone, label, state: r.state, count, problems: r.problems }); list.push(...r.problems); };
    for (let z = 1; z <= Math.min(zoneCount, MAX_FORM_ZONES); z++) {
      const jobZone = ctx.zones[z - 1] ?? { name: null, underInsulated: null };
      const fz = read.zones[z - 1]!;
      const zoneLabel = jobZone.name?.trim() ? `Zone ${z} (${jobZone.name.trim()})` : `Zone ${z}`;
      if (!fz.name) before.push(`${zoneLabel}: area name not entered on the form`);
      else if (jobZone.name?.trim() && zoneNameCore(fz.name) !== zoneNameCore(jobZone.name)) before.push(`${zoneLabel}: the form names this area "${fz.name}" — Table 4 needs the same name on every record; office review`);
      // Under-insulated: the job's recorded fact OR the installer's answer on the day; the old "below R2.0" tick is not enough.
      const under = jobZone.underInsulated === true || fz.underInsulated === true;
      if (jobZone.underInsulated == null && fz.underInsulated == null) before.push(`${Q.zoneUnderInsulated(z)}: not answered`);
      if (under) add(before, "zone_existing_photo", z, Q.zoneExistingPhoto(z), mediaProblems(`${zoneLabel} existing insulation ruler/brand photo`, fz.existingPhoto, { min: 1, video: false, workStartAt, phase: "before" }), fz.existingPhoto.length);
      else items.push({ id: "zone_existing_photo", zone: z, label: Q.zoneExistingPhoto(z), state: "not_required", count: fz.existingPhoto.length, problems: [] });
      add(before, "zone_before_video", z, Q.zoneBeforeVideo(z), mediaProblems(`${zoneLabel} before 360° video`, fz.beforeVideo, { min: 1, video: true, workStartAt, phase: "before" }), fz.beforeVideo.length);
      add(after, "zone_after_video", z, Q.zoneAfterVideo(z), mediaProblems(`${zoneLabel} after 360° video`, fz.afterVideo, { min: 1, video: true, phase: "after" }), fz.afterVideo.length);
      add(after, "zone_depth_photo", z, Q.zoneDepthPhoto(z), mediaProblems(`${zoneLabel} after-install depth photo with vertical ruler`, fz.depthPhoto, { min: 1, video: false, phase: "after" }), fz.depthPhoto.length);
      // Decision 210 d / 211: product + m² per zone (the portal draws the final diagram from these).
      if (!fz.product) after.push(`${zoneLabel}: insulation product installed not chosen`);
      else if (!ZONE_PRODUCT_OPTIONS.some((o) => norm(o) === norm(fz.product!))) after.push(`${zoneLabel}: product "${fz.product}" is not one of the approved options`);
      if (fz.areaM2 == null) after.push(`${zoneLabel}: area insulated (m²) not entered`);
      else if (!(fz.areaM2 > 0 && fz.areaM2 <= 5000)) after.push(`${zoneLabel}: area insulated ${fz.areaM2} m² is not a believable figure`);
    }
    // Multi-day: the form's own answer, or what the job knows. Not answered = asked for.
    const multi = read.multiDay === true || ctx.multiDay;
    if (read.multiDay == null) after.push(`${Q.multiDay}: not answered`);
    else if (read.multiDay === false && ctx.multiDay) after.push("The form says one day but the installation ran over more than one day — the daily re-check must be confirmed; office review");
    if (multi) {
      const ok = read.dailyRecheck;
      items.push({ id: "daily_recheck", zone: null, label: Q.dailyRecheck, state: ok ? "met" : "missing", count: ok ? 1 : 0, problems: ok ? [] : ["Daily pre-start re-check not ticked for this multi-day installation"] });
      if (!ok) after.push("Daily pre-start re-check not ticked for this multi-day installation");
    } else items.push({ id: "daily_recheck", zone: null, label: Q.dailyRecheck, state: "not_required", count: read.dailyRecheck ? 1 : 0, problems: [] });
  }
  // SWMS (before work), its cross-check with the official Part 3, foil (before work), after-install sign-off.
  const swmsProblems = swmsBlockers(read.swms, { ...ctx, multiDay: read.multiDay === true || ctx.multiDay });
  before.push(...swmsProblems.map((p) => (p.startsWith("SWMS") || p.startsWith("The Mitti") ? p : `SWMS: ${p}`)), ...swmsCrossCheck(read.swms, swmsProblems, ctx.p3Swms, ctx.p3Table1));
  const existing = ctx.existingInsulation === true || ctx.zones.some((z) => z.underInsulated === true) || read.zones.some((z) => z.underInsulated === true);
  before.push(...foilBlockers(read.foil, existing, workStartAt));
  after.push(...afterInstallBlockers(read.after, ctx, workStartAt));
  const prestartBlockers = [...new Set(before)];
  return { ...base, items, blockers: [...new Set([...before, ...after])], prestartBlockers, swmsComplete: read.swms.onForm && swmsProblems.length === 0 };
}

/** Lines for the stage gate. `summary` null = never read from Mitti; blocks only when the rule applies. */
export function installEvidenceGateLines(summary: InstallEvidenceSummary | null | undefined, installDate: string | null): string[] {
  if (!installEvidenceApplies(installDate)) return [];
  if (!summary) return ["Install-day evidence (Activity Guide Table 4, SWMS and sign-off) has not been read from the Mitti Install day form yet — sync the PIISA."];
  if (!summary.applies) return [];
  return summary.blockers.map((b) => `Install evidence: ${b}`);
}

// ======================================================================================================
// Prefill (zone names from the Ready Check, SWMS header and crew names) — label-matched text items
// ======================================================================================================
export type InstallPrefillCtx = { zoneNames: (string | null)[]; businessName: string | null; leadName: string | null; crewNames: string[] };
/** Text items to send with the audit: only questions the template actually carries (by exact wording). */
export function installEvidencePrefillItems(template: unknown, ctx: InstallPrefillCtx): { item_id: string; type: "text"; responses: { text: string } }[] {
  const items = labelledItemsWithIds(template);
  const out: { item_id: string; type: "text"; responses: { text: string } }[] = [];
  const put = (label: string, value: string | null) => { if (!value) return; const it = items.find((i) => key(i.label) === key(label)); if (it) out.push({ item_id: it.id, type: "text", responses: { text: value } }); };
  const zones = ctx.zoneNames.length ? ctx.zoneNames : [null];
  zones.slice(0, MAX_FORM_ZONES).forEach((n, i) => put(INSTALL_EVIDENCE_QUESTIONS.zoneName(i + 1), zoneNameValue(i + 1, n)));
  put(SWMS_QUESTIONS.preparedBy, ctx.businessName);
  put(SWMS_QUESTIONS.preparedFor, SWMS_PREPARED_FOR);
  put(SWMS_QUESTIONS.work, SWMS_WORK_DEFAULT);
  put(SWMS_QUESTIONS.workerName(1), ctx.leadName);
  ctx.crewNames.slice(0, SWMS_CREW_ROWS - 1).forEach((n, i) => put(SWMS_QUESTIONS.workerName(i + 2), n));
  return out;
}
function labelledItemsWithIds(doc: unknown): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = [];
  const walk = (x: unknown) => {
    if (Array.isArray(x)) { x.forEach(walk); return; }
    if (!x || typeof x !== "object") return;
    const o = x as Record<string, any>;
    const id = o["item_id"] ?? o["id"];
    if (typeof o["label"] === "string" && id != null) out.push({ id: String(id), label: o["label"] });
    for (const v of Object.values(o)) if (v && typeof v === "object") walk(v);
  };
  walk((doc as any)?.template ?? doc);
  return out;
}

// ======================================================================================================
// SWMS record text (filed as the 6-year PDF, decision 206)
// ======================================================================================================
export function swmsRecordText(s: SwmsRead, meta: { jobNumber: string; address: string | null; auditId: string }): string {
  const S = SWMS_QUESTIONS;
  const L: string[] = [];
  L.push(`Safe Work Method Statement — ceiling insulation (VEU Activity 48)`, `Job ${meta.jobNumber}${meta.address ? ` — ${meta.address}` : ""}`, `Mitti Install day form ${meta.auditId}`, "");
  const row = (label: string, v: string | null | undefined) => L.push(`${label}: ${v && v.trim() ? v.trim() : "—"}`);
  row(S.preparedBy, s.preparedBy); row(S.preparedFor, s.preparedFor); row(S.work, s.work); row(S.preparedAt, s.preparedAt);
  row(S.hrcw, s.hrcw.join("; ")); if (s.hrcwNone) row(S.hrcwNone, s.hrcwNone);
  L.push("", "Hazards and controls");
  for (const h of s.hazards) {
    L.push(`- ${h.name}: ${h.present == null ? "not answered" : h.present ? "PRESENT" : "not present"}`);
    if (h.present) { L.push(`    Controls: ${h.controls.join("; ") || "—"}`); if (h.otherControl) L.push(`    Other control: ${h.otherControl}`); L.push(`    Person responsible: ${h.person ?? "—"}${h.otherPerson ? ` (${h.otherPerson})` : ""}`); }
  }
  L.push("", "Monitoring and review"); row(S.controlsCheck, s.controlsCheck.join("; ")); row(S.changes, s.changes);
  L.push("", "Emergency"); row(S.firstAidKit, s.firstAidKit); row(S.firstAider, s.firstAider); row(S.hospital, s.hospital); row(S.reception, s.reception == null ? null : s.reception ? "Yes" : "No"); if (s.reception === false) row(S.noReception, s.noReception); row(S.assembly, s.assembly); row(S.electricalEmergency, s.electricalEmergency);
  L.push("", "Crew sign-on");
  for (const w of s.workers) if (w.name || w.signature.present) L.push(`- Worker ${w.row}: ${w.name ?? "—"} — read and will follow: ${w.read ? "Yes" : "No"} — signed: ${w.signature.present ? `${w.signature.signedAt ?? "time not recorded"} (signature image ${w.signature.mediaId})` : "not signed"}`);
  L.push("", "Lead installer declaration", `Ticked: ${s.leadDeclaration ? "Yes" : "No"}`, `Signed: ${s.leadSignature.present ? `${s.leadSignature.name ?? "name not recorded"} at ${s.leadSignature.signedAt ?? "time not recorded"} (signature image ${s.leadSignature.mediaId})` : "not signed"}`);
  row(S.signedAt, s.signedAt);
  if (s.day2Recheck || s.day3Recheck) { L.push("", "Daily re-checks"); row(S.day2Recheck, s.day2Recheck); row(S.day3Recheck, s.day3Recheck); }
  return L.join("\n");
}

// ======================================================================================================
// Activity 48 product check (decision 205 / checklist D6)
// ======================================================================================================
/**
 * Problems for a declared product option (the Mitti "Insulation product" tap option, e.g. "Bradford Gold R5") on the
 * install date AND the planned VEEC creation date (the Guide tests the register on the creation date). Model codes
 * recorded by the office win over the option's representative model. No product recorded = [] here (the product hold
 * is reported elsewhere); unknown option = one plain line.
 */
export function declaredProductProblems(option: string | null | undefined, dates: { installDate: string | null; veecCreationDate: string }, recordedCodes: readonly string[] = []): string[] {
  if (!option && !recordedCodes.length) return [];
  let codes = [...recordedCodes];
  if (!codes.length) {
    const models = modelsForMittiOption(option!);
    if (!models.length) return [`Product "${option}" does not match any model on the ESC approved list — office must confirm the model from the packaging photo.`];
    codes = [models[0]!.code]; // one representative model per option: every model of the option shares the R-value
  }
  const out: string[] = [];
  for (const d of [dates.installDate, dates.veecCreationDate]) if (d) out.push(...activity48ProductProblems(codes, d));
  return [...new Set(out)].map((p) => `Product: ${p}`);
}
// ======================================================================================================
// Decision 213: Mitti Complete → installation recorded only when every check passes
// ======================================================================================================
export type InstallCompletionInput = {
  /** Mitti reports the Install day form finished. */
  formCompleted: boolean;
  /** The signed installer declaration from this form is saved (official PIISA copy stored). */
  declarationSaved: boolean;
  /** This module's evidence summary for the same form (null = not read). */
  summary: InstallEvidenceSummary | null;
  /** `installation_completed_at` already set (office button or an earlier sync). */
  alreadyCompleted: boolean;
};
export type InstallCompletionDecision = { record: boolean; reason: string; /** The installer's Next line when not recording; null when recording or already done. */ nextLine: string | null; outstanding: string[] };

/** Pure: record completion through the guarded path only when the form is Complete, the declaration is saved and no evidence item is outstanding. */
export function installCompletionDecision(i: InstallCompletionInput): InstallCompletionDecision {
  if (i.alreadyCompleted) return { record: false, reason: "Installation already recorded", nextLine: null, outstanding: [] };
  if (!i.formCompleted) return { record: false, reason: "Install day form not marked Complete in Mitti", nextLine: "Finish the Install day form in Mitti and mark it Complete", outstanding: [] };
  if (!i.declarationSaved) return { record: false, reason: "Signed installer declaration not saved yet", nextLine: "Sign the safety form (PIISA) in Mitti — the portal has not got a signed copy yet", outstanding: [] };
  if (!i.summary) return { record: false, reason: "Install-day evidence not read yet", nextLine: "Sync the Install day form — the evidence has not been read yet", outstanding: [] };
  if (!i.summary.applies) return { record: true, reason: "Install before the evidence effective date — original checks only", nextLine: null, outstanding: [] };
  if (i.summary.blockers.length) return { record: false, reason: `${i.summary.blockers.length} evidence item(s) outstanding`, nextLine: installerNextLine(i.summary), outstanding: i.summary.blockers };
  return { record: true, reason: "Install day form Complete and every evidence check passed", nextLine: null, outstanding: [] };
}
/** One plain line for the installer's screen: the first missing item and how many more. */
export function installerNextLine(summary: InstallEvidenceSummary): string | null {
  const [first, ...rest] = summary.blockers;
  if (!first) return null;
  return rest.length ? `Install day form: ${first} (and ${rest.length} more item${rest.length === 1 ? "" : "s"})` : `Install day form: ${first}`;
}

/** Per-zone installed products (Install day answers) first; the Ready Check option when no zone product is in yet. */
export function jobProductOptions(zoneProducts: { product: string | null }[] | null | undefined, readyCheckOption: string | null | undefined): string[] {
  const z = (zoneProducts ?? []).map((p) => p.product).filter((p): p is string => !!p);
  if (z.length) return [...new Set(z)];
  return readyCheckOption ? [readyCheckOption] : [];
}
