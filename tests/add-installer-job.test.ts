// A6 (installer pages part 1): the Add a job payload for the one-transaction save, and the wiring that makes "Try again"
// finish the same job (request key kept on the phone, resume before the address check, fallback until the SQL is live).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { addInstallerJobPayload, type AddInstallerJobInput } from "../src/lib/add-installer-job.core";
import { restoreRequestKey } from "../src/lib/add-job-flow.core";

const K = "6f1c2c1e-6a77-4b55-9d0e-2f3b1c9a0a11";
const input: AddInstallerJobInput = {
  requestKey: K, businessId: "30000000-0000-4000-8000-000000000001", userId: "40000000-0000-4000-8000-000000000001", source: "qa_test",
  owner: { full_name: " Helen Test ", email: "helen@hivic-test.example", phone: " 0400 000 001 " },
  property: { address_line: " 1 Test Street ", suburb: " Frankston ", postcode: " 3199 " },
  consent: { key: "installer_confirmed", by: "installer", text: "Permission", sha256: "ab".repeat(32) },
  electricianChoice: { choice: "hivic", usual_name: null, usual_licence: null, source: "add_job" }, leadOrigin: "owner_contacted", visitRequested: true, flagEvent: null,
};

describe("A6: Add a job payload", () => {
  test("payload is trimmed, email lower-cased, key carried", () => {
    const p = addInstallerJobPayload({ ...input, requestKey: K, owner: { ...input.owner, email: " A@B.CO " } });
    expect(p.request_key).toBe(K); expect(p.owner.email).toBe("a@b.co");
    expect(p.owner).toEqual({ full_name: "Helen Test", email: "a@b.co", phone: "0400 000 001" });
    expect(p.property).toEqual({ address_line: "1 Test Street", suburb: "Frankston", postcode: "3199" });
    expect(Object.keys(p).sort()).toEqual(["business_id", "consent", "electrician_choice", "flag_event", "lead_origin", "owner", "property", "request_key", "source", "user_id", "visit_requested"]);
    expect(p.visit_requested).toBe(true); expect(p.flag_event).toBeNull();
  });
  test("the phone draft keeps its request key; anything else gives none", () => {
    expect(restoreRequestKey({ full_name: "x", request_key: K })).toBe(K);
    expect(restoreRequestKey({ request_key: "not-a-key" })).toBeNull();
    expect(restoreRequestKey(null)).toBeNull();
  });
  test("server: a known request key resumes BEFORE the address check; atomic call with a fallback", () => {
    const srv = readFileSync("src/lib/onsite-ready-check.server.ts", "utf8");
    expect(srv.indexOf("findAddedJob(")).toBeLessThan(srv.indexOf("findOpenJobAtAddress("));
    expect(srv).toContain("addInstallerJobAtomic(");
    expect(srv).toContain('=== "not_deployed"');
    expect(readFileSync("src/lib/add-installer-job.server.ts", "utf8")).toContain('rpc("add_installer_job"');
    expect(readFileSync("src/components/trade/add-job-flow.tsx", "utf8")).toContain("requestKey");
    expect(readFileSync("src/lib/onsite-ready-check.functions.ts", "utf8")).toContain("requestKey: z.string().uuid().optional()");
  });
});

describe("A6 pre-go-live fixes", () => {
  test("only a missing function or table means add_installer_job isn't deployed", async () => {
    const { isMissingDbFunction } = await import("../src/lib/schema-compat.core");
    expect(isMissingDbFunction({ code: "42883", message: "function public.add_installer_job(jsonb) does not exist" })).toBe(true);
    expect(isMissingDbFunction({ code: "PGRST202", message: "Could not find the function public.add_installer_job(_payload) in the schema cache" })).toBe(true);
    expect(isMissingDbFunction({ code: "42P01", message: 'relation "owner_contact_consents" does not exist' })).toBe(true);
    // a missing column inside the function, or any other failure, is a real error, not "not deployed"
    expect(isMissingDbFunction({ code: "42703", message: 'column "x" does not exist' })).toBe(false);
    expect(isMissingDbFunction({ code: "PGRST204", message: "Could not find the 'x' column in the schema cache" })).toBe(false);
    expect(isMissingDbFunction({ code: "P0001", message: "something does not exist" })).toBe(false);
    expect(isMissingDbFunction(null)).toBe(false);
    const srv = readFileSync("src/lib/add-installer-job.server.ts", "utf8");
    expect(srv).toContain("isMissingDbFunction(error)");
    expect(srv).not.toContain("isMissingDbObject");
  });
  test("Try again race: the refuse branch re-checks the request key before refusing or flagging", () => {
    const srv = readFileSync("src/lib/onsite-ready-check.server.ts", "utf8");
    const refuse = srv.slice(srv.indexOf("findOpenJobAtAddress("));
    expect(refuse.indexOf("findAddedJob(requestKey, businessId)")).toBeGreaterThan(0);
    expect(refuse.indexOf("findAddedJob(requestKey, businessId)")).toBeLessThan(refuse.indexOf("flagDuplicateAddress(open"));
  });
});
