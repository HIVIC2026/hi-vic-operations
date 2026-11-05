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
for (const [j, ch] of [[id(11), "installer_sourced"], [id(12), "hivic_sourced"], [id(13), "hivic_sourced"], [id(14), "hivic_sourced"]] as const) {
  await db.query("insert into jobs values ($1,$2,'real','piesa_scheduled',null,$3)", [j, ch, id(1)]);
  if (j !== id(14)) await db.query("insert into job_assignments (job_id, role, business_id, user_id) values ($1,'installer',$2,$3)", [j, id(2), id(3)]);
  await db.query("insert into bookings (job_id, kind, status, scheduled_start) values ($1,'assessment','confirmed',$2)", [j, startIso]);
  // Part 3 Task 3: the electrical upgrades visit, entered on the electrician's link.
  await db.query("insert into bookings (job_id, kind, status, scheduled_start) values ($1,'rectification','confirmed',$2)", [j, startIso]);
}
// The shim can't do embedded selects (owners(...), businesses(...)); answer just those two reads with canned rows.
const shim = postgrestShim(db);
// The embedded installer read answers per job: id(14) has no installer (the HIV office line is used instead).
const canned = (data: unknown | ((jobId: string | null) => unknown)) => { let jobId: string | null = null; const c: Record<string, unknown> = {}; for (const m of ["select", "order", "limit"]) c[m] = () => c; c["eq"] = (col: string, v: string) => { if (col === "job_id" || col === "id") jobId = v; return c; }; c["maybeSingle"] = async () => ({ data: typeof data === "function" ? (data as (j: string | null) => unknown)(jobId) : data, error: null }); return c; };
const wrapped = { ...shim, from: (t: string) => {
  const b = (shim as { from: (t: string) => Record<string, (...a: unknown[]) => unknown> }).from(t);
  return { ...b, select: (cols: string, ...rest: unknown[]) => String(cols).includes("owners(") ? canned({ source: "real", deleted_at: null, stage: "piesa_scheduled", owners: { email: "owner@example.test", phone: "0400000000" } })
    : String(cols).includes("businesses(") ? canned((j: string | null) => (j === id(14) ? null : { businesses: { name: "Reinsulate", trading_name: "Reinsulate", phone: "0300000000" } })) : b["select"]!(cols, ...rest) };
} };
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: wrapped }));
// id(13) is an in-house job (held in-house dispatch); the others are not.
mock.module("../src/lib/in-house-suppression.server", () => ({ readInHouseDispatchState: async () => ({ held: new Set<string>([id(13)]), failed: false }) }));

mock.module("../src/lib/comms.server", () => ({ assertCustomerDeliveryAllowed: async () => {} }));
const emails: string[] = [];
const texts: string[] = [];
mock.module("../src/lib/owner-email-send.server", () => ({ sendGuardedOwnerEmail: async (p: { jobId: string }) => { emails.push(p.jobId); return "sent"; } }));
mock.module("../src/lib/sms.server", () => ({ sendRealSms: async (p: { jobId: string }) => { texts.push(p.jobId); return { status: "sent", detail: "", sid: null }; } }));
const { notifyOwnerBooked: notify } = await import("../src/lib/in-house-booking.server");
// Since #149 the PIESA "You're booked" wording is ON, so the send reads the ELECTRICIAN's business; the shim can't, so the
// test supplies it (the gate under test comes before that read either way).
const SPARKS = { name: "Sparks Electrical", tradingName: null, officePhone: "0300000001", email: "office@sparks.test" };
const notifyOwnerBooked: typeof notify = (jobId, kind, startIso, who, now, deps = {}) => notify(jobId, kind, startIso, who, now, { electrician: async () => SPARKS, ...deps });
const who = { id: id(9), name: "Sparky Sam", phone: "0411111111" };
// The PGlite shim can't do embedded selects (owners(...), businesses(...)), so these check the GATE: an own job gets past it
// (the next check, "booking is in the past", answers 'not current'); any other channel stops at 'held'. The send itself
// after the gate is the in-house code already covered by the in-house booking tests.
const afterStart = new Date(START.getTime() + 3_600_000);
const beforeStart = new Date(START.getTime() - 3 * 86_400_000); // about midday Melbourne, three days before

describe("notifyOwnerBooked", () => {
  test("an installer_sourced own job: the owner gets one booking email and one text", async () => {
    const r = await notifyOwnerBooked(id(11), "piesa", startIso, who, beforeStart);
    expect(r).toBe("sent; sent");
    expect(emails).toEqual([id(11)]);
    expect(texts).toEqual([id(11)]);
  });
  test("any other channel (not in-house held) stays 'held' and sends nothing", async () => {
    expect(await notifyOwnerBooked(id(12), "piesa", startIso, who, beforeStart)).toBe("held");
    expect(emails).toHaveLength(1);
    expect(texts).toHaveLength(1);
  });
  test("a booking time that has passed is 'not current' for an own job", async () => {
    expect(await notifyOwnerBooked(id(11), "piesa", startIso, who, afterStart)).toBe("not current");
  });
});

// Part 3 Task 3 (controller ruling, fix round 1): the electrical upgrades day is entered on the electrician's link on EVERY job,
// so the owner's "You're booked" for the upgrades goes on every channel — HIV leads included — with the installer's office phone
// when there is an installer, else the HIV office line. Jo approved the wording on 4 Nov 2026 (APPROVED=true): the attempt is
// recorded once, sent, and the intent row becomes 'delivered' like the other booking notices.
describe("notifyOwnerBooked — electrical upgrades day (kind 'upgrades')", () => {
  const pending = async (job: string) => (await db.query<{ details: { kind: string } }>("select details from workflow_events where job_id=$1 and event_type='in_house_booked_notice_delivered' and details->>'kind'='upgrades'", [job])).rows;
  test("HIV lead: one owner notice recorded and sent", async () => {
    const before = { e: emails.length, t: texts.length };
    expect(await notifyOwnerBooked(id(12), "upgrades", startIso, who, beforeStart)).toBe("sent; sent");
    expect(await pending(id(12))).toHaveLength(1);
    expect(emails.length).toBe(before.e + 1); expect(texts.length).toBe(before.t + 1);
  });
  test("own job: the same one notice", async () => {
    expect(await notifyOwnerBooked(id(11), "upgrades", startIso, who, beforeStart)).toBe("sent; sent");
    expect(await pending(id(11))).toHaveLength(1);
  });
  test("in-house job: unchanged (its own path), the same one notice", async () => {
    expect(await notifyOwnerBooked(id(13), "upgrades", startIso, who, beforeStart)).toBe("sent; sent");
    expect(await pending(id(13))).toHaveLength(1);
    // Its safety check notice still goes as before.
    expect(await notifyOwnerBooked(id(13), "piesa", startIso, who, beforeStart)).toBe("sent; sent");
  });
  test("HIV lead with no installer yet: still sent (HIV office line stands in for the installer phone)", async () => {
    expect(await notifyOwnerBooked(id(14), "upgrades", startIso, who, beforeStart)).toBe("sent; sent");
    expect(await pending(id(14))).toHaveLength(1);
    // Any other kind on that job stays held with nothing recorded (no installer, not own, not in-house).
    expect(await notifyOwnerBooked(id(14), "piesa", startIso, who, beforeStart)).toBe("held");
  });
});
