import { tapSaysThinOrLooseFill } from "./spot-saved-rank.core";
import { BUILD_DECADE_OPTIONS, buildDecadeOverFiveYears, type BuildDecade } from "./build-decade.core";
export const INSULATION_DETAIL_QUESTIONS = [
  { key: "insulation_type", label: "What type is it?", options: [{value:"loose_fill",label:"Loose fill (fluffy or crumbly)"},{value:"batts",label:"Batts (blanket strips)"},{value:"unknown",label:"Not sure"}] },
  { key: "insulation_thickness", label: "About how thick is it?", options: [{value:"thin",label:"Less than a finger's length"},{value:"hand",label:"About a hand's width"},{value:"thicker",label:"Thicker"},{value:"unknown",label:"Can't tell"}] },
  { key: "house_built_period", label: "When was your home built?", options: BUILD_DECADE_OPTIONS },
] as const;
export type InsulationTapAnswers = { insulation_type: "loose_fill"|"batts"|"unknown"; insulation_thickness: "thin"|"hand"|"thicker"|"unknown"; house_built_period: BuildDecade };
/** Preview saves only TEST enquiries; the published site saves real website owners (Jo 24 Oct "Fix the saving"). */
export function insulationDraftSaveAllowed(preview:boolean,source:string|null|undefined){return preview?source==='qa_test':source==='base44'||source==='qa_test';}
/** Jo 23 Oct 08:14 UTC: EVERYONE who answers (or uploads photos/video) gets Save my spot automatically —
 *  nobody is parked or sent to an office list first. The answers only choose the WORDING and the Spots saved
 *  RANK. Thin/patchy wording only for loose fill or "less than a finger"; everyone else gets the standard
 *  existing-insulation Save my spot wording (with the removal line). House age (1990 or earlier — Victoria's
 *  1991 minimum standards, Sustainability Victoria 2016) now only affects rank. */
export type InsulationTapRoute = "thin_patchy" | "existing_save_spot" | "ineligible";
export function insulationTapRoute(a: Pick<InsulationTapAnswers,"insulation_type"|"insulation_thickness"> & Partial<Pick<InsulationTapAnswers,"house_built_period">>, _hasPhotos = false): InsulationTapRoute {
  if (a.house_built_period === "last_5_years") return "ineligible";
  return tapSaysThinOrLooseFill(a) ? "thin_patchy" : "existing_save_spot";
}
/** Original website handoff stays immutable; newer declared answers are a separate provenance overlay. */
export function ownerInsulationAnswers(enrichment: Record<string,unknown>|null|undefined): Record<string,unknown> {
  const base = enrichment?.['base44'] as {raw?:{answers?:Record<string,unknown>}}|undefined;
  const newer = enrichment?.['owner_insulation_details'] as {answers?:Record<string,unknown>}|undefined;
  const answers = {...base?.raw?.answers,...newer?.answers};
  const period = newer?.answers?.["house_built_period"] as BuildDecade | undefined;
  return period ? {...answers, build_decade: period, property_over_five_years: buildDecadeOverFiveYears(period)} : answers;
}
export function savedInsulationTap(enrichment: Record<string,unknown>|null|undefined) {
  const saved=enrichment?.['owner_insulation_details'] as {answers?:InsulationTapAnswers;route?:string}|undefined;
  return saved?.answers ? {answers:saved.answers,route:saved.route??""} : null;
}