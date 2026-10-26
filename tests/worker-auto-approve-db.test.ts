// Decision 402 (Jo 26 Oct 2026) against an isolated PGlite database: every portal table (journey harness) plus every
// trigger the live database runs on public tables (read back 26 Oct 2026, loaded exactly as journey-live-runner-db.test.ts
// loads it), so the live 0082 guard `guard_installer_worker_certified` is real. Mitti is a recording stand-in.
// Never touches the live database or any network.
import { afterAll, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { journeyAdmin, journeyDb, serverFnStandIn } from "./helpers/journey-harness";

const OFFICE = "40000000-0000-4000-8000-0000000000f9";
const j = await journeyDb();
const live = JSON.parse(readFileSync(new URL("./fixtures/live-triggers-2026-10-26.json", import.meta.url), "utf8")) as { functions: string[]; triggers: string[] };
for (const f of live.functions.map((x) => x.replaceAll("current_setting('role',true)", "auth.role()"))) { try { await j.db.exec(f); } catch { /* not loadable on PGlite; the guard below is asserted */ } }
for (const t of live.triggers) {
  const m = /^CREATE (?:CONSTRAINT )?TRIGGER (\S+) .*? ON (\S+) /.exec(t);
  try { await j.db.exec(`DROP TRIGGER IF EXISTS ${m![1]} ON ${m![2]}; ${t}`); } catch { /* not loadable on PGlite */ }
}
const { admin } = journeyAdmin(j);
const q = j.q;
const mittiApproved: string[] = [], mittiRemoved: string[] = [];
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: admin }));
mock.module("@tanstack/react-start", serverFnStandIn);
mock.module("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
mock.module("../src/lib/mitti-invite.server", () => ({
  onPartnerPersonApproved: async (id: string) => { mittiApproved.push(id); if (id === FAILS_MITTI) throw new Error("Mitti down"); return { action: "skip" }; },
  onPartnerPersonRemoved: async (id: string) => { mittiRemoved.push(id); return { action: "skip" }; },
}));
afterAll(async () => { await j.db.close(); });

const { autoApproveVerifiedPeople, approvePartnerWorker } = await import("../src/lib/worker-approval.server");
const { decideWorker } = await import("../src/lib/worker-links.functions");
const { AUTO_APPROVE_SUMMARY } = await import("../src/lib/worker-auto-approve.core");

await q(`insert into profiles (id, full_name, email) values ($1,'Office','admin@hivic.test')`, [OFFICE]);
await q(`insert into user_roles (user_id, role) values ($1,'admin')`, [OFFICE]);

let seq = 0;
const id = () => `70000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
async function business(status: string) {
  const b = id();
  await q(`insert into businesses (id, name, business_type, onboarding_status, is_active) values ($1,$2,'eec_installer',$3,$4)`, [b, `Biz ${seq}`, status, status === "approved"]);
  return b;
}
type P = { role?: "installer" | "electrician"; approval?: string; cert?: string | null; removed?: boolean; check?: "verified" | "rejected" | null; level?: string | null; expires?: string | null };
async function person(biz: string, name: string, p: P = {}) {
  const w = id();
  const email = `${name.toLowerCase().replace(/\s+/g, ".")}@example.test`;
  const role = p.role ?? "installer";
  await q(`insert into partner_workers (id, business_id, trade_role, full_legal_name, email, mobile, licence_number, qualification, approval_status, certification_status, removed_at)
    values ($1,$2,$3,$4,$5,'0400000000',$6,$7,$8,$9,$10)`, [w, biz, role, name, email, role === "electrician" ? "REC-1" : null, role === "installer" ? "Cert III" : null, p.approval ?? "pending", p.cert === undefined ? (role === "installer" ? "verified" : null) : p.cert, p.removed ? "2026-10-20T00:00:00Z" : null]);
  const check = p.check === undefined ? (role === "installer" ? "verified" : null) : p.check;
  if (check) {
    const c = id();
    await q(`insert into partner_worker_certifications (id, worker_id, worker_email, status, evidence_source, evidence_note, recorded_by) values ($1,$2,$3,$4,'certificate_sighted','Office sighted the CII certificate.',$5)`, [c, w, email, check, OFFICE]);
    const level = p.level === undefined ? "full" : p.level;
    if (level) await q(`insert into worker_certification_levels (certification_id, worker_email, level, expires_on, recorded_by) values ($1,$2,$3,$4,$5)`, [c, email, level, p.expires ?? "2028-06-30", OFFICE]);
  }
  return w;
}
const statusOf = async (w: string) => (await q<{ approval_status: string; approved_by: string | null; rejection_reason: string | null }>("select approval_status, approved_by, rejection_reason from partner_workers where id=$1", [w]))[0]!;
const events = async (w: string) => q<{ event_type: string; summary: string; actor_id: string | null; details: Record<string, unknown> }>("select event_type, summary, actor_id, details from admin_config_events where details->>'worker_id' = $1 order by created_at", [w]);
let FAILS_MITTI = "";

describe("decision 402 on PGlite with the live triggers", () => {
  test("the live 0082 guard is loaded: an unverified installer can never be approved", async () => {
    const b = await business("approved");
    const w = await person(b, "Guard Check", { cert: "unverified", check: null });
    await expect(approvePartnerWorker(w, OFFICE, { kind: "office" })).rejects.toThrow("worker_cert:unverified");
    expect((await statusOf(w)).approval_status).toBe("pending");
  });

  test("Matthews-style business: verified installers approved, everyone else left as is", async () => {
    const b = await business("approved");
    const ok1 = await person(b, "Ann Verified"), ok2 = await person(b, "Bob Verified", { level: "provisional", expires: "2026-10-26" });
    const unverified = await person(b, "Cal Unverified", { cert: "unverified", check: null });
    const rejected = await person(b, "Dee Rejected", { approval: "rejected", cert: "rejected", check: "rejected" });
    const removed = await person(b, "Eve Removed", { removed: true });
    const noLevel = await person(b, "Fay Nolevel", { level: null });
    const expired = await person(b, "Gus Expired", { expires: "2026-10-25" });
    const flagOnly = await person(b, "Hal Flagonly", { check: null });
    const already = await person(b, "Ivy Approved", { approval: "approved" });
    const sparky = await person(b, "Jim Sparky", { role: "electrician" });
    const r = await autoApproveVerifiedPeople(b, OFFICE, { today: "2026-10-26" });
    expect(r.errors).toEqual([]);
    expect(r.approved.map((p) => p.id).sort()).toEqual([ok1, ok2].sort());
    for (const w of [ok1, ok2]) {
      expect(await statusOf(w)).toMatchObject({ approval_status: "approved", approved_by: OFFICE, rejection_reason: null });
      const ev = await events(w);
      expect(ev).toHaveLength(1);
      expect(ev[0]).toMatchObject({ event_type: "worker_approved", summary: AUTO_APPROVE_SUMMARY, actor_id: OFFICE });
      expect(ev[0]!.details).toMatchObject({ business_id: b, decision: 402 });
    }
    expect(mittiApproved).toEqual(expect.arrayContaining([ok1, ok2]));
    for (const [w, s] of [[unverified, "pending"], [rejected, "rejected"], [removed, "pending"], [noLevel, "pending"], [expired, "pending"], [flagOnly, "pending"], [already, "approved"], [sparky, "pending"]] as const) {
      expect((await statusOf(w)).approval_status).toBe(s);
      expect(await events(w)).toHaveLength(0);
      expect(mittiApproved).not.toContain(w);
    }
    expect(r.left.find((l) => l.id === sparky)?.reason).toContain("Electricians");
    // Running it again changes nothing.
    const again = await autoApproveVerifiedPeople(b, OFFICE, { today: "2026-10-26" });
    expect(again.approved).toEqual([]);
    expect(await events(ok1)).toHaveLength(1);
  });

  test("dry run reports without changing anything; a business that is not approved is refused", async () => {
    const b = await business("approved");
    const w = await person(b, "Kim Dryrun");
    const dry = await autoApproveVerifiedPeople(b, OFFICE, { dryRun: true, today: "2026-10-26" });
    expect(dry.approved.map((p) => p.id)).toEqual([w]);
    expect((await statusOf(w)).approval_status).toBe("pending");
    expect(await events(w)).toHaveLength(0);
    const draft = await business("submitted");
    const d = await person(draft, "Lou Draft");
    const r = await autoApproveVerifiedPeople(draft, OFFICE, { today: "2026-10-26" });
    expect(r.businessApproved).toBe(false);
    expect(r.approved).toEqual([]);
    expect((await statusOf(d)).approval_status).toBe("pending");
  });

  test("a failing Mitti hook never fails the approval, and a DB refusal never throws out of the business approval", async () => {
    const b = await business("approved");
    const w = await person(b, "Max Mittidown");
    FAILS_MITTI = w;
    const r = await autoApproveVerifiedPeople(b, OFFICE, { today: "2026-10-26" });
    expect(r.approved.map((p) => p.id)).toEqual([w]);
    expect((await statusOf(w)).approval_status).toBe("approved");
    // An unknown business id: nothing thrown, reported.
    const none = await autoApproveVerifiedPeople("70000000-0000-4000-8000-999999999999", OFFICE);
    expect(none.errors.length).toBeGreaterThan(0);
  });

  test("decideWorker (office Approve / Reject in Needs me) behaves as before through the shared helper", async () => {
    const b = await business("approved");
    const sparky = await person(b, "Ned Sparky", { role: "electrician" });
    const ctx = { userId: OFFICE, supabase: admin, claims: {} };
    expect(await decideWorker({ data: { id: sparky, approve: true }, context: ctx } as never)).toEqual({ ok: true });
    expect(await statusOf(sparky)).toMatchObject({ approval_status: "approved", approved_by: OFFICE });
    expect((await events(sparky)).map((e) => [e.event_type, e.summary, e.details])).toEqual([["worker_approved", "Worker approved", { worker_id: sparky, reason: null }]]);
    expect(mittiApproved).toContain(sparky);
    const unverified = await person(b, "Oli Unverified", { cert: "unverified", check: null });
    await expect(decideWorker({ data: { id: unverified, approve: true }, context: ctx } as never)).rejects.toThrow("worker_cert:unverified");
    expect(await events(unverified)).toHaveLength(0);
    await expect(decideWorker({ data: { id: unverified, approve: false }, context: ctx } as never)).rejects.toThrow("Give a reason");
    expect(await decideWorker({ data: { id: unverified, approve: false, reason: "Not on the team" }, context: ctx } as never)).toEqual({ ok: true });
    expect(await statusOf(unverified)).toMatchObject({ approval_status: "rejected", rejection_reason: "Not on the team" });
    expect((await events(unverified)).map((e) => e.event_type)).toEqual(["worker_rejected"]);
    expect(mittiRemoved).toContain(unverified);
  });
});
