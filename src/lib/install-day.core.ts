/* eslint-disable @typescript-eslint/no-explicit-any */
// "A5 – Install day" Mitti template (decisions 260–262, Jo 24 Oct 2026). PURE: no database, no network.
// The exact wording of every question, option, help text and stop line is fixed here; docs/MITTI_INSTALL_FORM_FIX_PROMPT.md
// is the ChatGPT build prompt and tests/install-day.test.ts fails if the two drift apart (same pattern as the lean Ready
// Check). The portal reads every answer by its question text: this module turns an audit into the official PIISA answers
// (parseA3Answers delegates here for this template), the four A5 photo items, the two signatures and the crew rows, and
// builds the "portal fills this in" prefill. The safety plan (SWMS) is NOT on this form (decision 261, swms.core.ts);
// Q19 is the installer's own confirmation that it is signed. The light, cable and downlight answers of official Part 5
// come from the stored PIESA (piesaPart5Answers) and official Part 6 (existing insulation) from the Ready Check record
// (piisa-a3.core readyCheckPart6Answers) — never from this form.
import { norm } from "./mitti.core";
import { onsiteStartTicked } from "./official-short.core";
import { B1_OPTIONS, type OfficialAnswers } from "./official-forms.core";
import { sectionCSigned } from "./piesa-rules-notice.core";
import { mittiMediaFile, type MittiMediaFile } from "./piesa-evidence.core";

export const INSTALL_DAY_TEMPLATE_NAME = "A5 – Install day";
export const INSTALL_DAY_RULE = "install-day-2026-10-24";
export const INSTALL_DAY_SOLAR_BACK_OPTIONS = ["Yes", "No", "There isn't one"] as const;
/** Q37, a text item (not a question) after the declaration signature. Decision 328 (Jo 25 Oct 2026) wording. */
export const INSTALL_DAY_AFTER_SIGN_TEXT = "STOP. You are only halfway. Do not leave site. When the insulation is in, come back and finish the next pages: after videos, depth photos and finishing up.";
/** Decision 328: the first item of Group 1 (before Q1), a text item. Replaces the decision-318 pay line on THIS form only. */
export const INSTALL_DAY_READ_FIRST_TEXT = 'READ FIRST: The VEU will not accept this job unless every answer, photo and video on this form is filled in. Do not leave site until the whole form is done, you have pressed Complete, and the portal has texted you "All filled in". You are only paid when this form is 100% complete.';
/** Decision 328: the first item of Group 8 (before the after videos), a text item. */
export const INSTALL_DAY_AFTER_INSTALL_TEXT = "AFTER THE INSTALL: do this before you pack up. Every ceiling area needs its after video and depth photo.";
export const INSTALL_DAY_DECLARATION_START = "INSTALLER DECLARATION – Sign BEFORE insulation work starts.";

/** Every label, by key. */
export const INSTALL_DAY_Q = {
  jobNumber: "Portal Job Number",
  address: "Site address",
  installDate: "Install date",
  ap: "Accredited person",
  business: "Installer business",
  lead: "Lead installer",
  leadCii: "Lead installer's CII number",
  anyoneElse: "Is anyone else installing today?",
  second: "Second installer",
  secondCii: "Second installer's CII number",
  third3: "Is there a third installer?",
  third: "Third installer",
  thirdCii: "Third installer's CII number",
  // Decision 300 (Jo 25 Oct 2026): one photo per installer, each mandatory — one shared question got one photo.
  leadPhoto: "Photo of the lead installer at the front door, showing photo ID",
  secondPhoto: "Photo of the second installer at the front door, showing photo ID",
  thirdPhoto: "Photo of the third installer at the front door, showing photo ID",
  powerInformed: "Does the household know the power will be off today?",
  lifeSupport: "Does anyone here rely on life support?",
  lifeSupportConsent: "Do you have their written consent or medical plan?",
  lifeSupportUpload: "Upload the consent or medical plan",
  swmsSigned: "Is the safety plan for this job signed?",
  hazardsCovered: "Are all the common hazards covered in it?",
  isolated: "Is the power isolated, locked out and tagged, and the ceiling safe to enter?",
  isolationPhoto: "Photo of the switchboard with the lock-out tag on",
  solar: "Is there solar, a battery or a generator?",
  solarInstructions: "Do you have the shutdown and restart instructions?",
  solarIsolator: "Does the ground-level isolator work and switch off safely?",
  piesaRead: "Have you read the PIESA and is it safe to start?",
  electricianNeeded: "Does the PIESA need an electrician here at the start?",
  electricianHere: "Is the electrician here?",
  electricianPhoto: "Photo of the electrician at the front door, showing photo ID",
  ceilingEntered: "Has anyone been in the ceiling since the PIESA?",
  productPhotos: "Photo of the packaging showing brand, model and R-value",
  declaration: "Everything on this form is true and complete",
  signature: "Lead installer's signature",
  /** Decisions 263/264: one multi-file item each; the files must cover every Ready Check area. The before video of each
   *  area is a Ready Check item (ready-check-lean.core LEAN_Q.beforeVideo), not asked here. */
  afterVideos: "After videos: one slow 360° of each ceiling area, lit, saying the area's name, showing full coverage and no rubbish left",
  depthPhotos: "Depth photos: the new insulation in each area with a ruler standing in it",
  multiDay: "Did the install take more than one day?",
  dailyRecheck: "I checked every item on this form again before starting each day",
  lockoutOff: "Is the lock-out off and the power back on?",
  lockoutBy: "Who turned it back on?",
  switchboardOn: "Photo of the switchboard with the main switch on",
  solarBack: "Is the solar, battery or generator back on?",
  supervised: "I was here the whole time and supervised everyone",
  /** Decision 328: the final tick, just before the last signature. Required — unticked = the form is not complete. */
  allFilledIn: 'Every answer, photo and video on this form is filled in, and I won\'t leave site until the portal texts me "All filled in".',
} as const;

