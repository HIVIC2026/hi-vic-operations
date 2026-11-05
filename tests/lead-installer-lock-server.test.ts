// Deep Part 5a (Jo 4–5 Nov 2026): the Lead Installer lock (2 days before the install start, Melbourne wall-clock) on
// every install writer — read fresh from the current confirmed booking inside the server, never a page's copy. Replaces
// the Part 7 Task 6 "5pm two days before" tests (that 9am confirm email is retired; lead-installer-reminder.test.ts
// covers its replacement).
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { LEAD_LOCKED_MESSAGE } from "../src/lib/prestart.core";

const START = "2026-11-12T20:30:00Z"; // Fri 13 Nov 2026 7:30am Melbourne (AEDT)
const BOOKED = "2026-11-09T00:00:00Z";
const at = (iso: string) => new Date(iso);
const WED_0729 = "2026-11-10T20:29:00Z", WED_0730 = "2026-11-10T20:30:00Z", WED_1100 = "2026-11-11T00:00:00Z";

type Row = Record<string, unknown>;
let tables: Record<string, Row[]> = {};
function from(t: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let order: { col: string; asc: boolean } | null = null;
  const res = () => {
    let rows = (tables[t] ?? []).filter((x) => filters.every((f) => f(x)));
    if (order) rows = [...rows].sort((a, b) => String(a[order!.col] ?? "").localeCompare(String(b[order!.col] ?? "")) * (order!.asc ? 1 : -1));
    return { data: rows, error: null };
  };
  const one = async () => { const r = res(); return { ...r, data: r.data[0] ?? null }; };
  const q: Record<string, unknown> = {};
  Object.assign(q, {
    select: () => q,
    eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return q; },
    neq: (k: string, v: unknown) => { filters.push((r) => r[k] !== v); return q; },
    order: (col: string, o?: { ascending?: boolean }) => { order = { col, asc: o?.ascending !== false }; return q; },
    limit: () => q, maybeSingle: one, single: one,
    then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(res()).then(ok, bad),
  });
  return q;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from } }));
mock.module("../src/lib/job-facts.server", () => ({ jobAdmin: { from } }));
mock.module("../src/lib/workflow.server", () => ({ WorkflowError: class WorkflowError extends Error {}, logEvent: async () => {} }));

const { assertLeadInstallerUnlocked, leadInstallerLockState } = await import("../src/lib/lead-installer-confirm.server");

beforeEach(() => {
  tables = {
    bookings: [{ id: "BK1", job_id: "J1", kind: "installation", status: "confirmed", scheduled_start: START, created_at: BOOKED }],
    jobs: [{ id: "J1", installation_completed_at: null }],
    workflow_events: [
      { id: "e1", job_id: "J1", event_type: "visit_allocated", created_at: "2026-11-09T01:00:00Z", details: { visit: "install", worker_id: "w1" } },
      { id: "e2", job_id: "J1", event_type: "piisa_crew_selected", created_at: "2026-11-09T01:00:01Z", details: { selection: { lead: "w1", additional: [{ workerId: "w2" }, { workerId: "w3" }] } } },
    ],
  };
});

