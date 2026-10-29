// HV-3542 (Jo 30 Oct 2026): a confirmed Ready Check booking makes the Mitti form inside the request, kept alive with
// waitUntil, instead of a fire-and-forget step that can be lost. Every "no" leaves one plain note on the job.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { bookedSkipReason, BOOKED_SKIP_EVENT } from "../src/lib/mitti-immediate.core";

// ---------- in-memory admin client ----------
type Row = Record<string, unknown>;
const T: Record<string, Row[]> = {};
function from(table: string) {
  let head = false; let wantCount = false;
  const f: [string, unknown][] = [];
  const hit = () => (T[table] ?? []).filter((r) => f.every(([k, v]) => r[k] === v));
  const q: Record<string, unknown> = {};
  Object.assign(q, {
    select: (_c?: string, o?: { count?: string; head?: boolean }) => { head = !!o?.head; wantCount = !!o?.count; return q; },
    eq: (k: string, v: unknown) => { f.push([k, v]); return q; },
    maybeSingle: async () => ({ data: hit()[0] ?? null, error: null }),
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve({ data: head ? null : hit(), error: null, count: wantCount ? hit().length : null }).then(res, rej),
  });
  return q;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from } }));
mock.module("../src/lib/owner-gates.server", () => ({ gateAComplete: async () => true }));
const events: { jobId: string; type: string; summary: string; details: Record<string, unknown> }[] = [];
mock.module("../src/lib/workflow.server", () => ({
  WorkflowError: class extends Error {},
  logEvent: async (jobId: string, _a: string | null, type: string, summary: string, details: Record<string, unknown> = {}) => { events.push({ jobId, type, summary, details }); },
}));
const mitti = { created: [] as string[], fail: null as string | null };
mock.module("../src/lib/mitti.server", () => ({
  realMittiCall: async () => { throw new Error("no network in tests"); },
  createAssignMittiAudit: async (jobId: string) => {
    await new Promise((r) => setTimeout(r, 30)); // Mitti takes a moment
    if (mitti.fail) throw new Error(mitti.fail);
    mitti.created.push(jobId);
    return { auditId: "audit_1", reused: false, scope: "MEASURE_UP_ONLY" };
  },
}));
const C = await import("../src/lib/mitti-create.server");
const { requestContext } = await import("../src/lib/background.server");

const JOB = "a0000000-0000-4000-8000-0000000035a2", BIZ = "a0000000-0000-4000-8000-000000000011", INSTALLER = "a0000000-0000-4000-8000-000000000003";
beforeEach(() => {
  for (const k of Object.keys(T)) delete T[k];
  events.length = 0; mitti.created.length = 0; mitti.fail = null;
  Object.assign(T, {
    jobs: [{ id: JOB, channel: "hivic_sourced", source: "website", stage: "ready_check_scheduled", originating_installer_business_id: null }],
    job_assignments: [{ job_id: JOB, role: "installer", active: true, user_id: INSTALLER, business_id: BIZ }],
    businesses: [{ id: BIZ, mitti_account_invited: true }],
    workflow_settings: [{ id: 1, mitti_ready_check_template_id: "tpl_a2", mitti_ready_check_priced_template_id: "tpl_a1", auto_send_mitti: true }],
    ceiling_measurements: [],
    bookings: [{ job_id: JOB, kind: "ready_check", status: "confirmed" }],
  });
});
const skipNotes = () => events.filter((e) => e.type === BOOKED_SKIP_EVENT);

describe("bookedSkipReason", () => {
  const ok = { auditId: null, measurementComplete: false, installerUserId: "u", mittiInvited: true, templateSet: true, autoSend: true, gateADone: true, booked: true };
  test("starts only when booked and every switch allows it", () => {
    expect(bookedSkipReason(ok)).toBeNull();
    expect(bookedSkipReason({ ...ok, booked: false })).toBe("the Ready Check isn't booked yet");
    expect(bookedSkipReason({ ...ok, auditId: "a" })).toBe("a Mitti form is already on the job");
    expect(bookedSkipReason({ ...ok, mittiInvited: false })).toBe("the installer's business is not invited to Mitti");
    expect(bookedSkipReason(null)).toBe("job not found");
  });
});

describe("onReadyCheckBooked (HV-3542)", () => {
  test("waits for the form to be made before returning", async () => {
    expect(await C.onReadyCheckBooked(JOB, INSTALLER)).toBe("scheduled");
    expect(mitti.created).toEqual([JOB]);
    expect(skipNotes()).toEqual([]);
  });

  test("hands the same work to waitUntil so a dropped connection can't lose it", async () => {
    const kept: Promise<unknown>[] = [];
    const result = await requestContext.run({ waitUntil: (p) => { kept.push(p); } }, () => C.onReadyCheckBooked(JOB, INSTALLER));
    expect(kept).toHaveLength(1);
    expect(await kept[0]).toBe(result);
    expect(mitti.created).toEqual([JOB]);
  });

  test.each([
    ["not booked", () => { T.bookings = []; }, "the Ready Check isn't booked yet"],
    ["form already there", () => { T.ceiling_measurements = [{ job_id: JOB, is_current: true, external_source: "mitti", external_id: "audit_x", status: "draft" }]; }, "a Mitti form is already on the job"],
    ["Mitti not invited", () => { T.businesses![0]!.mitti_account_invited = false; }, "the installer's business is not invited to Mitti"],
  ] as [string, () => void, string][])("%s: skipped with one plain note", async (_name, setup, reason) => {
    setup();
    expect(await C.onReadyCheckBooked(JOB, INSTALLER)).toBe("skipped");
    expect(mitti.created).toEqual([]);
    expect(skipNotes()).toHaveLength(1);
    expect(skipNotes()[0]!.details).toEqual({ reason });
    expect(skipNotes()[0]!.summary).toContain(reason);
  });

  test("a Mitti error doesn't throw and is logged for the retry sweep, with one quick attempt only", async () => {
    mitti.fail = "Mitti user not found for info@example.test";
    const t0 = Date.now();
    expect(await C.onReadyCheckBooked(JOB, INSTALLER)).toBe("scheduled");
    expect(Date.now() - t0).toBeLessThan(2_000); // no 5s/20s retries
    const logged = events.filter((e) => e.type === "mitti_access_needed");
    expect(logged).toHaveLength(1);
    expect(logged[0]!.summary).toContain("could not be created");
  });
});
