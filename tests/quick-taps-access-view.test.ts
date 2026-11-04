// Quick taps, Task 5 (Jo 2 Nov 2026): who will be at the home, shown to the installer (only while owner contact is
// shown, as text only — final review 3: not in the electrician view, no "Call tenant") and to the office. Read from the newest quick_taps_answered event; older events without an answer, no event or
// a failed read show nothing. Runs tradeJobStatus on an in-memory fake database.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
const failReads = new Set<string>();
const get = (r: Row, path: string): unknown => path.split(".").reduce<unknown>((o, k) => (o == null ? o : (o as Row)[k]), r);
function fakeAdmin() {
  return {
    from(table: string) {
      let lim = Infinity; let one = false; let evType: unknown = null;
      const preds: ((r: Row) => boolean)[] = [];
      const b: Record<string, unknown> & PromiseLike<unknown> = {
        select() { return b; },
        eq(c: string, v: unknown) { if (c === "event_type") evType = v; preds.push((r) => get(r, c) === v); return b; },
        neq(c: string, v: unknown) { preds.push((r) => get(r, c) !== v); return b; },
        in(c: string, v: unknown[]) { preds.push((r) => v.includes(get(r, c))); return b; },
        order() { return b; }, range() { return b; },
        limit(n: number) { lim = n; return b; },
        maybeSingle() { one = true; return b; },
        single() { one = true; return b; },
        then(res, rej) {
          // Rows are deliberately returned oldest first: the code must pick the newest itself.
          const hit = (tables[table] ?? []).filter((r) => preds.every((p) => p(r)));
          const out = failReads.has(table) && evType === "quick_taps_answered" ? { data: null, error: { message: "read failed", code: "57014" } } : { data: one ? hit[0] ?? null : hit.slice(0, lim), error: null };
          return Promise.resolve(out).then(res, rej);
        },
      };
      return b;
    },
  };
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: fakeAdmin() }));
const BIZ = "b0000000-0000-0000-0000-000000000001";
const JOB = "j0000000-0000-0000-0000-000000000001";
mock.module("../src/lib/trade-view.server", () => ({
  requireTradeJob: async () => ({ biz: { id: BIZ, name: "Rapid" }, boss: true, kind: "installer" }),
}));
mock.module("../src/lib/in-house-suppression.server", () => ({ readInHouseDispatchState: async () => ({ held: new Set(), failed: false }) }));

const { tradeJobStatus } = await import("../src/lib/job-status.server");
const { readJobAccess } = await import("../src/lib/quick-taps-access.server");

const answered = (at: string, answers: Row) => ({ job_id: JOB, event_type: "quick_taps_answered", created_at: at, details: { answers } });
beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  failReads.clear();
  tables["jobs"] = [{ id: JOB, job_number: "HV-1001", stage: "ready_check_scheduled", channel: "hivic_sourced", originating_installer_business_id: null, created_at: "2026-10-01T00:00:00Z" }];
  tables["bookings"] = [{ job_id: JOB, kind: "ready_check", status: "confirmed", scheduled_start: "2026-11-05T00:00:00Z", scheduled_end: null, business_id: BIZ, businesses: { name: "Rapid", trading_name: null } }];
  tables["workflow_events"] = [];
});

