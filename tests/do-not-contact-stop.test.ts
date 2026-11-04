import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { memoryPostgrest } from "./helpers/memory-postgrest";
import { setDoNotContactFromStop } from "../src/lib/do-not-contact-stop.server";
import { DO_NOT_CONTACT_SET_EVENT, DO_NOT_CONTACT_CLEARED_EVENT, doNotContactBlocks, doNotContactOn } from "../src/lib/do-not-contact.core";

const NOW = "2026-11-10T01:00:00.000Z";
function world() {
  const tables = {
    owners: [{ id: "o1", phone: "0400 000 000" }, { id: "o2", phone: "0411 111 111" }],
    jobs: [
      { id: "j1", owner_id: "o1", stage: "measured_quote_accepted", deleted_at: null },
      { id: "j2", owner_id: "o1", stage: "installation_booked", deleted_at: null },
      { id: "j3", owner_id: "o2", stage: "installation_booked", deleted_at: null },
      { id: "j4", owner_id: "o1", stage: "cancelled", deleted_at: null },
      { id: "j5", owner_id: "o1", stage: "installation_booked", deleted_at: "2026-10-01T00:00:00Z" },
    ] as Record<string, unknown>[],
    workflow_events: [] as Record<string, unknown>[],
  };
  return { tables, db: memoryPostgrest(tables as any) };
}
const sets = (t: ReturnType<typeof world>["tables"], id: string) => t.workflow_events.filter((e) => e["job_id"] === id && e["event_type"] === DO_NOT_CONTACT_SET_EVENT);

test("STOP turns Do not contact on for every open job with that mobile, once", async () => {
  const { tables, db } = world();
  expect(await setDoNotContactFromStop(db, "+61400000000", "SM1", NOW)).toBe(2);
  for (const id of ["j1", "j2"]) {
    expect(sets(tables, id)).toHaveLength(1);
    expect(sets(tables, id)[0]).toMatchObject({ actor_id: null, details: { source: "sms_stop", provider_message_id: "SM1", note: "Owner replied STOP" } });
  }
  for (const id of ["j3", "j4", "j5"]) expect(sets(tables, id)).toHaveLength(0);
  expect(await setDoNotContactFromStop(db, "+61400000000", "SM2", NOW)).toBe(0);
  expect(tables.workflow_events).toHaveLength(2);
});

test("a job already on is untouched; after STOP automatic email stops but legal copies go", async () => {
  const { tables, db } = world();
  tables.workflow_events.push({ job_id: "j1", event_type: DO_NOT_CONTACT_SET_EVENT, created_at: "2026-11-01T00:00:00Z", details: { source: "office" } });
  expect(await setDoNotContactFromStop(db, "+61400000000", null, NOW)).toBe(1);
  expect(sets(tables, "j1")).toHaveLength(1);
  const on = doNotContactOn(tables.workflow_events.filter((e) => e["job_id"] === "j2") as any);
  expect(on).toBe(true);
  expect(doNotContactBlocks({ channel: "email", purpose: "quote_reminder", on })).not.toBeNull();
  expect(doNotContactBlocks({ channel: "email", purpose: "piesa_copy", on })).toBeNull();
});

test("a read failure throws", async () => {
  const bad = { from: () => { throw new Error("boom"); } };
  await expect(setDoNotContactFromStop(bad, "+61400000000", null, NOW)).rejects.toThrow();
});

test("wiring: STOP handler calls it before closing enquiries; START never clears it", () => {
  const src = readFileSync("src/lib/sms.server.ts", "utf8");
  const stop = src.slice(src.indexOf('if (k === "stop")'), src.indexOf("else await db.from(\"sms_optouts\").update"));
  expect(stop).toContain("setDoNotContactFromStop(");
  expect(stop.indexOf("setDoNotContactFromStop(")).toBeLessThan(stop.indexOf("closeStoppedEnquiries("));
  expect(src.slice(src.indexOf("export async function recordInboundReply"))).not.toContain(DO_NOT_CONTACT_CLEARED_EVENT);
});
