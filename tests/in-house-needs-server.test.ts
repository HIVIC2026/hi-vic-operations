import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as rules from "../src/lib/office-needs.core";

// Exercise the real new reader in isolation; never import a hosted client or provider.
function fixture() {
  const data: Record<string, Record<string, unknown>[]> = {
    jobs: [{ id: "j", source: "base44", deleted_at: null, stage: "piesa_complete" }, { id: "test", source: "qa_test", deleted_at: null }, { id: "deleted", source: "base44", deleted_at: "2026-10-30" }],
    job_assignments: [{ id: "a", job_id: "j", role: "installer", active: true, business_id: "b", businesses: { name: "Rapid", trading_name: "Rapid Insulation", in_house: true } }],
    workflow_events: [{ id: "ev", job_id: "j", event_type: "in_house_batch_sent", created_at: "2026-10-30T06:00:00Z", details: { business_id: "b" } }],
    bookings: [{ id: "rc", job_id: "j", kind: "ready_check", status: "confirmed" }],
    quotes: [{ id: "q", job_id: "j", kind: "installation", status: "accepted", accepted_at: "2026-10-30T06:00:00Z" }],
    piesa_records: [{ id: "pr", job_id: "j", kind: "initial", completed_date: "2026-11-01" }],
    job_piesa_deadlines: [{ job_id: "j", days_remaining: 7, install_deadline: "2026-11-16" }],
  };
  let failedTable = "";
  const scoped: string[][] = [];
  const admin = { from(table: string) {
    let selected = [...(data[table] ?? [])]; let from = 0, to = 999;
    const q: any = {
      select: () => q, order: () => q,
      eq: (key: string,v: unknown) => { selected = selected.filter(r => r[key] === v); return q; },
      neq: (key: string,v: unknown) => { selected = selected.filter(r => r[key] !== v); return q; },
      is: (key: string,v: unknown) => { selected = selected.filter(r => r[key] === v); return q; },
      in: (key: string,v: unknown[]) => { selected = selected.filter(r => v.includes(r[key])); return q; },
      not: (key: string, op: string,v: unknown) => { selected = selected.filter(r => op === "is" ? r[key] != null : !String(v).includes(String(r[key]))); return q; },
      range: (a: number,b: number) => { from=a;to=b;return q; },
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: selected.slice(from,to+1), error: table === failedTable ? { message: "read failed" } : null }).then(resolve),
    }; return q;
  } };
  const source = readFileSync("src/lib/office-needs.server.ts","utf8");
  const part = source.slice(source.indexOf("type Row ="), source.indexOf('/** Batch 3a: the "new quote asked for"'));
  const js = ts.transpile(part,{ module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022 });
  const output: any = {};
  new Function("exports","admin","require",js)(output,admin,(name:string) => {
    if (name !== "./in-house-suppression.server") throw new Error(`Unexpected import ${name}`);
    return { readInHouseDispatchState: async(ids:string[]) => { scoped.push(ids); return { failed:false, held:new Set(ids) }; } };
  });
  return { api:output, data, scoped, fail:(table:string)=>{failedTable=table;} };
}
test("real gather reader honours ready_check bookings, completed PIESA and recorded seven-day deadline",async()=>{
  const f=fixture(); const result=await f.api.inHouseNeedsFacts(["j","test","deleted"]);
  expect(f.scoped).toEqual([["j"]]); expect([...result.keys()]).toEqual(["j"]);
  const ih=result.get("j");
  expect(ih.readyCheckBooked).toBe(true); expect(ih.piesaCompleted).toBe(true); expect(ih.daysRemaining).toBe(7);
  expect(rules.needsCandidates({jobId:"j",jobNumber:"HV-1",surname:"S",suburb:null,inHouse:ih},Date.parse("2026-11-09T06:00:00Z")).map(r=>r.kind)).toEqual(["in_house_install_not_booked"]);
  f.data.bookings = [{ id:"rc",job_id:"j",kind:"ready_check",status:"cancelled" }, {id:"i",job_id:"j",kind:"installation",status:"confirmed"}];
  const next=await f.api.inHouseNeedsFacts(["j"]); expect(next.get("j").readyCheckBooked).toBe(false); expect(next.get("j").installationBooked).toBe(true);
});
test("failed fact reads propagate instead of claiming a visit is absent",async()=>{
  const f=fixture(); f.fail("bookings"); await expect(f.api.inHouseNeedsFacts(["j"])).rejects.toThrow("read failed");
});