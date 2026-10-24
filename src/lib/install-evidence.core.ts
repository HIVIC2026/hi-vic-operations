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
/** Additional installer rows on the A3 crew section (Part 2: Additional installer 1–3); each signs the SWMS inside its own block. */
export const SWMS_ADDITIONAL_INSTALLERS = 3;
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

/** Part B — zones and Table 4 evidence (decision 205) + per-zone product and m² (decision 210 d). Decision 260: the short
 *  labels of docs/MITTI_INSTALL_FORM_FIX_PROMPT.md are primary; every earlier wording stays readable (LABEL_ALIASES). */
export const INSTALL_EVIDENCE_QUESTIONS = {
  zoneCount: "How many zones?",
  zoneName: (z: number) => `Zone ${z} name (same as the Ready Check)`,
  zoneUnderInsulated: (z: number) => `Zone ${z}: existing insulation here?`,
  zoneExistingPhoto: (z: number) => `Zone ${z}: photo with ruler showing depth`,
  zoneBeforeVideo: (z: number) => `Zone ${z}: before video`,
  zoneAfterVideo: (z: number) => `Zone ${z}: after video`,
  zoneDepthPhoto: (z: number) => `Zone ${z}: after photo with ruler showing depth`,
  zoneProduct: (z: number) => `Zone ${z}: product installed`,
  zoneAreaM2: (z: number) => `Zone ${z}: m² installed`,
  multiDay: "More than one day?",
  dailyRecheck: "I re-checked every item before starting each day",
} as const;
/** The 24 Oct 2026 long wordings (decision 205), still read on forms built before decision 260. */
export const INSTALL_EVIDENCE_QUESTIONS_LONG = {
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

/** The four A3 photo items (same Mitti items, wording only). Decision 260 short labels; help text carries the detail. */
export const INSTALL_EVIDENCE_RELABELS = {
  installer_photos: "Photo: each installer at the front door with ID",
  electrician_photo: "Photo: electrician at the front door with ID",
  isolation_photo: "Photo: power isolated, lock-out tag on switchboard",
  product_photos: "Photo: product packaging showing brand, model, R-value",
} as const;
/** Decision 205 wordings of the same four items (still accepted on the same stable IDs). */
export const INSTALL_EVIDENCE_RELABELS_LONG = {
  installer_photos: "Photo of each installer at the front of the premises with photo ID clearly visible — one photo per installer (geotagged)",
  electrician_photo: "Photo of the electrician at the front of the premises with photo ID clearly visible (geotagged)",
  isolation_photo: "Before work starts: photo of the power isolated — lock-out tag on the switchboard, and the solar and battery isolators switched off where the home has them (geotagged)",
  product_photos: "Photo of the product packaging on site showing the brand, model and R-value label — one per product (geotagged)",
} as const;
/** Alias used by the Mitti build prompt. */
export const A3_RELABELS = INSTALL_EVIDENCE_RELABELS;

/** Part C — SWMS ("safety plan"), the legal minimum (decisions 256/258/260, Jo 24 Oct 2026; docs/SWMS_REQUIREMENTS_VIC_2026-10-24.md;
 *  end state docs/MITTI_INSTALL_FORM_FIX_PROMPT.md): high-risk work, one required tick that the standard controls (shown on
 *  the installer's job page and printed on the filed SWMS — SWMS_STANDARD_CONTROLS_TEXT) are in place, an optional box for
 *  anything specific to the house, and each named installer 2–4 signing inside their own crew block. The lead's sign-off is
 *  the declaration signature; prepared by / for / work / date come from job facts on the filed PDF. */
export const SWMS_QUESTIONS = {
  hrcw: "High-risk work on this job (tick all)",
  hrcwNone: "None apply: why?",
  standardControls: "Standard controls are in place (they're on your job page)",
  /** Optional. */
  changes: "Anything specific to this house (optional)",
  /** Additional installer n (1..3) = the form's "Installer n+1", shown only when that name is filled in. */
  installerSignature: (n: number) => `Installer ${n + 1} signature: I have read the safety plan and will follow it`,
} as const;
/** Earlier wordings still read on forms built before decision 260. */
export const SWMS_LEGACY_LABELS = {
  hrcw: ["SWMS — which high-risk construction work applies to this job? (tick all)"],
  hrcwNone: ["SWMS — if none of the high-risk work types apply, explain why"],
  standardControls: ["SWMS — the standard controls above are in place on this job", "SWMS — the standard controls above are in place for every ticked hazard"],
  changes: ["SWMS — anything specific to this house, or any change during the job (optional)", "SWMS — anything specific to this house, or any change to hazards or controls during the job (write 'None' if none)", "SWMS — changes to hazards or controls during this job (write 'None' if none)"],
  installerSignature: (n: number) => [`SWMS — additional installer ${n}: signature (I have read this SWMS, understand the hazards and controls, and will follow it)`, `SWMS — additional installer ${n}: signature`],
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
/** The nine ESC hazards of every ceiling insulation job (all always apply, decision 258) with each one's sentence from
 *  the standard-controls instruction on the form (`short`: `control`.). The filed PDF prints every one of them. */
export const SWMS_HAZARDS: readonly { name: string; short: string; control: string }[] = [
  { name: "Live electrical hazards", short: "Live electrical", control: "power isolated, locked out and tagged before entry (solar, battery and generator too, following their instructions); PIESA read and its conditions followed; electrician on site when the PIESA requires; test for dead before touching cables" },
  { name: "Hazardous substances (friable asbestos, harmful chemicals)", short: "Hazardous substances", control: "if asbestos is suspected, do not disturb it — stop work; it is a licensed asbestos removalist's job before work continues; no chemicals or solvents used in the ceiling" },
  { name: "Biological hazards (mould, animal waste)", short: "Biological (mould, animal waste)", control: "do not disturb droppings or mould dry; P2 mask and gloves; wash hands before eating" },
  { name: "High temperatures and heat exhaustion", short: "Heat", control: "work early, water and a break every 30 minutes, stop in extreme heat" },
  { name: "Unsafe noise and vibration levels", short: "Noise and vibration", control: "hearing protection for blowers and power tools" },
  { name: "Respiratory hazards and irritants (dust, odours)", short: "Dust and irritants", control: "P2 mask, goggles, gloves and long sleeves in the ceiling; removed material bagged in the ceiling" },
  { name: "Working in enclosed spaces", short: "Enclosed spaces", control: "exits kept clear, lighting set up first, stay in contact with someone outside the ceiling" },
  { name: "Working at height (inside and outside the ceiling space)", short: "Height (inside and outside the ceiling space)", control: "walk only on joists or crawl boards, never on plasterboard; ladder secured and footed with three points of contact; no roof access in wind or rain" },
  { name: "Fire hazards and ignition sources (flues, chimneys, gas heaters, heat lamps, exhaust fans, downlights, cables over 400 mm surrounded by insulation)", short: "Fire and ignition sources", control: "AS 3999 clearances kept to flues, chimneys, gas heaters, heat lamps, exhaust fans and downlights; cables over 400 mm in insulation as the PIESA directs" },
];
/** Closing sentence of the standard-controls instruction (how the controls are implemented and monitored). */
export const SWMS_HOW_IN_PLACE = "How these are put in place: the lead installer directly supervises the crew, checks every control before anyone enters the ceiling and again at the start of each day, and stops work if any control cannot be followed.";
/** The instruction (text item, not a question) shown above SWMS_QUESTIONS.standardControls — verbatim. */
export const SWMS_STANDARD_CONTROLS_TEXT = ["Standard controls for the hazards of every ceiling insulation job.", ...SWMS_HAZARDS.map((h) => `${h.short}: ${h.control}.`), SWMS_HOW_IN_PLACE].join(" ");
/** Header facts printed on the filed SWMS (from the job, not the form). */
export const SWMS_PREPARED_FOR = "Home Insulation Victoria (DC Construction Solutions Pty Ltd)";
export const SWMS_WORK_DEFAULT = "Ceiling insulation removal (if required) and installation of bulk ceiling insulation – VEU Activity 48";

/** Part D — after-install sign-off (decision 210 a, b; audit A3-1…A3-7), decision 260 short labels. The completion
 *  signature shares the label "Signature" with the declaration signature: it is the SECOND "Signature" on the form. */
export const AFTER_INSTALL_QUESTIONS = {
  lockoutRemoved: "Lock-out removed, power back on?",
  lockoutRemovedBy: "Who did it?",
  switchboardAfterPhoto: "Photo: switchboard, main switch on",
  solarRestarted: "Solar, battery or generator restarted?",
  leadPresent: "I was on site the whole time and supervised every installer",
  completionSignature: "Signature",
} as const;
export const AFTER_INSTALL_QUESTIONS_LONG = {
  lockoutRemoved: "After installation: have all lock-out devices been removed and the premises safely re-energised?",
  lockoutRemovedBy: "Who removed the lock-out and re-energised the premises? (name and role — the person who applied the lock, or the attending electrician)",
  switchboardAfterPhoto: "Photo of the switchboard after re-energising — lock-out tag removed, main switch on (geotagged)",
  solarRestarted: "Solar, battery or generator restarted following the shutdown/restart instructions?",
  leadPresent: "I, the lead installer, was on site for the whole installation, supervised every other installer and confirm the installation complies with the VEU program requirements.",
  completionSignature: "Lead installer signature at completion",
} as const;
/** Decision 258: deleted from the form; still read on older forms. Otherwise the completion signature's time is the finish time. */
export const LEGACY_FINISHED_AT_LABEL = "Installation finished at (date and time)";
export const SOLAR_RESTARTED_OPTIONS = ["Yes", "No", "None here"] as const;
/** "None here" (decision 260) or the earlier "N/A – none at this property". */
export const solarNoneAnswer = (v: string) => /^(n\/?a\b|none\b)/i.test(v.trim());

/** Part E — foil / conductive existing insulation (decision 210 c; audit A3-10), feeding the official P6 foil rule. */
export const FOIL_QUESTIONS = {
  foil: "Foil, metallic or conductive?",
  foilPhoto: "Photo of the facing",
} as const;
export const FOIL_QUESTIONS_LONG = {
  foil: "Is any of the existing insulation foil-backed, metallic or electrically conductive?",
  foilPhoto: "Photo of the existing insulation showing the facing (geotagged)",
} as const;

/** Every earlier wording of each current label (exact, first line), so forms built before decision 260 still read. */
export const LABEL_ALIASES: Readonly<Record<string, readonly string[]>> = (() => {
  const out: Record<string, string[]> = {};
  const add = (cur: string, ...old: readonly string[]) => { out[cur] = [...(out[cur] ?? []), ...old]; };
  const Q = INSTALL_EVIDENCE_QUESTIONS, QL = INSTALL_EVIDENCE_QUESTIONS_LONG;
  add(Q.zoneCount, QL.zoneCount); add(Q.multiDay, QL.multiDay); add(Q.dailyRecheck, QL.dailyRecheck);
  for (let z = 1; z <= MAX_FORM_ZONES; z++) for (const k of ["zoneName", "zoneUnderInsulated", "zoneExistingPhoto", "zoneBeforeVideo", "zoneAfterVideo", "zoneDepthPhoto", "zoneProduct", "zoneAreaM2"] as const) add(Q[k](z), QL[k](z));
  for (const k of Object.keys(AFTER_INSTALL_QUESTIONS) as (keyof typeof AFTER_INSTALL_QUESTIONS)[]) add(AFTER_INSTALL_QUESTIONS[k], AFTER_INSTALL_QUESTIONS_LONG[k]);
  add(FOIL_QUESTIONS.foil, FOIL_QUESTIONS_LONG.foil); add(FOIL_QUESTIONS.foilPhoto, FOIL_QUESTIONS_LONG.foilPhoto);
  const S = SWMS_QUESTIONS, L = SWMS_LEGACY_LABELS;
  add(S.hrcw, ...L.hrcw); add(S.hrcwNone, ...L.hrcwNone); add(S.standardControls, ...L.standardControls); add(S.changes, ...L.changes);
  for (let n = 1; n <= SWMS_ADDITIONAL_INSTALLERS; n++) add(S.installerSignature(n), ...L.installerSignature(n));
  return out;
})();

/** Decision 211: the old upload item to DELETE from the Install day form — the portal draws the final diagram instead. */
export const RETIRED_FINAL_PLAN_UPLOAD_LABEL = "Please upload a clear final roof-space plan showing the installed area in m² and the products used. Unclear or incomplete evidence may be rejected by the Essential Services Commission (ESC).";

/** Per-zone confirmations for the generated final diagram (area-diagram.server `fileFinalAreaDiagram`). Zones without a name or figures are left out. */
export function installZoneConfirmations(summary: Pick<InstallEvidenceSummary, "zoneProducts"> | null | undefined): { name: string; areaM2: number | null; productOption: string | null }[] {
  return (summary?.zoneProducts ?? []).filter((z) => z.name && (z.areaM2 != null || z.product)).map((z) => ({ name: String(z.name).replace(/^\s*area\s*\d+\s*[–—-]\s*/i, "").trim() || String(z.name), areaM2: z.areaM2, productOption: z.product }));
}

/** Zone name convention (audit §6): "Area N – <name>"; a one-area job is "Main ceiling". */
export const DEFAULT_SINGLE_AREA_NAME = "Main ceiling";
export const zoneNameValue = (z: number, name: string | null | undefined) => `Area ${z} – ${name?.trim() || (z === 1 ? DEFAULT_SINGLE_AREA_NAME : `Area ${z}`)}`;
/** The human part of a zone name, for comparing records that may or may not carry the "Area N –" prefix. */
export const zoneNameCore = (v: string | null | undefined) => norm(String(v ?? "").replace(/^\s*area\s*\d+\s*[–—-]\s*/i, ""));

// ======================================================================================================
// Question list (form order) — drives the build prompt, form health and the drift test
// ======================================================================================================
export type QuestionType = "pick_one" | "tick_all" | "text" | "yes_no" | "photo" | "video" | "checkbox" | "number" | "date_time" | "signature";
export type QuestionSpec = { part: "B" | "C" | "D" | "E"; label: string; type: QuestionType; zone?: number | null; options?: readonly string[]; showWhen?: string | undefined; prefill?: string | undefined; /** Not required on the form. */ optional?: boolean };

export function installEvidenceQuestionList(): QuestionSpec[] {
  const Q = INSTALL_EVIDENCE_QUESTIONS, S = SWMS_QUESTIONS, A = AFTER_INSTALL_QUESTIONS, F = FOIL_QUESTIONS;
  const out: QuestionSpec[] = [];
  // Part C — SWMS (decisions 256/258). Crew signatures sit inside each "Additional Installer N" block of Part 2 (shown
  // when that name is filled in); the SWMS questions sit before Part 3 of the PIISA, so they are done before isolation.
  for (let n = 1; n <= SWMS_ADDITIONAL_INSTALLERS; n++) out.push({ part: "C", label: S.installerSignature(n), type: "signature", showWhen: `Additional installer ${n} name is filled in` });
  out.push(
    { part: "C", label: S.hrcw, type: "tick_all", options: SWMS_HRCW_OPTIONS },
    { part: "C", label: S.hrcwNone, type: "text", showWhen: `${S.hrcw} has "${SWMS_HRCW_NONE}" ticked` },
    { part: "C", label: S.standardControls, type: "checkbox" },
    { part: "C", label: S.changes, type: "text", optional: true },
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
/** One exact label. "Signature" is shared by the declaration and the sign-off: the sign-off one is the SECOND on the form
 *  (a form with a single "Signature" has no sign-off signature yet — never the declaration's). */
const findExact = (items: Labelled[], label: string) => {
  const k = key(label);
  if (k === key(AFTER_INSTALL_QUESTIONS.completionSignature)) return items.filter((i) => key(i.label) === k)[1];
  return items.find((i) => key(i.label) === k);
};
/** Current wording first, then every earlier wording of it (LABEL_ALIASES). */
const find = (items: Labelled[], label: string) => [label, ...(LABEL_ALIASES[label] ?? [])].map((l) => findExact(items, l)).find((x) => !!x);
/** First item carrying any of the labels (current wording first, then older wordings). */
const findAny = (items: Labelled[], labels: readonly string[]) => labels.map((l) => find(items, l)).find((x) => !!x);
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
/** One "Additional Installer N" SWMS sign-off (N = row, 1..3). */
export type SwmsInstallerRead = { row: number; signature: ReadSignature };
export type SwmsRead = { onForm: boolean; hrcw: string[]; hrcwNone: string | null; standardControls: boolean; changes: string | null; installers: SwmsInstallerRead[] };
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
  const sig = (label: string, legacy: readonly string[] = []): ReadSignature => findAny(items, [label, ...legacy])?.signature ?? { present: false, name: null, signedAt: null, mediaId: null };
  const tAny = (labels: readonly string[]) => { const x = findAny(items, labels)?.value ?? null; return x && x.trim() ? x.trim() : null; };
  const zc = v(Q.zoneCount);
  const n = zc == null ? NaN : Number(String(zc).trim());
  const zones: InstallEvidenceZoneRead[] = [];
  for (let z = 1; z <= MAX_FORM_ZONES; z++) zones.push({
    zone: z, name: t(Q.zoneName(z)), underInsulated: yn(v(Q.zoneUnderInsulated(z))),
    existingPhoto: m(Q.zoneExistingPhoto(z)), beforeVideo: m(Q.zoneBeforeVideo(z)), afterVideo: m(Q.zoneAfterVideo(z)), depthPhoto: m(Q.zoneDepthPhoto(z)),
    product: t(Q.zoneProduct(z)), areaM2: numberOf(v(Q.zoneAreaM2(z))),
  });
  const swms: SwmsRead = {
    onForm: !!findAny(items, [S.standardControls, ...SWMS_LEGACY_LABELS.standardControls]),
    hrcw: ticks(find(items, S.hrcw), SWMS_HRCW_OPTIONS), hrcwNone: t(S.hrcwNone),
    standardControls: !!tAny([S.standardControls, ...SWMS_LEGACY_LABELS.standardControls]), changes: tAny([S.changes, ...SWMS_LEGACY_LABELS.changes]),
    installers: Array.from({ length: SWMS_ADDITIONAL_INSTALLERS }, (_, i) => ({ row: i + 1, signature: sig(S.installerSignature(i + 1), SWMS_LEGACY_LABELS.installerSignature(i + 1)) })),
  };
  // Decision 258: "Installation finished at" is gone — the completion signature's own time stands as the finish time.
  const completionSignature = sig(A.completionSignature);
  const after: AfterInstallRead = { onForm: !!find(items, A.lockoutRemoved), lockoutRemoved: yn(v(A.lockoutRemoved)), lockoutRemovedBy: t(A.lockoutRemovedBy), switchboardAfterPhoto: m(A.switchboardAfterPhoto), solarRestarted: t(A.solarRestarted), finishedAt: t(LEGACY_FINISHED_AT_LABEL) ?? completionSignature.signedAt, leadPresent: !!v(A.leadPresent), completionSignature };
  const foil: FoilRead = { onForm: !!find(items, F.foil), foil: yn(v(F.foil)), foilPhoto: m(F.foilPhoto) };
  return { formZoneCount: Number.isInteger(n) && n > 0 ? n : null, zones, multiDay: yn(v(Q.multiDay)), dailyRecheck: !!v(Q.dailyRecheck), questionsOnForm: !!find(items, Q.zoneCount), swms, after, foil };
}

/**
 * Fix prompt (24 Oct 2026): the whole-job before / completed videos are deleted from the A3 form — each zone's own
 * before / after 360° video now stands as that evidence. Returns every zone's files for a phase ONLY when the form's zone
 * count is answered and every zone 1..n carries at least one file; otherwise null (never a partial set).
 */
export function zoneVideoFiles(audit: unknown): { before: MittiMediaFile[] | null; after: MittiMediaFile[] | null } {
  const r = readInstallEvidence(audit);
  const n = r.formZoneCount;
  if (!r.questionsOnForm || n == null || n < 1 || n > MAX_FORM_ZONES) return { before: null, after: null };
  const zones = r.zones.slice(0, n);
  const all = (k: "beforeVideo" | "afterVideo") => (zones.every((z) => z[k].length > 0) ? zones.flatMap((z) => z[k]) : null);
  return { before: all("beforeVideo"), after: all("afterVideo") };
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
  /** Lead installer's recorded name (Part 2) — the completion signature must carry it; printed on the SWMS. null = not checked. */
  leadName?: string | null;
  /** Part 2 "Additional installer 1–3" names by row (index 0 = additional installer 1; null = row empty). Every filled
   *  row needs its SWMS signature (decisions 256/258). */
  additionalInstallers?: (string | null)[];
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

/** SWMS section (decisions 206/256/258): what is still missing before work may start. Empty = complete. The lead's
 *  sign-off is the PIISA Part 8 signature, checked by the PIISA gate; the specific/changes box is optional. */
export function swmsBlockers(s: SwmsRead, ctx: Pick<InstallEvidenceCtx, "additionalInstallers">): string[] {
  const S = SWMS_QUESTIONS;
  if (!s.onForm) return [`The Mitti Install day form does not have the current SWMS yet ("${S.standardControls}" not found) — apply docs/MITTI_INSTALL_FORM_FIX_PROMPT.md to the template.`];
  const b: string[] = [];
  if (!s.hrcw.length) b.push(`${S.hrcw}: nothing ticked`);
  else if (s.hrcw.includes(SWMS_HRCW_NONE)) { if (s.hrcw.length > 1) b.push("SWMS — high-risk work: \"None of these apply\" cannot be ticked with another type"); if (!s.hrcwNone) b.push(`${S.hrcwNone}: not entered`); }
  if (!s.standardControls) b.push(`${S.standardControls}: not ticked`);
  // Every additional installer named on the form signs the SWMS inside their own block.
  (ctx.additionalInstallers ?? []).slice(0, SWMS_ADDITIONAL_INSTALLERS).forEach((name, i) => {
    if (!name) return;
    const w = s.installers[i]!;
    const who = `SWMS — additional installer ${i + 1} (${name})`;
    if (!w.signature.present) b.push(`${who}: signature missing`);
    else if (!w.signature.signedAt) b.push(`${who}: signature has no time recorded`);
  });
  return b;
}

/** Official Part 3 ticks must agree with the section: a Yes on a half-done SWMS is a contradiction, never a pass. */
export function swmsCrossCheck(s: SwmsRead, swmsProblems: string[], p3Swms: "Yes" | "No" | null | undefined, p3Table1: "Yes" | "No" | null | undefined): string[] {
  const out: string[] = [];
  if (!s.onForm) return out;
  const complete = swmsProblems.length === 0;
  const tableOneDone = s.standardControls;
  if (p3Swms === "Yes" && !complete) out.push("PIISA Part 3 says the SWMS is complete, but the SWMS section on the form is not — finish the SWMS section");
  if (p3Table1 === "Yes" && !tableOneDone) out.push("PIISA Part 3 says every Table 1 hazard is controlled, but the SWMS standard controls are not confirmed");
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
  else if (solarNoneAnswer(a.solarRestarted) && ctx.solarPresent === true) b.push("Solar/battery restart answered \"None here\" but the safety form says the home has solar, a battery or another supply — office review");
  if (a.finishedAt && Number.isNaN(Date.parse(a.finishedAt))) b.push(`${LEGACY_FINISHED_AT_LABEL}: not a readable date and time`);
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
  const swmsProblems = swmsBlockers(read.swms, ctx);
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
// Prefill (zone names from the Ready Check) — label-matched text items. Decision 256: the SWMS has no prefilled items
// (prepared by / for / work come from job facts on the filed PDF; crew names are the Part 2 crew prefill).
// ======================================================================================================
export type InstallPrefillCtx = { zoneNames: (string | null)[] };
/** Text items to send with the audit: only questions the template actually carries (by exact wording). */
export function installEvidencePrefillItems(template: unknown, ctx: InstallPrefillCtx): { item_id: string; type: "text"; responses: { text: string } }[] {
  const items = labelledItemsWithIds(template);
  const out: { item_id: string; type: "text"; responses: { text: string } }[] = [];
  const put = (label: string, value: string | null) => { if (!value) return; const it = [label, ...(LABEL_ALIASES[label] ?? [])].map((l) => items.find((i) => key(i.label) === key(l))).find((x) => !!x); if (it) out.push({ item_id: it.id, type: "text", responses: { text: value } }); };
  const zones = ctx.zoneNames.length ? ctx.zoneNames : [null];
  zones.slice(0, MAX_FORM_ZONES).forEach((n, i) => put(INSTALL_EVIDENCE_QUESTIONS.zoneName(i + 1), zoneNameValue(i + 1, n)));
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
/** Job facts for the SWMS header (decisions 256/258: not asked on the form). `leadSignature` = the PIISA Part 8 signature. */
export type SwmsRecordMeta = { jobNumber: string; address: string | null; auditId: string; preparedBy: string | null; leadName: string | null; leadSignature: ReadSignature | null; additionalInstallers: (string | null)[]; multiDay: boolean | null; dailyRecheck: boolean };
/** Fixed wording on the filed SWMS (WorkSafe Victoria sample template layout, decision 256). */
export const SWMS_RECORD_TASK = "Ceiling insulation removal (if required) and installation in the ceiling space";
export const SWMS_COMPLIANCE_MEASURES = "Direct supervision by the lead installer; every control checked before first entry and at the start of each day";
export const SWMS_HOW_IMPLEMENTED = "Lead installer directly supervises the crew, checks the control before anyone enters the ceiling and again at the start of each day, and stops work if it cannot be followed";
/**
 * The filed SWMS (6-year record) laid out like WorkSafe Victoria's sample SWMS template (Safe-work-method-statements-2023-07):
 * header rows from job facts, compliance rows, a Tasks | Hazard | Control measures | How implemented | Responsible table for
 * all nine hazards (control = that hazard's own sentence from the form's standard-controls text), the review row (daily
 * re-check tick + the optional specific/changes box) and a Name | Signature | Date sign-off table (lead = Part 8 signature,
 * then each named additional installer; date = the Mitti signature time).
 */
export function swmsRecordText(s: SwmsRead, meta: SwmsRecordMeta): string {
  const L: string[] = [];
  const val = (v: string | null | undefined) => (v && v.trim() ? v.trim() : "—");
  const leadSig = meta.leadSignature ?? { present: false, name: null, signedAt: null, mediaId: null };
  const lead = val(meta.leadName ?? leadSig.name);
  const sigCell = (x: ReadSignature) => (x.present ? `signed (signature image ${x.mediaId})` : "NOT SIGNED");
  L.push("Safe Work Method Statement — ceiling insulation (VEU Activity 48)", `Job ${meta.jobNumber} — Mitti Install day form ${meta.auditId}`, "");
  L.push(
    `Direct employer: ${val(meta.preparedBy)}`,
    `Principal contractor: ${SWMS_PREPARED_FOR}`,
    `Work supervisor: ${lead}`,
    `Site location/address: ${val(meta.address)}`,
    `Work activity: ${SWMS_WORK_DEFAULT}`,
    `Date SWMS signed: ${val(leadSig.signedAt)}`,
    `High-risk construction work: ${s.hrcw.length ? s.hrcw.join("; ") : "—"}`,
  );
  if (s.hrcwNone) L.push(`Why no high-risk construction work applies: ${s.hrcwNone}`);
  L.push("", `Person responsible for ensuring compliance with SWMS: ${lead}`, `Measures to ensure compliance: ${SWMS_COMPLIANCE_MEASURES}`);
  const daily = meta.multiDay === true ? `Daily re-check before each day's work: ${meta.dailyRecheck ? "confirmed by the lead installer" : "NOT CONFIRMED"}` : "One-day installation: controls checked before first entry";
  L.push(`How control measures will be reviewed: ${daily} · Specific to this house / changes during the job: ${val(s.changes ?? "None recorded")}`);
  L.push("", "Tasks | Hazard | Control measures | How implemented | Responsible");
  for (const h of SWMS_HAZARDS) L.push(`${SWMS_RECORD_TASK} | ${h.name} | ${h.short}: ${h.control}. | ${SWMS_HOW_IMPLEMENTED} | ${lead} (lead installer)`);
  L.push("", SWMS_HOW_IN_PLACE, `Standard controls in place on this job: ${s.standardControls ? "Yes" : "No"}`);
  L.push("", "Worker sign-off (I have read this SWMS, understand the hazards and controls, and will follow it)", "Name | Signature | Date");
  L.push(`${lead} (lead installer — PIISA Part 8 signature) | ${sigCell(leadSig)} | ${val(leadSig.signedAt)}`);
  meta.additionalInstallers.slice(0, SWMS_ADDITIONAL_INSTALLERS).forEach((name, i) => {
    const w = s.installers[i]!;
    if (!name && !w.signature.present) return;
    L.push(`${val(name)} (additional installer ${w.row}) | ${sigCell(w.signature)} | ${val(w.signature.signedAt)}`);
  });
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
