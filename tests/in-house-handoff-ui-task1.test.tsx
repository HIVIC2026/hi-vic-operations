import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();
import { afterEach, expect, mock, test } from "bun:test";
const calls: unknown[] = [];
let count = 5;
const get = Object.assign(() => {}, { id: "load" });
const send = Object.assign(() => {}, { id: "send" });
mock.module("@/lib/in-house-batch.functions", () => ({ getInHouseBatches: get, allocateInHouseBatch: send }));
mock.module("@tanstack/react-start", () => ({ useServerFn: (fn: { id: string }) => async (input: unknown) => { if (fn.id === "send") calls.push(input); return { sent: ["1", "2", "3", "4", "5"], refused: [] }; } }));
mock.module("@tanstack/react-query", () => ({ useQuery: () => ({ data: { partners: [{ id: "p", name: "Rapid" }, { id: "q", name: "INSolation" }], jobs: [], suggestions: [{ businessId: "p", jobIds: Array.from({ length: count }, (_, i) => String(i + 1)) }] } }), useQueryClient: () => ({ invalidateQueries: async () => {} }) }));
const React = await import("react");
const { render, fireEvent, act, cleanup } = await import("@testing-library/react");
const { InHouseHandoff } = await import("../src/components/portal/in-house-handoff");
afterEach(() => { cleanup(); calls.length = 0; count = 5; });
test("Choose installer in-house handoff lists partners and calls existing batch action with five", async () => {
  const r = render(React.createElement(InHouseHandoff));
  expect(r.getByText("INSolation")).toBeTruthy();
  await act(async () => { fireEvent.click(r.getByRole("button", { name: "Give 5 jobs to Rapid" })); });
  expect(calls).toEqual([{ data: { businessId: "p", jobIds: ["1", "2", "3", "4", "5"] } }]);
});
test("four waiting cannot call allocation", () => {
  count = 4;
  const r = render(React.createElement(InHouseHandoff));
  fireEvent.click(r.getByRole("button", { name: "Give 5 jobs to Rapid" }));
  expect(calls).toEqual([]);
});