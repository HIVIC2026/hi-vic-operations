// Portal-owned decisions only. Workers never decide whether accepted evidence needs repeating.
/** Jo 4 Nov 2026 21:30 (G8 (5)): the installer job page / office line "Before photos: to be taken on install day (…)" is
 *  HIDDEN for go-live — the Mitti A5 capture it points to isn't built; the Ready Check before video + ruler photo remain
 *  the before evidence. The rule (installBeforePlan) and the reader (install-before.server) stay; nothing renders the line
 *  while this is false. */
export const INSTALL_BEFORE_LINE_SHOWN = false as boolean;
export const INSTALL_BEFORE_VIDEO_INSTRUCTION = 'The power is off, so use a bright torch or work light.';
export const INSTALL_AFTER_VIDEO_INSTRUCTION = 'The power is still off, so use a bright torch or work light.';
export const INSTALL_AREA_ORDER_LABEL = 'Ceiling areas in Ready Check order';
/** `backingPhoto` is read but no longer required (Jo 5 Nov 2026: the foil photo is off the Ready Check forms). */
export type BeforeArea = {name:string|null;beforeVideo:boolean|null;depthPhoto:boolean|null;wholeAreaPhoto?:boolean|null;backingPhoto?:boolean|null;present:boolean|null;rejected:boolean};
export function installBeforePlan(hasMittiReadyCheck:boolean,areas:BeforeArea[]) {
 const named=areas.map((a,i)=>({...a,name:a.name?.trim()||`Area ${i+1}`}));
 const needed=named.flatMap(a=>{
  const reasons:string[]=[];
  if(!hasMittiReadyCheck) reasons.push('No Ready Check in Mitti');
  else {
   if(a.beforeVideo!==true) reasons.push('Ready Check BEFORE video missing');
   if(a.wholeAreaPhoto!==true) reasons.push('Whole-area photo missing');
   if(a.present!==false&&a.depthPhoto!==true) reasons.push('Old-insulation ruler photo missing');
   if(a.rejected) reasons.push('BEFORE evidence rejected by office');
  }
  return reasons.length?[{...a,reasons}]:[];
 });
 return {needed,line:needed.length?`Before photos: to be taken on install day (${needed.map(a=>a.name).join(', ')})`:null,areaOrder:named.map((a,i)=>`${i+1}. ${a.name}`).join(' · '),unknownAreas:areas.length===0};
}
export function installScopeChanges(recorded:string[],submitted:string[]):string[] {
 const key=(s:string)=>s.trim().toLowerCase().replace(/\s+/g,' ');
 const known=new Set(recorded.map(key));
 return [...new Map(submitted.filter(s=>s.trim()&&!known.has(key(s))).map(s=>[key(s),s.trim()])).values()];
}