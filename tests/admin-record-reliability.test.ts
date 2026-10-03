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