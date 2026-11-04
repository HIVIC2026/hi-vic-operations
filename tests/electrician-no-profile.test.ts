// Part 6 fix wave C1: electricians never log in, so an allocated electrician has NO profile and NO business membership. The
// assignment then carries user_id NULL; the person is named by the `in_house_electrician_allocated` event's worker_id.
// The link, the booked email and the owner notice must all find the right worker from that, and a link must still be
// scoped to ONE electrician when two of the same business both have no profile.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";
import { stableUuid } from "../src/lib/mitti-create-claim.core";
import { partnerEmailLayout } from "../src/lib/partner-email.core";
import * as mailCore from "../src/lib/electrician-piesa-booked-email.core";

const J = "00000000-0000-4000-8000-0000000000a1", INST = "00000000-0000-4000-8000-0000000000b1", ELEC = "00000000-0000-4000-8000-0000000000b2";
const WA = "00000000-0000-4000-8000-0000000000c1", WB = "00000000-0000-4000-8000-0000000000c2";
const NOW = Date.parse("2026-11-03T02:00:00.000Z");
const tables: Tables = {};
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: (t: string) => memoryPostgrest(tables).from(t), rpc: async () => ({ data: false, error: null }) } }));
const server = await import("../src/lib/electrician-link.server");

const allocated = (workerId: string, at = "2026-11-02T00:00:00Z") => ({ id: `al-${workerId}-${at}`, job_id: J, event_type: "in_house_electrician_allocated", summary: "", details: { worker_id: workerId, business_id: ELEC }, created_at: at });
function seed() {
  for (const k of Object.keys(tables)) delete tables[k];
  tables["properties"] = [{ id: "p1", address_line: "12 Smith St, Kew", suburb: "Kew" }];
  tables["jobs"] = [{ id: J, job_number: "HV-5001", source: "website", stage: "piesa_and_install_window_pending", property_id: "p1", deleted_at: null }];
  tables["businesses"] = [
    { id: INST, name: "Smith Insulation", trading_name: null, phone: "03 9000 0001", email: "office@smith.test", onboarding_notes: null, piesa_booked_by: "electrician" },
    { id: ELEC, name: "Spark Co", trading_name: null, phone: "03 9000 0002", email: "office@spark.test", onboarding_notes: null },
  ];
  tables["job_assignments"] = [
    { id: "a1", job_id: J, business_id: INST, role: "installer", active: true, user_id: null },
    { id: "a2", job_id: J, business_id: ELEC, role: "electrician", active: true, user_id: null }, // no profile: user_id NULL
  ];
  tables["partner_workers"] = [
    { id: WA, business_id: ELEC, full_legal_name: "Alex Amp", mobile: "0422 222 222", trade_role: "electrician", approval_status: "approved", removed_at: null, profile_id: null, email: "alex@spark.test" },
    { id: WB, business_id: ELEC, full_legal_name: "Bea Bolt", mobile: "0433 333 333", trade_role: "electrician", approval_status: "approved", removed_at: null, profile_id: null, email: "bea@spark.test" },
  ];
  tables["worker_job_links"] = [];
  tables["contact_releases"] = [{ id: "r1", job_id: J, assignment_id: "a2", visit_kind: "piesa", revoked_at: null }];
  tables["job_overview"] = [{ id: J, owner_name: "Helen Owner", owner_phone: "0411 111 111", property_address: "12 Smith St, Kew VIC 3101" }];
  tables["bookings"] = [];
  tables["assessments"] = [{ id: "as1", job_id: J, external_mitti_id: "audit-a3", completed_at: null, piesa_outcome: "pending", mitti_raw_snapshot: null }];
  tables["workflow_events"] = [allocated(WA)];
  tables["documents"] = [];
}
beforeEach(() => seed());

describe("the link for an electrician with no profile", () => {
  test("the allocated worker (named by the allocation event) gets a link; the other electrician of the same business does not", async () => {
    const { token } = await server.mintElectricianLink(J, WA, null, NOW);
    expect(token).toBeTruthy();
    await expect(server.mintElectricianLink(J, WB, null, NOW)).rejects.toThrow("This job isn't assigned to that electrician.");
  });
  test("the link opens for the allocated worker and shows the owner; after the installer switches to the other electrician it is switched off", async () => {
    const { token } = await server.mintElectricianLink(J, WA, null, NOW);
    const v = await server.electricianLinkView(token, NOW);
    expect(v.firstName).toBe("Alex");
    expect(v.owner?.name).toBe("Helen Owner");
    // The same business, a newer allocation to Bea (user_id still NULL): Alex's link is no longer this job's electrician.
    tables["workflow_events"]!.push(allocated(WB, "2026-11-02T01:00:00Z"));
    await expect(server.electricianLinkView(token, NOW)).rejects.toThrow("This link has been switched off. Ask Smith Insulation for a new one.");
    expect((await server.mintElectricianLink(J, WB, null, NOW)).token).toBeTruthy();
  });
  test("a legacy assignment with a user_id still matches by profile (and refuses a worker with another profile)", async () => {
    tables["job_assignments"]![1]!["user_id"] = "u-alex";
    tables["partner_workers"]![0]!["profile_id"] = "u-alex";
    tables["partner_workers"]![1]!["profile_id"] = "u-bea";
    tables["workflow_events"] = [];
    expect((await server.mintElectricianLink(J, WA, null, NOW)).token).toBeTruthy();
    await expect(server.mintElectricianLink(J, WB, null, NOW)).rejects.toThrow("This job isn't assigned to that electrician.");
  });
  test("no allocation event and no user_id (an old business-level assignment): the business is enough, as before", async () => {
    tables["workflow_events"] = [];
    expect((await server.mintElectricianLink(J, WA, null, NOW)).token).toBeTruthy();
  });
});

