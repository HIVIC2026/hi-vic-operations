export const INSULATION_DETAIL_QUESTIONS = [
  { key: "insulation_type", label: "What type is it?", options: [{value:"loose_fill",label:"Loose fill (fluffy or crumbly)"},{value:"batts",label:"Batts (blanket strips)"},{value:"unknown",label:"Not sure"}] },
  { key: "insulation_thickness", label: "About how thick is it?", options: [{value:"thin",label:"Less than a finger's length"},{value:"hand",label:"About a hand's width"},{value:"thicker",label:"Thicker"},{value:"unknown",label:"Can't tell"}] },
  { key: "house_built_period", label: "When was the house built?", options: [{value:"1990_or_earlier",label:"1990 or earlier"},{value:"1991_1999",label:"1991–1999"},{value:"2000_2009",label:"2000–2009"},{value:"2010_or_later",label:"2010 or later"},{value:"unknown",label:"Not sure"}] },
] as const;
export type InsulationTapAnswers = { insulation_type: "loose_fill"|"batts"|"unknown"; insulation_thickness: "thin"|"hand"|"thicker"|"unknown"; house_built_period: "1990_or_earlier"|"1991_1999"|"2000_2009"|"2010_or_later"|"unknown" };
export function insulationDraftSaveAllowed(preview:boolean,source:string|null|undefined){return preview&&source==='qa_test';}
export function insulationTapRoute(a: Pick<InsulationTapAnswers,"insulation_type"|"insulation_thickness"> & Partial<Pick<InsulationTapAnswers,"house_built_period">>, hasPhotos = false): "thin_patchy"|"needs_onsite_assessment"|"photo_review" {
  // Jo-approved declared-age proxy: Victoria introduced mandatory minimum insulation standards
  // for new houses in 1991 (Sustainability Victoria 2016 report). Jo's 07:36 replacement:
  // 1990 or earlier overrides type, thickness AND uploaded photos; later/unknown retains photo review.
  if (a.house_built_period === "1990_or_earlier") return "thin_patchy";
  if (hasPhotos) return "photo_review";
  return a.insulation_type === "loose_fill" || a.insulation_thickness === "thin" ? "thin_patchy" : "needs_onsite_assessment";
}
/** Original website handoff stays immutable; newer declared answers are a separate provenance overlay. */
export function ownerInsulationAnswers(enrichment: Record<string,unknown>|null|undefined): Record<string,unknown> {
  const base = enrichment?.['base44'] as {raw?:{answers?:Record<string,unknown>}}|undefined;
  const newer = enrichment?.['owner_insulation_details'] as {answers?:Record<string,unknown>}|undefined;
  return {...base?.raw?.answers,...newer?.answers};
}
export function savedInsulationTap(enrichment: Record<string,unknown>|null|undefined) {
  const saved=enrichment?.['owner_insulation_details'] as {answers?:InsulationTapAnswers;route?:string}|undefined;
  return saved?.answers ? {answers:saved.answers,route:saved.route??""} : null;
}