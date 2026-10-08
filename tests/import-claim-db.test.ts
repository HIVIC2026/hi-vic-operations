// Submission claim through the real persistence boundary (PGlite + PostgREST-style conditional updates).
// Drives confirmImportFor itself; only the job-building body (confirmClaimed) is replaced by a controllable step.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";

const db = new PGlite();
await db.exec(`
CREATE TABLE job_imports (id uuid primary key, business_id uuid not null, status text not null default 'draft',
  confirmed_by uuid, confirmed_at timestamptz, job_id uuid, confirmed_facts jsonb, updated_at timestamptz default now());
CREATE TABLE jobs (id uuid primary key, job_number text);`);
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: postgrestShim(db) }));
mock.module("@/lib/pilot.server", () => ({ requireMember: async () => {}, requireApprovedPartner: async () => ({}) }));
const { confirmImportFor, linkImportJob, finalizeImport } = await import("../src/lib/partner-import.server");

const IMP = "00000000-0000-0000-0000-0000000000a1", BIZ = "00000000-0000-0000-0000-0000000000b1";
const U = "00000000-0000-0000-0000-0000000000c1", JOB = "00000000-0000-0000-0000-0000000000d1";
const input = (area = "118") => ({ importId: IMP, facts: { full_name: "TEST Owner", measured_area_m2: area } });
const row = async () => { const r = (await db.query<{ confirmed_by: string | null; confirmed_at: Date | null; job_id: string | null; status: string }>("select * from job_imports where id=$1", [IMP])).rows[0]!; return { ...r, confirmed_at: r.confirmed_at ? new Date(r.confirmed_at).toISOString() : null }; };
const gate = () => { let open!: () => void; const p = new Promise<void>((r) => (open = r)); return { p, open }; };

beforeEach(async () => {
  await db.exec("delete from job_imports; delete from jobs;");
  await db.query("insert into job_imports (id, business_id) values ($1,$2)", [IMP, BIZ]);
  await db.query("insert into jobs values ($1,'HV-T1')", [JOB]);
});

describe("import submission claim (persistence boundary)", () => {
  test("same user, second tab, while the first submit is running and a partial job exists → busy, not resume", async () => {
    const g = gate(); const linked = gate();
    const first = confirmImportFor(U, input() as never, (async (_u, _d, _i, resume, claim, attempt) => {
      expect(resume).toBeNull(); await linkImportJob(claim, JOB, attempt); linked.open(); await g.p; throw new Error("crash after job created");
    }) as never);
    await linked.p;
    expect((await row()).job_id).toBe(JOB);
    let ran = false;
    await expect(confirmImportFor(U, input() as never, (async () => { ran = true; }) as never)).rejects.toThrow("already being saved");
    expect(ran).toBe(false);
    g.open(); await expect(first).rejects.toThrow("crash");
    const r = await row(); // failed partial: claim released, job kept for reuse
    expect(r.confirmed_by).toBeNull(); expect(r.job_id).toBe(JOB); expect(r.status).toBe("draft");
  });

  test("lost response / failed partial retry reuses the SAME job and confirms once; later retry returns it", async () => {
    await confirmImportFor(U, input() as never, (async (_u, _d, _i, _r, claim, attempt) => { await linkImportJob(claim, JOB, attempt); throw new Error("network"); }) as never).catch(() => {});
    let reused: string | null = null;
    const out = await confirmImportFor(U, input() as never, (async (_u, _d, _i, resume, claim) => { reused = resume; await finalizeImport(claim, resume!, { ok: true }); return { jobId: resume!, jobNumber: "HV-T1" }; }) as never);
    expect(reused).toBe(JOB); expect(out.jobId).toBe(JOB);
    expect((await row()).status).toBe("confirmed");
    const again = await confirmImportFor(U, input() as never, (async () => { throw new Error("must not run"); }) as never);
    expect(again).toEqual({ jobId: JOB, jobNumber: "HV-T1", reused: true });
  });

  test("retry onto a partial job with DIFFERENT details is refused and leaves the claim released", async () => {
    await confirmImportFor(U, input("118") as never, (async (_u, _d, _i, _r, claim, attempt) => { await linkImportJob(claim, JOB, attempt); throw new Error("x"); }) as never).catch(() => {});
    await expect(confirmImportFor(U, input("200") as never, (async () => { throw new Error("must not run"); }) as never)).rejects.toThrow("different details");
    expect((await row()).confirmed_by).toBeNull();
  });

  test("two simultaneous first submits: exactly one claims", async () => {
    const g = gate(); let runs = 0;
    const calls = [0, 1].map(() => confirmImportFor(U, input() as never, (async () => { runs++; await g.p; return { jobId: JOB, jobNumber: null }; }) as never));
    await Promise.race(calls.map((c) => c.catch(() => {})));
    g.open();
    const res = await Promise.allSettled(calls);
    expect(res.filter((r) => r.status === "rejected").length).toBe(1);
    expect(runs).toBe(1);
  });

  test("stale takeover is fenced: the old handler can neither confirm nor clear the newer claim", async () => {
    const g = gate(); const linked = gate(); let oldClaim: { id: string; userId: string; at: string } | null = null;
    const first = confirmImportFor(U, input() as never, (async (_u, _d, _i, _r, claim, attempt) => { oldClaim = claim; await linkImportJob(claim, JOB, attempt); linked.open(); await g.p; await finalizeImport(claim, JOB, {}); }) as never);
    await linked.p;
    await db.query("update job_imports set confirmed_at = now() - interval '10 minutes' where id=$1", [IMP]); // crashed long ago
    oldClaim!.at = (await row()).confirmed_at!; // old handler's view of its own (now stale) claim
    const hold = gate(); let newResume: string | null = null;
    const second = confirmImportFor(U, input() as never, (async (_u, _d, _i, resume) => { newResume = resume; await hold.p; throw new Error("second fails"); }) as never);
    await new Promise((r) => setTimeout(r, 50));
    const newAt = (await row()).confirmed_at;
    expect(newAt).not.toBe(oldClaim!.at);
    g.open(); await expect(first).rejects.toThrow("taken over"); // old handler's release is fenced out too
    expect((await row()).confirmed_at).toBe(newAt);
    hold.open(); await expect(second).rejects.toThrow("second fails");
    expect(newResume).toBe(JOB);
    const r = await row(); expect(r.confirmed_by).toBeNull(); expect(r.job_id).toBe(JOB);
  });
});
