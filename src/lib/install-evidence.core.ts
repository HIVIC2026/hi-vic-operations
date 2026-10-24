/* eslint-disable @typescript-eslint/no-explicit-any */
// Install-day evidence and sign-off on the Mitti Install day form. PURE: no database, no network. Jo 24 Oct 2026,
// decisions 205 (Activity Guide v1.2 §4.2 + Table 4), 210 (lock-out removal / re-energise, lead present + signature, foil /
// conductive existing insulation, product + m² per area, area names from the Ready Check), 211 (no plan upload: the
// final diagram is drawn from the per-area product + m² answers) and 262 (the "A3 – Install day" template).
//
// The portal reads every item BY EXACT QUESTION WORDING. The current wording is the "A3 – Install day" template
// (install-day.core.ts, built from docs/MITTI_INSTALL_FORM_FIX_PROMPT.md); the decision-205 wording of the old
// "A3 - PIISA + AP Evidence" template stays readable as aliases so completed old forms still parse. The safety plan
// (SWMS) is not on the form any more (decision 261, swms.core.ts). Form health lists any wording the template lacks;
// the stage gates fail closed for installs from the effective date.
//
// Grandfathering: installs that started before INSTALL_EVIDENCE_EFFECTIVE_DATE keep the seven original A3 items only
// (piisa-a3.core); nothing here applies to them, so history is untouched.
import { norm } from "./mitti.core";
import { melbourneToday } from "./melbourne-time.core";
import type { MittiMediaFile } from "./piesa-evidence.core";
import { INSTALL_DAY_Q as ID, INSTALL_DAY_SOLAR_BACK_OPTIONS, allWithLabel, isInstallDayDoc, labelKey as key, labelledItems, NO_SIGNATURE, type Labelled, type ReadSignature } from "./install-day.core";
import { activity48ProductProblems, modelsForMittiOption } from "./esc-approved-products.core";
import { APPROVED_PRODUCTS } from "./insulation-product.core";

/** Melbourne date from which the new items are required (install start date on or after). Earlier installs = old rule. */
export const INSTALL_EVIDENCE_EFFECTIVE_DATE = "2026-11-01";
export const INSTALL_EVIDENCE_RULE = "install-day-v2-2026-10-24";
/** Zone blocks on the Mitti form. */
export const MAX_FORM_ZONES = 3;
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

/** Areas and Table 4 evidence (decision 205) + per-area product and m² (decision 210 d): the "A3 – Install day" wording.
 *  The two existing-insulation items are on the OLD A3 only: on the install day form the Ready Check depth photos are the
 *  existing-insulation evidence and official Part 6 comes from the Ready Check record (decision 262). */
export const INSTALL_EVIDENCE_QUESTIONS = {
  zoneCount: ID.areaCount,
  zoneName: ID.areaName,
  zoneUnderInsulated: (z: number) => `Zone ${z} — is there existing insulation in this area (under-insulated)?`,
  zoneExistingPhoto: (z: number) => `Zone ${z} — photo of the existing insulation with a ruler placed vertically showing its depth, and any brand, model or R-value markings (geotagged)`,
  zoneBeforeVideo: ID.areaBeforeVideo,
  zoneAfterVideo: ID.areaAfterVideo,
  zoneDepthPhoto: ID.areaNewPhoto,
  zoneProduct: ID.areaProduct,
  zoneAreaM2: ID.areaM2,
  multiDay: ID.multiDay,
  dailyRecheck: ID.dailyRecheck,
} as const;
/** Decision 205 wording on the old "A3 - PIISA + AP Evidence" template (still read on completed old forms). */
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

/** The four A3 photo items: the "A3 – Install day" wording. */
export const INSTALL_EVIDENCE_RELABELS = {
  installer_photos: ID.installerPhotos,
  electrician_photo: ID.electricianPhoto,
  isolation_photo: ID.isolationPhoto,
  product_photos: ID.productPhotos,
} as const;
/** Decision 205 wordings of the same four items on the old A3 template (still accepted on the same stable IDs). */
export const INSTALL_EVIDENCE_RELABELS_LONG = {
  installer_photos: "Photo of each installer at the front of the premises with photo ID clearly visible — one photo per installer (geotagged)",
  electrician_photo: "Photo of the electrician at the front of the premises with photo ID clearly visible (geotagged)",
  isolation_photo: "Before work starts: photo of the power isolated — lock-out tag on the switchboard, and the solar and battery isolators switched off where the home has them (geotagged)",
  product_photos: "Photo of the product packaging on site showing the brand, model and R-value label — one per product (geotagged)",
} as const;
/** Alias used by the old A3 build prompt. */
export const A3_RELABELS = INSTALL_EVIDENCE_RELABELS;

