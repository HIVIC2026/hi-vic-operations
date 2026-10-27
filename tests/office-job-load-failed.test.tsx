// Activity 48 records: a failed read must NOT list every record as unrecorded with a Record button (Jo, 27 Oct 2026).
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: "http://localhost" });
import { afterEach, expect, mock, test } from "bun:test";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const { cleanup, render, waitFor } = await import("@testing-library/react");

let fail = true;
mock.module("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
mock.module("../src/hooks/use-me", () => ({ useAction: (fn: unknown) => fn }));
mock.module("../src/integrations/supabase/client", () => ({ supabase: {} }));
mock.module("../src/components/portal/mitti", () => ({ PriceItemForm: () => null }));
mock.module("../src/components/portal/panels", () => ({ Section: ({ title, children }: { title: string; children: React.ReactNode }) => <section aria-label={title}>{children}</section> }));
mock.module("../src/components/portal/badges", () => ({ Pill: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }));
mock.module("../src/lib/workflow", () => ({ fmtDate: () => "", aud: () => "", ELIGIBILITY_LABEL: {} }));
mock.module("../src/lib/admin-records.functions", () => ({ getAdminJobEligibility: async () => ({}) }));
mock.module("../src/lib/coverage.functions", () => ({ getJobCoverage: async () => ({}), sendNoCoverageEmail: async () => ({}) }));
mock.module("../src/lib/portal.functions", () => ({
  listComplianceRecords: async () => { if (fail) throw new Error("network down"); return []; },
  draftVeecReply: async () => ({}), markVeecReplySent: async () => ({}), recordComplianceItem: async () => ({}), runComplianceReview: async () => ({}), setComplianceCheck: async () => ({}), setEligibility: async () => ({}), updateVeec: async () => ({}),
}));
const { ComplianceRecords } = await import("../src/components/portal/office-job-parts");

afterEach(() => cleanup());
const mount = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ComplianceRecords jobId="qa-job" /></QueryClientProvider>);

test("failed read: says it could not load, offers Try again, and shows no Record buttons", async () => {
  fail = true;
  const v = mount();
  await waitFor(() => expect(v.getByRole("alert").textContent).toContain("Activity 48 records could not load"));
  expect(v.getByRole("button", { name: "Try again" })).toBeTruthy();
  expect(v.queryAllByRole("button", { name: "Record" })).toHaveLength(0);
});

test("successful empty read still offers Record for each missing item", async () => {
  fail = false;
  const v = mount();
  await waitFor(() => expect(v.queryAllByRole("button", { name: "Record" }).length).toBeGreaterThan(0));
  expect(v.queryByRole("alert")).toBeNull();
});
