// Join 4 Nov 2026: /e/<token> resolves BOTH link kinds until Part 2's minting is retired at go-live — Part 6's worker link
// (`worker_job_links`, electrician-link.server.ts) first, then main's Part 2 own-job link (`electrician_job_links`,
// own-job-electrician-link.server.ts). The REAL server modules run against one in-memory database. Own file: it mocks
// modules for the whole process.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";

const J = "00000000-0000-4000-8000-0000000000a1", INST = "00000000-0000-4000-8000-0000000000b1", ELEC = "00000000-0000-4000-8000-0000000000b2";
const W = "00000000-0000-4000-8000-0000000000c1", USER = "00000000-0000-4000-8000-0000000000d1";
const NOW = Date.parse("2026-11-03T02:00:00.000Z");

const tables: Tables = {};
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: (t: string) => memoryPostgrest(tables).from(t), rpc: async () => ({ data: false, error: null }) } }));
// The own-job reader's side reads (paid-at, repeat rounds) are not under test; they answer "not handed over".
mock.module("../src/lib/repeat-piesa.server", () => ({ latestReopenAt: async () => null }));
mock.module("../src/lib/payments.server", () => ({ jobPaymentView: async () => null }));

const server = await import("../src/lib/electrician-link.server");
const own = await import("../src/lib/own-job-electrician-link.server");
const { ELECTRICIAN_LINK_NOT_VALID } = await import("../src/lib/electrician-link.core");

function seed() {
  for (const k of Object.keys(tables)) delete tables[k];
  tables["properties"] = [{ id: "p1", address_line: "12 Smith St, Kew", suburb: "Kew" }];
  tables["jobs"] = [{ id: J, job_number: "HV-5001", source: "website", stage: "piesa_scheduled", property_id: "p1", deleted_at: null, channel: "installer_sourced" }];
  tables["businesses"] = [
    { id: INST, name: "Smith Insulation", trading_name: "Smith Insulation Pty Ltd", phone: "03 9000 0001", email: "office@smith.test", onboarding_notes: null, piesa_booked_by: "electrician" },
    { id: ELEC, name: "Spark Co", trading_name: null, phone: "03 9000 0002", email: "office@spark.test", onboarding_notes: null },
  ];
  tables["job_assignments"] = [
    { id: "a1", job_id: J, business_id: INST, role: "installer", active: true, user_id: null },
    { id: "a2", job_id: J, business_id: ELEC, role: "electrician", active: true, user_id: USER, booking_confirmed_at: null },
  ];
  tables["partner_workers"] = [{ id: W, business_id: ELEC, full_legal_name: "Sam Spark", mobile: "0422 222 222", trade_role: "electrician", approval_status: "approved", removed_at: null, profile_id: USER }];
  tables["worker_job_links"] = []; tables["electrician_job_links"] = [];
  tables["contact_releases"] = [{ id: "r1", job_id: J, assignment_id: "a2", visit_kind: "piesa", revoked_at: null }];
  tables["job_overview"] = [{ id: J, job_number: "HV-5001", owner_name: "Helen Owner", owner_phone: "0411 111 111", property_address: "12 Smith St, Kew VIC 3101" }];
  tables["bookings"] = []; tables["assessments"] = [{ id: "as1", job_id: J, external_mitti_id: "audit-a3", completed_at: null, piesa_outcome: "pending", mitti_raw_snapshot: null }];
  tables["workflow_events"] = []; tables["documents"] = [];
}
beforeEach(seed);

describe("electricianLinkAnyView: one read, two link kinds", () => {
  test("a Part 6 worker link opens Part 6's page", async () => {
    const { token } = await server.mintElectricianLink(J, W, "actor-1", NOW);
    const r = await server.electricianLinkAnyView(token, NOW);
    expect(r.kind).toBe("worker");
    if (r.kind !== "worker") throw new Error("kind");
    expect(r.data).toMatchObject({ business: "Spark Co", firstName: "Sam", jobNumber: "HV-5001" });
    expect(r.data.view.step).toBe("book_piesa");
  });
  test("a Part 2 own-job link (electrician_job_links) opens the own-job page: a token Part 6 does not know", async () => {
    const { url } = await own.createElectricianLink(J, ELEC, NOW);
    const token = url.split("/e/")[1]!;
    const r = await server.electricianLinkAnyView(token, NOW);
    expect(r.kind).toBe("own_job");
    if (r.kind !== "own_job") throw new Error("kind");
    expect(r.data.ok).toBe(true);
    if (!r.data.ok) throw new Error("ok");
    expect(r.data).toMatchObject({ step: "do_piesa_in_mitti", jobNumber: "HV-5001", electricianName: "Sam Spark" });
    expect(tables["worker_job_links"]).toHaveLength(0);
  });
  test("an own-job link's own refusals keep Part 2's wording (revoked = moved to another electrician)", async () => {
    const { url } = await own.createElectricianLink(J, ELEC, NOW);
    await own.revokeElectricianLinks(J, "swap", {}, new Date(NOW));
    const r = await server.electricianLinkAnyView(url.split("/e/")[1]!, NOW);
    expect(r).toEqual({ kind: "own_job", data: { ok: false, reason: "This job has moved to another electrician" } });
  });
  test("a token neither table knows, or a badly shaped one, is Part 6's plain 'not valid'", async () => {
    await expect(server.electricianLinkAnyView("A".repeat(43), NOW)).rejects.toThrow(ELECTRICIAN_LINK_NOT_VALID);
    await expect(server.electricianLinkAnyView("short", NOW)).rejects.toThrow(ELECTRICIAN_LINK_NOT_VALID);
  });
});

describe("source pins", () => {
  test("the page reads once through getAnyElectricianLinkView and shows the own-job body for own-job links", () => {
    const route = readFileSync("src/routes/e.$token.tsx", "utf8");
    expect(route).toContain("getAnyElectricianLinkView");
    expect(route).toContain('q.data.kind === "own_job"');
    expect(route).toContain("OwnJobElectricianLinkBody");
    const fns = readFileSync("src/lib/electrician-link.functions.ts", "utf8");
    expect(fns).toContain("electricianLinkAnyView");
    const ownFns = readFileSync("src/lib/own-job-electrician-link.functions.ts", "utf8");
    expect(ownFns).not.toContain(".middleware(");
    expect(ownFns).toContain("own-job-electrician-link.server");
  });
});