describe("the booked email for an electrician with no profile", () => {
  function load(deps: Record<string, unknown>) {
    const api: Record<string, (...a: unknown[]) => Promise<unknown>> = {};
    new Function("exports", "require", ts.transpile(readFileSync("src/lib/in-house-electrician-booked.server.ts", "utf8"), { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }))(api, (p: string) => { if (!(p in deps)) throw Error(`Unexpected ${p}`); return deps[p]; });
    return api;
  }
  const rows = (): Tables => ({
    jobs: [{ id: "j", job_number: "HV-1234", source: "base44", owner_id: "o", property_id: "p", deleted_at: null }],
    owners: [{ id: "o", full_name: "Sarah Brown", phone: "0400 000 000" }],
    properties: [{ id: "p", address_line: "12 Example St", suburb: "Box Hill", postcode: "3128" }],
    bookings: [{ id: "b", job_id: "j", kind: "assessment", status: "confirmed", contractor_id: null, scheduled_start: "2026-11-05T23:00:00Z" }],
    partner_workers: [
      { id: "w", profile_id: null, business_id: "biz", email: "alex@spark.test", full_legal_name: "Alex Amp", removed_at: null },
      { id: "w2", profile_id: null, business_id: "biz", email: "bea@spark.test", full_legal_name: "Bea Bolt", removed_at: null },
    ],
    workflow_events: [{ id: "al", job_id: "j", event_type: "in_house_electrician_allocated", summary: "", details: { worker_id: "w", business_id: "biz" }, created_at: "2026-11-02T00:00:00Z" }],
  });
  test("contractor_id is NULL: the worker comes from the allocation event; the email goes (flag off = the worker's own email) and the key names the worker", async () => {
    const r = rows(); const sends: Record<string, unknown>[] = [];
    const api = load({
      "@/integrations/supabase/client.server": { supabaseAdmin: memoryPostgrest(r) }, "./mitti-create-claim.core": { stableUuid }, "./partner-email.core": { partnerEmailLayout },
      "./electrician-piesa-booked-email.core": mailCore,
      "./trade-pause.server": { tradeMessagesPausedNow: async () => null }, "./qa-inbox.server": { qaDeliveryHeld: async () => false },
      "./office-email.server": { sendOfficeEmail: async (p: Record<string, unknown>) => { sends.push(p); return { status: "sent" }; } },
      "./test-send.server": { sendTestEmail: async () => ({ status: "sent" }) },
    });
    expect(await api["notifyInHouseElectricianBooked"]!("j", "b")).toBe("sent");
    expect(sends).toHaveLength(1);
    expect(sends[0]!["to"]).toBe("alex@spark.test");
    expect(sends[0]!["idempotencyKey"]).toBe("in-house-electrician-booked:v1:b:w");
  });
});

describe("allocation server: no profile needed", () => {
  test("allocateElectrician no longer refuses a worker without a profile or Team login; a Mitti email is still needed", () => {
    const src = readFileSync("src/lib/in-house-electrician.server.ts", "utf8");
    expect(src).not.toContain("Electrician needs active Team access and a Mitti email");
    expect(src).not.toMatch(/!worker\.profile_id/);
    expect(src).toContain("Electrician needs a Mitti email");
    expect(src).toContain("allocatedWorkerId(");
  });
  test("pending SQL v2 + rollback exist and the proof covers them", () => {
    expect(readFileSync("docs/pending-migrations/2026-11-03_allocate_team_electrician_v2.sql", "utf8")).toContain("CREATE OR REPLACE FUNCTION public.allocate_team_electrician");
    expect(readFileSync("docs/pending-migrations/2026-11-03_allocate_team_electrician_v2_rollback.sql", "utf8")).toContain("Electrician needs active Team access");
    expect(readFileSync("tests/in-house-electrician-v2-practice-db.test.ts", "utf8")).toContain("2026-11-03_allocate_team_electrician_v2.sql");
  });
});
