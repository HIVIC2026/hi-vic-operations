import { beforeEach, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";

const tables: Tables = {};
const admin = memoryPostgrest(tables);
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: admin }));
mock.module("../src/lib/workflow.server", () => ({
  logEvent: async (job_id: string, actor_id: string | null, event_type: string, summary: string, details: Record<string, unknown> = {}) => {
    (tables.workflow_events ??= []).push({ job_id, actor_id, event_type, summary, details });
  },
}));
const core = await import("../src/lib/acceptance-signature.core");
const server = await import("../src/lib/acceptance-signature.server");
const { P2 } = await import("../src/lib/owner-pages.core");
const { AP_COUNTERSIGNER: PDF_SIGNER } = await import("../src/lib/signed-acceptance.core");

const input = { quoteId: "q1", version: 3, typedName: "  Sarah   Brown ", signedAt: "2026-11-08T09:42:00.000Z" };
beforeEach(() => { for (const k of Object.keys(tables)) delete tables[k]; });

test("record: typed name tidied, Chris Lowe counter-signs at the same moment, documents consent is tick 1", () => {
  const r = core.acceptanceSignatureRecord(input);
  expect(r.countersigned.owner_typed_name).toBe("Sarah Brown");
  expect(r.countersigned.countersigner.name).toBe("Chris Lowe");
  expect(r.countersigned.countersigner.role).toBe("Director");
  expect(r.countersigned.at).toBe(input.signedAt);
  expect(r.countersigned.signed_at).toBe(input.signedAt);
  expect(r.countersigned).toMatchObject({ quote_id: "q1", version: 3 });
  expect(r.documentsConsent.wording).toBe(P2.tick1);
  expect(r.documentsConsent.at).toBe(input.signedAt);
  expect(core.ACCEPTANCE_COUNTERSIGNED_EVENT).toBe("acceptance_countersigned");
  expect(core.DOCUMENTS_BY_EMAIL_CONSENT_EVENT).toBe("owner_documents_by_email_consent");
  expect(PDF_SIGNER.name).toBe(core.AP_COUNTERSIGNER.name);
});

test("recording writes both events once; a second accept of the same version writes nothing", async () => {
  await server.recordAcceptanceSignature("job-1", "owner-1", input);
  await server.recordAcceptanceSignature("job-1", "owner-1", { ...input, signedAt: "2026-11-08T10:00:00.000Z" });
  const types = (tables.workflow_events ?? []).map((e) => e.event_type).sort();
  expect(types).toEqual(["acceptance_countersigned", "owner_documents_by_email_consent"]);
  const found = await server.readAcceptanceCountersignature("job-1", "q1", 3);
  expect(found).toEqual({ ownerTypedName: "Sarah Brown", signedAt: input.signedAt });
  expect(await server.readAcceptanceCountersignature("job-1", "q1", 4)).toBeNull();
});

test("a new quote version records again", async () => {
  await server.recordAcceptanceSignature("job-1", "owner-1", input);
  await server.recordAcceptanceSignature("job-1", "owner-1", { ...input, version: 4 });
  expect((tables.workflow_events ?? []).length).toBe(4);
});

test("wiring: gate docs signed with the typed name, no ESC consent at acceptance, records written after the gate signatures", () => {
  const src = readFileSync("src/lib/owner-link.functions.ts", "utf8");
  const fn = src.slice(src.indexOf("signQuoteSitting: async"), src.indexOf("ownerDeclineQuoteFn"));
  expect(fn).toContain("signatoryName:data.signing.typedName");
  expect(fn).not.toContain("pkg.consumer.name");
  expect(fn).not.toContain("signOwnerConsent");
  expect(fn).not.toContain("prepareQuoteConsent");
  expect(fn.indexOf("signGateDoc")).toBeLessThan(fn.indexOf("recordAcceptanceSignature"));
  const accept = src.slice(src.indexOf("export const ownerAcceptQuoteFn"), src.indexOf("signQuoteSitting: async"));
  expect(accept).toMatch(/signatureName:\s*data\.signing\.typedName/);
  const pdf = readFileSync("src/lib/assignment.server.ts", "utf8");
  expect(pdf).toContain("readAcceptanceCountersignature");
});
