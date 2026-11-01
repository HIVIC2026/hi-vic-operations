import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();
import { afterEach, expect, mock, test } from "bun:test";
const calls: unknown[] = [];
let count = 5;
const get = Object.assign(() => {}, { id: "load" });
const send = Object.assign(() => {}, { id: "send" });
mock.module("@/lib/in-house-batch.functions", () => ({ getInHouseBatches: get, allocateInHouseBatch: send }));
mock.module("@tanstack/react-start", () => ({ useServerFn: (fn: { id: string }) => async (input: unknown) => { if (fn.id === "send") { calls.push(input); return { sent: (input as { data: { jobIds: string[] } }).data.jobIds, refused: [] }; } return null; } }));
const jobsFor = () => Array.from({ length: count }, (_, i) => ({ id: String(i + 1), job_number: `HV-${i + 1}`, address: `${i + 1} Main St` }));
mock.module("@tanstack/react-query", () => ({ useQuery: () => ({ data: { partners: [{ id: "p", name: "Rapid" }, { id: "q", name: "INSolation" }], jobs: jobsFor(), suggestions: [{ businessId: "p", jobIds: jobsFor().map(j => j.id) }] } }), useQueryClient: () => ({ invalidateQueries: async () => {} }) }));
const React = await import("react");
const { render, fireEvent, act, cleanup } = await import("@testing-library/react");
const { InHouseHandoff } = await import("../src/components/portal/in-house-handoff");
afterEach(() => { cleanup(); calls.length = 0; count = 5; });
const tick = (r: ReturnType<typeof render>, n: number) => fireEvent.click(r.getByRole("checkbox", { name: `HV-${n} · ${n} Main St` }));

test("no ticks: button greyed out and says why", () => {
  const r = render(React.createElement(InHouseHandoff));
  expect(r.getByText("INSolation")).toBeTruthy();
  const button = r.getByRole("button", { name: "Give 0 jobs to Rapid" }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  expect(r.getAllByText("Tick at least one job to give.").length).toBeGreaterThan(0);
  fireEvent.click(button);
  expect(calls).toEqual([]);
});
test("ticking 1 job sends exactly that job", async () => {
  const r = render(React.createElement(InHouseHandoff));
  tick(r, 3);
  await act(async () => { fireEvent.click(r.getByRole("button", { name: "Give 1 job to Rapid" })); });
  expect(calls).toEqual([{ data: { businessId: "p", jobIds: ["3"] } }]);
});
test("ticking 3 of 7 sends those 3 in list order", async () => {
  count = 7;
  const r = render(React.createElement(InHouseHandoff));
  tick(r, 7); tick(r, 1); tick(r, 4);
  await act(async () => { fireEvent.click(r.getByRole("button", { name: "Give 3 jobs to Rapid" })); });
  expect(calls).toEqual([{ data: { businessId: "p", jobIds: ["1", "4", "7"] } }]);
});
test("untick all greys it out again", () => {
  const r = render(React.createElement(InHouseHandoff));
  tick(r, 2); tick(r, 2);
  const button = r.getByRole("button", { name: "Give 0 jobs to Rapid" }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.click(button);
  expect(calls).toEqual([]);
});
test("partner with 0 waiting has no tick boxes and a greyed button", () => {
  count = 0;
  const r = render(React.createElement(InHouseHandoff));
  expect(r.queryAllByRole("checkbox")).toHaveLength(0);
  expect((r.getByRole("button", { name: "Give 0 jobs to Rapid" }) as HTMLButtonElement).disabled).toBe(true);
});
test("ticks clear after giving", async () => {
  const r = render(React.createElement(InHouseHandoff));
  tick(r, 1); tick(r, 2);
  await act(async () => { fireEvent.click(r.getByRole("button", { name: "Give 2 jobs to Rapid" })); });
  expect((r.queryAllByRole("checkbox") as HTMLInputElement[]).some(c => c.checked)).toBe(false);
});
