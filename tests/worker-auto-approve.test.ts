// Decision 402 (Jo 26 Oct 2026): who is approved automatically when the office approves/activates their business.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { AUTO_APPROVE_SKIP, AUTO_APPROVE_SUMMARY, autoApproveSkipReason, selectAutoApprove, type AutoApprovePerson } from "../src/lib/worker-auto-approve.core";
import { CREW_CLEARANCE_REASON } from "../src/lib/worker-compliance.core";

const TODAY = "2026-10-26";
const cleared = { certStatus: "verified", level: "full", expiresOn: "2028-01-01" };
const installer = (over: Partial<AutoApprovePerson> = {}): AutoApprovePerson => ({ id: "w1", trade_role: "installer", approval_status: "pending", removed_at: null, certification_status: "verified", cii: cleared, ...over });

describe("decision 402 selection rule", () => {
  test("a pending installer with a verified, Full, current CII → approved", () => {
    expect(autoApproveSkipReason(installer(), TODAY)).toBeNull();
    expect(autoApproveSkipReason(installer({ cii: { ...cleared, level: "provisional", expiresOn: TODAY } }), TODAY)).toBeNull();
  });
  test("unverified installers stay pending", () => {
    expect(autoApproveSkipReason(installer({ certification_status: "unverified", cii: null }), TODAY)).toBe(AUTO_APPROVE_SKIP.unverified);
    expect(autoApproveSkipReason(installer({ certification_status: null, cii: null }), TODAY)).toBe(AUTO_APPROVE_SKIP.unverified);
    // worker flag says verified but no office check row behind it (fails closed)
    expect(autoApproveSkipReason(installer({ cii: null }), TODAY)).toBe(CREW_CLEARANCE_REASON.unverified);
    // latest office check withdrew it
    expect(autoApproveSkipReason(installer({ cii: { ...cleared, certStatus: "rejected" } }), TODAY)).toBe(CREW_CLEARANCE_REASON.withdrawn);
    // verified but level/expiry not recorded, or expired (decision 153 crewClearance)
    expect(autoApproveSkipReason(installer({ cii: { ...cleared, level: null } }), TODAY)).toBe(CREW_CLEARANCE_REASON.noLevel);
    expect(autoApproveSkipReason(installer({ cii: { ...cleared, expiresOn: "2026-10-25" } }), TODAY)).toBe(CREW_CLEARANCE_REASON.expired);
  });
  test("rejected, removed and already-approved people are never touched", () => {
    expect(autoApproveSkipReason(installer({ approval_status: "rejected" }), TODAY)).toBe(AUTO_APPROVE_SKIP.notPending);
    expect(autoApproveSkipReason(installer({ approval_status: "approved" }), TODAY)).toBe(AUTO_APPROVE_SKIP.notPending);
    expect(autoApproveSkipReason(installer({ removed_at: "2026-10-20T00:00:00Z" }), TODAY)).toBe(AUTO_APPROVE_SKIP.removed);
  });
  test("electricians are never approved automatically (no office-verified person certification)", () => {
    expect(autoApproveSkipReason({ id: "e1", trade_role: "electrician", approval_status: "pending", removed_at: null, certification_status: null, cii: null }, TODAY)).toBe(AUTO_APPROVE_SKIP.electrician);
    expect(autoApproveSkipReason({ id: "e1", trade_role: "electrician", approval_status: "pending", removed_at: null, certification_status: "verified", cii: cleared }, TODAY)).toBe(AUTO_APPROVE_SKIP.electrician);
  });
  test("selectAutoApprove splits the business's people", () => {
    const people = [installer({ id: "a" }), installer({ id: "b", certification_status: "unverified", cii: null }), installer({ id: "c", approval_status: "rejected" }), installer({ id: "d", removed_at: "2026-10-01T00:00:00Z" }), installer({ id: "e" })];
    const r = selectAutoApprove(people, TODAY);
    expect(r.approve.map((p) => p.id)).toEqual(["a", "e"]);
    expect(r.left.map((l) => l.person.id)).toEqual(["b", "c", "d"]);
  });
  test("event summary is Jo's wording", () => {
    expect(AUTO_APPROVE_SUMMARY).toBe("Worker approved automatically with the business (decision 402)");
  });
});

describe("decision 402 wiring", () => {
  const src = (f: string) => readFileSync(f, "utf8");
  test("decideWorker stays a literal chain with requireAdmin and approves through the shared helper", () => {
    const s = src("src/lib/worker-links.functions.ts");
    const body = s.slice(s.indexOf("export const decideWorker"), s.indexOf("// ---------- Job links"));
    expect(body).toMatch(/^export const decideWorker = createServerFn\(\{ method: "POST" \}\)\.middleware\(\[requireSupabaseAuth\]\)\s*\.inputValidator\(/);
    expect(body).toContain("await requireAdmin(context.supabase);");
    expect(body).toContain('approvePartnerWorker(data.id, context.userId, { kind: "office", reason: data.reason ?? null })');
    expect(body).toContain('approval_status: "rejected"');
    expect(body).toContain("onPartnerPersonRemoved(data.id, context.userId)");
    expect(s).not.toContain("@tanstack/react-start/server");
  });
  test("the helper keeps the update, the event and the never-failing Mitti hook", () => {
    const s = src("src/lib/worker-approval.server.ts");
    expect(s).toContain('approval_status: "approved", approved_by: actorId, approved_at: now, rejection_reason: null');
    expect(s).toContain('event_type: "worker_approved", summary: "Worker approved", details: { worker_id: workerId, reason: how.reason ?? null }');
    expect(s).toContain('m.onPartnerPersonApproved(workerId, actorId)).catch((e) => console.error("Mitti auto-invite skipped"');
  });
  test("business activation and the office Approve both run the auto-approval, never failing them", () => {
    for (const [f, biz] of [["src/lib/partner-activation.functions.ts", "r.business_id"], ["src/lib/pilot.functions.ts", "data.businessId"]] as const) {
      expect(src(f)).toContain(`m.autoApproveVerifiedPeople(${biz}, context.userId)).catch((e) => console.error("Decision 402 auto-approval skipped"`);
    }
  });
});
