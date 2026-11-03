// New job flow Part 8 Task 7 (Jo 2 Nov 2026): the Mitti Part B signature signs Section 3 Part B on the VEEC assignment record.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";
import { INSTALLER_DECLARATION } from "../src/lib/veec-assignment-form.core";
import { INSTALL_DAY_NOV2_Q, INSTALL_DAY_Q as ID } from "../src/lib/install-day.core";
import { partBApplyDecision } from "../src/lib/veec-part-b-mitti.core";

const AT = "2026-10-30T04:05:00Z";
const sig = (name: string | null = "Ivy Installer", over: Record<string, unknown> = {}) => ({ present: true, name, signedAt: AT, mediaId: "0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5d", ...over }) as any;
const partB = (s = sig(), o: Record<string, unknown> = {}) => ({ onForm: true, ticked: true, signature: s, ...o }) as any;
const dec = (p = partB(), lead: string | null = "Ivy Installer", a: any = { status: "awaiting_installer_signature", installerSignedAt: null }) => partBApplyDecision({ partB: p, leadName: lead, assignment: a });

describe("partBApplyDecision", () => {
  test("matching name applies; case and spacing do not matter", () => {
    expect(dec()).toEqual({ action: "apply" });
    expect(dec(partB(sig("ivy  installer")), "Ivy Installer").action).toBe("apply");
    expect(dec(partB(), "Ivy Installer", null).action).toBe("apply");
  });
  test("a crew member's name holds for the office", () => {
    const d = dec(partB(sig("Sam Crew")));
    expect(d.action).toBe("hold");
    expect((d as any).reason).toContain("isn't the Lead Installer");
  });
  test("no media id / time, or no Lead Installer chosen, holds", () => {
    expect(dec(partB(sig("Ivy Installer", { mediaId: null }))).action).toBe("hold");
    expect(dec(partB(sig("Ivy Installer", { signedAt: null }))).action).toBe("hold");
    expect(dec(partB(), null).action).toBe("hold");
  });
  test("already signed or old form: skip, never a hold", () => {
    expect(dec(partB(), "Ivy Installer", { status: "awaiting_ap_signature", installerSignedAt: AT }).action).toBe("skip");
    expect(dec({ onForm: false, ticked: false, signature: { present: false, name: null, signedAt: null, mediaId: null } }).action).toBe("skip");
  });
  test("on the form but not ticked or not signed yet: skip (the confirmation text already chases it)", () => {
    expect(dec(partB(sig(), { ticked: false })).action).toBe("skip");
    expect(dec(partB({ present: false, name: null, signedAt: null, mediaId: null })).action).toBe("skip");
  });
});

const tables: Tables = {};
const stored: Record<string, Uint8Array> = {};
const base = memoryPostgrest(tables);
const admin = { ...base, from: base.from.bind(base), storage: { from: () => ({ upload: async (p: string, b: Uint8Array) => { stored[p] = b; return { error: null }; } }) } };
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: admin }));
mock.module("../src/lib/workflow.server", () => ({
  WorkflowError: class extends Error {},
  logEvent: async (job_id: string, actor_id: string | null, event_type: string, summary: string, details: Record<string, unknown> = {}) => { (tables.workflow_events ??= []).push({ job_id, actor_id, event_type, summary, details }); },
}));
mock.module("../src/lib/prestart.server", () => ({ leadInstallerCert: async () => ({ name: "Ivy Installer" }) }));
let prepared = 0;
mock.module("../src/lib/assignment.server", () => ({
  currentAssignment: async (jobId: string) => (tables.customer_assignments ?? []).find((a) => a.job_id === jobId && a.status !== "cancelled") ?? null,
  prepareFinalAssignment: async (jobId: string) => { prepared++; (tables.customer_assignments ??= []).push({ id: "a1", job_id: jobId, status: "awaiting_installer_signature", record_kind: "final_veec_assignment", final_facts: { template_version: "v1.1" }, final_facts_sha256: "facts-sha", consumer_declaration_version: "v1.1", installer_signed_at: null }); return "a1"; },
  evaluateAndApply: async () => null,
  loadTemplates: async () => [],
}));
mock.module("../src/lib/assignment.core", () => ({
  activeTemplate: () => ({ version: "v1.1" }),
  signingOrderBlocker: () => null,
  sha256Hex: async (s: string) => `sha:${s.length}`,
  stableJson: (v: unknown) => JSON.stringify(v),
}));
const { applyMittiPartB } = await import("../src/lib/veec-part-b-mitti.server");

