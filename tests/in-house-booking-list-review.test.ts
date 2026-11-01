import {expect,test} from 'bun:test';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
import {memoryPostgrest} from './helpers/memory-postgrest';
import * as compliance from '../src/lib/worker-compliance.core';
import * as allocation from '../src/lib/visit-allocation.core';
import {readByJobIds} from '../src/lib/sweep-batch.server';
test('405 booking rows share one Team load; other business records never returned',async()=>{
 const ids=Array.from({length:405},(_,i)=>`j${i}`),rows:any={jobs:ids.map(id=>({id,source:'base44',deleted_at:null})),job_assignments:ids.map(job_id=>({job_id,business_id:'own',role:'installer',active:true})),partner_workers:[],bookings:[],workflow_events:[]};
 rows.jobs.push({id:'other',source:'base44',deleted_at:null});rows.job_assignments.push({job_id:'other',business_id:'outside',role:'installer',active:true});
 const db=memoryPostgrest(rows);let teamReads=0;const deps:any={'@/integrations/supabase/client.server':{supabaseAdmin:db},'./sweep-batch.server':{readByJobIds},'./worker-compliance.core':compliance,'./visit-allocation.core':allocation,'./trade-view.server':{bossOrThrow:async(user:string)=>{if(user!=='office')throw Error('Forbidden');return{kind:'installer',biz:{id:'own'}};}},'./in-house-suppression.server':{readInHouseDispatchState:async(ids:string[])=>({failed:false,held:new Set(ids)})},'./visit-allocation.server':{allocationCandidates:async()=>{teamReads++;return[];}},'./install-deposit-list.server':{installDepositPaidForJobs:async(ids:string[])=>new Map(ids.map(id=>[id,true]))}};
 const api:any={};new Function('exports','require',ts.transpile(readFileSync('src/lib/in-house-booking-list.server.ts','utf8'),{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}))(api,(p:string)=>{if(!(p in deps))throw Error(`Unmocked ${p}`);return deps[p];});
 const result=await api.inHouseBookingList('office',[...ids,'other']);expect(Object.keys(result)).toHaveLength(405);expect(result.other).toBeUndefined();expect(teamReads).toBe(1);await expect(api.inHouseBookingList('outside',ids)).rejects.toThrow('Forbidden');expect(teamReads).toBe(1);
});