import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { auditIdentity } from "../src/lib/mitti-retry.core";
import { fixesDayMissingQuestions, fixesDayPrefillItems, readFixesDay } from "../src/lib/fixes-day.core";

// In-memory stand-in for the mitti_sim_audits table (service-role client).
const rows = new Map<string, Record<string, unknown>>();
const table = () => {
  let gteMin = ""; let limitN = 1000; let filterId: string | null = null; let pending: Record<string, unknown> | null = null;
  const q: Record<string, unknown> = {
    select: () => q, gte: (_c: string, v: string) => { gteMin = v; return q; }, order: () => q, limit: (n: number) => { limitN = n; return q; },
    then: (res: (v: unknown) => void) => res({ data: [...rows.values()].filter((r) => !gteMin || String(r.modified_at) >= gteMin).slice(0, limitN), error: null }),
    eq: (_c: string, v: string) => { filterId = v; if (pending) { Object.assign(rows.get(v) ?? {}, pending); pending = null; } return q; },
    maybeSingle: async () => ({ data: filterId ? rows.get(filterId) ?? null : null, error: null }),
    insert: async (r: Record<string, unknown>) => { rows.set(String(r.id), { ...r }); return { error: null }; },
    update: (r: Record<string, unknown>) => { pending = r; return q; },
  };
  return q;
};
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: (t: string) => (t === "mitti_sim_audits" ? table() : {}) } }));
const ms = await import("../src/lib/mitti.server");
const route = await import("../src/lib/mitti-test-route.core");

let calls: { url: string; init: RequestInit }[] = [];
const realFetch = globalThis.fetch;
beforeEach(() => {
  calls = []; rows.clear(); process.env["MITTI_API_TOKEN"] = "t";
  globalThis.fetch = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(JSON.stringify({ ok: 1 })); }) as never;
});
afterEach(() => { globalThis.fetch = realFetch; });

test("real assignee search goes to real Mitti byte for byte", async () => {
  await ms.realMittiCall("POST", "/users/search", { email: ["sparky@realtrade.com.au"] });
  expect(calls.length).toBe(1);
  expect(calls[0]!.url).toBe("https://api.mitti.com/users/search");
  expect(calls[0]!.init.method).toBe("POST");
  expect(calls[0]!.init.body).toBe(JSON.stringify({ email: ["sparky@realtrade.com.au"] }));
  expect(calls[0]!.init.headers).toEqual({ Authorization: "Bearer t", Accept: "application/json", "Content-Type": "application/json" });
});

test("real audit id and real create go to real Mitti unchanged", async () => {
  await ms.realMittiCall("GET", "/audits/audit_0123456789abcdef");
  const body = { template_id: "template_x", header_items: [{ item_id: "a", responses: { text: "Owner Real" } }] };
  await ms.realMittiCall("POST", "/audits", body);
  expect(calls.map((c) => c.url)).toEqual(["https://api.mitti.com/audits/audit_0123456789abcdef", "https://api.mitti.com/audits"]);
  expect(calls[1]!.init.body).toBe(JSON.stringify(body));
});

test("TEST-domain and TEST-partner users never touch the network", async () => {
  const a = await ms.realMittiCall("POST", "/users/search", { email: ["qa.installer@hivic-test.example"] });
  const b = await ms.realMittiCall("POST", "/users/search", { email: ["jo@actpropertyinspections.com.au"] });
  expect(calls.length).toBe(0);
  expect((a as { id: string }[])[0]!.id.startsWith("sim_")).toBe(true);
  expect((b as { id: string }[])[0]!.id.startsWith("sim_")).toBe(true);
});