describe("the lock on the writers (server check, current booking read fresh)", () => {
  test("from Wed 11 Nov 7:30am: a different Lead or a moved start is refused with LEAD_LOCKED_MESSAGE; same Lead / same start / crew-only pass", async () => {
    await expect(assertLeadInstallerUnlocked("J1", { newLeadId: "w2" }, at(WED_0730))).rejects.toThrow(LEAD_LOCKED_MESSAGE);
    await expect(assertLeadInstallerUnlocked("J1", { newStart: "2026-11-13T20:30:00Z" }, at(WED_1100))).rejects.toThrow(LEAD_LOCKED_MESSAGE);
    await expect(assertLeadInstallerUnlocked("J1", { newLeadId: "w1", newStart: START }, at(WED_0730))).resolves.toBeUndefined();
    await expect(assertLeadInstallerUnlocked("J1", {}, at(WED_0730))).resolves.toBeUndefined();
    expect(await leadInstallerLockState("J1", at(WED_0730))).toEqual({ locked: true, start: START, bookingId: "BK1", leadId: "w1" });
  });
  test("a minute before the lock everything passes; no confirmed install booking → never locked", async () => {
    await expect(assertLeadInstallerUnlocked("J1", { newLeadId: "w2", newStart: "2026-11-13T20:30:00Z" }, at(WED_0729))).resolves.toBeUndefined();
    tables["bookings"] = [];
    await expect(assertLeadInstallerUnlocked("J1", { newLeadId: "w2" }, at(WED_0730))).resolves.toBeUndefined();
    expect((await leadInstallerLockState("J1", at(WED_0730))).locked).toBe(false);
  });
  test("the current install booking is the latest-scheduled non-cancelled one (shared helper); a cancelled later booking or a completed install never locks", async () => {
    tables["bookings"]!.push({ id: "BK2", job_id: "J1", kind: "installation", status: "cancelled", scheduled_start: "2026-11-20T20:30:00Z", created_at: WED_1100 });
    expect(await leadInstallerLockState("J1", at(WED_0730))).toMatchObject({ locked: true, bookingId: "BK1" });
    tables["bookings"]!.push({ id: "BK3", job_id: "J1", kind: "installation", status: "confirmed", scheduled_start: "2026-11-25T20:30:00Z", created_at: BOOKED });
    expect(await leadInstallerLockState("J1", at(WED_0730))).toMatchObject({ locked: false, bookingId: "BK3" }); // moved out: its own lock day
    tables["bookings"] = [{ id: "BK1", job_id: "J1", kind: "installation", status: "confirmed", scheduled_start: START, created_at: BOOKED }];
    tables["jobs"]![0]!["installation_completed_at"] = "2026-11-13T05:00:00Z";
    expect((await leadInstallerLockState("J1", at(WED_0730))).locked).toBe(false);
    for (const f of ["src/lib/lead-installer-confirm.server.ts", "src/lib/visit-allocation.server.ts", "src/lib/swms-link.server.ts", "src/lib/swms.server.ts"]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).toContain('import("./install-booking.server")');
      expect(src, f).not.toMatch(/from\("bookings"\)\.select\("[^"]*scheduled_start[^"]*"\)\.eq\("job_id"/);
    }
  });
  test("the Lead is read from the saved crew when no allocation event exists", async () => {
    tables["workflow_events"] = tables["workflow_events"]!.filter((e) => e["event_type"] !== "visit_allocated");
    expect((await leadInstallerLockState("J1", at(WED_0730))).leadId).toBe("w1");
  });
  test("wiring: the partner writers check the lock inside the server; the Home Insulation Victoria office keeps its own path", () => {
    const fns = readFileSync("src/lib/trade-view.functions.ts", "utf8");
    const change = fns.slice(fns.indexOf("export const changeInHouseLeadInstaller"), fns.indexOf("export const recordInHouseEscNoticeUpdated"));
    expect(change).toContain("assertLeadInstallerUnlocked(data.jobId,{newLeadId:data.workerId})");
    expect(change.indexOf("assertLeadInstallerUnlocked")).toBeLessThan(change.indexOf("saveCrewWithLead("));
    const tv = readFileSync("src/lib/trade-view.server.ts", "utf8");
    const book = tv.slice(tv.indexOf("export async function inHouseBookVisit"), tv.indexOf("export async function setMittiInvited"));
    expect(book).toContain("assertLeadInstallerUnlocked(input.jobId, { newStart: input.start, newLeadId: input.workerId ?? null })");
    expect(book.indexOf("assertLeadInstallerUnlocked")).toBeLessThan(book.indexOf("saveInHouseVisit("));
    const va = readFileSync("src/lib/visit-allocation.server.ts", "utf8");
    const save = va.slice(va.indexOf("export async function saveCrewWithLead("), va.indexOf("async function refuseLockedLeadChange"));
    expect(save).toContain("await refuseLockedLeadChange(jobId, leadWorkerId(sel));");
    expect(va).toContain("leadLockBlocker({ startIso: book.scheduled_start, now, currentLeadId");
    const alloc = va.slice(va.indexOf("export async function allocateVisit("), va.indexOf("export async function saveCrewWithLead("));
    expect(alloc).toContain('if (kind === "install") await refuseLockedLeadChange(jobId, workerId);');
    // The office may still move a locked install (booking.server officeActor) and change the Lead (in-house-booking.server
    // recordLeadChange → ESC update + info@ email) — the partner gets LEAD_LOCKED_MESSAGE.
    const bk = readFileSync("src/lib/booking.server.ts", "utf8");
    expect(bk).toContain("if (await officeActor(move.actorId ?? null))");
    expect(bk).toContain("await lic.assertLeadInstallerUnlocked(jobId, { newStart: move.start })");
  });
});
