// New job flow, Part 6, Task 9 (Jo 2 Nov 2026, answer 7): at a rental where someone other than the owner lets the trades in,
// the electrician sees and calls that person — on the job link (always) and in the "PIESA booked" email (behind
// ELECTRICIAN_ACCESS_ROWS_APPROVED; while false the email is byte-identical to Task 4's). The REAL electrician-link.server
// runs against an in-memory database; the owner's details and the access person follow the same contact_releases rule.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";
import { ElectricianLinkBody } from "../src/components/trade/ElectricianLinkBody";
import * as mail from "../src/lib/electrician-piesa-booked-email.core";
import { electricianStep } from "../src/lib/electrician-link.core";

const J = "00000000-0000-4000-8000-0000000000a1", INST = "00000000-0000-4000-8000-0000000000b1", ELEC = "00000000-0000-4000-8000-0000000000b2";
const W = "00000000-0000-4000-8000-0000000000c1", USER = "00000000-0000-4000-8000-0000000000d1";
const NOW = Date.parse("2026-11-03T02:00:00.000Z");
const tables: Tables = {};
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: (t: string) => memoryPostgrest(tables).from(t), rpc: async () => ({ data: false, error: null }) } }));
const server = await import("../src/lib/electrician-link.server");

const tina = { rented: true, tenant: { name: "Tina Lee", mobile: "+61400111222", email: "tina@example.test" }, access: { who: "tenant", name: "Tina Lee", mobile: "+61400111222" } };
function seed(over: { rental?: unknown; released?: boolean } = {}) {
  for (const k of Object.keys(tables)) delete tables[k];
  tables["properties"] = [{ id: "p1", address_line: "12 Smith St, Kew", suburb: "Kew" }];
  tables["jobs"] = [{ id: J, job_number: "HV-5001", source: "qa_test", stage: "piesa_scheduled", property_id: "p1", deleted_at: null }];
  tables["businesses"] = [
    { id: INST, name: "Smith Insulation", trading_name: null, email: "office@smith.test", onboarding_notes: null, piesa_booked_by: "electrician" },
    { id: ELEC, name: "Spark Co", trading_name: null, email: "office@spark.test", onboarding_notes: null },
  ];
  tables["job_assignments"] = [
    { id: "a1", job_id: J, business_id: INST, role: "installer", active: true, user_id: null },
    { id: "a2", job_id: J, business_id: ELEC, role: "electrician", active: true, user_id: USER },
  ];
  tables["partner_workers"] = [{ id: W, business_id: ELEC, full_legal_name: "Sam Spark", mobile: "0422 222 222", trade_role: "electrician", approval_status: "approved", removed_at: null, profile_id: USER }];
  tables["worker_job_links"] = [];
  tables["contact_releases"] = over.released === false ? [] : [{ id: "r1", job_id: J, assignment_id: "a2", visit_kind: "piesa", revoked_at: null }];
  tables["job_overview"] = [{ id: J, owner_name: "Helen Owner", owner_phone: "0411 111 111", property_address: "12 Smith St, Kew VIC 3101" }];
  tables["bookings"] = [{ id: "bk1", job_id: J, kind: "assessment", status: "confirmed", scheduled_start: "2026-11-06T23:00:00.000Z", business_id: ELEC, assignment_id: "a2" }];
  tables["assessments"] = [{ id: "as1", job_id: J, external_mitti_id: "audit-a3", completed_at: null, piesa_outcome: "pending", mitti_raw_snapshot: null }];
  tables["workflow_events"] = "rental" in over ? (over.rental ? [{ id: "qt", job_id: J, event_type: "quick_taps_answered", summary: "", details: { answers: { rental: over.rental } }, created_at: "2026-11-01T00:00:00Z" }] : []) : [{ id: "qt", job_id: J, event_type: "quick_taps_answered", summary: "", details: { answers: { rental: tina } }, created_at: "2026-11-01T00:00:00Z" }];
  tables["documents"] = [];
}
beforeEach(() => seed());
const token = async () => (await server.mintElectricianLink(J, W, null, NOW)).token;

describe("the link: who lets you in", () => {
  test("rental with the tenant letting us in: access = Tina Lee (tenant) with her mobile, beside the owner's details", async () => {
    const v = await server.electricianLinkView(await token(), NOW);
    expect(v.access).toEqual({ name: "Tina Lee", role: "tenant", phone: "+61400111222" });
    expect(v.owner).toEqual({ name: "Helen Owner", phone: "0411 111 111" });
  });
  test("property manager: role 'property manager'", async () => {
    seed({ rental: { ...tina, access: { who: "property_manager", name: "Pat Moore", mobile: "+61400333444" } } });
    expect((await server.electricianLinkView(await token(), NOW)).access).toEqual({ name: "Pat Moore", role: "property manager", phone: "+61400333444" });
  });
  test("owner lets us in, owner-occupied, or never asked: access is null", async () => {
    seed({ rental: { ...tina, access: { who: "owner", name: "Helen Owner", mobile: "+61411111111" } } });
    expect((await server.electricianLinkView(await token(), NOW)).access).toBeNull();
    seed({ rental: { rented: false, tenant: null, access: null } });
    expect((await server.electricianLinkView(await token(), NOW)).access).toBeNull();
    seed({ rental: null });
    expect((await server.electricianLinkView(await token(), NOW)).access).toBeNull();
  });
  test("no current contact release: access is null, like the owner's details (same rule)", async () => {
    seed({ released: false });
    const v = await server.electricianLinkView(await token(), NOW);
    expect(v.owner).toBeNull();
    expect(v.access).toBeNull();
    // Assignment ended (the electrician was changed or handed back): the link is switched off, so nothing is shown at all.
    seed(); const t = await token(); tables["job_assignments"]![1]!["active"] = false;
    await expect(server.electricianLinkView(t, NOW)).rejects.toThrow("This link has been switched off. Ask Smith Insulation for a new one.");
  });
  test("a failed rental read never hides the job: access null, owner still shown", async () => {
    seed(); delete tables["workflow_events"]; // the events table "cannot be read"
    const v = await server.electricianLinkView(await token(), NOW).catch((e) => e);
    expect(v).not.toBeInstanceOf(Error);
    expect((v as { access: unknown }).access).toBeNull();
  });
});

