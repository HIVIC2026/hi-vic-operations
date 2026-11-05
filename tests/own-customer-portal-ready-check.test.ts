import { describe, expect, test } from 'bun:test';
import { portalReadyCheckSchema, portalReadyCheckFacts, portalReadyCheckFileOnJob } from '../src/lib/own-customer-portal-ready-check.core';
import { partialA1QuoteCore } from '../src/lib/own-customer-partial-a1.core';
import { readyCheckStopReasons } from '../src/lib/ready-check-answers.core';

const input = { installM2: 120, removalM2: 0, existing: 'none', method: 'onsite', areas: [{ name: 'Living', m2: 70 }, { name: 'Bedrooms', m2: 50 }], access: 'standard', priceIncGst: 2500, files: [], other: '' };
describe('own-customer portal Ready Check — Jo 5 November', () => {
 test('requires positive install m²', () => expect(portalReadyCheckSchema.safeParse({ ...input, installM2: 0 }).success).toBe(false));
 test('requires explicit removal m², accepts zero', () => { expect(portalReadyCheckSchema.safeParse({ ...input, removalM2: undefined }).success).toBe(false); expect(portalReadyCheckSchema.safeParse(input).success).toBe(true); });
 test('requires insulation presence', () => expect(portalReadyCheckSchema.safeParse({ ...input, existing: undefined }).success).toBe(false));
 test('requires R-value when insulation is present', () => expect(portalReadyCheckSchema.safeParse({ ...input, existing: 'present' }).success).toBe(false));
 test('R2.0 or more is a failure, using the ordinary Mitti stop reader', () => { const f = portalReadyCheckFacts(portalReadyCheckSchema.parse({ ...input, existing: 'present', rValue: 'R2.0 or more' })); expect(readyCheckStopReasons(f.entries)).toContain('Fails: existing insulation is R2 or above'); });
 test('below R2 passes the insulation rule', () => { const f = portalReadyCheckFacts(portalReadyCheckSchema.parse({ ...input, existing: 'present', rValue: 'Below R2.0' })); expect(readyCheckStopReasons(f.entries)).toEqual([]); });
 test('no insulation drops hidden stale R', () => { const f = portalReadyCheckFacts(portalReadyCheckSchema.parse({ ...input, rValue: 'R2.0 or more' })); expect(f.measure.existing_r_value).toBeNull(); expect(readyCheckStopReasons(f.entries)).toEqual([]); });
 test('onsite rows must total Install m²', () => expect(portalReadyCheckSchema.safeParse({ ...input, areas: [{ name: 'Living', m2: 70 }] }).success).toBe(false));
 test('requires a named size for every onsite area', () => expect(portalReadyCheckSchema.safeParse({ ...input, areas: [{ name: '', m2: 120 }] }).success).toBe(false));
 test.each(['floor_plan', 'aerial'])('%s requires its upload', method => expect(portalReadyCheckSchema.safeParse({ ...input, method }).success).toBe(false));
 test.each(['floor_plan', 'aerial'])('%s uses m² without dimensions', method => { const f = portalReadyCheckFacts(portalReadyCheckSchema.parse({ ...input, method, files: [{ path: 'job/portal-ready-check/plan.pdf', name: 'plan.pdf', mime: 'application/pdf', size: 20, purpose: method }] })); expect(f.areas[0]?.areaM2).toBe(120); expect(f.areas[0]?.lengthM).toBeNull(); });
 test('requires access and price', () => { expect(portalReadyCheckSchema.safeParse({ ...input, access: undefined }).success).toBe(false); expect(portalReadyCheckSchema.safeParse({ ...input, priceIncGst: 0 }).success).toBe(false); });
 test('optional photos, notes, downlights and BEFORE evidence do not block core quoting', () => { const f = portalReadyCheckFacts(portalReadyCheckSchema.parse(input)); expect(f.areas.every(a => a.downlights === null && !a.beforeVideo && !a.depthPhoto)).toBe(true); expect(partialA1QuoteCore({ areaM2: 120, areas: f.areas, entries: f.entries }).ready).toBe(true); });
 test('does not accept video as optional photos', () => expect(portalReadyCheckSchema.safeParse({ ...input, files: [{ path: 'x', name: 'x.mp4', mime: 'video/mp4', size: 10, purpose: 'photo' }] }).success).toBe(false));
 test('database method codes retain exact on-site wording in the snapshot',()=>{const f=portalReadyCheckFacts(portalReadyCheckSchema.parse(input));expect(f.measure.measurement_method).toBe('other');expect(f.areas[0]?.measurementMethod).toBe('Measured on site');});
 test('private uploads cannot cross jobs or traverse paths',()=>{const name='00000000-0000-4000-9000-000000000001_plan.pdf';expect(portalReadyCheckFileOnJob('job-a',`job-a/portal-ready-check/${name}`)).toBe(true);expect(portalReadyCheckFileOnJob('job-b',`job-a/portal-ready-check/${name}`)).toBe(false);expect(portalReadyCheckFileOnJob('job-a',`job-a/portal-ready-check/../../job-b/${name}`)).toBe(false);});
});test.each(['R0.5','R1.0','R1.5',"Don't know"])('exact R choice %s remains non-disqualifying',rValue=>{const f=portalReadyCheckFacts(portalReadyCheckSchema.parse({...input,existing:'present',rValue}));expect(readyCheckStopReasons(f.entries)).toEqual([]);expect(f.measure.existing_r_value).toBe(rValue === "Don't know" ? null : Number(rValue.slice(1)));});
