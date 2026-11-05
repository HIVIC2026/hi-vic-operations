// Photo-quote installers Task 2: on Choose installer, a lead a "From photos" installer can't take shows as a greyed-out
// tick box with the reason under the address, and can't be ticked or given.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();
import { expect, mock, test } from "bun:test";
const calls: unknown[] = [];
const get = Object.assign(() => {}, { id: "load" });
const send = Object.assign(() => {}, { id: "send" });
mock.module("@/lib/in-house-batch.functions", () => ({ getInHouseBatches: get, allocateInHouseBatch: send }));
mock.module("@tanstack/react-start", () => ({ useServerFn: () => async (input: unknown) => { calls.push(input); return { sent: [], refused: [] }; } }));
const REASON = "No Gap Insulation quotes from photos. This owner hasn't sent any.";
mock.module("@tanstack/react-query", () => ({ useQuery: () => ({ data: {
  partners: [{ id: "ng", name: "No Gap Insulation", quote_method: "photos" }],
  jobs: [{ id: "1", job_number: "HV-1", address: "1 Main St" }, { id: "2", job_number: "HV-2", address: "2 Main St" }],
  suggestions: [{ businessId: "ng", jobIds: ["2"] }], blocked: { ng: [{ jobId: "1", reason: REASON }] },
} }), useQueryClient: () => ({ invalidateQueries: async () => {} }) }));
const React = await import("react");
const { render, fireEvent } = await import("@testing-library/react");
const { InHouseHandoff } = await import("../src/components/portal/in-house-handoff");

test("blocked lead: disabled tick box, reason under the address, never sent", () => {
  const r = render(React.createElement(InHouseHandoff));
  const box = r.getByRole("checkbox", { name: "HV-1 · 1 Main St" }) as HTMLInputElement;
  expect(box.disabled).toBe(true);
  expect(r.getByText(REASON)).toBeTruthy();
  fireEvent.click(box);
  expect(box.checked).toBe(false);
  expect((r.getByRole("checkbox", { name: "HV-2 · 2 Main St" }) as HTMLInputElement).disabled).toBe(false);
  expect((r.getByRole("button", { name: "Give 0 jobs to No Gap Insulation" }) as HTMLButtonElement).disabled).toBe(true);
  expect(calls).toEqual([]);
});
