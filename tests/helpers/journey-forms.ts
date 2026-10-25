// Mitti forms as the trades fill them in, for the journey tests: the question wording is the portal's own constants
// (official-short.core / piesa-evidence.core), so the forms read exactly as the live templates are matched (by wording,
// decision 390). Photos carry a capture time and a location the way Mitti returns them (geotagged evidence, decision 178).
import {
  FIXES_DOWNLIGHT_COUNT_LABEL, FIXES_DOWNLIGHT_OPTION, FIXES_PRICE_LABEL, FIXES_WORK_LABEL, LIFE_SUPPORT_PRESENT, NO_PRICE_TALK_LABEL, ONSITE_START_LABEL,
} from "../../src/lib/official-short.core";
import { PIESA_EVIDENCE_BY_ID } from "../../src/lib/piesa-evidence.core";
import type { MittiItem } from "./journey-harness";
import { createHash } from "node:crypto";

/** A 1×1 PNG (signature / photo bytes the fake Mitti serves for media downloads). */
export const PNG_1X1 = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 0, 1, 0, 0, 5, 0, 1, 13, 10, 45, 180, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]);
/** Mitti media ids are uuid-like hex (the signature reader only accepts those): a stable one per name. */
export const mediaId = (name: string) => createHash("md5").update(name).digest("hex");
/** Frankston 3199, where the journey property is. */
export const SITE = { lat: -38.1446, lng: 145.1225 };

let seq = 0;
const id = (label: string) => `q_${label.replace(/\W+/g, "_").toLowerCase().slice(0, 40)}_${++seq}`;
export const text = (label: string, v: string): MittiItem => ({ item_id: id(label), label, type: "textsingle", responses: { text: v } });
export const pick = (label: string, ...labels: string[]): MittiItem => ({ item_id: id(label), label, type: "question", responses: { selected: labels.map((l) => ({ label: l })) } });
export const photo = (label: string, mediaIds: string[], capturedAt: string, where = SITE): MittiItem =>
  ({ item_id: id(label), label, type: "media", media: mediaIds.map((media_id) => ({ media_id, captured_at: capturedAt, location: { lat: where.lat, lng: where.lng }, date_created: capturedAt })) });

/** The template definition the fake Mitti returns for prefill: the same labels, no answers. */
export const templateOf = (items: MittiItem[]): { items: MittiItem[] } => ({ items: items.map(({ item_id, label, type }) => ({ item_id, label, ...(type ? { type } : {}) })) });

/** A Mitti signature answer the way the readers take it (responses.image = media id + its own timestamp). */
export const signature = (label: string, mediaId: string, at: string, name: string): MittiItem =>
  ({ item_id: id(label), label, type: "signature", responses: { image: { media_id: mediaId, timestamp: at }, name } });

/** The electrician's A4 "Electrical fixes" form (decision 293): all repair work done, CoES number + date + file, a geotagged
 *  photo of the finished work, signed. Question wording from fixes-day.core FIXES_DAY_Q. */
export function completedA4(o: { q: Record<string, string>; coesNumber: string; certDate: string; capturedAt: string; mediaPrefix: string; electrician: string }): { items: MittiItem[]; mediaIds: string[] } {
  const m = (n: string) => mediaId(`${o.mediaPrefix}-${n}`);
  const items: MittiItem[] = [
    pick(o.q["done"]!, "Yes"),
    text(o.q["coesNumber"]!, o.coesNumber),
    text(o.q["certDate"]!, o.certDate),
    photo(o.q["coesFile"]!, [m("coes")], o.capturedAt),
    photo(o.q["workPhoto"]!, [m("work")], o.capturedAt),
    signature(o.q["signature"]!, m("signature"), o.capturedAt, o.electrician),
  ];
  return { items, mediaIds: ["coes", "work", "signature"].map(m) };
}

/** The electrician's A3 PIESA (decisions 178/295/305/308/323/324/336/338): mains, solar and wiring safe; six downlights
 *  that are NOT IC rated → repair work needed, NOT fixed on the same visit, no electrician needed at the install start;
 *  one total price for replacing the six downlights. Evidence: switchboard + on-site photos and one hazard photo,
 *  geotagged; electrician signature image. */
