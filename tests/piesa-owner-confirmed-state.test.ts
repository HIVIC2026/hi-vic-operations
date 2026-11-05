// Portal speed step 2: the installer job page's "owner confirmed the PIESA?" (`ownerPiesaConfirmedState`) gives the same
// answer as the full facts reader it replaces there (`ownerPiesaConfirmFacts(id) → f ? !!f.confirmation : null`), in one
// round. In-memory database (tests/helpers/memory-postgrest.ts); run on its own (bun shares mock.module per process).
import { describe, expect, mock, test } from "bun:test";
import type { Tables } from "./helpers/memory-postgrest";
import { roundCounter } from "./helpers/round-counter";
import { memoryPostgrest } from "./helpers/memory-postgrest";

const tables: Tables = {};
const rc = roundCounter(memoryPostgrest(tables));
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: rc.client }));
const { ownerPiesaConfirmFacts, ownerPiesaConfirmedState } = await import("../src/lib/piesa-owner-confirm.server");
const { PIESA_OWNER_CONFIRMED_EVENT } = await import("../src/lib/piesa-owner-confirm.core");

const J = "00000000-0000-4000-8000-000000000001";
const rec = (id: string, created: string, signed = true, kind = "initial") => ({ id, job_id: J, kind, outcome: "pass", completed_date: "2026-10-01", created_at: created, signed_off_by: signed ? "u-elec" : null });
const confirmed = (recId: string) => ({ id: `e-${recId}`, job_id: J, event_type: PIESA_OWNER_CONFIRMED_EVENT, created_at: "2026-10-03T00:00:00Z", details: { piesa_record_id: recId, name: "Olive Owner", signed_at: "2026-10-03T00:00:00Z", authority: "owner" } });

const CASES: [string, Partial<Tables>][] = [
  ["no PIESA record", {}],
  ["record not signed off", { piesa_records: [rec("r1", "2026-10-01T00:00:00Z", false)] }],
  ["signed off, owner has not confirmed", { piesa_records: [rec("r1", "2026-10-01T00:00:00Z")] }],
  ["signed off and confirmed", { piesa_records: [rec("r1", "2026-10-01T00:00:00Z")], workflow_events: [confirmed("r1")] }],
  ["confirmed an earlier PIESA, not the re-done one", { piesa_records: [rec("r1", "2026-10-01T00:00:00Z"), rec("r2", "2026-10-05T00:00:00Z", true, "reassessment")], workflow_events: [confirmed("r1")] }],
  ["a rectification record is not the PIESA the owner confirms", { piesa_records: [rec("r1", "2026-10-01T00:00:00Z"), rec("r9", "2026-10-09T00:00:00Z", true, "post_rectification")], workflow_events: [confirmed("r1")] }],
];

describe("ownerPiesaConfirmedState", () => {
  for (const [name, seed] of CASES) {
    test(`${name}: same answer as the full facts reader, in one round`, async () => {
      for (const k of Object.keys(tables)) delete tables[k];
      Object.assign(tables, { piesa_records: [], workflow_events: [], rectification_items: [], assessments: [], job_assignments: [], profiles: [], businesses: [], official_form_signed_copies: [], documents: [], ...seed });
      const full = await ownerPiesaConfirmFacts(J).then((f) => (f ? !!f.confirmation : null)).catch(() => null);
      const lean = await rc.countRounds(() => ownerPiesaConfirmedState(J));
      expect(lean.result).toBe(full);
      expect(lean.rounds).toBe(1);
    });
  }
  test("the cases cover null, false and true", async () => {
    const seen = new Set<boolean | null>();
    for (const [, seed] of CASES) {
      for (const k of Object.keys(tables)) delete tables[k];
      Object.assign(tables, { piesa_records: [], workflow_events: [], ...seed });
      seen.add(await ownerPiesaConfirmedState(J));
    }
    expect([...seen].sort()).toEqual([false, null, true].sort());
  });
});
