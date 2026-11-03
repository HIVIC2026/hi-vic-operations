// New job flow, Part 6, Task 4: the approved "PIESA booked" email to the electrician (decision #39), with the job link.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { memoryPostgrest } from "./helpers/memory-postgrest";
import { stableUuid } from "../src/lib/mitti-create-claim.core";
import { partnerEmailLayout } from "../src/lib/partner-email.core";
import * as core from "../src/lib/electrician-piesa-booked-email.core";

const base = { jobNumber: "HV-1234", firstName: "Will", startIso: "2026-11-05T23:00:00Z", address: "12 Example St, Box Hill VIC 3128", owner: { name: "Sarah Brown", phone: "0400 000 000" }, mittiUrl: "https://app.au.safetyculture.com/inspection/abc" };

test("approved wording: subject, greeting, heading, table, button, change line", () => {
  const r = core.renderElectricianPiesaBooked(base);
  expect(r.subject).toBe("HV-1234: PIESA booked, Fri 6 Nov 10:00am");
  expect(r.text).toContain("Hi Will,");
  expect(r.text).toContain("PIESA booked: HV-1234");
  for (const s of ["Day", "Fri 6 Nov", "Arriving", "10:00am", "Address", "12 Example St, Box Hill VIC 3128", "Owner", "Sarah Brown, 0400 000 000", "Open the Mitti form"]) expect(r.text).toContain(s);
  expect(r.text).toContain("Need to change the time? Call Sarah Brown, then update it on the job.");
  expect(r.text + r.html).not.toMatch(/Pre Insulation Electrical Safety Assessment|portal|fixes|HIV/);
  expect(r.html).toContain("Open the Mitti form");
  expect(r.html).toContain(base.mittiUrl);
});

test("no Mitti url: no button and no button text; no first name: plain greeting; no owner phone: name only", () => {
  const r = core.renderElectricianPiesaBooked({ ...base, mittiUrl: null, firstName: null, owner: { name: "Sarah Brown", phone: null } });
  expect(r.text).not.toContain("Open the Mitti form");
  expect(r.html).not.toContain("Open the Mitti form");
  expect(r.text).toContain("Hi,");
  expect(r.text).toContain("Owner: Sarah Brown");
  expect(r.text).not.toContain("Sarah Brown, 0");
});

test("job link: 'update it on the job' links to the electrician's /e/ page; without a link it is plain words", () => {
  const url = "https://portal.example/e/tok123";
  const w = core.renderElectricianPiesaBooked({ ...base, jobUrl: url });
  expect(w.html).toContain(`href="${url}"`);
  expect(w.text).toContain(url);
  const wo = core.renderElectricianPiesaBooked(base);
  expect(wo.html).not.toContain("/e/");
  expect(wo.text).not.toContain("/e/");
});

test("DRAFT team greeting for the office recipient; one person's greeting stays the approved default", () => {
  expect(core.renderElectricianPiesaBooked({ ...base, team: "Spark Co" }).text).toContain("Hi Spark Co team,");
  expect(core.renderElectricianPiesaBooked({ ...base, team: "Spark Co" }).text).not.toContain("Hi Will,");
  expect(core.renderElectricianPiesaBooked(base).text).toContain("Hi Will,");
});

test("a TEST job is labelled", () => {
  expect(core.renderElectricianPiesaBooked({ ...base, test: true }).text).toContain("TEST");
});

test("the stored copy hides the link token", () => {
  const m = core.maskPiesaBookedLink("Update: https://portal.example/e/tok123 thanks");
  expect(m).not.toContain("tok123");
  expect(m).toContain("/e/••••");
});

test("flag starts off", () => { expect(core.PIESA_BOOKED_EMAIL_APPROVED).toBe(false); });

