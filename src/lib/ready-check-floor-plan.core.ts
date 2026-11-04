// Pure measurement provenance. Floor plan and Aerial image (Jo 4 Nov) answers never fall back to hidden dimensions.
// Import-free on purpose: ceiling-layout.core → ready-check-basics.core → the installer My work route load this file, so the
// Mitti media walk (`floorPlanFiles`) lives in ready-check-floor-plan-files.core.ts (join step 7: the home graph had grown to
// 638 KB through install-day.core / mitti.core / official-forms.core; tests/trade-home-first-load pins the budget).
export const FLOOR_PLAN_Q = {
 method: 'How did you measure this area?', area: 'Ceiling area from the floor plan (m²)', file: 'Upload the floor plan (photo or PDF)',
 instruction: "Got a floor plan for the whole house? Pick Floor plan and add just one area called 'Whole house'.",
 fileInstruction: "The whole plan, readable, with the areas you're insulating marked.",
} as const;
export const AERIAL_Q = {
 answer: 'Aerial image', area: 'Ceiling area from the aerial image (m²)', file: 'Upload the aerial image (photo or PDF)',
 fileInstruction: 'The roof from above (e.g. Nearmap), with the area you measured and its m² showing.',
} as const;
export const MEASURED_SOURCE_AREA_LABELS = [FLOOR_PLAN_Q.area, AERIAL_Q.area] as const;
export const MEASURED_SOURCE_FILE_LABELS = [FLOOR_PLAN_Q.file, AERIAL_Q.file] as const;
export type MeasuredSourceKind = 'floor_plan' | 'aerial';
export function floorPlanMeasurement(entries: {label:string;value:unknown}[]) {
 const values=(label:string)=>entries.filter(e=>e.label.split('\n')[0]?.trim()===label).map(e=>e.value);
 const methods=[...values(FLOOR_PLAN_Q.method),...values('How was this ceiling area measured?')].map(v=>String(v).trim());
 const kind:MeasuredSourceKind|null=methods.includes('Floor plan')?'floor_plan':methods.includes(AERIAL_Q.answer)?'aerial':null;
 const q=kind==='aerial'?AERIAL_Q:FLOOR_PLAN_Q;
 const raw=values(q.area), s=String(raw[0]??'').trim().replace(/,/g,'');
 const n=/^\d+(?:\.\d+)?$/.test(s)?Number(s):null;
 return {selected:kind!==null,kind,areaM2:kind&&raw.length===1&&n!==null&&n>0&&n<=5000?n:null,fileAnswered:values(q.file).some(v=>v!=null&&String(v).trim()!=='')};
}