test("a TEST flow (search, template, create, share, owner, read) stays simulated", async () => {
  const call = await ms.mittiCallFor(ms.realMittiCall, "qa.lead@hivic-test.example");
  const [u] = (await call("POST", "/users/search", { email: ["qa.lead@hivic-test.example"] })) as { id: string }[];
  const tpl = await call("GET", "/templates/v1/templates/template_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  expect((tpl as { template: { template_id: string } }).template.template_id).toBe("template_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  const { audit_id } = (await call("POST", "/audits", { template_id: "template_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", items: [] })) as { audit_id: string };
  expect(audit_id.startsWith("sim_")).toBe(true);
  // later calls through the plain boundary route by id / sim user
  await ms.realMittiCall("POST", `/audits/${audit_id}/share`, { shares: [{ id: u!.id, permission: "edit" }] });
  await ms.realMittiCall("PUT", `/inspections/v1/inspections/${audit_id}/owner`, { owner_id: u!.id });
  const got = await ms.realMittiCall("GET", `/audits/${audit_id}`);
  expect((got as { audit_id: string }).audit_id).toBe(audit_id);
  expect(calls.length).toBe(0);
  expect(rows.has(audit_id)).toBe(true);
});

test("a real person's flow is not swapped", async () => {
  expect(await ms.mittiCallFor(ms.realMittiCall, "sparky@realtrade.com.au")).toBe(ms.realMittiCall);
  expect(route.testMittiRoute("GET", "/templates/v1/templates/x", undefined)).toBeNull();
  expect(route.isTestMittiEmail("someone@hivic-test.example.com.au")).toBe(false);
});

test("practice database: simulator table applies, rejects non-sim ids", async () => {
  const db = new PGlite();
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;");
  await db.exec(readFileSync("docs/pending-migrations/mitti-sim-audits.sql", "utf8"));
  await db.query("INSERT INTO public.mitti_sim_audits (id, template_id) VALUES ('sim_audit_1','t')");
  await expect(db.query("INSERT INTO public.mitti_sim_audits (id, template_id) VALUES ('audit_real','t')")).rejects.toThrow();
  const rls = await db.query<{ relrowsecurity: boolean }>("SELECT relrowsecurity FROM pg_class WHERE relname='mitti_sim_audits'");
  expect(rls.rows[0]!.relrowsecurity).toBe(true);
});

test("fixes-day TEST flow: template read goes to the simulator, never the network", async () => {
  const call = await ms.mittiCallFor(ms.realMittiCall, "jo@actpropertyinspections.com.au");
  const template = await call("GET", "/templates/v1/templates/template_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  expect(fixesDayMissingQuestions(template)).toEqual([]);
  const items = fixesDayPrefillItems(template, { jobNumber: "HV-TEST", address: "TEST Frankston 3199", electricianName: "TEST Delta", licence: "TEST-L", recName: "TEST REC", recNo: "TEST-R", phone: "0400000201", repairList: ["TEST repair"] });
  const created = await call("POST", "/audits", { template_id: "template_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", items }) as { audit_id: string };
  expect(created.audit_id.startsWith("sim_")).toBe(true);
  const saved = await ms.realMittiCall("GET", `/audits/${created.audit_id}`);
  expect(fixesDayMissingQuestions(saved)).toEqual([]);
  expect(readFixesDay(saved).jobNumber).toBe("HV-TEST");
  expect(readFixesDay(saved).done).toBeNull();
  expect(calls.length).toBe(0);
  const src = readFileSync("src/lib/fixes-day.server.ts", "utf8");
  expect(src).toContain("call ?? await mittiCallFor(realMittiCall, email)");
});

test("simulated GET returns the answers sent at creation so auditIdentity reads job number and address", async () => {
  const { persistentSimMittiCall: sim } = await import("../src/lib/mitti-sim-store.server");
  const mk = (header_items: unknown[], items: unknown[] = []) => sim("POST", "/audits", { template_id: "template_x", header_items, items }) as Promise<{ audit_id: string }>;
  const ans = (item_id: string, label: string, text: string) => ({ item_id, label, type: "textsingle", responses: { text } });
  const rc = await mk([ans("h1", "Portal Job Number", "HV-1001"), ans("h2", "Site address", "1 Test St, Reid VIC 3000")]);
  const pi = await mk([], [ans("q1", "Job Reference ID", "HV-1002"), ans("q2", "Address including postcode", "2 Test St, Reid VIC 3000")]);
  const g = async (id: string) => sim("GET", `/audits/${id}`);
  expect(auditIdentity("ready_check", await g(rc.audit_id))).toMatchObject({ jobNumber: "HV-1001", siteAddress: "1 Test St, Reid VIC 3000" });
  expect(auditIdentity("piesa", await g(pi.audit_id))).toMatchObject({ jobNumber: "HV-1002", siteAddress: "2 Test St, Reid VIC 3000" });
});

test("simulated GET /audits/search lists stored forms modified at or after the time", async () => {
  const { persistentSimMittiCall: sim } = await import("../src/lib/mitti-sim-store.server");
  rows.set("sim_old", { id: "sim_old", template_id: "t_old", modified_at: "2026-10-01T00:00:00.000Z" });
  rows.set("sim_new", { id: "sim_new", template_id: "t_new", modified_at: "2026-10-27T00:00:00.000Z" });
  const r = (await sim("GET", "/audits/search?modified_after=2026-10-20T00:00:00.000Z&limit=50")) as { audits: { audit_id: string; template_id: string }[] };
  expect(r).toEqual({ audits: [{ audit_id: "sim_new", template_id: "t_new" }] });
  expect(calls.length).toBe(0);
});