export function completedA3(o: { inspectionDate: string; capturedAt: string; priceIncGst: number; mediaPrefix: string }): { items: MittiItem[]; mediaIds: string[] } {
  const m = (n: string) => mediaId(`${o.mediaPrefix}-${n}`);
  const items: MittiItem[] = [
    pick(NO_PRICE_TALK_LABEL, "Yes"),
    text("Date of inspection", o.inspectionDate),
    pick(LIFE_SUPPORT_PRESENT, "No"),
    pick("Is the mains power set-up safe? This means the mains cable in the ceiling is identified and marked, the main switch works and can be locked off, the ceiling is confirmed dead when the switch is off, and safety switches (RCDs) are fitted and tested.", "Yes"),
    pick("Is there solar, a battery or a generator at the property?", "No"),
    pick("Are the cables, connections and fittings in the ceiling safe to work around and cover with insulation?", "Yes"),
    pick("Are there any downlights or other recessed lights in the ceiling?", "Yes"),
    text("How many are there?", "6"),
    pick("Are any of them not IC or IC-4 rated?", "Yes"),
    text("How many are not IC or IC-4 rated?", "6"),
    photo(PIESA_EVIDENCE_BY_ID.hazard_photos.label, [m("hazard")], o.capturedAt),
    pick("Are there any appliances, exhaust fans, flues or other hazards in the ceiling space?", "No"),
    pick("Is any electrical repair work needed before insulation can be installed?", "Yes"),
    pick(FIXES_WORK_LABEL, FIXES_DOWNLIGHT_OPTION),
    text(FIXES_DOWNLIGHT_COUNT_LABEL, "6"),
    pick(ONSITE_START_LABEL, "No"),
    text(FIXES_PRICE_LABEL, String(o.priceIncGst)),
    photo(PIESA_EVIDENCE_BY_ID.switchboard_photo.label, [m("switchboard")], o.capturedAt),
    photo(PIESA_EVIDENCE_BY_ID.onsite_photo.label, [m("onsite")], o.capturedAt),
    pick("I declare that all information contained in and attached to this form is correct and not misleading by inclusion or omission", "Yes"),
    signature("Electrician signature", m("signature"), o.capturedAt, "Eddie Electrician"),
  ];
  return { items, mediaIds: ["hazard", "switchboard", "onsite", "signature"].map(m) };
}

/** The "A5 – Install day" template as Mitti serves it (decision 262): every question in the portal's wording
 *  (install-day.core INSTALL_DAY_QUESTIONS), Yes/No and pick-one questions with their response sets so the prefill
 *  can choose real option ids. */
export function installDayTemplate(questions: readonly { n: number; label: string; type: string; options?: readonly string[] }[]): { items: MittiItem[]; response_sets: { id: string; responses: { id: string; label: string }[] }[] } {
  const kind: Record<string, string> = { yes_no: "question", pick_one: "question", photo: "media", video: "media", signature: "signature", date: "datetime", number: "textsingle", text: "textsingle", checkbox: "checkbox" };
  const response_sets: { id: string; responses: { id: string; label: string }[] }[] = [];
  const items = questions.map((q) => {
    const item_id = `a5_${q.n}`;
    const opts = q.type === "yes_no" ? (q.options ?? ["Yes", "No"]) : q.type === "pick_one" ? (q.options ?? []) : null;
    if (opts) response_sets.push({ id: `rs_${q.n}`, responses: opts.map((label, i) => ({ id: `rs_${q.n}_${i}`, label })) });
    return { item_id, id: item_id, label: q.label, type: kind[q.type] ?? "textsingle", ...(opts ? { question: { response_set_id: `rs_${q.n}` } } : {}) } as MittiItem;
  });
  return { items, response_sets };
}

const ticked = (label: string): MittiItem => ({ item_id: id(label), label, type: "checkbox", responses: { value: true } });

/** The lead installer's "A5 – Install day" answers (decisions 262/263/264/300/328), alone on site, no solar, no life
 *  support, no electrician needed at the start: ID photo, isolation photo, product label photo, the declaration signed
 *  before work, one after video and one depth photo per Ready Check area, power back on, the final "All filled in" tick
 *  and the closing signature. Wording from install-day.core INSTALL_DAY_Q. */
