// Part 2 Task 3: notifyOwnerBooked now also covers an installer's own job (call and book); another channel stays held.
import { describe, expect, mock, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";

const db = new PGlite();
await db.exec(`
CREATE TABLE owners (id uuid primary key, email text, phone text);
CREATE TABLE businesses (id uuid primary key, name text, trading_name text, phone text);
CREATE TABLE jobs (id uuid primary key, channel text, source text, stage text, deleted_at timestamptz, owner_id uuid);
CREATE TABLE job_assignments (id uuid primary key default gen_random_uuid(), job_id uuid, role text, business_id uuid, user_id uuid, active boolean default true);
CREATE TABLE bookings (id uuid primary key default gen_random_uuid(), job_id uuid, kind text, status text, scheduled_start timestamptz, created_at timestamptz default now());
CREATE TABLE workflow_events (id uuid primary key default gen_random_uuid(), job_id uuid, actor_id uuid, event_type text, summary text, details jsonb, internal boolean, created_at timestamptz default clock_timestamp());
`);
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const START = new Date(Date.now() + 5 * 86_400_000);
START.setUTCHours(0, 0, 0, 0); START.setUTCDate(START.getUTCDate()); // a mid-day Melbourne time, well outside quiet hours
START.setUTCHours(1, 0, 0, 0);
const startIso = START.toISOString();
await db.query("insert into owners values ($1,'owner@example.test','0400000000')", [id(1)]);
await db.query("insert into businesses values ($1,'Reinsulate','Reinsulate','0300000000')", [id(2)]);
for (const [j, ch] of [[id(11), "installer_sourced"], [id(12), "hivic_sourced"]] as const) {
  await db.query("insert into jobs values ($1,$2,'real','piesa_scheduled',null,$3)", [j, ch, id(1)]);
  await db.query("insert into job_assignments (job_id, role, business_id, user_id) values ($1,'installer',$2,$3)", [j, id(2), id(3)]);
  await db.query("insert into bookings (job_id, kind, status, scheduled_start) values ($1,'assessment','confirmed',$2)", [j, startIso]);
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: postgrestShim(db) }));
mock.module("../src/lib/in-house-suppression.server", () => ({ readInHouseDispatchState: async () => ({ held: new Set<string>(), failed: false }) }));
mock.module("../src/lib/owner-email-send.server", () => ({ sendGuardedOwnerEmail: async () => { return "sent"; } }));
mock.module("../src/lib/comms.server", () => ({ assertCustomerDeliveryAllowed: async () => {} }));
mock.module("../src/lib/sms.server", () => ({ sendRealSms: async () => ({ status: "sent", detail: "", sid: null }) }));
const { notifyOwnerBooked } = await import("../src/lib/in-house-booking.server");
const who = { id: id(9), name: "Sparky Sam", phone: "0411111111" };
// The PGlite shim can't do embedded selects (owners(...), businesses(...)), so these check the GATE: an own job gets past it
// (the next check, "booking is in the past", answers 'not current'); any other channel stops at 'held'. The send itself
// after the gate is the in-house code already covered by the in-house booking tests.
const afterStart = new Date(START.getTime() + 3_600_000);

describe("notifyOwnerBooked gate", () => {
  test("an installer_sourced own job gets past the gate (not 'held')", async () => {
    expect(await notifyOwnerBooked(id(11), "piesa", startIso, who, afterStart)).toBe("not current");
  });
  test("any other channel (not in-house held) stays 'held'", async () => {
    expect(await notifyOwnerBooked(id(12), "piesa", startIso, who, afterStart)).toBe("held");
  });
});
