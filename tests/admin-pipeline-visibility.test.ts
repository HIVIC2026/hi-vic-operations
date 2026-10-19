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
    expect(implementation.indexOf('admin.from("job_overview")')).toBeGreaterThan(
      implementation.indexOf("await requireAdmin(context.supabase)"),
    );
    expect(implementation).toContain("if (error) throw new Error");
  });

  it("uses the admin-only read instead of silently turning a browser RLS error into zero jobs", () => {
    expect(pipeline).toContain("useServerFn(getAdminPipeline)");
    expect(pipeline).toContain("queryFn: () => loadPipeline()");
    expect(pipeline).not.toContain('supabase.from("job_overview").select("*")');
    expect(pipeline).toContain("error: pipelineError");
    expect(pipeline).toContain("The Pipeline could not be loaded");
  });

  it("never delays the enquiry read behind maintenance work", () => {
    expect(pipeline).toContain("Promise.allSettled([sweep(), advance()])");
    expect(pipeline).not.toMatch(/queryFn:\s*async[\s\S]*await sweep\(\)[\s\S]*return loadPipeline\(\)/);
    expect(pipeline).toContain("Loading enquiries…");
    expect(pipeline).toContain("Your enquiries have not been deleted.");
  });

  it("uses the same phase-filtered jobs for rows, select-all and the empty state", () => {
    expect(pipeline).toContain("const visibleJobs = useMemo(() => filterVisibleJobs(filtered, phase, (_s, j) => phaseOf(j))");
    expect(pipeline).toContain("visibleJobs.map((j: JobRow)");
    expect(pipeline).toContain("visibleJobs.every((j) => selected.has(j.id!))");
    expect(pipeline).toContain("visibleJobs.length === 0 && shownInterests.length === 0");
  });

  it("keeps unrelated jobs hidden from non-admins at the RLS boundary", () => {
    expect(schema).toContain("create policy \"job_access\" on public.jobs for select to authenticated using (public.can_access_job(id));");
    expect(schema).toMatch(/create or replace function public\.can_access_job[\s\S]*?public\.is_admin\(\)[\s\S]*?job_assignment_role[\s\S]*?is_job_owner/);
    expect(schema).not.toContain('create policy "public_jobs"');
  });
});