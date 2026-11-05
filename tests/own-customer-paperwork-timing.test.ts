import { expect, test } from 'bun:test';
import { paperworkRows } from '../src/lib/job-page-rows.core';
const base = { readyCheckReport:false, signedPiesa:false, ownerConsent:false, safetyPlan:false, installForm:false, installBooked:false };
test('PIESA and consent availability do not depend on install booking',()=>{
 const rows=paperworkRows({...base,signedPiesa:true,ownerConsent:true});
 expect(rows.find(r=>r.label==='Signed PIESA')?.ready).toBe(true);
 expect(rows.find(r=>r.label==="Owner's ESC consent")?.ready).toBe(true);
 expect(paperworkRows(base).find(r=>r.label==='Signed PIESA')?.note).not.toBe('Ready once the install is booked');
 expect(paperworkRows(base).find(r=>r.label==="Owner's ESC consent")?.note).not.toBe('Ready once the install is booked');
});
test('portal submission is viewable before installation booking',()=>{
 const rows=paperworkRows({...base,readyCheckSource:'portal' as const,readyCheckSubmittedAt:'2026-11-05T09:00:00Z'});
 expect(rows[0]?.ready).toBe(true);
});
test('SWMS and install form stay unavailable until install booking',()=>{
 const rows=paperworkRows({...base,safetyPlan:true,installForm:true});
 expect(rows.find(r=>r.label==='Safety plan (SWMS)')?.ready).toBe(false);
 expect(rows.find(r=>r.label==='Install form (Mitti)')?.ready).toBe(false);
 const booked=paperworkRows({...base,safetyPlan:true,installForm:true,installBooked:true});
 expect(booked.find(r=>r.label==='Safety plan (SWMS)')?.ready).toBe(true);
 expect(booked.find(r=>r.label==='Install form (Mitti)')?.ready).toBe(true);
});