/**
 * Decision 396 (Jo, 26 Oct 2026, "A5 asks both ruler photos"): ESC Ceiling Insulation Activity Guide v1.2 Table 4 — per
 * ceiling area, a timestamped + geotagged photo with a vertical ruler showing the EXISTING insulation depth (areas that
 * had insulation only) and one showing the NEW insulation depth after install (every area). They sit in ONE repeating
 * section on their own page (before the declaration, so the existing photo is taken before any work), the installer adds
 * one copy per ceiling area in the SAME ORDER as the Ready Check areas (decision 263: files are matched to the Ready
 * Check areas by order). The A5 has no existing-insulation answer of its own (decision 263: not asked again), so the
 * existing photo is NOT required in Mitti and the portal requires it per area from the Ready Check record.
 * Kept OUT of INSTALL_DAY_QUESTIONS (no renumbering of Q1–Q48, and a form built before the paste can still be created);
 * the evidence check (install-evidence.core) blocks Installation complete when they are missing.
 */
export const INSTALL_DAY_RULER_Q = {
  existingDepth: "Existing insulation depth — photo with a ruler standing upright in it",
  newDepth: "New insulation depth after install — photo with a ruler standing upright in it",
} as const;
export const INSTALL_DAY_RULER_PAGE = "Ruler photos (each ceiling area)";
export const INSTALL_DAY_RULER_SECTION_BUTTON = "Add a ceiling area";
export const INSTALL_DAY_RULER_HELP = {
  section: "Add one for each ceiling area, in the same order as the Ready Check areas.",
  existingDepth: "Only if this area had insulation before. Take it before any work starts.",
  newDepth: "Come back to this page when the insulation is in. Don't squash it.",
} as const;
export type InstallDayRulerArea = { existing: MittiMediaFile[]; after: MittiMediaFile[] };
export type InstallDayRulerRead = { onForm: boolean; areas: InstallDayRulerArea[] };
/**
 * The ruler photos per repeat copy, in form order (copy i = Ready Check area i). Items hidden by Mitti logic
 * (`inactive: true`) are never read. Both questions of a copy share its repeat-instance parent; a form without parents
 * (flat) pairs them by occurrence.
 */
export function installDayRulerPhotos(audit: unknown): InstallDayRulerRead {
  type Hit = { which: "existing" | "after"; parent: string | null; media: MittiMediaFile[] };
  const hits: Hit[] = [];
  const kE = labelKey(INSTALL_DAY_RULER_Q.existingDepth), kN = labelKey(INSTALL_DAY_RULER_Q.newDepth);
  const walk = (x: unknown, parent: string | null) => {
    if (Array.isArray(x)) { x.forEach((y) => walk(y, parent)); return; }
    if (!x || typeof x !== "object") return;
    const o = x as Record<string, any>;
    if (o["inactive"] === true) return;
    const id = o["item_id"] ?? o["id"];
    if (typeof o["label"] === "string") {
      const k = labelKey(o["label"]);
      if (k === kE || k === kN) {
        const r = (o["responses"] ?? {}) as Record<string, any>;
        const media = o["media"] ?? r["media"] ?? r["attachments"] ?? [];
        const p = o["parent_id"] ?? parent;
        hits.push({ which: k === kE ? "existing" : "after", parent: p == null ? null : String(p), media: Array.isArray(media) ? media.map(mittiMediaFile) : [] });
      }
    }
    const childParent = typeof o["label"] === "string" && id != null ? String(id) : parent;
    for (const [key, v] of Object.entries(o)) if (v && typeof v === "object" && key !== "responses" && key !== "media") walk(v, childParent);
  };
  walk((audit as any)?.template ?? audit, null);
  if (!hits.length) return { onForm: false, areas: [] };
  const areas: InstallDayRulerArea[] = [];
  if (hits.every((h) => h.parent != null)) {
    const order: string[] = [];
    for (const h of hits) if (!order.includes(h.parent!)) order.push(h.parent!);
    for (const p of order) {
      const own = hits.filter((h) => h.parent === p);
      areas.push({ existing: own.filter((h) => h.which === "existing").flatMap((h) => h.media), after: own.filter((h) => h.which === "after").flatMap((h) => h.media) });
    }
  } else {
    const ex = hits.filter((h) => h.which === "existing"), nw = hits.filter((h) => h.which === "after");
    for (let i = 0; i < Math.max(ex.length, nw.length); i++) areas.push({ existing: ex[i]?.media ?? [], after: nw[i]?.media ?? [] });
  }
  return { onForm: true, areas };
}
/** Decision 396: ruler questions the template does not carry yet (exact wording). Advisory — see INSTALL_DAY_RULER_Q. */
export function installDayRulerMissingQuestions(template: unknown): string[] {
  const items = labelledItems(template);
  return Object.values(INSTALL_DAY_RULER_Q).filter((l) => !allWithLabel(items, l).length);
}

