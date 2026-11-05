// Plan 2026-11-02 Task 4: the guarded sender — ONE installer-office email per Give, once per batch id.
import { expect, test } from "bun:test";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { memoryPostgrest } from "./helpers/memory-postgrest";
import * as core from "../src/lib/in-house-give-email.core";
import * as layout from "../src/lib/partner-email.core";
import * as names from "../src/lib/display-name.core";
import * as testCore from "../src/lib/test-send.core";
import { stableUuid } from "../src/lib/mitti-create-claim.core";

const load = (file: string, deps: Record<string, unknown>) => {
  const api: any = {};
  new Function("exports", "require", ts.transpile(readFileSync(file, "utf8"), { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }))(api, (p: string) => {
    if (!(p in deps)) throw Error(`Unmocked ${p}`);
    return deps[p];
  });
  return api;
};

const JOBS: core.GiveEmailJob[] = [
  { jobId: "j1", jobNumber: "HV-2730", ownerName: "WAYNE WILSON", ownerMobile: "0412 000 000", address: "1 Example St, Clayton 3168" },
  { jobId: "j2", jobNumber: "HV-2731", ownerName: null, ownerMobile: null, address: null },
  { jobId: "j3", jobNumber: "HV-2732", ownerName: "Helen Sample", ownerMobile: "0400 000 000", address: "2 Sample Rd, Clayton 3168" },
];

function fixture(biz: Record<string, unknown> = { id: "biz", name: "RAPID INSULATION", email: "Office@Rapid.example", onboarding_notes: null }) {
  const rows: Record<string, any[]> = { businesses: [biz], workflow_events: [] };
  const db = memoryPostgrest(rows);
  const office: any[] = [], tests: any[] = [];
  let paused: string | null = null;
  const admin = { from: (table: string) => {
    const q = db.from(table);
    const eq = q.eq; q.eq = (c: string, v: unknown) => (c === "details" && typeof v === "string" ? q.contains(c, JSON.parse(v)) : eq(c, v));
    return q;
  } };
  const clientDep = { "@/integrations/supabase/client.server": { supabaseAdmin: admin } };
  const notices = load("src/lib/in-house-booking-notices.server.ts", {
    ...clientDep, "./in-house-booking.core": {}, "./partner-email.core": layout, "./mitti-create-claim.core": { stableUuid },
  });
  const api = load("src/lib/in-house-give-email.server.ts", {
    ...clientDep,
    "./in-house-give-email.core": core, "./display-name.core": names, "./test-send.core": testCore,
    "./in-house-booking-notices.server": notices,
    "./trade-pause.server": { tradeMessagesPausedNow: async (o: { businessId?: string }) => { expect(o.businessId).toBe("biz"); return paused; } },
    "./office-email.server": { sendOfficeEmail: async (p: any) => { office.push(p); return { channel: "email", to: p.to, status: "sent", detail: "Accepted by the email service" }; } },
    "./test-send.server": { sendTestEmail: async (ctx: any, to: string, subject: string, html: string, text: string) => { tests.push({ ctx, to, subject, html, text }); return { channel: "email", to, status: "sent", detail: "ok" }; } },
  });
  return { api, rows, office, tests, pause: (r: string | null) => { paused = r; } };
}
const give = (f: ReturnType<typeof fixture>, approved = true) => f.api.sendInHouseGiveEmail({ batchId: "B1", businessId: "biz", jobs: JOBS, actorId: "jo", approved });

test("3 given jobs → ONE office email to the installer's office listing all 3", async () => {
  const f = fixture();
  expect(await give(f)).toEqual({ status: "sent" });
  expect(f.office).toHaveLength(1);
  const m = f.office[0];
  expect(m.recipient).toBe("partner");
  expect(m.to).toBe("office@rapid.example");
  expect(m.subject).toBe("New free Ready Check jobs from Home Insulation Victoria");
  expect(m.idempotencyKey).toBe("in-house-give:v1:B1");
  expect(m.record).toEqual({ businessId: "biz" });
  expect(m.actorId).toBe("jo");
  expect(m.contactName).toBe("Rapid Insulation");
  for (const n of ["HV-2730", "HV-2731", "HV-2732"]) expect(m.text).toContain(n);
  expect(m.text).toContain("HV-2731\nOwner\n\nMobile: no mobile on file\n\nAddress: address not recorded");
  expect(m.text).toContain("Call each owner to book their free Ready Check.");
  expect(m.html).not.toContain("TEST — only sent to Jo");
  expect(f.tests).toHaveLength(0);
});

test("the same Give twice sends one email", async () => {
  const f = fixture();
  await give(f);
  const again = await give(f);
  expect(f.office).toHaveLength(1);
  expect(again.status).not.toBe("sent");
});

test("not approved → nothing recorded or sent", async () => {
  const f = fixture();
  expect(await give(f, false)).toEqual({ status: "not_approved" });
  expect(f.office).toHaveLength(0);
  expect(f.rows.workflow_events).toHaveLength(0);
});

test("default switch is off: real installers get nothing without approved", async () => {
  const f = fixture();
  expect((await f.api.sendInHouseGiveEmail({ batchId: "B1", businessId: "biz", jobs: JOBS, actorId: "jo" })).status).toBe("not_approved");
  expect(f.office).toHaveLength(0);
});

test("trade messages paused → held, no claim, so a later try can still send", async () => {
  const f = fixture();
  f.pause("Trade messages are paused");
  expect(await give(f)).toEqual({ status: "held", detail: "Trade messages are paused" });
  expect(f.office).toHaveLength(0);
  expect(f.rows.workflow_events).toHaveLength(0);
  f.pause(null);
  expect((await give(f)).status).toBe("sent");
  expect(f.office).toHaveLength(1);
});

test("TEST partner → test-send only (even while the switch is off), once per Give", async () => {
  const f = fixture({ id: "biz", name: "TEST INSTALLER", email: "jolowexo@hotmail.com", onboarding_notes: "[TEST PARTNER] demo" });
  expect(await f.api.sendInHouseGiveEmail({ batchId: "B1", businessId: "biz", jobs: JOBS, actorId: "jo" })).toEqual({ status: "test_sent" });
  await f.api.sendInHouseGiveEmail({ batchId: "B1", businessId: "biz", jobs: JOBS, actorId: "jo" });
  expect(f.office).toHaveLength(0);
  expect(f.tests).toHaveLength(1);
  expect(f.tests[0].ctx.partnerIsTest).toBe(true);
  expect(f.tests[0].subject).toBe("New free Ready Check jobs from Home Insulation Victoria");
  expect(f.tests[0].text).toContain("HV-2732");
});

test("no office email on file → no_email, nothing sent", async () => {
  const f = fixture({ id: "biz", name: "Rapid Insulation", email: "  ", onboarding_notes: null });
  expect((await give(f)).status).toBe("no_email");
  expect(f.office).toHaveLength(0);
  expect(f.rows.workflow_events).toHaveLength(0);
});

test("no jobs given → no email", async () => {
  const f = fixture();
  expect((await f.api.sendInHouseGiveEmail({ batchId: "B1", businessId: "biz", jobs: [], actorId: "jo", approved: true })).status).toBe("not_sent");
  expect(f.office).toHaveLength(0);
});
