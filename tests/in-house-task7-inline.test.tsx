// Task 7 (in-house booking) inline install booking, now lived in the Next step box (Task 11 retired InHouseBookingCard.tsx):
// the install cannot be booked without a Lead Installer, nor before the deposit is confirmed paid, and a good booking goes
// through the canonical `inHouseBookVisit` with the chosen person and the Melbourne arrival time. Run on its own (mock.module).
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();
import { afterEach, expect, mock, test } from "bun:test";
import type { ReactNode } from "react";
import type { NextStepFacts } from "../src/lib/next-step-box.core";

const calls: { fn: string; data: unknown }[] = [];
const fake = (name: string, answer: unknown = { ok: true, bookingId: "b1" }) => Object.assign(async (input: { data: unknown }) => { calls.push({ fn: name, data: input.data }); return answer; }, { id: name });
mock.module("@/lib/trade-view.functions", () => ({ inHouseBookVisit: fake("inHouseBookVisit"), changeInHouseLeadInstaller: fake("changeInHouseLeadInstaller"), setA1ReadyCheckTimeFn: fake("setA1ReadyCheckTimeFn"), getInHouseBookingAccess: fake("getInHouseBookingAccess"), getInHouseBookingTeam: fake("getInHouseBookingTeam"), tradeHandBack: fake("tradeHandBack"), tradeOwnerCancelled: fake("tradeOwnerCancelled") }));
mock.module("@/lib/visit-allocation.functions", () => ({ getTeamElectricians: fake("getTeamElectricians"), allocateElectricianFn: fake("allocateElectricianFn") }));
mock.module("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
mock.module("sonner", () => ({ toast: { success: () => {} } }));
mock.module("@/lib/office-list-refresh", () => ({ markOfficeChanged: () => {} }));
mock.module("@/components/portal/MittiFormLink", () => ({ MittiFormLink: ({ children }: { children: ReactNode }) => <a href="#mitti">{children}</a> }));
let depositPaid = true;
mock.module("@tanstack/react-query", () => ({
  useQuery: (o: { queryKey: unknown[] }) => {
    const k = o.queryKey[0];
    const team = { depositPaid, selection: null, workers: [{ id: "new", name: "New Installer", phone: null, tradeRole: "installer", workerRole: "lead", cleared: true, reason: null, escRegistered: true, escRegisteredAt: "2026-11-01" }] };
    return { data: k === "in-house-booking-access" ? { allowed: true, blockers: [], bookings: [] } : k === "in-house-booking-team" ? team : k === "team-electricians" ? { workers: [] } : undefined, isError: false, isPending: false };
  },
  useQueryClient: () => ({ invalidateQueries: async () => {} }),
}));

const React = await import("react");
const { render, fireEvent, act, cleanup } = await import("@testing-library/react");
const { NextStepBox } = await import("../src/components/trade/NextStepBox");
const { nextStepBox } = await import("../src/lib/next-step-box.core");

afterEach(() => { cleanup(); calls.length = 0; depositPaid = true; });

const facts: NextStepFacts = {
  channel: "hivic_sourced", stage: "installation_scheduling", ownerFirst: "Sarah", ownerName: "Sarah Brown", ownerPhone: "0400 000 000",
  now: new Date("2026-11-01T22:00:00Z"), givenAt: "2026-10-20T00:00:00Z", readyCheck: { start: null, done: true, missing: [] }, priceEntered: null,
  quote: "accepted", acceptedAt: "2026-10-25T00:00:00Z", whoBooks: "office", electricianName: null,
  piesa: { start: null, outcome: "pass", upgradesDone: false, certificateIn: false }, access: null, depositPaidAt: "2026-10-30T00:00:00Z",
  install: { start: null, lead: null, swmsSigned: 0, swmsTotal: 0 }, installDone: false, pay: null, mittiFormUrl: null,
};
const draw = () => render(<NextStepBox jobId="j" box={nextStepBox(facts)} ownerFirst="Sarah" installBy="2026-11-30" />);

test("inline install booking refuses a missing Lead Installer, then submits the chosen person and the Melbourne arrival through the canonical booking action", async () => {
  const ui = draw();
  const button = ui.getByRole("button", { name: "Book the install" }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.submit(button.closest("form") as HTMLFormElement);
  expect(calls).toHaveLength(0);
  fireEvent.change(ui.getByLabelText("Day"), { target: { value: "2026-11-03" } });
  fireEvent.change(ui.getByLabelText("Arrival"), { target: { value: "09:00" } });
  expect(button.disabled).toBe(true); // Lead Installer still required
  expect(ui.container.querySelector(`#${button.getAttribute("aria-describedby")}`)?.textContent).toContain("Lead Installer");
  fireEvent.change(ui.getByLabelText("Lead Installer"), { target: { value: "new" } });
  expect(button.disabled).toBe(false);
  await act(async () => { fireEvent.click(button); });
  expect(calls).toEqual([{ fn: "inHouseBookVisit", data: { jobId: "j", kind: "installation", start: "2026-11-02T22:00:00.000Z", workerId: "new", crewIds: [] } }]);
});

test("inline install booking cannot book before the deposit is confirmed paid (the button is greyed with the deposit reason)", () => {
  depositPaid = false;
  const ui = draw();
  const button = ui.getByRole("button", { name: "Book the install" }) as HTMLButtonElement;
  fireEvent.change(ui.getByLabelText("Day"), { target: { value: "2026-11-03" } });
  fireEvent.change(ui.getByLabelText("Arrival"), { target: { value: "09:00" } });
  fireEvent.change(ui.getByLabelText("Lead Installer"), { target: { value: "new" } });
  expect(button.disabled).toBe(true);
  expect(ui.container.querySelector(`#${button.getAttribute("aria-describedby")}`)?.textContent).toContain("Deposit: waiting for Sarah.");
  fireEvent.submit(button.closest("form") as HTMLFormElement);
  expect(calls).toHaveLength(0);
});
