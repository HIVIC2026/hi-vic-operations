// STEP 80 (W4): the REAL Homeowner job route component (/owner/$jobId) always reaches a terminal state. STEP 79 browser
// UAT: opening another customer's job stayed on "Loading…" because the page ignored the refusal from getJobOverview.
// Only the data hook and the child cards are stubbed (they are not under test); the route's own rendering logic runs.
import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";

const JOB_ID = "00000000-0000-4000-8000-000000000d01";
type JobQuery = { data?: Record<string, unknown>; isError: boolean; error?: Error | null; refetch: () => Promise<unknown> };
let query: JobQuery = { isError: false, refetch: async () => null };

mock.module("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({ ...opts, options: opts, useParams: () => ({ jobId: JOB_ID }) }),
  Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => <a href={to} className={className}>{children}</a>,
}));
const stub = (name: string) => () => <div data-stub={name} />;
mock.module("@/components/portal/AppShell", () => ({ AppShell: ({ children }: { children: ReactNode }) => <main data-shell="">{children}</main> }));
mock.module("@/components/portal/panels", () => ({
  useJob: (jobId: string) => { expect(jobId).toBe(JOB_ID); return query; },
  BookingPanel: stub("booking"), DocumentsPanel: stub("documents"), MessagesPanel: stub("messages"), PaymentsPanel: stub("payments"),
  QuotesPanel: stub("quotes"), TimelinePanel: stub("timeline"), Section: ({ children }: { children: ReactNode }) => <section>{children}</section>,
}));
mock.module("@/components/portal/allocation", () => ({ VisitContactsCard: stub("contacts") }));
mock.module("@/components/portal/instalment-plan", () => ({ OwnerInstalmentPlanCard: stub("instalments") }));
mock.module("@/components/portal/piesa-times", () => ({ PiesaTimesCard: stub("piesa-times") }));
mock.module("@/components/portal/visit-changes", () => ({ OwnerVisitChangeCard: stub("visit-change") }));
mock.module("@/components/portal/install-days", () => ({ OwnerInstallDaysCard: stub("install-days") }));
mock.module("@/components/portal/estimate", () => ({ OwnerEstimateCard: stub("estimate") }));
mock.module("@/components/portal/waiting", () => ({ ClearTimeline: stub("clear-timeline"), WhoHasTheBall: stub("who-has-the-ball") }));
mock.module("@/components/portal/badges", () => ({ PaymentBadge: stub("payment-badge"), StageBadge: stub("stage-badge"), UrgencyBadge: stub("urgency-badge") }));
mock.module("@/components/portal/assignment", () => ({ OwnerAssignmentCard: stub("assignment") }));
mock.module("@/hooks/use-me", () => ({ useAction: () => async () => undefined }));
mock.module("@/lib/portal.functions", () => ({ requestReassignment: async () => ({ ok: true }) }));

const { Route } = await import("../src/routes/_authenticated/owner.$jobId");
const { OWNER_JOB_UNAVAILABLE, ownerJobView } = await import("../src/lib/owner-job-view.core");
const OwnerJob = (Route as unknown as { component: () => ReactNode }).component;
const render = (q: Partial<JobQuery>) => { query = { isError: false, refetch: async () => null, ...q }; return renderToStaticMarkup(<OwnerJob />); };
const html = (s: string) => s.replace(/'/g, "&#x27;");

// Exactly what getJobOverview/requireJobRole return (see tests/a4-step80-regulated-result-authz-db.test.ts G/H).
const REFUSED = new Error("You don't have permission for this action on this job.");

describe("ownerJobView", () => {
  test("loaded job wins; failed load is terminal; otherwise loading", () => {
    expect(ownerJobView({ hasJob: true, isError: true })).toBe("ready");
    expect(ownerJobView({ hasJob: false, isError: true })).toBe("unavailable");
    expect(ownerJobView({ hasJob: false, isError: false })).toBe("loading");
  });
  test("the message is neutral (never says whether the job exists or whose it is)", () => {
    expect(OWNER_JOB_UNAVAILABLE).toBe("This job is unavailable or you do not have permission to access it.");
  });
});

describe("/owner/$jobId route component", () => {
  test("G: another customer's job → neutral denial, not 'Loading…', no job details", () => {
    const out = render({ isError: true, error: REFUSED });
    expect(out).toContain(html(OWNER_JOB_UNAVAILABLE));
    expect(out).toContain('role="alert"');
    expect(out).toContain('href="/owner"');
    expect(out).toContain("Try again");
    expect(out).not.toContain("Loading…");
    expect(out).not.toContain("data-stub");
    expect(out).not.toContain(html(REFUSED.message));
  });
  test("H: a job that does not exist renders byte-identical output to G", () => {
    expect(render({ isError: true, error: REFUSED })).toBe(render({ isError: true, error: new Error(REFUSED.message) }));
  });
  test("any other load failure (network/server) is also terminal", () => {
    const out = render({ isError: true, error: new Error("Failed to fetch") });
    expect(out).toContain(html(OWNER_JOB_UNAVAILABLE));
    expect(out).not.toContain("Loading…");
    expect(out).not.toContain("Failed to fetch");
  });
  test("still loading → 'Loading…' only", () => {
    const out = render({});
    expect(out).toContain("Loading…");
    expect(out).not.toContain(html(OWNER_JOB_UNAVAILABLE));
  });
  test("F: own job renders the job page (no denial)", () => {
    const out = render({ data: { id: JOB_ID, job_number: "UAT-S80-E", property_address: "1 Private St, Step80ville VIC 3999", stage: "measured_estimate_ready", payment_status: null, urgency: null, days_remaining: null, electrician_name: null, installer_name: null } });
    expect(out).toContain("UAT-S80-E");
    expect(out).toContain("1 Private St, Step80ville VIC 3999");
    expect(out).toContain('data-stub="quotes"');
    expect(out).not.toContain(html(OWNER_JOB_UNAVAILABLE));
    expect(out).not.toContain("Loading…");
  });
  test("a failed background refetch keeps showing the loaded own job", () => {
    const out = render({ data: { id: JOB_ID, job_number: "UAT-S80-E", property_address: "x", stage: "measured_estimate_ready" }, isError: true, error: new Error("Failed to fetch") });
    expect(out).toContain("UAT-S80-E");
    expect(out).not.toContain(html(OWNER_JOB_UNAVAILABLE));
  });
});
