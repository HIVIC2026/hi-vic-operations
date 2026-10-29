// Jo 30 Oct 2026 (HV-3542): a Ready Check is never booked while the owner's street is missing. confirmBooking is the
// one booking path (owner, installer and office override), so the check lives there. In-memory fake database.
import { beforeEach, describe, expect, mock, test } from "bun:test";

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
const writes: string[] = [];
const get = (r: Row, path: string): unknown => path.split(".").reduce<unknown>((o, k) => (o == null ? o : (o as Row)[k]), r);
function from(table: string) {
  let one = false;
  const preds: ((r: Row) => boolean)[] = [];
  const write = () => { writes.push(table); return b; };
  const b: Record<string, unknown> & PromiseLike<unknown> = {
    select: () => b, order: () => b, limit: () => b,
    eq: (c: string, v: unknown) => { preds.push((r) => get(r, c) === v); return b; },
    in: (c: string, v: unknown[]) => { preds.push((r) => v.includes(get(r, c))); return b; },
    is: (c: string, v: unknown) => { preds.push((r) => (get(r, c) ?? null) === v); return b; },
    maybeSingle: () => { one = true; return b; }, single: () => { one = true; return b; },
    insert: write, update: write, upsert: write, delete: write,
    then: (res, rej) => {
      const rows = (tables[table] ?? []).filter((r) => preds.every((p) => p(r)));
      return Promise.resolve({ data: one ? rows[0] ?? null : rows, error: null }).then(res, rej);
    },
  };
  return b;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from, rpc: async () => { writes.push("rpc"); return { data: null, error: null }; } } }));

const { confirmBooking } = await import("../src/lib/booking.server");
const { ADDRESS_REQUEST_BLOCK_REASON } = await import("../src/lib/address-request.core");

function seed(address: string | null, stage = "ready_check_ready_to_schedule") {
  for (const k of Object.keys(tables)) delete tables[k];
  writes.length = 0;
  tables["jobs"] = [{ id: "j1", stage, channel: "hivic_sourced", source: "base44", deleted_at: null, property_id: "p1", properties: { address_line: address } }];
  tables["properties"] = [{ id: "p1", address_line: address }];
  tables["job_assignments"] = []; tables["bookings"] = []; tables["workflow_events"] = [];
}
const START = "2026-11-10T00:00:00.000Z";

describe("confirmBooking: no street, no Ready Check booking", () => {
  beforeEach(() => seed("Brighton VIC 3186"));

  test("no street → refused with the reason for owner, installer and office override; nothing written", async () => {
    for (const a of ["Brighton VIC 3186", "Greenwood St", "Park Ave, Glen Huntly VIC 3163", null]) {
      seed(a);
      for (const who of ["owner", "installer", "admin (override)"])
        await expect(confirmBooking("j1", "ready_check", START, "u1", who)).rejects.toThrow(ADDRESS_REQUEST_BLOCK_REASON);
      expect(writes).toEqual([]);
      expect(tables["bookings"]).toEqual([]);
    }
  });

  test("a full street → past this check (the normal checks carry on: here, no installer yet)", async () => {
    seed("11 Albert St, Brighton VIC 3186");
    await expect(confirmBooking("j1", "ready_check", START, "u1", "owner")).rejects.toThrow("No installer assigned yet.");
    seed("Unit 14/26-30 Willansby Ave, Brighton VIC 3186");
    await expect(confirmBooking("j1", "ready_check", START, "u1", "owner")).rejects.toThrow("No installer assigned yet.");
  });

  test("a PIESA booking isn't affected by this check", async () => {
    seed("Brighton VIC 3186", "ready_check_ready_to_schedule");
    const err = await confirmBooking("j1", "assessment", START, "u1", "owner").then(() => null, (e: Error) => e.message);
    expect(err).not.toBe(ADDRESS_REQUEST_BLOCK_REASON);
    expect(err).toMatch(/PIESA can only be booked/);
  });
});
