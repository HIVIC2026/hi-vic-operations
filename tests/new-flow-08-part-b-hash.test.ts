// Part B Mitti signature hash must re-compute exactly as the portal signing path does (real stableJson + sha256Hex).
import { expect, mock, test } from "bun:test";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";
import { INSTALL_DAY_NOV2_Q } from "../src/lib/install-day.core";
import { sha256Hex, stableJson } from "../src/lib/assignment.core";

const AT = "2026-10-30T04:05:00Z";
const MEDIA = "0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5d";
const tables: Tables = {
  workflow_events: [{ job_id: "j1", event_type: "mitti_piisa_audit_created", details: { audit_id: "aud-1" }, created_at: "2026-10-29T00:00:00Z" }],
  customer_assignments: [{ id: "a1", job_id: "j1", status: "awaiting_installer_signature", final_facts: { template_version: "v1.1", installed: [{ product: "X", r_value: 4 }], n: 2 }, final_facts_sha256: "facts-sha", consumer_declaration_version: "v1.1", installer_signed_at: null, prepared_at: "2026-10-29T00:00:00Z" }],
};
const base = memoryPostgrest(tables);
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { ...base, from: base.from.bind(base), storage: { from: () => ({ upload: async () => ({ error: null }) }) } } }));
mock.module("../src/lib/workflow.server", () => ({ WorkflowError: class extends Error {}, logEvent: async () => {} }));
mock.module("../src/lib/prestart.server", () => ({ leadInstallerCert: async () => ({ name: "Ivy Installer" }) }));
const real = await import("../src/lib/assignment.core");
mock.module("../src/lib/assignment.server", () => ({
  currentAssignment: async () => tables.customer_assignments![0],
  prepareFinalAssignment: async () => "a1",
  evaluateAndApply: async () => null,
  loadTemplates: async () => [],
}));
mock.module("../src/lib/assignment.core", () => ({ ...real, activeTemplate: () => ({ version: "v1.1" }), signingOrderBlocker: () => null }));
const { applyMittiPartB } = await import("../src/lib/veec-part-b-mitti.server");

test("stored installer_snapshot_sha256 re-computes from the stored snapshot like the portal signing path", async () => {
  const audit = { items: [
    { item_id: "t", label: INSTALL_DAY_NOV2_Q.partBTick, type: "checkbox", responses: { value: true } },
    { item_id: "s", label: INSTALL_DAY_NOV2_Q.partBSignature, type: "signature", responses: { image: { media_id: MEDIA, name: "Ivy Installer", timestamp: AT } } },
  ] };
  expect(await applyMittiPartB("j1", "aud-1", audit, async () => ({ bytes: new Uint8Array([1]), contentType: "image/png" }))).toBe("applied");
  const a = tables.customer_assignments![0]!;
  const { part: _p, declaration: _d, ...sig } = a.installer_snapshot as Record<string, unknown>;
  expect(a.installer_snapshot_sha256).toBe(await sha256Hex(stableJson({ party: "installer", sig, facts: a.final_facts })));
  expect(a.installer_snapshot_sha256).toMatch(/^[0-9a-f]{64}$/);
});
