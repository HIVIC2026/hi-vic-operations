// Photo-quote installers Task 2: on Choose installer, a lead a "From photos" installer can't take shows as a greyed-out
// tick box with the reason under the address, and can't be ticked or given.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();
import { afterEach, expect, mock, test } from "bun:test";
const calls: unknown[] = [];
const get = Object.assign(() => {}, { id: "load" });
const send = Object.assign(() => {}, { id: "send" });
mock.module("@/lib/in-house-batch.functions", () => ({ getInHouseBatches: get, allocateInHouseBatch: send }));
mock.module("@tanstack/react-start", () => ({ useServerFn: () => async (input: unknown) => { calls.push(input); return { sent: ["1"], refused: [] }; } }));
const REASON = "Firm quote jobs go to installers who quote from photos.";
mock.module("@tanstack/react-query", () => ({ useQuery: () => ({ data: {
  partners: [{ id: "ng", name: "No Gap Insulation", quote_method: "photos" }, { id: "rc", name: "Ready Check Installer", quote_method: "ready_check" }],
  jobs: [{ id: "1", job_number: "HV-1", address: "1 Main St", firmQuote: true, firmQuoteDueBy: "2026-11-17" }, { id: "2", job_number: "HV-2", address: "2 Main St" }],
  suggestions: [{ businessId: "ng", jobIds: ["1", "2"] }], blocked: { rc: [{ jobId: "1", reason: REASON }] },
} }), useQueryClient: () => ({ invalidateQueries: async () => {} }) }));
const React = await import("react");
const { render, fireEvent, act, cleanup } = await import("@testing-library/react");
const { InHouseHandoff } = await import("../src/components/portal/in-house-handoff");
afterEach(() => { cleanup(); calls.length = 0; });

test("blocked lead: disabled tick box, reason under the address, never sent", () => {
  const r = render(React.createElement(InHouseHandoff));
  const boxes = r.getAllByRole("checkbox", { name: "HV-1 · 1 Main St" }) as HTMLInputElement[];
  const box = boxes.find(b => b.disabled);
  if (!box) throw new Error("Missing blocked Ready Check option");
  expect(box.disabled).toBe(true);
  expect(r.getByText(REASON)).toBeTruthy();
  fireEvent.click(box);
  expect(box.checked).toBe(false);
  expect((r.getByRole("checkbox", { name: "HV-2 · 2 Main St" }) as HTMLInputElement).disabled).toBe(false);
  expect((r.getByRole("button", { name: "Give 0 jobs to No Gap Insulation" }) as HTMLButtonElement).disabled).toBe(true);
  expect(calls).toEqual([]);
  expect(boxes.some(b => !b.disabled)).toBe(true);
  expect(r.getByText("Asked for firm quote · due Tuesday 17 November")).toBeTruthy();
});
test("office confirms photos Give and sees the saved result in place", async () => {
  const r = render(React.createElement(InHouseHandoff));
  const box = (r.getAllByRole("checkbox", { name: "HV-1 · 1 Main St" }) as HTMLInputElement[]).find(b => !b.disabled);
  if (!box) throw new Error("Missing photos option");
  fireEvent.click(box);
  await act(async () => fireEvent.click(r.getByRole("button", { name: "Give 1 job to No Gap Insulation" })));
  expect(calls).toEqual([{ data: { businessId: "ng", jobIds: ["1"] } }]);
  expect(r.getByRole("status").textContent).toBe("1 job given to No Gap Insulation.");
});
