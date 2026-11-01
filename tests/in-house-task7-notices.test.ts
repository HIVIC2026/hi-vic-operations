import { expect, test } from 'bun:test';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { memoryPostgrest } from './helpers/memory-postgrest';
import * as core from '../src/lib/in-house-booking.core';
import * as layout from '../src/lib/partner-email.core';
import { stableUuid } from '../src/lib/mitti-create-claim.core';
import * as time from '../src/lib/melbourne-time.core';

function fixture(count = 1) {
  const rows: Record<string, any[]> = { bookings: [], jobs: [], job_assignments: [], businesses: [{ id: 'biz', email: 'office@example.invalid', name: 'Example', onboarding_notes: null }], workflow_events: [] };
  for (let i = 0; i < count; i++) {
    const jobId = `j${String(i).padStart(4, '0')}`;
    rows.bookings.push({ id: `b${i}`, job_id: jobId, kind: 'installation', status: 'confirmed', scheduled_start: '2026-11-03T00:00:00Z' });
    rows.jobs.push({ id: jobId, job_number: `HV-${i}`, source: 'base44', deleted_at: null });
    rows.job_assignments.push({ job_id: jobId, role: 'installer', business_id: 'biz', active: true });
  }
  const db = memoryPostgrest(rows), pages: number[] = [], sends: any[] = [], accepted = new Set<string>();
  let outcome = 'sent', throwAfterAccept = false;
  const guarded = async (p: any) => {
    sends.push(p);
    if (outcome === 'sent') accepted.add(p.idempotencyKey);
    if (throwAfterAccept) throw Error('Response lost');
    return { status: outcome, detail: outcome === 'failed' ? "The email service didn't accept it (error 503). Please try again shortly." : outcome };
  };
  const deps: Record<string, any> = {
    '@/integrations/supabase/client.server': { supabaseAdmin: { from: (table: string) => {
      const q = db.from(table);
      const eq=q.eq;q.eq=(column:string,value:unknown)=>column==='details'&&typeof value==='string'?q.contains(column,JSON.parse(value)):eq(column,value);
      if (table === 'bookings') { const range = q.range; q.range = (a: number, b: number) => { pages.push(a); return range(a, b); }; }
      return q;
    } } },
    './in-house-booking.core': core, './partner-email.core': layout, './mitti-create-claim.core': { stableUuid },
    './melbourne-time.core': time,
    './in-house-suppression.server': { readInHouseDispatchState: async (ids: string[]) => ({ held: new Set(ids), failed: false }) },
    './piisa-a3.server': { loadCrew: async () => ({ selection: { lead: 'new' }, staff: [{ workerId: 'new', name: 'New Installer' }] }) },
    './set-password-link.core': { SET_PASSWORD_BASE: 'https://example.invalid' },
    './trade-pause.server': { tradeMessagesPausedNow: async () => false },
    './test-send.core': { isTestPartner: () => false },
    './qa-inbox.server': { qaDeliveryHeld: async () => false },
    './office-email.server': { sendOfficeEmail: guarded },
    './in-house-office-alert.server': { sendInHouseOfficeAlert: guarded },
  };
  const api: any = {};
  new Function('exports', 'require', ts.transpile(readFileSync('src/lib/in-house-booking-notices.server.ts', 'utf8'), { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }))(api, (p: string) => { if (!(p in deps)) throw Error(`Unmocked ${p}`); return deps[p]; });
  return { api, rows, pages, sends, accepted, outcome: (v: string) => { outcome = v; }, loseResponse: () => { throwAfterAccept = true; } };
}
const now = new Date('2026-11-02T03:00:00Z'); // 2pm Melbourne, the day before.
test('2pm digest pages all 405 installs into one office email and never sends again on replay', async () => {
  const f = fixture(405);
  await f.api.sweepInHouseInstallOfficeEmails(now);
  await f.api.sweepInHouseInstallOfficeEmails(now);
  expect(f.pages).toContain(200); expect(f.pages).toContain(400);
  expect(f.sends).toHaveLength(1);
  expect(f.sends[0].text).toContain('HV-404');
  expect(f.sends[0].text.match(/Lead Installer: New Installer/g)).toHaveLength(405);
  expect(f.sends[0].to).toBe('office@example.invalid');
});
test('definite rejection retries the identical digest key once, then replay sends nothing', async () => {
  const f = fixture(); f.outcome('failed'); await f.api.sweepInHouseInstallOfficeEmails(now);
  f.outcome('sent'); await f.api.sweepInHouseInstallOfficeEmails(now); await f.api.sweepInHouseInstallOfficeEmails(now);
  expect(f.sends).toHaveLength(2); expect(f.sends[0].idempotencyKey).toBe(f.sends[1].idempotencyKey); expect(f.accepted.size).toBe(1);
});
test('lost response after acceptance is held, never automatically double-sent', async () => {
  const f = fixture(); f.loseResponse(); await expect(f.api.sweepInHouseInstallOfficeEmails(now)).rejects.toThrow('Response lost');
  await f.api.sweepInHouseInstallOfficeEmails(now); expect(f.sends).toHaveLength(1); expect(f.accepted.size).toBe(1);
});
test('owner cancellation emails only the HIV office and replay makes no duplicate', async () => {
  const f = fixture(); await f.api.notifyOfficeOwnerCancelled('j0000', 'Owner changed plans', 'actor');
  await f.api.notifyOfficeOwnerCancelled('j0000', 'Owner changed plans', 'actor');
  expect(f.sends).toHaveLength(1); expect(f.sends[0].to).toBe('info@homeinsulationvictoria.com.au'); expect(f.sends[0].text).toContain('Owner changed plans');
});
test('actual cancelJobFully releases forms quietly; only the HIV office gets a cancellation email',async()=>{
  const f=fixture();f.rows.jobs[0].stage='installation_booked';
  const db=memoryPostgrest(f.rows),calls:string[]=[],closed:string[]=[];
  const deps:Record<string,any>={
    '@/integrations/supabase/client.server':{supabaseAdmin:db},
    './workflow.server':{WorkflowError:Error,logEvent:async(jobId:string,_actor:string,type:string,summary:string,details:any)=>{f.rows.workflow_events.push({id:type,job_id:jobId,event_type:type,summary,details});}},
    './name-address-tidy.core':{},'./office-jobs.core':{},
    './job-disposition.server':{applyHoldOrCancel:async()=>{f.rows.jobs[0].stage='cancelled';}},
    './in-house-forms.server':{closeUnneededForms:async(id:string)=>{closed.push(id);return 1;}},
    './installer-run.server':{runOwnerCancelled:async(_id:string,opts:any)=>{if(!opts.silent)calls.push('installer text');return {told:false};}},
    './cancel-notice.server':{sendCancelNotices:async()=>{calls.push('owner and installer email');return {};}}
  };
  const api:any={};new Function('exports','require',ts.transpile(readFileSync('src/lib/office-actions.server.ts','utf8'),{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}))(api,(p:string)=>{if(!(p in deps))throw Error(`Unmocked ${p}`);return deps[p];});
  const result=await api.cancelJobFully('j0000','Owner cancelled: changed plans','actor',{tell:{owner:false,installer:false},suppressRunNotice:true});
  await f.api.notifyOfficeOwnerCancelled('j0000','changed plans','actor');
  expect(result.notices).toEqual({owner:null,installer:null});expect(calls).toEqual([]);expect(closed).toEqual(['j0000']);expect(f.rows.job_assignments[0].active).toBe(false);
  expect(f.sends.map(p=>p.to)).toEqual(['info@homeinsulationvictoria.com.au']);
});