export type InstallDayType = "text" | "number" | "date" | "yes_no" | "pick_one" | "photo" | "video" | "checkbox" | "signature";
export type InstallDayPrefillKey = "jobNumber" | "address" | "installDate" | "apName" | "businessName" | "leadName" | "leadCii" | "anyoneElse" | "secondName" | "secondCii" | "thirdOnSite" | "thirdName" | "thirdCii" | "lifeSupport" | "solarPresent" | "electricianAtStart";
/** Decision 301: who turned the power back on — a pick, mapped to the pre-filled crew, never free text. */
export const INSTALL_DAY_LOCKOUT_BY_OPTIONS = ["Lead installer", "Second installer", "Third installer", "The electrician"] as const;
export type InstallDayQuestion = {
  n: number; label: string; type: InstallDayType; required: boolean; group: number;
  options?: readonly string[]; help?: string;
  /** Only show when question `n` has one of these answers. */
  showWhen?: { n: number; is: readonly string[] };
  stop?: { when: "Yes" | "No"; text: string };
  prefill?: InstallDayPrefillKey;
  /** Several files allowed. */
  multiple?: boolean;
};

const Q = INSTALL_DAY_Q;
/** Every question in form order (Q1–48; Q34 and Q37 are text items). */
export const INSTALL_DAY_QUESTIONS: readonly InstallDayQuestion[] = (() => {
  const out: InstallDayQuestion[] = [];
  let n = 0;
  const q = (group: number, label: string, type: InstallDayType, required: boolean, x: Partial<InstallDayQuestion> = {}) => { n++; out.push({ n, label, type, required, group, ...x }); return n; };
  q(1, Q.jobNumber, "text", true, { prefill: "jobNumber" });
  q(1, Q.address, "text", true, { prefill: "address" });
  q(1, Q.installDate, "date", true, { prefill: "installDate" });
  q(1, Q.ap, "text", true, { prefill: "apName" });
  q(2, Q.business, "text", true, { prefill: "businessName" });
  q(2, Q.lead, "text", true, { prefill: "leadName" });
  q(2, Q.leadCii, "text", true, { prefill: "leadCii" });
  q(2, Q.leadPhoto, "photo", true, { help: "Photo ID readable." });
  const anyone = q(2, Q.anyoneElse, "yes_no", true, { prefill: "anyoneElse" });
  q(2, Q.second, "text", true, { showWhen: { n: anyone, is: ["Yes"] }, prefill: "secondName" });
  q(2, Q.secondCii, "text", true, { showWhen: { n: anyone, is: ["Yes"] }, prefill: "secondCii" });
  q(2, Q.secondPhoto, "photo", true, { showWhen: { n: anyone, is: ["Yes"] }, help: "Photo ID readable." });
  const third = q(2, Q.third3, "yes_no", true, { showWhen: { n: anyone, is: ["Yes"] }, prefill: "thirdOnSite" });
  q(2, Q.third, "text", true, { showWhen: { n: third, is: ["Yes"] }, prefill: "thirdName" });
  q(2, Q.thirdCii, "text", true, { showWhen: { n: third, is: ["Yes"] }, prefill: "thirdCii" });
  q(2, Q.thirdPhoto, "photo", true, { showWhen: { n: third, is: ["Yes"] }, help: "Photo ID readable." });
  q(3, Q.powerInformed, "yes_no", true, { stop: { when: "No", text: "Stop. Tell them before you go on." } });
  const ls = q(3, Q.lifeSupport, "yes_no", true, { prefill: "lifeSupport" });
  const lsc = q(3, Q.lifeSupportConsent, "yes_no", true, { showWhen: { n: ls, is: ["Yes"] }, stop: { when: "No", text: "Stop. You need it before starting." } });
  q(3, Q.lifeSupportUpload, "photo", true, { showWhen: { n: lsc, is: ["Yes"] }, help: "Every page readable." });
  q(3, Q.swmsSigned, "yes_no", true, { help: "It's on your job page.", stop: { when: "No", text: "Stop. Sign it on your job page first." } });
  q(3, Q.hazardsCovered, "yes_no", true, { stop: { when: "No", text: "Stop." } });
  const solar = q(4, Q.solar, "yes_no", true, { prefill: "solarPresent" });
  q(4, Q.solarInstructions, "yes_no", true, { showWhen: { n: solar, is: ["Yes"] }, stop: { when: "No", text: "Stop. An electrician must isolate it." } });
  q(4, Q.solarIsolator, "yes_no", true, { showWhen: { n: solar, is: ["Yes"] }, stop: { when: "No", text: "Stop. Get an electrician to check it." } });
  // Jo 25 Oct 2026: isolation comes AFTER the solar question so the solar/battery step reads in order.
  q(4, Q.isolated, "yes_no", true, { stop: { when: "No", text: "Stop. Isolate, lock out and tag first." } });
  q(4, Q.isolationPhoto, "photo", true, { help: "If there's solar, a battery or a generator, it must be off too." });
  q(5, Q.piesaRead, "yes_no", true, { stop: { when: "No", text: "Stop." } });
  const needed = q(5, Q.electricianNeeded, "yes_no", true, { prefill: "electricianAtStart" });
  const here = q(5, Q.electricianHere, "yes_no", true, { showWhen: { n: needed, is: ["Yes"] }, stop: { when: "No", text: "Stop. Wait for the electrician." } });
  q(5, Q.electricianPhoto, "photo", true, { showWhen: { n: here, is: ["Yes"] } });
  q(5, Q.ceilingEntered, "yes_no", true, { help: "Ask the owner.", stop: { when: "Yes", text: "Stop. An electrician must check again." } });
  q(6, Q.productPhotos, "photo", true, { help: "One per product." });
  n++; // Q34: the official declaration text items (copied from the old template), not a question
  q(7, Q.declaration, "checkbox", true);
  q(7, Q.signature, "signature", true);
  n++; // Q37: "STOP. You are only halfway…" text item (decision 328), not a question
  q(8, Q.afterVideos, "video", true, { multiple: true });
  q(8, Q.depthPhotos, "photo", true, { multiple: true, help: "Don't squash it." });
  const md = q(8, Q.multiDay, "yes_no", true);
  q(8, Q.dailyRecheck, "checkbox", true, { showWhen: { n: md, is: ["Yes"] } });
  const lo = q(9, Q.lockoutOff, "yes_no", true, { stop: { when: "No", text: "Don't leave until it is." } });
  q(9, Q.lockoutBy, "pick_one", true, { showWhen: { n: lo, is: ["Yes"] }, options: INSTALL_DAY_LOCKOUT_BY_OPTIONS });
  q(9, Q.switchboardOn, "photo", true, { showWhen: { n: lo, is: ["Yes"] } });
  q(9, Q.solarBack, "pick_one", true, { options: INSTALL_DAY_SOLAR_BACK_OPTIONS });
  q(9, Q.supervised, "checkbox", true);
  q(9, Q.allFilledIn, "checkbox", true); // decision 328
  q(9, Q.signature, "signature", true);
  return out;
})();

