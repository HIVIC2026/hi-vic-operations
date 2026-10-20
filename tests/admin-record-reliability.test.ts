import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";

const functions = readFileSync("src/lib/admin-records.functions.ts", "utf8");
const partners = readFileSync("src/routes/_authenticated/admin.partners.tsx", "utf8");
const businesses = readFileSync("src/routes/_authenticated/admin.businesses.tsx", "utf8");
const users = readFileSync("src/routes/_authenticated/admin.users.tsx", "utf8");
const job = readFileSync("src/routes/_authenticated/admin.jobs.$jobId.tsx", "utf8");

describe("admin record reliability", () => {
  it("loads office lists through authenticated admin functions", () => {
    for (const name of ["getAdminPartnerEnquiries", "getAdminBusinesses", "getAdminUsers"]) {
      const start = functions.indexOf(`export const ${name}`);
      expect(start).toBeGreaterThan(-1);
      const next = functions.indexOf("export const", start + 20);
      const implementation = functions.slice(start, next < 0 ? undefined : next);
      expect(implementation).toContain(".middleware([requireSupabaseAuth])");
      expect(implementation).toContain("await requireAdmin(context.supabase)");
      expect(implementation).toContain("throw new Error");
    }
  });

  it("does not silently turn list failures into empty screens", () => {
    for (const page of [partners, businesses, users]) {
      expect(page).toContain("useServerFn");
      expect(page).toContain("Try again");
      expect(page).toContain("retry: 3");
    }
    expect(partners).not.toContain('supabase.from("partner_enquiries")');
    expect(businesses).not.toContain('supabase.from("businesses")');
    expect(users).not.toContain('supabase.from("profiles")');
  });

  it("puts signed portal applications in a distinct pending approval queue", () => {
    expect(partners).toContain("Pending approval");
    expect(partners).toContain('queue === "approval"');
    expect(partners).toContain("&& isOnboarding(row)");
    expect(partners).toContain("Website enquiries");
    expect(partners).toContain("Onboarding form (signed application)");
  });

  it("keeps a failed job read distinct from a missing job", () => {
    expect(functions).toContain("export const getJobOverview");
    expect(functions).toContain("await requireJobRole(context.supabase");
    expect(job).toContain("Its records have not been deleted");
    expect(job).toContain("Try again");
  });
});
describe("single-job operations status getter", () => {
  const opsFunctions = readFileSync("src/lib/operations-preview.functions.ts", "utf8");
  const opsQuery = readFileSync("src/lib/operations-query.ts", "utf8");
  const compact = readFileSync("src/components/portal/CompactJobStatus.tsx", "utf8");
  it("keeps the single-job getter admin-authenticated, id-validated and fail-closed", () => {
    const start = opsFunctions.indexOf("export const getOperationsJob");
    expect(start).toBeGreaterThan(-1);
    const implementation = opsFunctions.slice(start);
    expect(implementation).toContain(".middleware([requireSupabaseAuth])");
    expect(implementation).toContain("await requireAdmin(context.supabase)");
    expect(implementation).toContain("z.string().uuid()");
    expect(implementation).toContain("loadOperationsPreview(supabaseAdmin, data.jobId)");
    // The global dashboard getter is unchanged: full loader, no job id argument.
    expect(opsFunctions).toContain("return loadOperationsPreview(supabaseAdmin);");
  });
  it("keys the single-job query under the operations-preview prefix for invalidation", () => {
    expect(opsQuery).toContain('queryKey: ["operations-preview", "job", jobId]');
    expect(opsQuery).toContain('queryKey: ["operations-preview"]');
  });
  it("the compact job status uses the job-keyed getter, not the whole-dashboard read", () => {
    expect(compact).toContain("operationsJobOptions(jobId)");
    expect(compact).not.toContain("operationsOptions");
  });
});
