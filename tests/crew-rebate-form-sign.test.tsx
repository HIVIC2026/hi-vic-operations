// Jo 28 Oct 2026 (spec rule 3, fix round 3): the rebate form's amounts are the business owner's only. The lead installer
// — who may be crew — still signs Section 3 Part B from the job page. Real `InstallerFinalDeclaration` in happy-dom, fed
// the crew payload `getAssignment` now returns (crew-no-price.core `assignmentForInstaller`); only server calls stubbed.
// Run on its own: bun test tests/crew-rebate-form-sign.test.tsx
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();
import { afterEach, describe, expect, mock, test } from "bun:test";
import { VEEC_FORM_BODY, VEEC_FORM_FIELDS } from "../src/lib/veec-assignment-form.core";
import { assignmentForInstaller } from "../src/lib/crew-no-price.core";

const JOB = "00000000-0000-4000-8000-000000000301";
const signCalls: unknown[] = [];
let payload: unknown = null;
const stub = async () => ({});

mock.module("@tanstack/react-start", () => ({
  useServerFn: (fn: unknown) => fn,
  createServerFn: () => { const chain: Record<string, unknown> = { middleware: () => chain, inputValidator: () => chain, handler: () => chain }; return chain; },
  createMiddleware: () => ({ server: (fn: unknown) => fn }),
}));
mock.module("@/hooks/use-me", () => ({ useAction: (fn: (o: { data: unknown }) => Promise<unknown>) => async (data: unknown) => fn({ data }) }));
mock.module("@/lib/portal.functions", () => ({
  getAssignment: async () => payload,
  signFinalAssignmentFn: async (o: { data: unknown }) => { signCalls.push(o.data); return { ok: true }; },
  confirmApConsentFn: stub, getAcceptancePackage: stub, getAssignmentDocUrl: stub, prepareFinalAssignmentFn: stub, raiseAssignmentVariation: stub,
  reconfirmAssignmentVariation: stub, recordVeecPrerequisiteFn: stub, respondToQuote: stub, sendMessage: stub, signOwnerConsentFn: stub,
}));
mock.module("../src/components/portal/panels", () => ({ Section: ({ children }: { children: unknown }) => children }));
mock.module("@/components/portal/file-viewer", () => ({ openFileViewer: () => undefined }));

const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { render, cleanup, waitFor, fireEvent } = await import("@testing-library/react");
const { InstallerFinalDeclaration } = await import("../src/components/portal/assignment");

afterEach(() => { cleanup(); signCalls.length = 0; });
const priceLabels = VEEC_FORM_FIELDS.filter((f) => f.label.includes("$")).map((f) => f.label);
const crewPayload = (blockers: string[], cur: Record<string, unknown> | null) => assignmentForInstaller("installer", cur as never, {
  stage: "installation_complete", installationCompleted: true, installerBlockers: [], finalBlockers: [],
  veecPrep: { blockers, missing: priceLabels, values: { price_before_incentive: 5000, consumer_payment_after: 4201.25, benefit_amount: 798.75 }, fields: VEEC_FORM_FIELDS },
  officialForm: { template_key: "consumer_declaration", body: VEEC_FORM_BODY, form_fields: VEEC_FORM_FIELDS },
}, false);
const show = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><InstallerFinalDeclaration jobId={JOB} /></QueryClientProvider>);

describe("crew lead installer signs Part B with the price-free payload", () => {
  test("ready: declaration and Sign button show, no $ anywhere; signing calls the server once as the installer", async () => {
    payload = crewPayload([], { id: "a1", status: "awaiting_installer_signature", installer_signed_at: null, installed_product: "Bradford Gold R5", installed_area_m2: 120 });
    const v = show();
    const btn = await waitFor(() => v.getByText("Sign as lead installer"));
    expect(v.container.textContent).toContain("Part B: Declaration by lead installer");
    expect(v.container.textContent).toContain("Installed: Bradford Gold R5 · 120 m²");
    expect(v.container.textContent).not.toContain("$");
    fireEvent.click(v.getByRole("checkbox"));
    fireEvent.change(v.getByPlaceholderText("Type your full name to sign"), { target: { value: "TEST Crew" } });
    fireEvent.click(btn);
    await waitFor(() => expect(signCalls.length).toBe(1));
    expect(signCalls[0]).toEqual({ jobId: JOB, party: "installer", signatureName: "TEST Crew" });
  });

  test("not ready (price fields still empty): 'Price details' in the list, no $ shown, no Sign button", async () => {
    payload = crewPayload(priceLabels.map((l) => `Missing: ${l}`), null);
    const v = show();
    await waitFor(() => v.getByText("Home Insulation Victoria is finishing the form details first:"));
    expect(v.getByText("Price details")).toBeTruthy();
    expect(v.container.textContent).not.toContain("$");
    expect(v.queryByText("Sign as lead installer")).toBeNull();
  });

  test("already signed: the signed line shows", async () => {
    payload = crewPayload([], { id: "a1", status: "awaiting_ap_signature", installer_signed_at: "2026-10-28T01:00:00Z", installed_product: "Bradford Gold R5", installed_area_m2: 120 });
    const v = show();
    await waitFor(() => v.getByText(/Your part of the rebate form is signed/));
  });
});