export function completedA5(o: { q: Record<string, string>; capturedAt: string; mediaPrefix: string; lead: string; areas: number }): { items: MittiItem[]; mediaIds: string[]; videoIds: string[] } {
  const m = (n: string) => mediaId(`${o.mediaPrefix}-${n}`);
  const q = o.q;
  const videos = Array.from({ length: o.areas }, (_, i) => m(`after-video-${i + 1}`));
  const depth = Array.from({ length: o.areas }, (_, i) => m(`depth-${i + 1}`));
  const items: MittiItem[] = [
    photo(q["leadPhoto"]!, [m("lead-id")], o.capturedAt),
    pick(q["powerInformed"]!, "Yes"),
    pick(q["lifeSupport"]!, "No"),
    pick(q["swmsSigned"]!, "Yes"),
    pick(q["hazardsCovered"]!, "Yes"),
    pick(q["solar"]!, "No"),
    pick(q["isolated"]!, "Yes"),
    photo(q["isolationPhoto"]!, [m("isolation")], o.capturedAt),
    pick(q["piesaRead"]!, "Yes"),
    pick(q["ceilingEntered"]!, "No"),
    photo(q["productPhotos"]!, [m("product")], o.capturedAt),
    ticked(q["declaration"]!),
    signature(q["signature"]!, m("signature-start"), o.capturedAt, o.lead),
    photo(q["afterVideos"]!, videos, o.capturedAt),
    photo(q["depthPhotos"]!, depth, o.capturedAt),
    pick(q["multiDay"]!, "No"),
    pick(q["lockoutOff"]!, "Yes"),
    pick(q["lockoutBy"]!, "Lead installer"),
    photo(q["switchboardOn"]!, [m("switchboard-on")], o.capturedAt),
    pick(q["solarBack"]!, "There isn't one"),
    ticked(q["supervised"]!),
    ticked(q["allFilledIn"]!),
    signature(q["signature"]!, m("signature-end"), o.capturedAt, o.lead),
  ];
  const photos = ["lead-id", "isolation", "product", "signature-start", "switchboard-on", "signature-end"].map(m).concat(depth);
  return { items, mediaIds: photos, videoIds: videos };
}

/** The electrician's A3 PIESA with NO repair work: mains, solar and wiring safe, no downlights, no hazards → "Is any
 *  electrical repair work needed …?" = No. Evidence: switchboard + on-site photos, geotagged; signature image. */
export function completedA3Pass(o: { inspectionDate: string; capturedAt: string; mediaPrefix: string }): { items: MittiItem[]; mediaIds: string[] } {
  const m = (n: string) => mediaId(`${o.mediaPrefix}-${n}`);
  const items: MittiItem[] = [
    pick(NO_PRICE_TALK_LABEL, "Yes"),
    text("Date of inspection", o.inspectionDate),
    pick(LIFE_SUPPORT_PRESENT, "No"),
    pick("Is the mains power set-up safe? This means the mains cable in the ceiling is identified and marked, the main switch works and can be locked off, the ceiling is confirmed dead when the switch is off, and safety switches (RCDs) are fitted and tested.", "Yes"),
    pick("Is there solar, a battery or a generator at the property?", "No"),
    pick("Are the cables, connections and fittings in the ceiling safe to work around and cover with insulation?", "Yes"),
    pick("Are there any downlights or other recessed lights in the ceiling?", "No"),
    pick("Are there any appliances, exhaust fans, flues or other hazards in the ceiling space?", "No"),
    pick("Is any electrical repair work needed before insulation can be installed?", "No"),
    photo(PIESA_EVIDENCE_BY_ID.switchboard_photo.label, [m("switchboard")], o.capturedAt),
    photo(PIESA_EVIDENCE_BY_ID.onsite_photo.label, [m("onsite")], o.capturedAt),
    pick("I declare that all information contained in and attached to this form is correct and not misleading by inclusion or omission", "Yes"),
    signature("Electrician signature", m("signature"), o.capturedAt, "Eddie Electrician"),
  ];
  return { items, mediaIds: ["switchboard", "onsite", "signature"].map(m) };
}