/** After-install sign-off (decision 210 a, b; audit A3-1…A3-7). The completion signature shares the label "Lead
 *  installer's signature" with the before-work declaration signature: it is the SECOND one on the form. */
export const AFTER_INSTALL_QUESTIONS = {
  lockoutRemoved: ID.lockoutOff,
  lockoutRemovedBy: ID.lockoutBy,
  switchboardAfterPhoto: ID.switchboardOn,
  solarRestarted: ID.solarBack,
  leadPresent: ID.supervised,
  completionSignature: ID.signature,
} as const;
export const AFTER_INSTALL_QUESTIONS_LONG = {
  lockoutRemoved: "After installation: have all lock-out devices been removed and the premises safely re-energised?",
  lockoutRemovedBy: "Who removed the lock-out and re-energised the premises? (name and role — the person who applied the lock, or the attending electrician)",
  switchboardAfterPhoto: "Photo of the switchboard after re-energising — lock-out tag removed, main switch on (geotagged)",
  solarRestarted: "Solar, battery or generator restarted following the shutdown/restart instructions?",
  leadPresent: "I, the lead installer, was on site for the whole installation, supervised every other installer and confirm the installation complies with the VEU program requirements.",
  completionSignature: "Lead installer signature at completion",
} as const;
/** Old A3 only; the install-day form has no finish time — the completion signature's own time is the finish time. */
export const LEGACY_FINISHED_AT_LABEL = "Installation finished at (date and time)";
export const SOLAR_RESTARTED_OPTIONS = INSTALL_DAY_SOLAR_BACK_OPTIONS;
/** "There isn't one" (install day) or the old "N/A – none at this property". */
export const solarNoneAnswer = (v: string) => /^(n\/?a\b|none\b|there isn.t one)/i.test(v.trim());

/** Foil / conductive existing insulation (decision 210 c; audit A3-10) — OLD A3 only. On the install day form the
 *  conductive answer comes from the Ready Check record (official Part 6, decision 262). */
export const FOIL_QUESTIONS = {
  foil: "Is any of the existing insulation foil-backed, metallic or electrically conductive?",
  foilPhoto: "Photo of the existing insulation showing the facing (geotagged)",
} as const;