const item = (label: string, x: Record<string, unknown>) => ({ item_id: label, label, ...x });
const auditWith = (name = "Ivy Installer") => ({ items: [
  item(INSTALL_DAY_NOV2_Q.partBTick, { type: "checkbox", responses: { value: true } }),
  item(INSTALL_DAY_NOV2_Q.partBSignature, { type: "signature", responses: { image: { media_id: "0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5d", name, timestamp: AT } } }),
] });
let fetches = 0;
const fetchMedia = async () => { fetches++; return { bytes: new Uint8Array([1, 2, 3]), contentType: "image/png" }; };
beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  for (const k of Object.keys(stored)) delete stored[k];
  fetches = 0; prepared = 0;
  tables.workflow_events = [{ job_id: "j1", event_type: "mitti_piisa_audit_created", details: { audit_id: "aud-1" }, created_at: "2026-10-29T00:00:00Z" }];
  tables.job_assignments = [{ job_id: "j1", role: "installer", active: true, user_id: "u-lead" }];
});

describe("applyMittiPartB", () => {
  test("signs once with the Mitti time and the stored image; second run writes nothing", async () => {
    expect(await applyMittiPartB("j1", "aud-1", auditWith(), fetchMedia)).toBe("applied");
    const a = tables.customer_assignments![0]!;
    expect(a.installer_signature_name).toBe("Ivy Installer");
    expect(a.installer_signed_at).toBe(AT);
    expect(a.installer_snapshot).toMatchObject({ part: "Section 3 Part B", declaration: INSTALLER_DECLARATION, source: "mitti_install_form", audit_id: "aud-1", media_id: "0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5d", image_path: "j1/assignment/part-b-0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5d.png", typed_name: "Ivy Installer", at: AT, facts_sha256: "facts-sha", form_version: "v1.1" });
    expect(a.installer_snapshot_sha256).toBeTruthy();
    expect(Object.keys(stored)).toEqual(["j1/assignment/part-b-0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5d.png"]);
    expect(tables.workflow_events!.filter((e) => e.event_type === "veec_part_b_signed_mitti")).toHaveLength(1);
    const snap = JSON.stringify(a);
    expect(await applyMittiPartB("j1", "aud-1", auditWith(), fetchMedia)).toBe("skipped");
    expect(JSON.stringify(tables.customer_assignments![0])).toBe(snap);
    expect(fetches).toBe(1);
    expect(tables.workflow_events!.filter((e) => e.event_type === "veec_part_b_signed_mitti")).toHaveLength(1);
  });
  test("a crew name holds for the office, fetches nothing, and logs once", async () => {
    expect(await applyMittiPartB("j1", "aud-1", auditWith("Sam Crew"), fetchMedia)).toBe("held");
    expect(await applyMittiPartB("j1", "aud-1", auditWith("Sam Crew"), fetchMedia)).toBe("held");
    expect(fetches).toBe(0);
    const held = tables.workflow_events!.filter((e) => e.event_type === "veec_part_b_mitti_held");
    expect(held).toHaveLength(1);
    expect(held[0]!.details.needs_office).toBe(true);
    expect(tables.customer_assignments?.[0]?.installer_signed_at ?? null).toBeNull();
  });
  test("an audit that is not this job's linked audit is never fetched", async () => {
    expect(await applyMittiPartB("j1", "other-audit", auditWith(), fetchMedia)).toBe("skipped");
    expect(fetches).toBe(0);
  });
  test("an old form without Part B: skipped, no event, nothing blocked", async () => {
    expect(await applyMittiPartB("j1", "aud-1", { items: [] }, fetchMedia)).toBe("skipped");
    expect(tables.workflow_events!.map((e) => e.event_type)).toEqual(["mitti_piisa_audit_created"]);
  });
});

describe("wiring", () => {
  const { readFileSync } = require("node:fs");
  test("recorded installation applies Part B, wrapped so a failure never undoes it; the A5 sync passes the audit", () => {
    const rec = readFileSync("src/lib/install-complete-mitti.server.ts", "utf8");
    expect(rec).toContain("applyMittiPartB");
    expect(rec.indexOf("recordInstallationComplete(jobId")).toBeLessThan(rec.indexOf("await applyPartB();\n    return { recorded: !r.already"));
    expect(rec).toContain("veec_part_b_mitti_failed");
    expect(readFileSync("src/lib/piisa-declaration.server.ts", "utf8")).toContain("partB: installDay && fetchMedia ? { audit, fetchMedia }");
  });
});
