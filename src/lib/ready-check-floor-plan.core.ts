// Pure measurement provenance. Plan answers never fall back to hidden dimensions.
import { labelledItems } from './install-day.core';
export const FLOOR_PLAN_Q = {
 method: 'How did you measure this area?', area: 'Ceiling area from the floor plan (m²)', file: 'Upload the floor plan (photo or PDF)',
 instruction: "Got a floor plan for the whole house? Pick Floor plan and add just one area called 'Whole house'.",
 fileInstruction: "The whole plan, readable, with the areas you're insulating marked.",
} as const;
export function floorPlanMeasurement(entries: {label:string;value:unknown}[]) {
 const values=(label:string)=>entries.filter(e=>e.label.split('\n')[0]?.trim()===label).map(e=>e.value);
 const selected=[...values(FLOOR_PLAN_Q.method),...values('How was this ceiling area measured?')].some(v=>String(v).trim()==='Floor plan');
 const raw=values(FLOOR_PLAN_Q.area), s=String(raw[0]??'').trim().replace(/,/g,'');
 const n=/^\d+(?:\.\d+)?$/.test(s)?Number(s):null;
 return {selected,areaM2:selected&&raw.length===1&&n!==null&&n>0&&n<=5000?n:null,fileAnswered:values(FLOOR_PLAN_Q.file).some(v=>v!=null&&String(v).trim()!=='')};
}
export function floorPlanFiles(audit:unknown) {
 return labelledItems(audit).filter(i=>i.label.split('\n')[0]?.trim()===FLOOR_PLAN_Q.file).flatMap(i=>i.media).filter(f=>!!f.mediaId);
}