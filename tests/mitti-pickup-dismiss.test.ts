import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { isTestPickupForm, knownPickupAuditIds, looksLikeTestText, visiblePickupForms } from "../src/lib/mitti-pickup.core";

describe("TEST forms stay off Needs me", () => {
  test.each(["1 TEST Street", "TEST RC Owner", "9 E2E Test Street", "deep-test", "Test Street", "TEST_RC", "test"])("%s is a TEST form", (t) => {
    expect(looksLikeTestText(t)).toBe(true);
  });
  test.each(["Courtney Daniels", "12 Contest Road", "Latest Lane", "Attestation Way", "", null, undefined])("%p is a real form", (t) => {
    expect(looksLikeTestText(t as string | null | undefined)).toBe(false);
  });
  test("owner name, address or reference each count", () => {
    expect(isTestPickupForm({ homeownerName: "TEST RC Owner", siteAddress: "5 Real St", mittiRef: "x" })).toBe(true);
    expect(isTestPickupForm({ homeownerName: "Jo", siteAddress: "9 E2E Test Street", mittiRef: null })).toBe(true);
    expect(isTestPickupForm({ homeownerName: "Jo", siteAddress: "5 Real St", mittiRef: "deep-test" })).toBe(true);
    expect(isTestPickupForm({ homeownerName: "Jo", siteAddress: "5 Real St", mittiRef: "HV-1" })).toBe(false);
  });
});

describe("known audit ids", () => {
  const known = knownPickupAuditIds({
    dismissed: [{ details: { audit_id: "dis_1" } }, { details: null }],
    replaced: [{ details: { old_audit_id: "old_3117", photos_not_copied: [] } }, { details: { old_audit_id: " old_1538 " } }, { details: { other: 1 } }],
  });
  test("dismissed and replaced old forms are known, even when no photos are left", () => {
    expect([...known].sort()).toEqual(["dis_1", "old_1538", "old_3117"]);
  });
  const forms = [
    { auditId: "old_3117", homeownerName: "Real Owner", siteAddress: "1 A St" },
    { auditId: "dis_1", homeownerName: "Real Owner", siteAddress: "2 A St" },
    { auditId: "new_1", homeownerName: "Real Owner", siteAddress: "3 A St" },
    { auditId: "t_1", homeownerName: "TEST RC Owner", siteAddress: "4 A St" },
  ];
  test("office list drops known and TEST forms", () => {
    expect(visiblePickupForms(forms, known, true).map((f) => f.auditId)).toEqual(["new_1"]);
  });
  test("auto pickup (no TEST hiding) still never sees known forms", () => {
    expect(visiblePickupForms(forms, known, false).map((f) => f.auditId)).toEqual(["new_1", "t_1"]);
  });
});

describe("wiring", () => {
  const server = readFileSync("src/lib/mitti-pickup.server.ts", "utf8");
  const auto = readFileSync("src/lib/mitti-pickup-auto.server.ts", "utf8");
  const fns = readFileSync("src/lib/mitti-pickup.functions.ts", "utf8");
  test("the shared scan skips known forms before reading them, so manual rows and auto pickup both honour it", () => {
    expect(server).toContain("known.has(auditId)");
    expect(server.indexOf("known.has(auditId)")).toBeLessThan(server.indexOf("await api.getAudit(auditId)"));
    expect(auto).toContain("scanMittiReadyCheckPickups(");
    expect(auto).not.toContain("hideTestForms");
  });
  test("known-form reads check their errors and read replaced events from workflow_events", () => {
    expect(server).toContain('"mitti_form_replaced"');
    expect(server).toContain("Could not check which Mitti forms are already known");
  });
  test("dismiss is admin-only, a literal server function chain, and only records an event", () => {
    const block = fns.slice(fns.indexOf("export const dismissMittiPickupFn"), fns.indexOf("export const getMittiSyncProblems"));
    expect(block).toContain(".middleware([requireSupabaseAuth])");
    expect(block).toContain(".inputValidator(");
    expect(block).toContain("await requireAdmin(context.supabase)");
    expect(fns).toContain("hideTestForms: true");
    const fn = server.slice(server.indexOf("export async function dismissMittiPickup"), server.indexOf("/** Office scan"));
    expect(fn).toContain('from("admin_config_events").insert');
    expect(fn).toContain("actor_id: actorId");
    expect(fn).toContain("readError");
    expect(fn).not.toContain("mittiApi");
  });
  test("Dismiss is on Needs me only, not on the Jobs pile", () => {
    const needs = readFileSync("src/routes/_authenticated/admin.needs-me.tsx", "utf8");
    expect(needs).toContain("<DismissPickupButton auditId={r.auditId}");
    expect(needs).not.toContain('key.slice("pickup:"');
    const pile = readFileSync("src/components/portal/mitti-piles.tsx", "utf8");
    expect(pile.match(/<DismissPickupButton/g)).toBeNull();
  });
  test("the scan checks its database reads and the auto pickup skips a tick when the scan throws", () => {
    expect(server).toContain("linkedError");
    expect(server).toContain("jobError");
    expect(auto).toContain("scan failed, skipping this tick");
  });
  test("linking refuses a replaced old form, reads its events with the error checked, and ignores dismissed ids", () => {
    const fn = server.slice(server.indexOf("export async function linkMittiReadyCheckToJob"), server.indexOf("const sel ="));
    expect(fn).toContain('readEventDetails("workflow_events", "mitti_form_replaced")');
    expect(fn).toContain("dismissed: []");
    expect(fn).toContain("This is an old Mitti form that was replaced – it can't be linked.");
    expect(server).toContain("Could not check which Mitti forms are already known");
  });
});
