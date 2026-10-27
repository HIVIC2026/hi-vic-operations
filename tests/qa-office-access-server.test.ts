import { beforeEach, expect, mock, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../src/integrations/supabase/types";
let adminChecks = 0, privilegedReads = 0, scopeCalls = 0;
let roles = ["qa_office"], email = "office@hivic-test.example", verified = true, allowed = true;
let realOwner = false;
mock.module("../src/lib/workflow.server", () => ({ requireAdmin: async () => { adminChecks++; if (!roles.includes("admin")) throw new Error("Admin only."); } }));
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from(table: string) {
  privilegedReads++;
  const result = () => ({ data: table === "jobs" ? { source: "qa_test", deleted_at: null, qa_archived_at: null, owner_id: "owner", property_id: "property", originating_installer_business_id: null, originating_installer_user_id: null }
    : table === "owners" ? { email: realOwner ? "real@example.com" : "owner@hivic-test.example", user_id: null }
    : table === "properties" ? { owner_id: "owner", managed_by_business_id: null } : [], error: null });
  const q = { select: () => q, eq: () => q, in: () => q, maybeSingle: async () => result(), then: (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve) };
  return q;
} } }));
const { requireOfficeJob } = await import("../src/lib/qa-office-access.server");
const client = {
  auth: { getUser: async () => ({ data: { user: { id: "office", email, email_confirmed_at: verified ? "2026-10-27" : null } }, error: null }) },
  from: () => ({ select: () => ({ eq: async () => ({ data: roles.map(role => ({ role })), error: null }) }) }),
  rpc: async (_name: string, args: { _job: string }) => { scopeCalls++; return { data: allowed && args._job === "test-job", error: null }; },
} as unknown as SupabaseClient<Database>;
beforeEach(() => { adminChecks = 0; privilegedReads = 0; scopeCalls = 0; roles = ["qa_office"]; email = "office@hivic-test.example"; verified = true; allowed = true; realOwner = false; });
test("real job id refused before privileged reads", async () => {
  await expect(requireOfficeJob(client, "real-job")).rejects.toThrow("Only fully isolated TEST jobs");
  expect(privilegedReads).toBe(0);
});
test("fully scoped TEST job gets a separate capability, never admin", async () => {
  expect(await requireOfficeJob(client, "test-job")).toBe("qa_office"); expect(adminChecks).toBe(0); expect(scopeCalls).toBe(1);
});
test("independent graph read refuses a real owner even when RPC allowed", async () => {
  realOwner = true; await expect(requireOfficeJob(client, "test-job")).rejects.toThrow("non-TEST");
});
test("unapplied or refused scope never falls back to admin", async () => {
  allowed = false; await expect(requireOfficeJob(client, "test-job")).rejects.toThrow(); expect(adminChecks).toBe(0); expect(privilegedReads).toBe(0);
});
test("mixed admin and qa_office is denied", async () => {
  roles = ["qa_office", "admin"]; await expect(requireOfficeJob(client, "real-job")).rejects.toThrow("mixed roles"); expect(privilegedReads).toBe(0); expect(adminChecks).toBe(0);
});
test("unverified or wrong-domain identity is denied before scope reads", async () => {
  verified = false; await expect(requireOfficeJob(client, "test-job")).rejects.toThrow("verified TEST-domain");
  verified = true; email = "office@example.com"; await expect(requireOfficeJob(client, "test-job")).rejects.toThrow("verified TEST-domain"); expect(scopeCalls).toBe(0);
});
test("admin follows exactly the existing admin check without TEST reads", async () => {
  roles = ["admin"]; email = "office@example.com"; expect(await requireOfficeJob(client, "real-job")).toBe("admin"); expect(adminChecks).toBe(1); expect(scopeCalls).toBe(0); expect(privilegedReads).toBe(0);
});
test("ordinary signed-in owner cannot become office", async () => {
  roles = ["owner"]; await expect(requireOfficeJob(client, "real-job")).rejects.toThrow("Admin only"); expect(privilegedReads).toBe(0);
});