// ---- the sender, real module against an in-memory database ----
function load(deps: Record<string, unknown>) {
  const api: any = {};
  new Function("exports", "require", ts.transpile(readFileSync("src/lib/in-house-electrician-booked.server.ts", "utf8"), { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }))(api, (p: string) => { if (!(p in deps)) throw Error(`Unexpected ${p}`); return deps[p]; });
  return api;
}
const rows = (over: any = {}): any => ({
  jobs: [{ id: "j", job_number: "HV-1234", source: over.source ?? "base44", owner_id: "o", property_id: "p", deleted_at: null }],
  owners: [{ id: "o", full_name: "Sarah Brown", phone: "0400 000 000" }],
  properties: [{ id: "p", address_line: "12 Example St", suburb: "Box Hill", postcode: "3128" }],
  bookings: [{ id: "b", job_id: "j", kind: "assessment", status: "confirmed", contractor_id: "e", scheduled_start: "2026-11-05T23:00:00Z" }],
  partner_workers: [{ id: "w", profile_id: "e", business_id: "biz", email: "worker@example.invalid", full_legal_name: "Will Casdorff", removed_at: null }],
  workflow_events: [],
});
function setup(r: any, extra: Record<string, unknown> = {}) {
  const sends: any[] = []; const tests: any[] = [];
  const deps: any = {
    "@/integrations/supabase/client.server": { supabaseAdmin: memoryPostgrest(r) }, "./mitti-create-claim.core": { stableUuid }, "./partner-email.core": { partnerEmailLayout },
    "./electrician-piesa-booked-email.core": core,
    "./trade-pause.server": { tradeMessagesPausedNow: async () => null }, "./qa-inbox.server": { qaDeliveryHeld: async () => false },
    "./office-email.server": { sendOfficeEmail: async (p: any) => { sends.push(p); return { status: "sent" }; } },
    "./test-send.server": { sendTestEmail: async (...a: any[]) => { tests.push(a); return { status: "sent" }; } },
    ...extra,
  };
  return { api: load(deps), sends, tests };
}
const on = (o: any = {}) => ({ approved: true, officeContact: async () => ({ name: "Spark Co", tradingName: null, officePhone: "03 9000 0002", email: "office@spark.test" }), mintLink: async () => "https://portal.example/e/tok123", mittiUrl: async () => "https://app.au.safetyculture.com/inspection/abc", ...o });

test("flag off: the current email, to the worker, unchanged", async () => {
  const { api, sends } = setup(rows());
  await api.notifyInHouseElectricianBooked("j", "b");
  expect(sends).toHaveLength(1);
  expect(sends[0].to).toBe("worker@example.invalid");
  expect(sends[0].subject).toBe("HV-1234: Pre Insulation Electrical Safety Assessment (PIESA) booked");
});

test("flag on: approved email to the electrician's OFFICE email, same key, stored copy has no token", async () => {
  const { api, sends } = setup(rows());
  await api.notifyInHouseElectricianBooked("j", "b", new Date("2026-11-03T00:00:00Z"), on());
  expect(sends).toHaveLength(1);
  const s = sends[0];
  expect(s.to).toBe("office@spark.test");
  expect(s.subject).toBe("HV-1234: PIESA booked, Fri 6 Nov 10:00am");
  expect(s.idempotencyKey).toBe("in-house-electrician-booked:v1:b:e");
  expect(s.text).toContain("Hi Spark Co team,"); // DRAFT: the email goes to the business office, so the greeting is the team's, not one person's
  expect(s.text).toContain("Sarah Brown, 0400 000 000");
  expect(s.text).toContain("/e/tok123");
  expect(s.html).toContain("/e/tok123");
  expect(s.message).not.toContain("tok123");
  expect(s.message).toContain("/e/••••");
});

test("flag on: no office email on file -> held, nothing sent, and it sends once an email is added", async () => {
  const { api, sends } = setup(rows());
  const noEmail = on({ officeContact: async () => ({ name: "Spark Co", tradingName: null, officePhone: "03", email: null }) });
  expect(await api.notifyInHouseElectricianBooked("j", "b", new Date("2026-11-03T00:00:00Z"), noEmail)).toBe("held");
  expect(sends).toHaveLength(0);
  await api.notifyInHouseElectricianBooked("j", "b", new Date("2026-11-03T00:05:00Z"), on());
  expect(sends).toHaveLength(1);
});

test("flag on: a failed link or missing Mitti form still sends, just without them; an already-sent booking is not sent again", async () => {
  const { api, sends } = setup(rows());
  await api.notifyInHouseElectricianBooked("j", "b", new Date("2026-11-03T00:00:00Z"), on({ mintLink: async () => { throw new Error("x"); }, mittiUrl: async () => null }));
  expect(sends).toHaveLength(1);
  expect(sends[0].text).not.toContain("/e/");
  expect(sends[0].text).not.toContain("Open the Mitti form");
  await api.notifyInHouseElectricianBooked("j", "b", new Date("2026-11-03T00:06:00Z"), on());
  expect(sends).toHaveLength(1);
});

test("flag on, TEST job: goes to test-send, not the office sender", async () => {
  const { api, sends, tests } = setup(rows({ source: "qa_test" }));
  await api.notifyInHouseElectricianBooked("j", "b", new Date("2026-11-03T00:00:00Z"), on());
  expect(sends).toHaveLength(0);
  expect(tests).toHaveLength(1);
  expect(tests[0][1]).toBe("office@spark.test");
});

test("source: the sender keeps the same key", () => {
  // C1: a no-login electrician has no profile, so the booking's contractor_id is NULL; the key then names the worker (legacy bookings keep the contractor key).
  expect(readFileSync("src/lib/in-house-electrician-booked.server.ts", "utf8")).toContain("in-house-electrician-booked:v1:${bookingId}:${book.data.contractor_id??worker.data.id}");
});
