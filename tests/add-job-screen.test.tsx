// Task 7 fix round 1: the Add a job screen in the browser (happy-dom). The consent tick never shows the old line; a
// not-allocated electrician is told; the approved labels reach the fields.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { afterEach, describe, expect, mock, test } from "bun:test";

const calls: unknown[] = [];
let saveResult: Record<string, unknown> = { jobId: "j-new", jobNumber: "HV-9", booking: "none", formCreation: "scheduled", state: { kind: "preparing", message: "p" }, electrician: "allocated", ownerFirstName: "Sarah" };
let options: { data?: unknown; isLoading: boolean; isSuccess: boolean; isError: boolean } = { data: { businessName: "Rapid Insulation", electricians: [{ id: "e1", name: "Will Casdorff", allowed: true, reason: null }] }, isLoading: false, isSuccess: true, isError: false };
const navigated: unknown[] = [];
const toasts: string[] = [];
// createServerFn: a chainable stub so modules that define server functions (address lookup) load; never called here.
const chain = (): unknown => new Proxy(() => chain(), { get: () => () => chain() });
mock.module("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn, createServerFn: () => chain(), createMiddleware: () => chain() }));
mock.module("@tanstack/react-start/server", () => ({ getCookie: () => undefined, getRequest: () => undefined, setCookie: () => undefined, setResponseStatus: () => undefined, getRequestHeader: () => undefined }));
// The address lookup's own server function module is not needed on this screen: the test types the address in.
mock.module("@/lib/address-search.functions", () => ({ searchAddresses: async () => [], addressDetails: async () => null }));
mock.module("@/components/trade/TradeShell", () => ({ inputCls: "input", card: "card", greenBtn: "green", ghostBtn: "ghost" }));
mock.module("@tanstack/react-router", () => ({ useNavigate: () => async (to: unknown) => { navigated.push(to); } }));
mock.module("@tanstack/react-query", () => ({ useQuery: () => options }));
mock.module("sonner", () => ({ toast: { success: (m: string) => { toasts.push(m); } } }));
mock.module("@/lib/onsite-ready-check.functions", () => ({
  addJobOptions: Object.assign(async () => options.data, { id: "options" }),
  startOnsiteReadyCheck: Object.assign(async (input: unknown) => { calls.push(input); return saveResult; }, { id: "start" }),
  ownPhotoQuotePreview: Object.assign(async () => null, { id: "preview" }),
}));

const React = await import("react");
const { render, fireEvent, act, cleanup } = await import("@testing-library/react");
const { AddJobFlow } = await import("../src/components/trade/add-job-flow");
const { addJobConsentLine, ADD_JOB_WORDS, ADD_JOB_DRAFT_WORDS } = await import("../src/lib/add-job-flow.core");
const { OWNER_CONTACT_PERMISSION } = await import("../src/lib/job-electrician.core");

afterEach(() => { cleanup(); calls.length = 0; navigated.length = 0; toasts.length = 0; try { localStorage.clear(); } catch { /* ignore */ } });
const draw = () => render(React.createElement(AddJobFlow, { businessId: "b1" }));
/** The lookup (mocked) finds nothing → "Type it in" appears → the address is typed (decision A8). */
const typeAddress = async (r: ReturnType<typeof render>) => {
  const combo = r.getByRole("combobox", { name: ADD_JOB_WORDS.address });
  fireEvent.focus(combo); fireEvent.change(combo, { target: { value: "18 dix" } });
  await act(async () => { await new Promise((d) => setTimeout(d, 400)); });
  fireEvent.click(r.getByText("Can't find the address? Type it in"));
  fireEvent.change(r.getByLabelText(ADD_JOB_WORDS.address), { target: { value: "18 Dixie Street" } });
  fireEvent.change(r.getByLabelText("Suburb"), { target: { value: "Richmond" } });
  fireEvent.change(r.getByLabelText("Postcode"), { target: { value: "3121" } });
};
const fillAll = (r: ReturnType<typeof render>) => {
  fireEvent.click(r.getByLabelText("They contacted us"));
  fireEvent.change(r.getByLabelText(ADD_JOB_WORDS.name), { target: { value: "Sarah Brown" } });
  fireEvent.change(r.getByLabelText(ADD_JOB_WORDS.mobile), { target: { value: "0412 345 678" } });
  fireEvent.change(r.getByLabelText(ADD_JOB_WORDS.email), { target: { value: "sarah@example.com" } });
  fireEvent.change(r.getByLabelText(ADD_JOB_WORDS.electrician), { target: { value: "e1" } });
  fireEvent.click(r.getByLabelText(addJobConsentLine("Rapid Insulation")));
};

describe("Add a job screen", () => {
  test("while the business details load there is no consent tick at all, and never the old line", () => {
    const was = options;
    options = { data: undefined, isLoading: true, isSuccess: false, isError: false };
    try {
      const r = draw();
      expect(r.container.querySelector("[data-permission-row]")).toBeNull();
      expect(r.container.querySelector('input[type="checkbox"]')).toBeNull();
      expect(r.container.textContent).not.toContain(OWNER_CONTACT_PERMISSION);
      expect(r.getByText(ADD_JOB_DRAFT_WORDS.loadingBusiness)).toBeTruthy();
    } finally { options = was; }
  });
  test("once loaded the tick carries the approved line naming the business; the old line is nowhere", () => {
    const r = draw();
    expect(r.getByLabelText(addJobConsentLine("Rapid Insulation"))).toBeTruthy();
    expect(r.container.textContent).not.toContain(OWNER_CONTACT_PERMISSION);
    expect(r.container.textContent).not.toContain("permission to contact");
  });
  test("the approved field labels reach the fields", () => {
    const r = draw();
    for (const l of [ADD_JOB_WORDS.name, ADD_JOB_WORDS.mobile, ADD_JOB_WORDS.email]) expect(r.getByLabelText(l)).toBeTruthy();
    expect(r.getByText(ADD_JOB_WORDS.address)).toBeTruthy();
  });
  test("a job whose electrician could not be put on it is still added, and the installer is told (DRAFT line) before going to the job", async () => {
    const was = saveResult;
    saveResult = { ...saveResult, electrician: "not_allocated" };
    try {
      const r = draw();
      fillAll(r);
      await typeAddress(r);
      await act(async () => { fireEvent.click(r.getByRole("button", { name: ADD_JOB_WORDS.button })); });
      expect(calls).toHaveLength(1);
      expect((calls[0] as { data: { electricianWorkerId: string } }).data.electricianWorkerId).toBe("e1");
      expect(r.getByText(ADD_JOB_DRAFT_WORDS.electricianNotAllocated)).toBeTruthy();
      expect(navigated).toHaveLength(0);
      await act(async () => { fireEvent.click(r.getByRole("button", { name: ADD_JOB_DRAFT_WORDS.goToJob })); });
      expect(navigated).toEqual([{ to: "/field/$jobId", params: { jobId: "j-new" }, search: { added: true } }]);
    } finally { saveResult = was; }
  });
  test("an allocated electrician goes straight to the job page with the Next line", async () => {
    const r = draw();
    fillAll(r);
    await typeAddress(r);
    await act(async () => { fireEvent.click(r.getByRole("button", { name: ADD_JOB_WORDS.button })); });
    expect(navigated).toEqual([{ to: "/field/$jobId", params: { jobId: "j-new" }, search: { added: true } }]);
    expect(toasts).toEqual(["Next: call Sarah and book the Ready Check on the job."]);
  });
});
