import { z } from 'zod';
import type { MittiArea } from './mitti.core';
import { LEAN_Q } from './ready-check-lean.core';
import { FLOOR_PLAN_Q, AERIAL_Q } from './ready-check-floor-plan.core';
import { allowedUpload } from './upload-safety.core';

export const PORTAL_READY_CHECK_SOURCE = 'portal_ready_check';
export function portalReadyCheckFileOnJob(jobId:string,path:string) {
 const prefix=`${jobId}/portal-ready-check/`;
 return path.startsWith(prefix) && /^[a-f0-9-]{36}_[a-zA-Z0-9._-]+$/.test(path.slice(prefix.length));
}
export const portalRcFile = z.object({ path: z.string().min(1).max(500), name: z.string().min(1).max(200), mime: z.string().max(100), size: z.number().int().positive().max(20_000_000), purpose: z.enum(['floor_plan', 'aerial', 'photo', 'sketch', 'other']) }).superRefine((f, c) => {
 const mime = allowedUpload(f.name, f.mime);
 if (!mime || !(mime.startsWith('image/') || (mime === 'application/pdf' && f.purpose !== 'photo' && f.purpose !== 'sketch'))) c.addIssue({ code: 'custom', message: 'Upload a photo or PDF; Photos and sketches accept photos only.' });
});
export const portalReadyCheckSchema = z.object({
 installM2: z.number().finite().positive().max(5000), removalM2: z.number().finite().nonnegative().max(5000),
 existing: z.enum(['none', 'present']), rValue: z.enum(['R0.5', 'R1.0', 'R1.5', 'R2.0 or more', "Don't know", 'Below R2.0']).optional(),
 method: z.enum(['floor_plan', 'aerial', 'onsite', 'other']), areas: z.array(z.object({ name: z.string().trim().min(1).max(80), m2: z.number().finite().positive().max(5000), lengthM: z.number().finite().positive().max(5000).optional(), widthM: z.number().finite().positive().max(5000).optional() })).max(30).default([]),
 planM2: z.number().finite().positive().max(5000).optional(), measurementNote: z.string().trim().max(1000).default(''),
 access: z.enum(['standard', 'moderate', 'difficult']), priceIncGst: z.number().finite().positive().max(1_000_000),
 files: z.array(portalRcFile).max(30).default([]), other: z.string().trim().max(1000).default(''),
}).superRefine((v, c) => {
 const fail = (path: string, message: string) => c.addIssue({ code: 'custom', path: [path], message });
 if (v.existing === 'present' && !v.rValue) fail('rValue', 'Choose the existing insulation R-value.');
 if (v.method === 'onsite' && !v.areas.length) fail('areas', 'Add at least one ceiling area.');
 if ((v.method === 'floor_plan' || v.method === 'aerial') && !v.files.some(f => f.purpose === v.method)) fail('files', v.method === 'aerial' ? 'Upload the aerial image (photo or PDF).' : 'Upload the floor plan (photo or PDF).');
 if (v.method === 'other' && !v.measurementNote) fail('measurementNote', 'Explain how you measured it.');
 if (v.removalM2 > v.installM2) fail('removalM2', 'Removal m² cannot exceed Install m².');
 if (v.existing === 'none' && v.removalM2 !== 0) fail('removalM2', 'Enter 0 if there is no insulation to remove.');
});
export type PortalReadyCheckInput = z.infer<typeof portalReadyCheckSchema>;
export function calculatedPortalArea(length: number, width: number) {
 return Number.isFinite(length) && Number.isFinite(width) && length > 0 && width > 0 ? Math.round(length * width * 100) / 100 : null;
}
export function portalAreaNudge(install: number, measured: number) {
 if (!Number.isFinite(install) || !Number.isFinite(measured) || install <= 0 || measured <= 0 || Math.abs(measured - install) <= install * 0.1) return null;
 return `Your areas add up to ${Number(measured.toFixed(2))} m² but you've put ${install} m². Which is right?`;
}
export function portalReadyCheckFacts(v: PortalReadyCheckInput) {
 const method = v.method === 'floor_plan' ? 'Floor plan' : v.method === 'aerial' ? 'Aerial image' : v.method === 'other' ? 'Other' : 'Measured on site';
 const present = v.existing === 'present';
 const band = present ? (v.rValue === 'R2.0 or more' ? 'at_or_above_r2' : v.rValue === "Don't know" ? null : 'below_r2') : null;
 const recordedR = !present || v.rValue === "Don't know" || v.rValue === 'Below R2.0' ? null : v.rValue === 'R2.0 or more' ? 2 : Number(v.rValue?.slice(1));
 const rows: PortalReadyCheckInput['areas'] = v.method === 'onsite' ? v.areas : [{ name: 'Whole house', m2: v.installM2 }];
 const areas: MittiArea[] = rows.map((a, i) => ({
  key: `area-${i + 1}`, label: a.name, name: a.name, areaM2: a.m2, lengthM: a.lengthM ?? null, widthM: a.widthM ?? null,
  existing: v.existing, present, rValue: recordedR, rValueBand: band,
  removal: v.removalM2 > 0 ? 'yes' : 'no', removalM2: v.removalM2 === 0 ? 0 : null,
  downlights: null, hazardFlag: null, hazardEvidence: false, hazardNote: null, beforeVideo: false,
  depthPhoto: false, wholeAreaPhoto: false, backingPhoto: false, product: null, scope: null, sources: {}, measurementMethod: method,
 }));
 const entries: { label: string; value: string | null }[] = [
  { label: LEAN_Q.measuredM2, value: String(v.installM2) }, { label: LEAN_Q.measuredHow, value: method },
  { label: LEAN_Q.removeM2, value: String(v.removalM2) }, { label: LEAN_Q.existing, value: present ? 'Yes' : 'No' },
  { label: 'Old insulation R value?', value: present ? v.rValue ?? null : null },
  { label: LEAN_Q.rValue, value: present ? (band === 'at_or_above_r2' ? 'R2.0 or above' : band === 'below_r2' ? 'Below R2.0' : "Don't know") : null },
  { label: LEAN_Q.access, value: v.access === 'standard' ? 'Standard' : v.access === 'moderate' ? 'Moderate' : 'Difficult' },
  { label: 'Other', value: v.other || null },
 ];
 if (v.method === 'floor_plan' || v.method === 'aerial') { const q = v.method === 'aerial' ? AERIAL_Q : FLOOR_PLAN_Q; entries.push({ label: q.area, value: String(v.planM2 ?? v.installM2) }, ...v.files.filter(f => f.purpose === v.method).map(f=>({label:q.file,value:f.path}))); }
 if (v.method === 'other') entries.push({label:'How did you measure it? — Other',value:v.measurementNote});
 if (v.method === 'onsite') for (const a of v.areas) entries.push({label:a.name,value:`${a.lengthM != null && a.widthM != null ? `${a.lengthM} m × ${a.widthM} m · ` : ''}${a.m2} m²`});
 return { entries, areas, measure: { measured_area_m2: v.installM2, removal_m2: v.removalM2, removal_required: v.removalM2 > 0, insulation_present: present, existing_r_value: recordedR, access_difficulty: (v.access === 'standard' ? 'easy' : v.access) as 'easy' | 'moderate' | 'difficult', measurement_method: v.method === 'floor_plan' ? 'floorplan' : v.method === 'aerial' ? 'aerial_remote' : 'other' } };
}