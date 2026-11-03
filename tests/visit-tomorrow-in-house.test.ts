// Part 4 (controller ruling 3 Nov 2026, after Task 15): the new flow is in-house for everyone (Part 3 Task 18), so the
// approved #25 "See you tomorrow" owner text must reach in-house owners too. textOwnerVisitTomorrow no longer skips
// in-house jobs; every other gate is unchanged (due the afternoon before, key per booking + day, quiet hours, TEST routing,
// business office phone). The legacy time-negotiation senders keep their in-house hold (tests/in-house-held-messages.test.ts).
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as inHouse from "../src/lib/in-house.core";
import { visitTomorrowText } from "../src/lib/approved-texts.core";
import { melbourneClock } from "../src/lib/installer-texts.core";

const BIZ = { name: "Rapid Insulation", tradingName: null, officePhone: "03 9000 0000", email: "office@rapid.test" };
const START = "2026-10-31T00:00:00Z"; // Saturday 31 October, 11am Melbourne
const NOW = new Date("2026-10-30T06:00:00Z"); // Friday 30 October, 5pm Melbourne (the afternoon before)

function fixture(held: boolean) {
  const sent: { to: string; body: string }[] = [], events: string[] = [];
  const job = { id: "j", job_number: "HV-9000", source: "qa_test", channel: "hivic_sourced", stage: "installation_booked", deleted_at: null, qa_archived_at: null, owners: { full_name: "Test Owner", phone: "0400000000" }, properties: { address_line: "1 Test St", suburb: "Test" } };
  const biz = { in_house: held, name: "Rapid Insulation", trading_name: null, phone: "03 9000 0000", onboarding_notes: "[TEST PARTNER]" };
  const tables: Record<string, unknown[]> = { jobs: [job], job_assignments: [{ id: "a", job_id: "j", business_id: "b", role: "installer", active: true, businesses: biz }], workflow_events: [] };
  const admin = { from(table: string) {
    let single = false, head = false, select = "", offset = 0; const q: Record<string, unknown> = {};
    q["select"] = (s: string, o?: { head?: boolean }) => { select = s; head = !!o?.head; return q; }; q["range"] = (a: number) => { offset = a; return q; };
    for (const n of ["eq", "is", "neq", "in", "order", "limit", "contains", "not", "gte", "lt"]) q[n] = () => q;
    for (const n of ["insert", "upsert", "update"]) q[n] = () => { events.push(table); return q; };
    q["maybeSingle"] = q["single"] = () => { single = true; return q; };
    q["then"] = (resolve: (v: unknown) => void) => { let rows = tables[table] ?? []; if (table === "job_assignments" && select.includes("in_house")) rows = offset ? [] : tables["job_assignments"]!;
      return Promise.resolve({ data: head ? null : single ? rows[0] ?? null : rows, count: 0, error: null }).then(resolve); }; return q;
  } };
  const modules: Record<string, unknown> = {
    "@/integrations/supabase/client.server": { supabaseAdmin: admin }, "./in-house.core": inHouse,
    "./workflow.server": { logEvent: async () => { events.push("event"); } },
    "./test-send.server": { sendTestSms: async (_c: unknown, to: string, body: string) => { sent.push({ to, body }); return { status: "sent", detail: "mock" }; } },
    "./sms.server": { sendRealSms: async () => { throw new Error("real sender must not be used for a TEST job"); } },
    "./test-send.core": { isTestPartner: () => true }, "./quote-hold.core": { smsQuietReason: () => null }, "./mitti.core": { isClosedOrArchivedJob: () => false },
    "./owner-contact.server": { businessContactForJob: async () => BIZ },
  };
  const cache: Record<string, unknown> = {};
  function load(name: string): Record<string, (...a: unknown[]) => Promise<string>> {
    const code = ts.transpile(readFileSync(`src/lib/${name}.ts`, "utf8"), { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }); const out: Record<string, unknown> = {};
    new Function("exports", "require", code)(out, (dep: string) => {
      if (dep in modules) return modules[dep];
      if (dep.startsWith("./") && dep.endsWith(".core")) return require(`../src/lib/${dep.slice(2)}.ts`);
      if (dep.startsWith("./")) { const key = dep.slice(2); return cache[key] ?? (cache[key] = load(key)); }
      throw new Error(`Unexpected dependency ${dep}`);
    }); return out as Record<string, (...a: unknown[]) => Promise<string>>;
  }
  return { load, sent, events };
}

for (const held of [true, false]) test(`${held ? "in-house" : "non-in-house"} job, confirmed install tomorrow → ONE owner text with the approved #25 wording, byte-identical`, async () => {
  const f = fixture(held);
  const r = await f.load("approved-texts.server")["textOwnerVisitTomorrow"]!("installation", "j", { id: "bk", scheduled_start: START }, NOW);
  expect(r).toMatch(/^owner sms \(test\) sent/);
  expect(f.sent).toEqual([{ to: "0400000000", body: visitTomorrowText({ kind: "install", time: melbourneClock(START), business: BIZ }) as string }]);
  expect(f.sent[0]!.body).toBe("Home Insulation Victoria: See you tomorrow at 11am for your insulation install (Rapid Insulation, 03 9000 0000). Reminder: power will be off while they work in the ceiling.");
  expect(f.events).toEqual(["event"]); // ONE approved_text_prepared event (logEvent), recorded before the send
});

test("the other gates are unchanged: not due until the afternoon before; the legacy install-moved text keeps its in-house hold", async () => {
  const f = fixture(true);
  expect(await f.load("approved-texts.server")["textOwnerVisitTomorrow"]!("installation", "j", { id: "bk", scheduled_start: START }, new Date("2026-10-29T06:00:00Z"))).toBe("not due");
  expect(f.sent).toEqual([]);
  expect(await f.load("approved-texts.server")["textOwnerInstallMoved"]!("j", { id: "bk", scheduled_start: START, created_at: "2026-10-30" }, "2026-10-29", NOW)).toBe("in_house");
  const src = readFileSync("src/lib/approved-texts.server.ts", "utf8");
  const fn = src.split("export async function textOwnerVisitTomorrow")[1]!.split("\nexport async function")[0]!;
  expect(fn).not.toContain("inHouseDispatchSkip");
});
