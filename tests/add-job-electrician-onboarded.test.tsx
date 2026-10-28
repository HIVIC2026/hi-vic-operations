// Jo 28 Oct 2026 (spec rule 3): at Add a job, "My usual electrician" is offered only once that electrician has finished
// signing up with an agreed rate. Until then it shows greyed out with the exact text and can't be picked; the save is
// refused on the server too. The options loader sends the name and onboarded flag only — never a rate or price (crew
// rule). Real loader, real save validation and the real Add a job screen; only I/O modules are stubbed.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { ReactNode } from "react";

const BIZ = "00000000-0000-4000-8000-0000000000b1";
const GREYED = "Sam Lee — not signed up with us yet. They need to finish before you can choose them.";
const SAM = { name: "Sam Lee", licence: "A12345", priceIncGst: 300, email: "sam@hivic-test.example" };
const REC = { business_id: "rec-1", name: "Sam Lee Electrical", trading_name: null, rec_number: "REC-1", worker_licences: ["A12345"], onboarding_status: "approved", is_active: true, approved_electricians: 1, piesa_rate: { id: "rate-1", rate_inc_gst: 310 } };
let usual: typeof SAM | null = SAM;
let candidates: (typeof REC)[] = [];
const created: string[] = [];

mock.module("@tanstack/react-start", () => ({
  useServerFn: (fn: unknown) => fn,
  createServerFn: () => {
    const chain: Record<string, unknown> = { middleware: () => chain, inputValidator: () => chain, handler: (fn: (o: unknown) => unknown) => (o: { data: unknown }) => fn({ data: o.data, context: { userId: "user-1" } }) };
    return chain;
  },
  createMiddleware: () => ({ server: (fn: unknown) => fn }),
}));
mock.module("@tanstack/react-router", () => ({ Link: ({ children }: { children: ReactNode }) => <a>{children}</a> }));
mock.module("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: (t: string) => { created.push(t); throw new Error(`no database in this test (${t})`); } } }));
mock.module("../src/lib/workflow.server", () => ({ WorkflowError: class WorkflowError extends Error {}, logEvent: async () => { created.push("event"); } }));
mock.module("../src/lib/pilot.server", () => ({ requireMember: async () => {}, requireApprovedPartner: async () => {}, intakeSourceFor: async () => "installer_onsite" }));
mock.module("../src/lib/usual-electrician.server", () => ({ readUsualElectrician: async () => ({ electrician: usual, revision: "rev-1" }) }));
mock.module("../src/lib/rec-onboarded.server", () => ({ loadApprovedRecCandidates: async () => candidates }));
// The step straight after validation: an open job at this address stops the save before anything is created, which
// shows the electrician check passed without needing a database.
mock.module("../src/lib/duplicate-address.server", () => ({ findOpenJobAtAddress: async () => ({ id: "job-open", job_number: "HV-9" }), flagDuplicateAddress: async () => {}, businessNameFor: async () => "TEST Biz" }));

const { addJobOptions } = await import("../src/lib/onsite-ready-check.functions");
const { startOnsiteReadyCheckFor } = await import("../src/lib/onsite-ready-check.server");
const { duplicateAddressMessage } = await import("../src/lib/duplicate-address.core");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { render, cleanup, waitFor, fireEvent } = await import("@testing-library/react");
const { AddJobFlow } = await import("../src/components/trade/add-job-flow");

const owner = { full_name: "Ann Lee", address_line: "12 Ryrie Street", suburb: "Geelong", postcode: "3220", phone: "0412 000 777", email: "owner@hivic-test.example", contact_permission: true, consent_by: "installer" as const, address_verified: true };
const loader = addJobOptions as unknown as (o: { data: { businessId: string } }) => Promise<{ usualElectrician: unknown }>;

beforeEach(() => { usual = SAM; candidates = []; created.length = 0; });
afterEach(() => cleanup());

describe("options loader: name and onboarded only", () => {
  test("not onboarded", async () => {
    expect(await loader({ data: { businessId: BIZ } })).toEqual({ usualElectrician: { name: "Sam Lee", onboarded: false } });
  });
  test("onboarded (approved REC with an agreed rate)", async () => {
    candidates = [REC];
    expect(await loader({ data: { businessId: BIZ } })).toEqual({ usualElectrician: { name: "Sam Lee", onboarded: true } });
  });
  test("approved but no agreed rate yet = not onboarded", async () => {
    candidates = [{ ...REC, piesa_rate: null as never }];
    expect(await loader({ data: { businessId: BIZ } })).toEqual({ usualElectrician: { name: "Sam Lee", onboarded: false } });
  });
  test("no usual electrician saved", async () => {
    usual = null;
    expect(await loader({ data: { businessId: BIZ } })).toEqual({ usualElectrician: null });
  });
});

describe("save: 'usual' is checked on the server", () => {
  test("not onboarded: refused with the exact text, nothing saved", async () => {
    await expect(startOnsiteReadyCheckFor("user-1", BIZ, owner, null, undefined, { electricianChoice: "usual" })).rejects.toThrow(GREYED);
    expect(created).toEqual([]);
  });
  test("not onboarded: no choice sent → Home Insulation Victoria's electrician (passes the check)", async () => {
    await expect(startOnsiteReadyCheckFor("user-1", BIZ, owner, null, undefined, { electricianChoice: null })).rejects.toThrow(duplicateAddressMessage("HV-9"));
  });
  test("onboarded: accepted (passes the check)", async () => {
    candidates = [REC];
    await expect(startOnsiteReadyCheckFor("user-1", BIZ, owner, null, undefined, { electricianChoice: "usual" })).rejects.toThrow(duplicateAddressMessage("HV-9"));
  });
});

const show = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><AddJobFlow businessId={BIZ} /></QueryClientProvider>);
};
const radio = (r: ReturnType<typeof show>, value: string) => r.container.querySelector(`input[name="add-job-electrician"][value="${value}"]`) as HTMLInputElement;

describe("Add a job screen", () => {
  test("not onboarded: greyed option with the exact text, can't be picked, HIV chosen", async () => {
    const r = show();
    await waitFor(() => expect(r.container.textContent).toContain(GREYED));
    expect(r.container.textContent).toContain("My usual electrician (Sam Lee)");
    expect(radio(r, "usual").disabled).toBe(true);
    await waitFor(() => expect(radio(r, "hivic").checked).toBe(true));
    fireEvent.click(radio(r, "usual"));
    expect(radio(r, "usual").checked).toBe(false);
    expect(radio(r, "hivic").checked).toBe(true);
  });
  test("onboarded: usual enabled and chosen, no greyed text", async () => {
    candidates = [REC];
    const r = show();
    await waitFor(() => expect(radio(r, "usual")?.checked).toBe(true));
    expect(radio(r, "usual").disabled).toBe(false);
    expect(r.container.textContent).not.toContain("not signed up with us yet");
  });
});
