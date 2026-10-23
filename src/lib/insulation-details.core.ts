export const INSULATION_DETAIL_QUESTIONS = [
  { key: "insulation_type", label: "What type is it?", options: [{value:"loose_fill",label:"Loose fill (fluffy or crumbly)"},{value:"batts",label:"Batts (blanket strips)"},{value:"unknown",label:"Not sure"}] },
  { key: "insulation_thickness", label: "About how thick is it?", options: [{value:"thin",label:"Less than a finger's length"},{value:"hand",label:"About a hand's width"},{value:"thicker",label:"Thicker"},{value:"unknown",label:"Can't tell"}] },
  { key: "house_built_period", label: "When was the house built?", options: [{value:"before_1980",label:"Before 1980"},{value:"1980s",label:"1980s"},{value:"1990s",label:"1990s"},{value:"2000s",label:"2000s"},{value:"2010_or_later",label:"2010 or later"},{value:"unknown",label:"Not sure"}] },
] as const;
export type InsulationTapAnswers = { insulation_type: "loose_fill"|"batts"|"unknown"; insulation_thickness: "thin"|"hand"|"thicker"|"unknown"; house_built_period: "before_1980"|"1980s"|"1990s"|"2000s"|"2010_or_later"|"unknown" };
export function insulationTapRoute(a: Pick<InsulationTapAnswers,"insulation_type"|"insulation_thickness">): "thin_patchy"|"needs_onsite_assessment" {
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