describe("the page", () => {
  const facts = { whoBooks: "electrician" as const, handedBack: false, certificateIn: false, now: new Date(NOW), piesa: { start: "2026-11-06T23:00:00Z", formUrl: "https://app.au.safetyculture.com/inspection/a3", outcome: null, upgradesSameDay: false }, upgrades: { start: null, formUrl: null, formDone: false } };
  const d = (access: { name: string; role: "tenant" | "property manager"; phone: string } | null) => ({ business: "Spark Co", firstName: "Sam", jobNumber: "HV-5001", owner: { name: "Helen Owner", phone: "0411 111 111" }, address: "12 Smith St, Kew VIC 3101", view: electricianStep(facts), buttonUrl: "https://app.au.safetyculture.com/inspection/a3", access });
  test("shows the person who lets you in, with a tel: link, above the owner, and the DRAFT call line", () => {
    const h = renderToStaticMarkup(<ElectricianLinkBody d={d({ name: "Tina Lee", role: "tenant", phone: "+61400111222" })} />);
    expect(h).toContain("data-electrician-access");
    expect(h).toContain("Tina Lee");
    expect(h).toContain("(tenant)");
    expect(h).toContain('href="tel:+61400111222"');
    expect(h).toContain("Call Tina to arrange the time.");
    expect(h.indexOf("data-electrician-access")).toBeLessThan(h.indexOf("Helen Owner"));
    expect(h).toContain("Helen Owner");
  });
  test("no access person: the page is unchanged", () => {
    const h = renderToStaticMarkup(<ElectricianLinkBody d={d(null)} />);
    expect(h).not.toContain("data-electrician-access");
    expect(h).not.toContain("arrange the time");
  });
});

describe("the PIESA booked email", () => {
  const base = { jobNumber: "HV-1234", firstName: "Will", startIso: "2026-11-05T23:00:00Z", address: "12 Example St, Box Hill VIC 3128", owner: { name: "Sarah Brown", phone: "0400 000 000" }, mittiUrl: "https://app.au.safetyculture.com/inspection/abc" };
  const access = { name: "Tina Lee", role: "tenant", phone: "0400 111 222" };
  test("flag starts off; with it off the email is byte-identical to Task 4's even when an access person is passed", () => {
    expect(mail.ELECTRICIAN_ACCESS_ROWS_APPROVED).toBe(false);
    const a = mail.renderElectricianPiesaBooked(base), b = mail.renderElectricianPiesaBooked({ ...base, access });
    expect(b).toEqual(a);
    expect(a.text).not.toContain("Lets you in");
    expect(a.text).toContain("Need to change the time? Call Sarah Brown, then update it on the job.");
  });
  test("flag on: one more table row 'Lets you in' and the change line names that person (DRAFT)", () => {
    const r = mail.renderElectricianPiesaBooked({ ...base, access }, { accessRowsApproved: true });
    expect(r.text).toContain("Lets you in: Tina Lee (tenant), 0400 111 222");
    expect(r.html).toContain("Lets you in");
    expect(r.html).toContain("Tina Lee (tenant), 0400 111 222");
    expect(r.text).toContain("Need to change the time? Call Tina Lee, then update it on the job.");
    expect(r.text).not.toContain("Call Sarah Brown");
    expect(r.text).toContain("Owner: Sarah Brown, 0400 000 000");
    // The approved wording is otherwise untouched.
    expect(r.subject).toBe("HV-1234: PIESA booked, Fri 6 Nov 10:00am");
    for (const s of ["Hi Will,", "PIESA booked: HV-1234", "Day: Fri 6 Nov", "Arriving: 10:00am", "Open the Mitti form"]) expect(r.text).toContain(s);
  });
  test("flag on, no access person: exactly Task 4's email", () => {
    expect(mail.renderElectricianPiesaBooked({ ...base, access: null }, { accessRowsApproved: true })).toEqual(mail.renderElectricianPiesaBooked(base));
  });
  test("the sender reads the access person through its deps only when the flag is on, and only from the job's rental answers", () => {
    const src = readFileSync("src/lib/in-house-electrician-booked.server.ts", "utf8");
    expect(src).toContain("accessPerson:");
    expect(src).toContain("ELECTRICIAN_ACCESS_ROWS_APPROVED");
    expect(src).toContain("accessPersonFor(jobId)");
    expect(src).toMatch(/accessRowsApproved\s*\?\s*await d\.accessPerson\(jobId\)/);
  });
});
