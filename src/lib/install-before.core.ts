// Single A5 always collects BEFORE for every area; Ready Check media never exempts one.
/** Keep the existing presentation line hidden until Jo republishes her A5 with the new page. */
export const INSTALL_BEFORE_LINE_SHOWN = false as boolean;
export const INSTALL_BEFORE_VIDEO_INSTRUCTION = 'The power is off, so use a bright torch or work light.';
export const INSTALL_AFTER_VIDEO_INSTRUCTION = 'The power is still off, so use a bright torch or work light.';
export const INSTALL_AREA_ORDER_LABEL = 'Ceiling areas in Ready Check order';
/** `backingPhoto` is read but no longer required (Jo 5 Nov 2026: the foil photo is off the Ready Check forms). */
export type BeforeArea = {name:string|null;beforeVideo:boolean|null;depthPhoto:boolean|null;wholeAreaPhoto?:boolean|null;backingPhoto?:boolean|null;present:boolean|null;rejected:boolean};
export function installBeforePlan(_hasMittiReadyCheck:boolean,areas:BeforeArea[]) {
 const named=areas.map((a,i)=>({...a,name:a.name?.trim()||`Area ${i+1}`}));
 const needed=named.map(a=>({...a,reasons:['BEFORE area photo on install day',...(a.present!==false?['Old-insulation ruler photo on install day']:[])]}));
 return {needed,line:needed.length?`Before photos: to be taken on install day (${needed.map(a=>a.name).join(', ')})`:null,areaOrder:named.map((a,i)=>`${i+1}. ${a.name}`).join(' · '),unknownAreas:areas.length===0};
}
export function installScopeChanges(recorded:string[],submitted:string[]):string[] {
 const key=(s:string)=>s.trim().toLowerCase().replace(/\s+/g,' ');
 const known=new Set(recorded.map(key));
 return [...new Map(submitted.filter(s=>s.trim()&&!known.has(key(s))).map(s=>[key(s),s.trim()])).values()];
}