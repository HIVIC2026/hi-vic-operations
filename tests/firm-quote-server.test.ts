import { beforeEach, expect, mock, test } from "bun:test";
let liveAt: string | null = null;
let failure: { code: string; message: string } | null = null;
let failedTable: string | null = null;
let job = { source: "base44", created_at: "2026-11-06T06:00:00Z" };
let docs = [{ kind: "intake_media", mime_type: "image/jpeg" as string | null, storage_path: "job/intake/photo.jpg" as string | null }];
const reads: string[] = [];
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from(table: string) {
  reads.push(table);
  const q = { select: () => q, eq: () => q, limit: () => q, maybeSingle: () => q,
    then: (resolve: (r: unknown) => unknown) => Promise.resolve({ data: table === "workflow_settings" ? { firm_quote_flow_live_at: liveAt } : table === "jobs" ? job : docs, error: failedTable === null || failedTable === table ? failure : null }).then(resolve),
  }; return q;
} } }));
const { firmQuoteLiveAt, isFirmQuoteJobId } = await import("../src/lib/firm-quote.server");
beforeEach(() => { liveAt = null; failure = null; failedTable = null; job = { source: "base44", created_at: "2026-11-06T06:00:00Z" }; docs = [{ kind: "intake_media", mime_type: "image/jpeg", storage_path: "job/intake/photo.jpg" }]; reads.length = 0; });
test("null switch returns null and skips job/media reads", async () => { expect(await firmQuoteLiveAt()).toBeNull(); expect(await isFirmQuoteJobId("job")).toBe(false); expect(reads).not.toContain("jobs"); expect(reads).not.toContain("documents"); });
test("missing PostgreSQL column reads as off", async () => { failure = { code: "42703", message: "column workflow_settings.firm_quote_flow_live_at does not exist" }; expect(await firmQuoteLiveAt()).toBeNull(); expect(await isFirmQuoteJobId("job")).toBe(false); });
test("missing schema-cache column reads as off", async () => { failure = { code: "PGRST204", message: "Could not find the 'firm_quote_flow_live_at' column of 'workflow_settings' in the schema cache" }; expect(await firmQuoteLiveAt()).toBeNull(); });
test("other read errors never masquerade as a missing column", async () => { failure = { code: "42501", message: "permission denied" }; await expect(firmQuoteLiveAt()).rejects.toThrow(); });
test("live timestamp and imported owner image qualify", async () => { liveAt = "2026-11-06T06:00:00Z"; expect(await firmQuoteLiveAt()).toBe(liveAt); expect(await isFirmQuoteJobId("job")).toBe(true); });
test("qa_test job at go-live with owner media qualifies through the server check", async () => { liveAt = job.created_at; job.source = "qa_test"; expect(await isFirmQuoteJobId("job")).toBe(true); expect(reads).toContain("documents"); });
test("qa_test job stays legacy with switch off and skips media reads", async () => { job.source = "qa_test"; expect(await isFirmQuoteJobId("job")).toBe(false); expect(reads).not.toContain("documents"); });
test("qa_test job before go-live stays legacy and skips media reads", async () => { liveAt = "2026-11-06T06:00:01Z"; job.source = "qa_test"; expect(await isFirmQuoteJobId("job")).toBe(false); expect(reads).not.toContain("documents"); });
test("qa_test job without owner media stays legacy", async () => { liveAt = job.created_at; job.source = "qa_test"; docs = []; expect(await isFirmQuoteJobId("job")).toBe(false); });
test("pre-live job remains legacy", async () => { liveAt = "2026-11-06T06:00:01Z"; expect(await isFirmQuoteJobId("job")).toBe(false); });
test("installer-source remains legacy", async () => { liveAt = "2026-11-06T06:00:00Z"; job.source = "installer_portal"; expect(await isFirmQuoteJobId("job")).toBe(false); });
test("no media remains legacy", async () => { liveAt = "2026-11-06T06:00:00Z"; docs = []; expect(await isFirmQuoteJobId("job")).toBe(false); });
test("unrelated or unpersisted files do not qualify", async () => { liveAt = "2026-11-06T06:00:00Z"; docs[0].kind = "evidence"; expect(await isFirmQuoteJobId("job")).toBe(false); docs[0].kind = "intake_media"; docs[0].storage_path = null; expect(await isFirmQuoteJobId("job")).toBe(false); });
test("owner video filename fallback qualifies", async () => { liveAt = "2026-11-06T06:00:00Z"; docs[0].mime_type = null; docs[0].storage_path = "job/intake/roof.mp4"; expect(await isFirmQuoteJobId("job")).toBe(true); });
test("job read failure blocks rather than selecting a legacy email", async () => { liveAt = "2026-11-06T06:00:00Z"; failedTable = "jobs"; failure = { code: "42501", message: "denied" }; await expect(isFirmQuoteJobId("job")).rejects.toThrow(); });
test("media read failure blocks rather than selecting a legacy email", async () => { liveAt = "2026-11-06T06:00:00Z"; failedTable = "documents"; failure = { code: "42501", message: "denied" }; await expect(isFirmQuoteJobId("job")).rejects.toThrow(); });