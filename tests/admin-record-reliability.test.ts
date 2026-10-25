import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "fs";

const functions = readFileSync("src/lib/admin-records.functions.ts", "utf8");
const partners = readFileSync("src/routes/_authenticated/admin.partners.tsx", "utf8");
// O5 build B: approved partners moved into Partners › Approved + the business file (admin.businesses is a redirect).
const businesses = readFileSync("src/routes/_authenticated/admin.partners_.business.$businessId.tsx", "utf8");
const officeTabs = readFileSync("src/components/portal/office-tabs.tsx", "utf8");
const board = readFileSync("src/lib/office-partners.server.ts", "utf8");
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
      expect(page).toContain("retry: 3");
    }
    expect(users).toContain("Try again");
    // Partners and the business file show the shared LoadError (with Try again) instead of an empty screen.
    for (const page of [partners, businesses]) expect(page).toContain("<LoadError");
    expect(officeTabs).toContain("Try again");
    expect(partners).not.toContain('supabase.from("partner_enquiries")');
    expect(businesses).not.toContain('supabase.from("businesses")');
    expect(users).not.toContain('supabase.from("profiles")');
  });

  it("puts signed portal applications in a distinct pending approval queue", () => {
    expect(partners).toContain("Pending approval · signed applications");
    expect(partners).toContain("rows.filter((r) => r.signed)");
    expect(partners).toContain("Website enquiries · no signed application yet");
    expect(board).toContain('signed: String(r["source"] ?? "").startsWith("portal_")');
  });

  it("keeps a failed job read distinct from a missing job", () => {
    expect(functions).toContain("export const getJobOverview");
    // Speed (decision 280): the read body lives in job-overview.server.ts so the installer job bundle shares it; the role check is unchanged.
    expect(functions).toContain("jobOverviewFor(context.supabase, context.userId, data.jobId)");
    expect(readFileSync("src/lib/job-overview.server.ts", "utf8")).toContain('await requireJobRole(sb, jobId, ["admin", "owner", "electrician", "installer"])');
    expect(job).toContain("Its records have not been deleted");
    expect(job).toContain("Try again");
  });
});
describe("single-job operations status getter", () => {
  const opsFunctions = readFileSync("src/lib/operations-preview.functions.ts", "utf8");
  const opsQuery = readFileSync("src/lib/operations-query.ts", "utf8");
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
  it("the retired compact job status box is gone; the O2 Next panel reads one job page loader", () => {
    expect(existsSync("src/components/portal/CompactJobStatus.tsx")).toBe(false);
    expect(readFileSync("src/routes/_authenticated/admin.jobs.$jobId.tsx", "utf8")).toContain("getOfficeJobPage");
  });
});