describe("tradeJobStatus access", () => {
  test("tenant answer", async () => {
    tables["workflow_events"]!.push(answered("2026-11-01T00:00:00Z", { access: { who: "tenant", name: "Sam Lee", mobile: "+61412345678" } }));
    const s = await tradeJobStatus("u1", JOB);
    expect(s.ownerContactVisible).toBe(true);
    expect(s.access).toBe("At the home: tenant — Sam Lee, +61412345678");
    expect("accessTenantMobile" in s).toBe(false); // final review 3: shown as text only, no separate number
  });
  test("owner answer", async () => {
    tables["workflow_events"]!.push(answered("2026-11-01T00:00:00Z", { access: { who: "owner" } }));
    const s = await tradeJobStatus("u1", JOB);
    expect(s.access).toBe("At the home: owner");
  });
  test("old event without access, or no event", async () => {
    expect((await tradeJobStatus("u1", JOB)).access).toBeNull();
    tables["workflow_events"]!.push(answered("2026-11-01T00:00:00Z", { hatch: "yes" }));
    const s = await tradeJobStatus("u1", JOB);
    expect(s.access).toBeNull();
  });
  test("two answers: the newest wins", async () => {
    tables["workflow_events"]!.push(answered("2026-11-01T00:00:00Z", { access: { who: "tenant", name: "Sam Lee", mobile: "+61412345678" } }));
    tables["workflow_events"]!.push(answered("2026-11-02T00:00:00Z", { access: { who: "owner" } }));
    expect((await tradeJobStatus("u1", JOB)).access).toBe("At the home: owner");
    tables["workflow_events"]!.push(answered("2026-11-03T00:00:00Z", { access: { who: "tenant", name: "Ana Wu", mobile: "+61400000001" } }));
    expect((await tradeJobStatus("u1", JOB)).access).toBe("At the home: tenant — Ana Wu, +61400000001");
  });
  test("hidden whenever owner contact is hidden", async () => {
    tables["workflow_events"]!.push(answered("2026-11-01T00:00:00Z", { access: { who: "tenant", name: "Sam Lee", mobile: "+61412345678" } }));
    tables["bookings"]![0]!["status"] = "completed"; // this business's visits are all done → contact gone
    const s = await tradeJobStatus("u1", JOB);
    expect(s.ownerContactVisible).toBe(false);
    expect(s.access).toBeNull();
  });
  test("a failed read shows nothing and never breaks the page", async () => {
    tables["workflow_events"]!.push(answered("2026-11-01T00:00:00Z", { access: { who: "owner" } }));
    failReads.add("workflow_events");
    const s = await tradeJobStatus("u1", JOB);
    expect(s.access).toBeNull();
    expect(s.ownerContactVisible).toBe(true);
  });
  test("invalid saved answer shows nothing", async () => {
    tables["workflow_events"]!.push(answered("2026-11-01T00:00:00Z", { access: { who: "tenant", name: "", mobile: "nope" } }));
    expect((await tradeJobStatus("u1", JOB)).access).toBeNull();
  });
});

describe("readJobAccess (office)", () => {
  test("same line for the office", async () => {
    tables["workflow_events"]!.push(answered("2026-11-01T00:00:00Z", { access: { who: "tenant", name: "Sam Lee", mobile: "+61412345678" } }));
    expect(await readJobAccess(JOB)).toEqual({ line: "At the home: tenant — Sam Lee, +61412345678" });
  });
  test("nothing answered", async () => {
    expect(await readJobAccess(JOB)).toEqual({ line: null });
  });
});

describe("pages", () => {
  const read = (p: string) => readFileSync(p, "utf8");
  // Part 5 (installer job page M2) moved the "who lets you in" line into the job page's Owner rows: trade-view.server
  // `tradeJobPage` builds them with `ownerRows(..., access: accessPerson)` only while the owner contact is released
  // (`showContact`), and job-page-rows.core adds the "Lets you in" row for a tenant / property manager only.
  test("installer page: the access person is an Owner row, only when owner contact is shown", () => {
    const srv = read("src/lib/trade-view.server.ts");
    expect(srv).toContain("const owner = showContact ? ownerRows({ name: ownerName, phone: ownerPhone, email: j?.owners?.email?.trim() || null, access: i.accessPerson }) : [];");
    const rows = read("src/lib/job-page-rows.core.ts");
    expect(rows).toContain('if (f.access && f.access.who !== "owner")');
    expect(rows).toContain("rows.push([W.letsYouIn,");
    // Final review 3: no "Call tenant" link and no tenant tel: link anywhere on the trade job page.
    const r = read("src/routes/_authenticated/field.$jobId.tsx");
    expect(r).not.toContain("Call tenant");
    expect(r).not.toContain("accessTenantMobile");
  });
  test("final review 3: the shared job body (FieldJobBody) has no access line of its own; electricians get theirs on the /e/ link (Part 6 Task 8)", () => {
    const r = read("src/routes/_authenticated/field.$jobId.tsx");
    const body = r.slice(r.indexOf("function FieldJobBody("), r.indexOf("function InstallerFlow("));
    expect(body.length).toBeGreaterThan(100);
    expect(body).not.toContain(".access");
    expect(body).not.toContain("data-at-the-home");
    expect(body).not.toContain("Call tenant");
    expect(read("src/components/trade/ElectricianLinkBody.tsx")).toContain("Lets you in:");
  });
  test("office job page: header shows the line", () => {
    expect(read("src/lib/office-job-page.server.ts")).toContain("access: access.line");
    expect(read("src/components/portal/office-job.tsx")).toContain("{h.access && ");
  });
  test("the tenant is never sent anything", () => {
    for (const p of ["src/lib/quick-taps-access.server.ts", "src/lib/job-status.server.ts"]) expect(read(p)).not.toMatch(/sendSms|sendGuardedOwnerEmail|sendTestEmail|resendSend/);
  });
});
