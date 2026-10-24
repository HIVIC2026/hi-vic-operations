// Jo 23 Oct: "Needs finishing…" clears once every Ready Check basic is in.
import { expect, mock, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";

const db = new PGlite();
await db.exec(`CREATE TABLE jobs (id uuid primary key, next_action text, stage text);`);
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: postgrestShim(db) }));
mock.module("../src/lib/mitti-pickup.server", () => ({ READY_CHECK_STAGES: ["ready_check_ready_to_schedule", "ready_check_scheduled"] }));
const { keepNeedsFinishingFor, READY_CHECK_BASICS_DONE } = await import("../src/lib/ready-check-basics.server");
const J = "00000000-0000-0000-0000-0000000000f1";
const next = async () => (await db.query<{ next_action: string }>("select next_action from jobs where id = $1", [J])).rows[0]!.next_action;

test("missing basics write Needs finishing; once all are in it is replaced, and other next steps are left alone", async () => {
  await db.query("insert into jobs values ($1, 'Attend booked Ready Check', 'ready_check_scheduled')", [J]);
  expect(await keepNeedsFinishingFor(J, "ready_check_scheduled", ["price"])).toBe(true);
  expect(await next()).toBe("Needs finishing: your price on the job page"); // decision 278: the price is entered in the portal
  expect(await keepNeedsFinishingFor(J, "ready_check_scheduled", [])).toBe(true);
  expect(await next()).toBe(READY_CHECK_BASICS_DONE);
  expect(READY_CHECK_BASICS_DONE.startsWith("Needs finishing")).toBe(false);
  await db.query("update jobs set next_action = 'Office checking quote' where id = $1", [J]);
  expect(await keepNeedsFinishingFor(J, "ready_check_scheduled", [])).toBe(false);
  expect(await next()).toBe("Office checking quote");
});
