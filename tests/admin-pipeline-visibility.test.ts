import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";

const functions = readFileSync("src/lib/portal.functions.ts", "utf8");
const pipeline = readFileSync("src/routes/_authenticated/admin.board.tsx", "utf8");
const schema = readFileSync("drizzle/migrations/0000_hivic_core_schema.sql", "utf8");

describe("admin pipeline visibility", () => {
  it("loads the complete overview only after authenticated admin verification", () => {
    const start = functions.indexOf("export const getAdminPipeline");
    const end = functions.indexOf("export const getGate1Evidence", start);
    const implementation = functions.slice(start, end);

    expect(implementation).toContain(".middleware([requireSupabaseAuth])");
    expect(implementation.indexOf("await requireAdmin(context.supabase)")).toBeGreaterThan(-1);
    // the job_overview read moved into its own server module; it is still imported, and therefore
    // reachable, only after the caller has been verified as an admin.
    expect(implementation.indexOf('await import("./job-pipeline.server")')).toBeGreaterThan(
      implementation.indexOf("await requireAdmin(context.supabase)"),
    );
    expect(functions).toContain("admin.from(\"job_overview\")");
    expect(implementation).toContain("if (error) throw new Error");
  });

  it("the Pipeline board is retired (decision 218, audit removal 1): it only redirects and never runs maintenance on open", () => {
    expect(pipeline).toContain('redirect({ to: "/admin/jobs/active"');
    expect(pipeline).not.toMatch(/import[^\n]*(sweepAuthorities|autoAdvancePipeline|getAdminPipeline)|useServerFn/);
  });

  it("keeps unrelated jobs hidden from non-admins at the RLS boundary", () => {
    expect(schema).toContain("create policy \"job_access\" on public.jobs for select to authenticated using (public.can_access_job(id));");
    expect(schema).toMatch(/create or replace function public\.can_access_job[\s\S]*?public\.is_admin\(\)[\s\S]*?job_assignment_role[\s\S]*?is_job_owner/);
    expect(schema).not.toContain('create policy "public_jobs"');
  });
});