/** The old A3 wording of each current label (exact, first line), so completed old forms still read. */
export const LABEL_ALIASES: Readonly<Record<string, readonly string[]>> = (() => {
  const out: Record<string, string[]> = {};
  const add = (cur: string, ...old: readonly string[]) => { out[cur] = [...(out[cur] ?? []), ...old]; };
  const Q = INSTALL_EVIDENCE_QUESTIONS, QL = INSTALL_EVIDENCE_QUESTIONS_LONG;
  add(Q.zoneCount, QL.zoneCount); add(Q.multiDay, QL.multiDay); add(Q.dailyRecheck, QL.dailyRecheck);
  for (let z = 1; z <= MAX_FORM_ZONES; z++) for (const k of ["zoneName", "zoneBeforeVideo", "zoneAfterVideo", "zoneDepthPhoto", "zoneProduct", "zoneAreaM2"] as const) add(Q[k](z), QL[k](z));
  for (const k of Object.keys(AFTER_INSTALL_QUESTIONS) as (keyof typeof AFTER_INSTALL_QUESTIONS)[]) add(AFTER_INSTALL_QUESTIONS[k], AFTER_INSTALL_QUESTIONS_LONG[k]);
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
  const Q = INSTALL_EVIDENCE_QUESTIONS, A = AFTER_INSTALL_QUESTIONS, F = FOIL_QUESTIONS;
  const out: QuestionSpec[] = [];
  // Part B — areas.
  out.push({ part: "B", label: Q.zoneCount, type: "pick_one", zone: null, options: ZONE_COUNT_OPTIONS });
  for (let z = 1; z <= MAX_FORM_ZONES; z++) {
    const show = z === 1 ? undefined : `${Q.zoneCount} is ${ZONE_COUNT_OPTIONS.slice(z - 1).join(" or ")}`;
    out.push(
      { part: "B", label: Q.zoneName(z), type: "text", zone: z, showWhen: show, prefill: "<Ready Check area name>" },
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
// Reading the audit / template by label (primitives shared with install-day.core)
// ======================================================================================================
export type { ReadSignature } from "./install-day.core";
/** One exact label. "Lead installer's signature" is shared by the declaration and the sign-off: the sign-off one is the
 *  SECOND on the form (a form with a single one has no sign-off signature yet — never the declaration's). */
const findExact = (items: Labelled[], label: string) => {
  if (key(label) === key(AFTER_INSTALL_QUESTIONS.completionSignature)) return allWithLabel(items, label)[1];
  return allWithLabel(items, label)[0];
};
/** Current wording first, then every earlier wording of it (LABEL_ALIASES). */
const find = (items: Labelled[], label: string) => [label, ...(LABEL_ALIASES[label] ?? [])].map((l) => findExact(items, l)).find((x) => !!x);
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
export type AfterInstallRead = { onForm: boolean; lockoutRemoved: boolean | null; lockoutRemovedBy: string | null; switchboardAfterPhoto: MittiMediaFile[]; solarRestarted: string | null; finishedAt: string | null; leadPresent: boolean; completionSignature: ReadSignature };
export type FoilRead = { onForm: boolean; foil: boolean | null; foilPhoto: MittiMediaFile[] };
export type InstallEvidenceRead = { /** The "A3 – Install day" template (decision 262), not the old A3. */ installDay: boolean; formZoneCount: number | null; zones: InstallEvidenceZoneRead[]; multiDay: boolean | null; dailyRecheck: boolean; questionsOnForm: boolean; after: AfterInstallRead; foil: FoilRead };

/** Everything the Install day audit holds for the new items. Missing question = nothing read, never a neighbour's answer. */
export function readInstallEvidence(audit: unknown): InstallEvidenceRead {
  const items = labelledItems(audit);
  const Q = INSTALL_EVIDENCE_QUESTIONS, A = AFTER_INSTALL_QUESTIONS, F = FOIL_QUESTIONS;
  const v = (label: string) => find(items, label)?.value ?? null;
  const t = (label: string) => { const x = v(label); return x && x.trim() ? x.trim() : null; };
  const m = (label: string) => find(items, label)?.media ?? [];
  const sig = (label: string): ReadSignature => find(items, label)?.signature ?? NO_SIGNATURE;
  const zc = v(Q.zoneCount);
  const n = zc == null ? NaN : Number(String(zc).trim());
  const zones: InstallEvidenceZoneRead[] = [];
  for (let z = 1; z <= MAX_FORM_ZONES; z++) zones.push({
    zone: z, name: t(Q.zoneName(z)), underInsulated: yn(v(Q.zoneUnderInsulated(z))),
    existingPhoto: m(Q.zoneExistingPhoto(z)), beforeVideo: m(Q.zoneBeforeVideo(z)), afterVideo: m(Q.zoneAfterVideo(z)), depthPhoto: m(Q.zoneDepthPhoto(z)),
    product: t(Q.zoneProduct(z)), areaM2: numberOf(v(Q.zoneAreaM2(z))),
  });
  // The install-day form has no finish time: the completion signature's own time stands as the finish time.
  const completionSignature = sig(A.completionSignature);
  const after: AfterInstallRead = { onForm: !!find(items, A.lockoutRemoved), lockoutRemoved: yn(v(A.lockoutRemoved)), lockoutRemovedBy: t(A.lockoutRemovedBy), switchboardAfterPhoto: m(A.switchboardAfterPhoto), solarRestarted: t(A.solarRestarted), finishedAt: t(LEGACY_FINISHED_AT_LABEL) ?? completionSignature.signedAt, leadPresent: !!v(A.leadPresent), completionSignature };
  const foil: FoilRead = { onForm: !!find(items, F.foil), foil: yn(v(F.foil)), foilPhoto: m(F.foilPhoto) };
  return { installDay: isInstallDayDoc(audit), formZoneCount: Number.isInteger(n) && n > 0 ? n : null, zones, multiDay: yn(v(Q.multiDay)), dailyRecheck: !!v(Q.dailyRecheck), questionsOnForm: !!find(items, Q.zoneCount), after, foil };
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
  /** Lead installer's recorded name — the completion signature must carry it. null = not checked. */
  leadName?: string | null;
  /** PIISA Part 4 "solar, battery or other supply present" answer. */
  solarPresent?: boolean | null;
  /** PIISA Part 6 "existing insulation present" answer (foil question applies). */
  existingInsulation?: boolean | null;
};

export type InstallEvidenceItem = { id: string; zone: number | null; label: string; state: "met" | "missing" | "review" | "not_required"; count: number; problems: string[] };
export type InstallEvidenceSummary = {
  rule: typeof INSTALL_EVIDENCE_RULE; applies: boolean; installDate: string | null; zoneCount: number;
  items: InstallEvidenceItem[];
  /** Everything outstanding, plain words, one line per item. */
  blockers: string[];
  /** The before-work subset (area before-items, foil) for the prestart snapshot. */
  prestartBlockers: string[];
  /** Per-zone installed product + m² as answered (drives the generated final diagram, decision 211). */
  zoneProducts: { zone: number; name: string | null; product: string | null; areaM2: number | null }[];
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
  if (!applies) return { ...base, items: [], blockers: [], prestartBlockers: [] };
  const items: InstallEvidenceItem[] = [];
  const before: string[] = [], after: string[] = [];
  if (!read.questionsOnForm) before.push(`The Mitti Install day form has no "${Q.zoneCount}" question yet — build the "A3 – Install day" template (docs/MITTI_INSTALL_FORM_FIX_PROMPT.md).`);
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
      // Install day form (decision 262): the existing-insulation photo is the Ready Check depth photo, not asked here.
      const under = jobZone.underInsulated === true || fz.underInsulated === true;
      if (!read.installDay && jobZone.underInsulated == null && fz.underInsulated == null) before.push(`${Q.zoneUnderInsulated(z)}: not answered`);
      if (read.installDay) items.push({ id: "zone_existing_photo", zone: z, label: Q.zoneExistingPhoto(z), state: "not_required", count: 0, problems: [] });
      else if (under) add(before, "zone_existing_photo", z, Q.zoneExistingPhoto(z), mediaProblems(`${zoneLabel} existing insulation ruler/brand photo`, fz.existingPhoto, { min: 1, video: false, workStartAt, phase: "before" }), fz.existingPhoto.length);
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
  // Foil (before work), after-install sign-off. The safety plan is checked by the pre-start check (decision 261).
  const existing = ctx.existingInsulation === true || ctx.zones.some((z) => z.underInsulated === true) || read.zones.some((z) => z.underInsulated === true);
  // Install day form (decision 262): foil / conductive is official Part 6 from the Ready Check record (pre-start check).
  if (!read.installDay) before.push(...foilBlockers(read.foil, existing, workStartAt));
  after.push(...afterInstallBlockers(read.after, ctx, workStartAt));
  const prestartBlockers = [...new Set(before)];
  return { ...base, items, blockers: [...new Set([...before, ...after])], prestartBlockers };
}

/** Lines for the stage gate. `summary` null = never read from Mitti; blocks only when the rule applies. */
export function installEvidenceGateLines(summary: InstallEvidenceSummary | null | undefined, installDate: string | null): string[] {
  if (!installEvidenceApplies(installDate)) return [];
  if (!summary) return ["Install-day evidence (Activity Guide Table 4 and sign-off) has not been read from the Mitti Install day form yet — sync the PIISA."];
  if (!summary.applies) return [];
  return summary.blockers.map((b) => `Install evidence: ${b}`);
}

// ======================================================================================================
// Prefill for the OLD A3 template (zone names from the Ready Check) — label-matched text items. The "A3 – Install day"
// template is prefilled by install-day.core installDayPrefillItems.
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
