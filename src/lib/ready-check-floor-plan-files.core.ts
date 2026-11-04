// The floor plan / aerial image files on a Ready Check audit (Jo 4 Nov). Split from ready-check-floor-plan.core.ts so the
// labels and measurement rule stay import-free for the installer My work route; only the server copier reads this.
import { labelledItems } from './install-day.core';
import { AERIAL_Q, FLOOR_PLAN_Q, type MeasuredSourceKind } from './ready-check-floor-plan.core';
export function floorPlanFiles(audit:unknown) {
 return labelledItems(audit).flatMap(i=>{
  const l=i.label.split('\n')[0]?.trim();
  const kind:MeasuredSourceKind|null=l===FLOOR_PLAN_Q.file?'floor_plan':l===AERIAL_Q.file?'aerial':null;
  return kind?i.media.filter(f=>!!f.mediaId).map(f=>({...f,kind})):[];
 });
}