// ======================================================================================================
// Reading an audit / template by label (shared with install-evidence.core)
// ======================================================================================================
/** First line of a Mitti label, normalised (Mitti appends help text after a line break). */
export const labelKey = (label: unknown) => norm(String(label ?? "").split("\n")[0]);
export type ReadSignature = { present: boolean; name: string | null; signedAt: string | null; mediaId: string | null };
export type Labelled = { id: string | null; label: string; value: string | null; values: string[]; media: MittiMediaFile[]; signature: ReadSignature };
export const NO_SIGNATURE: ReadSignature = { present: false, name: null, signedAt: null, mediaId: null };

export function signatureOf(r: Record<string, any>): ReadSignature {
  const m = r["image"] ?? r["media"] ?? r["media_id"] ?? r["signature"];
  const pick = (x: any): string | null => typeof x === "string" ? (/^[0-9a-f-]{16,}$/i.test(x.trim()) || /^https:\/\//.test(x.trim()) ? x.trim() : null) : x && typeof x === "object" ? pick(Array.isArray(x) ? x[0] : (x.media_id ?? x.id ?? x.href)) : null;
  const mediaId = pick(m);
  const captured = m && typeof m === "object" && !Array.isArray(m) ? m : {};
  const ts = [r["timestamp"], r["signed_at"], r["datetime"], captured.timestamp, captured.signed_at, captured.metadata?.signed_at].find((t) => typeof t === "string" && !Number.isNaN(Date.parse(t))) as string | undefined;
  const name = r["name"] ?? captured.name ?? captured.metadata?.signer_name;
  return { present: !!mediaId, name: typeof name === "string" && name.trim() ? name.trim() : null, signedAt: ts ?? null, mediaId };
}
/** Every labelled item in form order with its answer, ticked options, media and signature. */
export function labelledItems(doc: unknown): Labelled[] {
  const out: Labelled[] = [];
  const walk = (x: unknown) => {
    if (Array.isArray(x)) { x.forEach(walk); return; }
    if (!x || typeof x !== "object") return;
    const o = x as Record<string, any>;
    if (typeof o["label"] === "string") {
      const r = (o["responses"] ?? {}) as Record<string, any>;
      const selected: string[] = Array.isArray(r["selected"]) ? r["selected"].map((s: any) => String(s?.label ?? s)) : [];
      const sel = selected.length ? selected.join(", ") : null;
      const txt = [sel, r["text"], r["value"], r["number"], r["numeric"], r["datetime"], r["date"], o["value"]].map((v) => (typeof v === "number" ? String(v) : v)).find((v) => typeof v === "string" && v.trim()) as string | undefined;
      const ticked = r["value"] === true || r["checked"] === true ? "Yes" : null;
      const media = o["media"] ?? r["media"] ?? r["attachments"] ?? [];
      const id = o["item_id"] ?? o["id"];
      out.push({ id: id == null ? null : String(id), label: o["label"], value: txt ?? ticked ?? null, values: selected, media: Array.isArray(media) ? media.map(mittiMediaFile) : [], signature: signatureOf(r) });
    }
    for (const v of Object.values(o)) if (v && typeof v === "object") walk(v);
  };
  walk((doc as any)?.template ?? doc);
  return out;
}
/** Items with this exact first-line label, in form order. */
export const allWithLabel = (items: Labelled[], label: string) => items.filter((i) => labelKey(i.label) === labelKey(label));

/** Is this template / audit the "A5 – Install day" form? (Two labels no other form carries.) */
export function isInstallDayDoc(doc: unknown): boolean {
  const items = labelledItems(doc);
  return allWithLabel(items, Q.declaration).length > 0 && allWithLabel(items, Q.afterVideos).length > 0;
}
/** Question labels the template does not carry (exact wording; "Lead installer's signature" twice). Empty = built. */
export function installDayMissingQuestions(template: unknown): string[] {
  const items = labelledItems(template);
  const out: string[] = [];
  const seen = new Map<string, number>();
  for (const q of INSTALL_DAY_QUESTIONS) {
    const k = labelKey(q.label);
    const want = (seen.get(k) ?? 0) + 1;
    seen.set(k, want);
    if (allWithLabel(items, q.label).length < want) out.push(want > 1 ? `${q.label} (Q${q.n})` : q.label);
  }
  return out;
}

const yesNo = (v: string | null | undefined): "Yes" | "No" | null => (v == null ? null : /^\s*yes\b/i.test(v) ? "Yes" : /^\s*no\b/i.test(v) ? "No" : null);

export type InstallDayRead = {
  text: (label: string) => string | null; yn: (label: string) => "Yes" | "No" | null; ticked: (label: string) => boolean;
  media: (label: string) => MittiMediaFile[];
  /** Q36 (before work) and Q48 (after install): the 1st and 2nd "Lead installer's signature". */
  declarationSignature: ReadSignature; completionSignature: ReadSignature;
};
export function readInstallDay(audit: unknown): InstallDayRead {
  const items = labelledItems(audit);
  const one = (label: string) => allWithLabel(items, label)[0];
  const text = (label: string) => { const v = one(label)?.value; return v && v.trim() ? v.trim() : null; };
  const sigs = allWithLabel(items, Q.signature);
  return {
    text, yn: (l) => yesNo(text(l)), ticked: (l) => !!one(l)?.value, media: (l) => one(l)?.media ?? [],
    declarationSignature: sigs[0]?.signature ?? NO_SIGNATURE, completionSignature: sigs[1]?.signature ?? NO_SIGNATURE,
  };
}

// ======================================================================================================
// Install day answers -> official PIISA answers
// ======================================================================================================
export type InstallDayOfficial = {
  answers: Record<string, string | string[]>;
  /** Crew rows as typed: index 0 lead, 1 second, 2 third (null = not on site). */
  crew: ({ name: string | null; cii: string | null } | null)[];
};
/** Q27 + Q28 -> official p5.electricianPresent: not needed = N/A; needed and here = Yes; needed and not here = No. */
export function electricianPresentAnswer(needed: "Yes" | "No" | null, here: "Yes" | "No" | null): "Yes" | "No" | "N/A" | null {
  if (needed === "No") return "N/A";
  if (needed === "Yes") return here;
  return null;
}
export function installDayOfficialAnswers(audit: unknown): InstallDayOfficial {
  const r = readInstallDay(audit);
  const a: Record<string, string | string[]> = {};
  const put = (id: string, v: string | string[] | null | undefined) => { if (v != null && (!Array.isArray(v) || v.length)) a[id] = v; };
  put("jobRef", r.text(Q.jobNumber));
  put("address", r.text(Q.address));
  put("startDate", r.text(Q.installDate)); put("p2.installDate", r.text(Q.installDate));
  put("p2.ap", r.text(Q.ap));
  put("p2.company", r.text(Q.business));
  put("p1.powerInformed", r.yn(Q.powerInformed));
  put("lifeSupport", r.yn(Q.lifeSupport));
  put("lifeSupportConsent", r.yn(Q.lifeSupportConsent));
  put("p3.swms", r.yn(Q.swmsSigned));
  put("p3.table1", r.yn(Q.hazardsCovered));
  put("p3.isolated", r.yn(Q.isolated));
  put("p4.present", r.yn(Q.solar));
  put("p4.instructions", r.yn(Q.solarInstructions));
  put("p4.isolator", r.yn(Q.solarIsolator));
  put("p5.reviewed", r.yn(Q.piesaRead));
  put("p5.electricianPresent", electricianPresentAnswer(r.yn(Q.electricianNeeded), r.yn(Q.electricianHere)));
  // Q30 asks the opposite of the official item: "anyone in the ceiling since the PIESA?" Yes = official No.
  const entered = r.yn(Q.ceilingEntered);
  put("p5.noAccess", entered === "Yes" ? "No" : entered === "No" ? "Yes" : null);
  // Q35 is this form's Part 8 declaration tick (under the official declaration text, Q34). Night test run 25 Oct 2026: it
  // was never mapped, so every completed Install day form failed the official PIISA "Required … must be ticked" rule and
  // the installation could not be recorded. Unticked stays blank (never assumed).
  put("p8.declaration", r.ticked(Q.declaration) ? "Yes" : null);
  const row =(name: string | null, cii: string | null) => (name || cii ? { name, cii } : null);
  const second = r.yn(Q.anyoneElse) === "Yes" ? row(r.text(Q.second), r.text(Q.secondCii)) : null;
  const third = r.yn(Q.anyoneElse) === "Yes" && r.yn(Q.third3) === "Yes" ? row(r.text(Q.third), r.text(Q.thirdCii)) : null;
  return { answers: a, crew: [row(r.text(Q.lead), r.text(Q.leadCii)), second, third] };
}

/** The A5 photo items of this form by the A5 evidence keys, plus the two after-install multi-file items (decisions 263/264). */
export function installDayMedia(audit: unknown): { installer_photos: MittiMediaFile[]; electrician_photo: MittiMediaFile[]; isolation_photo: MittiMediaFile[]; product_photos: MittiMediaFile[]; life_support: MittiMediaFile[]; after_videos: MittiMediaFile[]; depth_photos: MittiMediaFile[] } {
  const r = readInstallDay(audit);
  return { installer_photos: [...r.media(Q.leadPhoto), ...r.media(Q.secondPhoto), ...r.media(Q.thirdPhoto)], electrician_photo: r.media(Q.electricianPhoto), isolation_photo: r.media(Q.isolationPhoto), product_photos: r.media(Q.productPhotos), life_support: r.media(Q.lifeSupportUpload), after_videos: r.media(Q.afterVideos), depth_photos: r.media(Q.depthPhotos) };
}

// ======================================================================================================
// Official Part 5 light / cable / downlight answers from the stored PIESA (not asked on this form)
// ======================================================================================================
const B1_NO_FIXES = "Electrical rectification work is not required before insulation is installed or upgraded.";
const B1_FIXES = "Electrical rectification work is required before insulation is installed or upgraded.";
const isTicked = (v: unknown) => v === true || (typeof v === "string" && /^(yes|true|ticked|x|✓)$/i.test(v.trim())) || (Array.isArray(v) && v.length > 0);
/**
 * Official PIISA p5.recessed / p5.count / p5.icConfirmed / p5.safeToCover / p5.rcd / p5.tps / p5.basic from the job's
 * signed PIESA answers (decision 262). Source per answer:
 *  - recessed lights + count: PIESA Part 6 (p6.recessed, p6.count);
 *  - A48 batch 1 task 3 (Jo 29 Oct 2026): lights (IC / IC-4, safe to cover), RCD, TPS and basic protection are "Yes" only
 *    when the PIESA really confirms them: the matching Part 4-6 answers are all clear (lights: Part 6; TPS: Part 5 + Part 4
 *    TPS; basic protection: Part 4 terminations + plug bases; RCD: all of Parts 4-6), OR the PIESA's Section C is signed
 *    (`sectionCSigned`) and ticks that item (c.tick2 lights, c.tick3 RCD, c.tick4 TPS, c.tick5 basic protection). B1 "not
 *    required" / "not possible" alone confirms nothing. Otherwise the item is left blank for the installer (a No stops the job).
 *  - decision 362: when B1 is "rectification is not possible … an electrician must be present at the start" (option 3,
 *    decision 338), p5.electricianPresent is Yes only from this form's "Is the electrician here?" = Yes WITH the electrician
 *    photo (`installDay`), otherwise it stays missing.
 * Anything not established is listed in `missing` (a pre-start blocker), never guessed.
 */
export const ELECTRICIAN_AT_START_MISSING = "PIESA needs an electrician at the start: \"Is the electrician here?\" is not Yes with the electrician's photo";
export function piesaPart5Answers(piesa: Record<string, unknown> | null | undefined, installDay?: { electricianHere: "Yes" | "No" | null; electricianPhoto: boolean } | null): { answers: Record<string, string>; missing: string[] } {
  const answers: Record<string, string> = {}, missing: string[] = [];
  if (!piesa) return { answers, missing: ["No signed PIESA on this job — the light and cable answers can't be filled in"] };
  const s = (k: string) => (typeof piesa[k] === "string" ? String(piesa[k]).trim() : "");
  const recessed = yesNo(s("p6.recessed"));
  if (recessed) answers["p5.recessed"] = recessed; else missing.push("PIESA Part 6: recessed lights not answered");
  if (recessed === "Yes") { if (s("p6.count")) answers["p5.count"] = s("p6.count"); else missing.push("PIESA Part 6: number of recessed lights not recorded"); }
  const b1 = s("b1");
  // A48 batch 1 task 3: an item is "Yes" only when the electrician's PIESA really confirms it — the matching Part 4-6 answers
  // are all clear, OR a signed Section C (sectionCSigned) ticks that item. Never because B1 says "not required"/"not possible".
  // Anything else stays blank for the installer to answer (a No stops the job: P5-CANNOT-COMMENCE).
  const is = (k: string, v: "yes" | "no") => yesNo(s(k))?.toLowerCase() === v;
  const lightsClear = is("p6.recessed", "no") || (is("p6.recessed", "yes") && is("p6.prohibited", "no"));
  const tpsClear = ["p5.nonTps", "p5.splitConduit", "p5.damaged"].every((k) => is(k, "no")) && (is("p4.tps", "yes") || /^n\/?a\b/i.test(s("p4.tps")));
  const basicClear = ["p4.terminations", "p4.plugBases"].every((k) => is(k, "yes"));
  // No Part 4-6 question is about safety switches alone, so RCD protection needs the whole of Parts 4-6 to be clear.
  const allClear = lightsClear && tpsClear && basicClear && ["p4.conduit", "p4.supported", "p4.treatment", "p4.foil"].every((k) => is(k, "yes"));
  const sectionC = sectionCSigned(piesa as OfficialAnswers);
  const ticks: [string, string, boolean][] = [["p5.icConfirmed", "c.tick2", lightsClear], ["p5.safeToCover", "c.tick2", lightsClear], ["p5.rcd", "c.tick3", allClear], ["p5.tps", "c.tick4", tpsClear], ["p5.basic", "c.tick5", basicClear]];
  const known = b1 === B1_NO_FIXES || b1 === B1_FIXES || b1 === B1_OPTIONS[2];
  if (known) for (const [id, c, clear] of ticks) if (clear || (sectionC && isTicked(piesa[c]))) answers[id] = "Yes";
  if (b1 === B1_OPTIONS[2]) {
    if (installDay?.electricianHere === "Yes" && installDay.electricianPhoto) answers["p5.electricianPresent"] = "Yes";
    else missing.push(ELECTRICIAN_AT_START_MISSING);
  }
  else if (!known) missing.push(b1 ? "PIESA outcome not recognised — the light and cable confirmations need office review" : "PIESA outcome (B1) not recorded");
  return { answers, missing: [...new Set(missing)] };
}

// ======================================================================================================
// Prefill ("portal fills this in")
// ======================================================================================================
export type InstallDayPrefillFacts = {
  jobNumber: string | null; address: string | null; installDate: string | null; apName: string | null; businessName: string | null;
  leadName: string | null; leadCii: string | null;
  /** Decision 299: the rest of the crew from the portal booking; null = not on site / unknown. */
  secondName?: string | null; secondCii?: string | null; thirdName?: string | null; thirdCii?: string | null;
  lifeSupport: boolean | null; solarPresent: boolean | null; electricianAtStart: boolean | null;
};
type PrefillItem = { item_id: string; type: string; responses: Record<string, unknown> };
/**
 * Decision 338 (Jo 25 Oct 2026): Q29 "Does the PIESA need an electrician here at the start?" comes from the A3 question
 * "Does an electrician need to be on site at the start of the install?" (Yes → Yes, No → No) when the stored A3 answered it;
 * an old form falls back to its decision-314 tick, then to the signed PIESA's B1 outcome (third option = Yes) as before.
 * `a4Short` = shortAnswersFromEntries("piesa", stored A3 snapshot); `b1` = the signed official PIESA's B1 answer.
 */
export function electricianAtStartPrefill(i: { a4Short: Record<string, unknown> | null | undefined; b1: string | null | undefined }): boolean {
  const q = String(i.a4Short?.["onsiteStartNeeded"] ?? "").trim();
  if (/^yes\b/i.test(q)) return true;
  if (/^no\b/i.test(q)) return false;
  if (i.a4Short && onsiteStartTicked(i.a4Short)) return true;
  return i.b1 === B1_OPTIONS[2];
}
/**
 * Night run 25 Oct 2026 (A1 route): the A5 did not carry life support / solar from the PIESA (A3). Q18 and Q23 now come
 * from the PIESA first — the signed official PIESA answers (`lifeSupport`, `p3.present`), else the stored A3 short answers
 * (`lifeSupportPresent`, `solarPresent`) — and the owner's enquiry declaration only for life support when the PIESA has
 * nothing. Safety first for life support: any source saying Yes pre-fills Yes. Unknown stays blank (the installer answers).
 */
export function installDayPiesaFacts(i: { piesaAnswers: Record<string, unknown> | null | undefined; a3Short: Record<string, unknown> | null | undefined; lifeSupportDeclared: "yes" | "no" | "unknown" | null | undefined }): { lifeSupport: boolean | null; solarPresent: boolean | null } {
  const yn = (v: unknown): boolean | null => { const s = String(Array.isArray(v) ? v[0] ?? "" : v ?? "").trim(); return /^yes\b/i.test(s) ? true : /^no\b/i.test(s) ? false : null; };
  const ls = [yn(i.piesaAnswers?.["lifeSupport"]), yn(i.a3Short?.["lifeSupportPresent"]), i.lifeSupportDeclared === "yes" ? true : i.lifeSupportDeclared === "no" ? false : null];
  const lifeSupport = ls.includes(true) ? true : ls.find((x) => x === false) ?? null;
  const solarPresent = yn(i.piesaAnswers?.["p3.present"]) ?? yn(i.a3Short?.["solarPresent"]);
  return { lifeSupport, solarPresent };
}
/** Prefill items for the template's own item IDs, matched by exact wording. Choice answers use the template's own option
 *  ids (never guessed); a value with no matching option, or a question the template lacks, is skipped. */
export function installDayPrefillItems(template: unknown, f: InstallDayPrefillFacts, choiceOption: (template: unknown, itemId: string, label: string) => { id: string; label: string } | null): PrefillItem[] {
  const items = labelledItems(template);
  const out: PrefillItem[] = [];
  const yn = (b: boolean | null) => (b == null ? null : b ? "Yes" : "No");
  for (const q of INSTALL_DAY_QUESTIONS) {
    if (!q.prefill) continue;
    const raw: string | null = (() => {
      switch (q.prefill) {
        case "jobNumber": return f.jobNumber; case "address": return f.address; case "installDate": return f.installDate; case "apName": return f.apName;
        case "businessName": return f.businessName; case "leadName": return f.leadName; case "leadCii": return f.leadCii;
        case "anyoneElse": return f.secondName || f.thirdName ? "Yes" : f.secondName === null ? "No" : null;
        case "secondName": return f.secondName ?? null; case "secondCii": return f.secondCii ?? null;
        case "thirdOnSite": return f.thirdName ? "Yes" : f.secondName || f.secondName === null ? "No" : null;
        case "thirdName": return f.thirdName ?? null; case "thirdCii": return f.thirdCii ?? null;
        case "lifeSupport": return yn(f.lifeSupport); case "solarPresent": return yn(f.solarPresent); case "electricianAtStart": return yn(f.electricianAtStart);
      }
    })();
    if (raw == null || !String(raw).trim()) continue;
    const it = allWithLabel(items, q.label)[0];
    if (!it?.id) continue;
    if (q.type === "yes_no" || q.type === "pick_one") {
      const opt = choiceOption(template, it.id, raw);
      if (opt) out.push({ item_id: it.id, type: "question", responses: { selected: [opt] } });
    } else if (q.type === "date") out.push({ item_id: it.id, type: "datetime", responses: { datetime: raw } });
    else out.push({ item_id: it.id, type: "text", responses: { text: raw } });
  }
  return out;
}
