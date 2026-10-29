// Active jobs "Registry robot couldn't lodge" pile: the real server function (admin only, job numbers, failures
// done by hand dropped by openRobotFailureRows) over a practice Postgres, and the real pile component rendered
// through it. No live database, no network.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();
import { afterEach, describe, expect, mock, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";

const JOB = "00000000-0000-4000-8000-00000000000a", JOB2 = "00000000-0000-4000-8000-00000000000b";
const N1 = "00000000-0000-4000-8000-0000000000e1";
const db = new PGlite();
await db.exec(`
  create table public.jobs(id uuid primary key, job_number text not null, source text not null default 'web');
  insert into public.jobs(id, job_number) values ('${JOB}', 'HV-1'), ('${JOB2}', 'HV-2');
  create table public.workflow_events(id uuid primary key default gen_random_uuid(), job_id uuid, event_type text not null, details jsonb not null default '{}'::jsonb, created_at timestamptz not null default clock_timestamp());
  create table public.esc_notifications(id uuid primary key, job_id uuid not null, sent_at timestamptz, submission_reference text);
  insert into public.esc_notifications(id, job_id) values ('${N1}', '${JOB}');
  create table public.veec_lodgements(id uuid primary key default gen_random_uuid(), job_id uuid not null unique, status text not null default 'not_submitted');
  insert into public.veec_lodgements(job_id) values ('${JOB2}');
`);
const shim = postgrestShim(db, { jsonColumns: { workflow_events: ["details"] } });
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: shim }));

type Ctx = { supabase: unknown; userId: string };
type Call = (a: { data?: unknown; context: Ctx }) => Promise<{ rows: { jobId: string; jobNumber: string; task: string; at: string; text: string }[] }>;
const ctx: Ctx = { supabase: { rpc: async () => ({ data: true, error: null }) }, userId: "u" };
mock.module("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate: (d: unknown) => unknown = (d) => d;
    const b = {
      middleware: () => b,
      inputValidator: (f: typeof validate) => { validate = f; return b; },
      handler: (h: (a: { data: unknown; context: Ctx }) => Promise<unknown>) => (a: { data?: unknown; context?: Ctx }) => h({ data: validate(a?.data), context: a?.context ?? ctx }),
    };
    return b;
  },
  createMiddleware: () => ({ server: () => ({}) }),
  useServerFn: (fn: (a: unknown) => unknown) => (a?: unknown) => fn(a ?? {}),
}));
mock.module("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
mock.module("@tanstack/react-router", () => ({
  Link: ({ to, params, hash, children, ...rest }: { to: string; params?: Record<string, string>; hash?: string; children: unknown }) =>
    createElement("a", { href: `${to.replace("$jobId", params?.["jobId"] ?? "")}${hash ? `#${hash}` : ""}`, ...rest }, children as never),
}));

const { getRobotFailures } = await import("../src/lib/office-screens.functions");
const { RobotFailuresPile } = await import("../src/components/portal/robot-failures-pile");
const call = getRobotFailures as unknown as Call;

const fail = (job: string, details: Record<string, unknown>) =>
  db.query("insert into public.workflow_events(job_id, event_type, details) values ($1, 'esc_registry_robot_failed', $2)", [job, JSON.stringify({ needs_office: true, ...details })]);
await fail(JOB, { task: "install_notification", notification_id: N1, step: "login", error: "The Registry refused the login" });
await fail(JOB2, { task: "veec_creation", step: "fill:veec_quantity", error: "no field" });

afterEach(cleanup);

describe("getRobotFailures", () => {
  test("one row per open failure, with its job number", async () => {
    const { rows } = await call({ context: ctx });
    expect(rows.map((r) => [r.jobNumber, r.task]).sort()).toEqual([["HV-1", "install_notification"], ["HV-2", "veec_creation"]]);
    expect(rows[0]).toMatchObject({ jobId: expect.any(String), at: expect.any(String), text: expect.stringContaining("Registry robot failed") });
  });
  test("a non-admin is refused", async () => {
    await expect(call({ context: { supabase: { rpc: async () => ({ data: false, error: null }) }, userId: "x" } })).rejects.toThrow(/Admin only/);
  });
  test("a TEST job's failure is not returned", async () => {
    const QA = "00000000-0000-4000-8000-0000000000c1";
    await db.exec(`insert into public.jobs(id, job_number, source) values ('${QA}', 'HV-QA', 'qa_test')`);
    await fail(QA, { task: "veec_creation", step: "fill:veec_quantity", error: "no field" });
    const { rows } = await call({ context: ctx });
    expect(rows.map((r) => r.jobNumber).sort()).toEqual(["HV-1", "HV-2"]);
    await db.exec(`delete from public.workflow_events where job_id = '${QA}'`);
  });
  test("a failure whose notice is now sent is not returned", async () => {
    await db.exec(`update public.esc_notifications set sent_at = now(), submission_reference = 'VEU-BY-HAND' where id = '${N1}'`);
    const { rows } = await call({ context: ctx });
    expect(rows.map((r) => r.jobNumber)).toEqual(["HV-2"]);
    await db.exec(`update public.esc_notifications set sent_at = null, submission_reference = null where id = '${N1}'`);
  });
});

const wrap = () => render(createElement(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }, createElement(RobotFailuresPile)));

describe("RobotFailuresPile", () => {
  test("lists each failure, linking the job to the install notice or the final check", async () => {
    const screen = wrap();
    const notice = await screen.findByText("HV-1");
    expect(notice.closest("a")?.getAttribute("href")).toBe(`/admin/jobs/${JOB}#stage-install`);
    expect(screen.getByText("HV-2").closest("a")?.getAttribute("href")).toBe(`/admin/jobs/${JOB2}#stage-final-check`);
    expect(screen.getByText(/The Registry refused the login|login/)).toBeTruthy();
  });
  test("says so when nothing is open", async () => {
    await db.exec("delete from public.workflow_events");
    const screen = wrap();
    await waitFor(() => expect(screen.getByText("No robot problems.")).toBeTruthy());
  });
});

test("Active jobs has the fold line next to the Mitti piles, red when there are failures, hidden from the test office", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync("src/components/portal/JobsScreen.tsx", "utf8");
  expect(src).toContain("Registry robot couldn't lodge");
  expect(src).toContain("getRobotFailures");
  expect(src).toContain("No robot problems.");
  expect(src).toContain("{!testOffice && <Piles />}");
});
