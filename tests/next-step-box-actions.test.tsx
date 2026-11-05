// Task 6 (installer screens): the Next step box actions — book, change time, change Lead Installer, change electrician.
// Renders the box with every server function faked and clicks it; the hand-back / owner-cancelled handlers are read as source.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();
import { afterEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { ReactNode } from "react";
import type { NextStepFacts } from "../src/lib/next-step-box.core";

type Call = { fn: string; data: unknown };
const calls: Call[] = [];
let refuse: string | null = null;
const fake = (name: string, answer: unknown = { ok: true, bookingId: "b1" }) =>
  Object.assign(async (input: { data: unknown }) => {
    calls.push({ fn: name, data: input.data });
    if (refuse) throw new Error(refuse);
    return answer;
  }, { id: name });
const fns = {
  inHouseBookVisit: fake("inHouseBookVisit"),
  changeInHouseLeadInstaller: fake("changeInHouseLeadInstaller", { ok: true }),
  setA1ReadyCheckTimeFn: fake("setA1ReadyCheckTimeFn", { ok: true }),
  getInHouseBookingAccess: fake("getInHouseBookingAccess"),
  getInHouseBookingTeam: fake("getInHouseBookingTeam"),
  tradeHandBack: fake("tradeHandBack"),
  tradeOwnerCancelled: fake("tradeOwnerCancelled"),
};
const vfns = { getTeamElectricians: fake("getTeamElectricians"), allocateElectricianFn: fake("allocateElectricianFn", { name: "Will Casdorff" }), changeJobElectricianFn: fake("changeJobElectricianFn", { ok: true, warnings: [] }) };
mock.module("@/lib/trade-view.functions", () => fns);
mock.module("@/lib/visit-allocation.functions", () => vfns);
mock.module("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
mock.module("sonner", () => ({ toast: { success: () => {} } }));
mock.module("@/lib/office-list-refresh", () => ({ markOfficeChanged: () => {} }));
mock.module("@/components/portal/MittiFormLink", () => ({ MittiFormLink: ({ children, className }: { children: ReactNode; className?: string }) => <a href="#mitti" className={className}>{children}</a> }));

let access: unknown = { allowed: true, blockers: [], bookings: [] };
let accessPending = false;
let team: unknown = {
  depositPaid: true, selection: null,
  workers: [
    { id: "lead1", name: "Dave Lead", phone: null, tradeRole: "installer", workerRole: "lead", cleared: true, reason: null, escRegistered: true, escRegisteredAt: "2026-11-01" },
    { id: "crew1", name: "Sam Crew", phone: null, tradeRole: "installer", workerRole: "crew", cleared: true, reason: null, crewAllowed:true },
    { id: "crew2", name: "Jo Crew", phone: null, tradeRole: "installer", workerRole: "crew", cleared: true, reason: null, crewAllowed:true },
    { id: "elec1", name: "Will Casdorff", phone: null, tradeRole: "electrician", cleared: true, reason: null, electricianVerified: true },
  ],
};
let electricians: unknown = { workers: [{ id: "elec1", name: "Will Casdorff", allowed: true, reason: null, selected: false }, { id: "elec2", name: "Not Yet", allowed: false, reason: "Waiting for office approval", selected: false }] };
mock.module("@tanstack/react-query", () => ({
  useQuery: (o: { queryKey: unknown[] }) => {
    const k = o.queryKey[0];
    if (k === "in-house-booking-access" && accessPending) return { data: undefined, isError: false, isPending: true };
    return { data: k === "in-house-booking-access" ? access : k === "in-house-booking-team" ? team : k === "team-electricians" ? electricians : undefined, isError: false, isPending: false };
  },
  useQueryClient: () => ({ invalidateQueries: async () => {} }),
}));

const React = await import("react");
const { render, fireEvent, act, cleanup, within } = await import("@testing-library/react");
const { NextStepBox } = await import("../src/components/trade/NextStepBox");
const { nextStepBox } = await import("../src/lib/next-step-box.core");
type Box = ReturnType<typeof nextStepBox>;

afterEach(() => { cleanup(); calls.length = 0; refuse = null; access = { allowed: true, blockers: [], bookings: [] }; accessPending = false; });

const base: NextStepFacts = {
  channel: "hivic_sourced", stage: "ready_check_ready_to_schedule", ownerFirst: "Sarah", ownerName: "Sarah Brown", ownerPhone: "0400 000 000",
  now: new Date("2026-11-09T22:00:00Z"), givenAt: "2026-10-26T00:00:00Z", readyCheck: { start: null, done: false, missing: [] }, priceEntered: null,
  quote: "none", acceptedAt: null, whoBooks: "office", electricianName: null,
  piesa: { start: null, outcome: null, upgradesDone: false, certificateIn: false }, access: null, depositPaidAt: null,
  install: { start: null, lead: null, swmsSigned: 0, swmsTotal: 0 }, installDone: false, pay: null, mittiFormUrl: null,
};
const boxFor = (f: Partial<NextStepFacts>): Box => nextStepBox({ ...base, ...f });
const draw = (box: Box, extra: Partial<React.ComponentProps<typeof NextStepBox>> = {}) =>
  render(<NextStepBox jobId="j1" box={box} ownerFirst="Sarah" installBy="2026-12-04" {...extra} />);
const fill = (r: ReturnType<typeof render>, day = "2026-11-10", arrival = "09:00") => {
  fireEvent.change(r.getByLabelText("Day"), { target: { value: day } });
  fireEvent.change(r.getByLabelText("Arrival"), { target: { value: arrival } });
};
const click = async (r: ReturnType<typeof render>, name: string) => { await act(async () => { fireEvent.click(r.getByRole("button", { name })); }); };
/** Every greyed-out button must point (aria-describedby) at a visible reason. */
const disabledHaveReasons = (r: ReturnType<typeof render>) => {
  const disabled = Array.from(r.container.querySelectorAll("button[disabled]"));
  for (const b of disabled) {
    const id = b.getAttribute("aria-describedby");
    expect(id, `disabled "${b.textContent}" needs aria-describedby`).toBeTruthy();
    const reason = r.container.querySelector(`#${id}`);
    expect(reason?.textContent?.trim().length ?? 0, `reason for "${b.textContent}" must be visible text`).toBeGreaterThan(0);
  }
  return disabled.length;
};

describe("Next step box actions", () => {
  test("book_ready_check: Day + Arrival + Who's going, Book → inHouseBookVisit kind ready_check", async () => {
    const r = draw(boxFor({}));
    expect(r.getByText("NEXT STEP")).toBeTruthy();
    expect(r.getByText("Book the Ready Check")).toBeTruthy();
    expect(r.container.querySelectorAll("select").length).toBe(1);
    const book = r.getByRole("button", { name: "Book" }) as HTMLButtonElement;
    expect(book.disabled).toBe(true);
    expect(disabledHaveReasons(r)).toBe(1);
    fill(r);
    fireEvent.change(r.getByLabelText("Who's going"), { target: { value: "lead1" } });
    expect(book.disabled).toBe(false);
    await click(r, "Book");
    expect(calls).toEqual([{ fn: "inHouseBookVisit", data: { jobId: "j1", kind: "ready_check", start: "2026-11-09T22:00:00.000Z", workerId: "lead1", crewIds: [] } }]);
  });

  test("book_ready_check on the installer's own customer (not in-house) books through setA1ReadyCheckTimeFn", async () => {
    access = { allowed: false, blockers: ["forbidden"] };
    const r = draw(boxFor({ channel: "installer_sourced" }), { ownCustomer: true });
    fireEvent.change(r.getByLabelText("Day"), { target: { value: "2026-11-10" } });
    fireEvent.change(r.getByLabelText("Arrival"), { target: { value: "09:00" } });
    await click(r, "Book");
    expect(calls).toEqual([{ fn: "setA1ReadyCheckTimeFn", data: { jobId: "j1", day: "2026-11-10", time: "09:00" } }]);
  });

  test("book_piesa: ONE form — electrician (from getTeamElectricians), Day, Arrival; Book a NEW electrician → changeJobElectricianFn (person + time saved together)", async () => {
    const r = draw(boxFor({ readyCheck: { start: null, done: true, missing: [] }, quote: "accepted", acceptedAt: "2026-10-30T00:00:00Z" }));
    expect(r.getByText("Book the PIESA")).toBeTruthy();
    expect(r.container.querySelectorAll("form").length).toBe(1);
    const elec = r.getByLabelText("Electrician") as HTMLSelectElement;
    expect(Array.from(elec.options).map((o) => o.textContent)).toContain("Will Casdorff");
    expect(Array.from(elec.options).find((o) => o.value === "elec2")?.disabled).toBe(true);
    fireEvent.change(elec, { target: { value: "elec1" } });
    fill(r, "2026-11-12", "08:00");
    await click(r, "Book");
    expect(calls).toEqual([{ fn: "changeJobElectricianFn", data: { jobId: "j1", workerId: "elec1", start: "2026-11-11T21:00:00.000Z" } }]);
  });

  test("book_piesa with the Main electrician as the default pick", async () => {
    const was = electricians;
    electricians = { workers: [{ id: "elec1", name: "Will Casdorff", allowed: true, reason: null, selected: false, main: false }, { id: "elec3", name: "Main Person", allowed: true, reason: null, selected: false, main: true }] };
    try {
      const r = draw(boxFor({ readyCheck: { start: null, done: true, missing: [] }, quote: "accepted", acceptedAt: "2026-10-30T00:00:00Z" }));
      expect((r.getByLabelText("Electrician") as HTMLSelectElement).value).toBe("elec3");
    } finally { electricians = was; cleanup(); calls.length = 0; }
  });

  test("book_piesa with the electrician already on the job: just the time (inHouseBookVisit), no electrician change, no Mitti", async () => {
    const was = electricians;
    electricians = { workers: [{ id: "elec1", name: "Will Casdorff", allowed: true, reason: null, selected: true }] };
    try {
      const r = draw(boxFor({ readyCheck: { start: null, done: true, missing: [] }, quote: "accepted", acceptedAt: "2026-10-30T00:00:00Z" }));
      fill(r, "2026-11-12", "08:00");
      await click(r, "Book");
      expect(calls).toEqual([{ fn: "inHouseBookVisit", data: { jobId: "j1", kind: "assessment", start: "2026-11-11T21:00:00.000Z", workerId: "elec1", crewIds: [] } }]);
    } finally { electricians = was; cleanup(); calls.length = 0; }
  });

  test("book_install: Day, Arrival, Lead Installer (Leads only), Crew ticks, Book the install + the booked line", async () => {
    const r = draw(boxFor({ readyCheck: { start: null, done: true, missing: [] }, quote: "accepted", piesa: { start: null, outcome: "pass", upgradesDone: false, certificateIn: false }, depositPaidAt: "2026-11-05T00:00:00Z" }));
    const lead = r.getByLabelText("Lead Installer") as HTMLSelectElement;
    expect(Array.from(lead.options).filter((o) => o.value).map((o) => o.value)).toEqual(["lead1"]);
    expect(r.getByLabelText("Sam Crew")).toBeTruthy();
    expect(r.getByLabelText("Jo Crew")).toBeTruthy();
    expect(r.getByText('Sarah gets a "You\'re booked" email and text straight away. Install by Fri 4 Dec.')).toBeTruthy();
    fill(r, "2026-11-13", "07:30");
    fireEvent.change(lead, { target: { value: "lead1" } });
    fireEvent.click(r.getByLabelText("Sam Crew"));
    await click(r, "Book the install");
    expect(calls).toEqual([{ fn: "inHouseBookVisit", data: { jobId: "j1", kind: "installation", start: "2026-11-12T20:30:00.000Z", workerId: "lead1", crewIds: ["crew1"] } }]);
  });

  test("book_install stays blocked (with a visible reason) while the deposit is not confirmed paid", () => {
    team = { ...(team as object), depositPaid: false };
    try {
      const r = draw(boxFor({ readyCheck: { start: null, done: true, missing: [] }, quote: "accepted", piesa: { start: null, outcome: "pass", upgradesDone: false, certificateIn: false }, depositPaidAt: "2026-11-05T00:00:00Z" }));
      fill(r, "2026-11-13", "07:30");
      fireEvent.change(r.getByLabelText("Lead Installer"), { target: { value: "lead1" } });
      const b = r.getByRole("button", { name: "Book the install" }) as HTMLButtonElement;
      expect(b.disabled).toBe(true);
      expect(disabledHaveReasons(r)).toBe(1);
    } finally { team = { ...(team as object), depositPaid: true }; }
  });

  test("booked visits show Change time; install shows Change Lead Installer only before the lock; PIESA shows Change electrician while no outcome", async () => {
    const rc = draw(boxFor({ readyCheck: { start: "2026-11-11T22:00:00Z", done: false, missing: [] } }));
    expect(rc.getByRole("button", { name: "Change time" })).toBeTruthy();
    expect(rc.queryByRole("button", { name: "Change Lead Installer" })).toBeNull();
    expect(rc.queryByRole("button", { name: "Change electrician" })).toBeNull();
    cleanup();
    const piesa = draw(boxFor({ readyCheck: { start: null, done: true, missing: [] }, quote: "accepted", piesa: { start: "2026-11-11T22:00:00Z", outcome: null, upgradesDone: false, certificateIn: false } }));
    expect(piesa.getByRole("button", { name: "Change time" })).toBeTruthy();
    expect(piesa.getByRole("button", { name: "Change electrician" })).toBeTruthy();
    cleanup();
    calls.length = 0;
  });

  test("Change electrician on a booked PIESA saves the new person and the existing time together (changeJobElectricianFn)", async () => {
    access = { allowed: true, blockers: [], bookings: [{ id: "bk-a", kind: "assessment", scheduled_start: "2026-11-11T22:00:00Z", status: "confirmed" }] };
    const piesa = draw(boxFor({ readyCheck: { start: null, done: true, missing: [] }, quote: "accepted", piesa: { start: "2026-11-11T22:00:00Z", outcome: null, upgradesDone: false, certificateIn: false } }));
    await click(piesa, "Change electrician");
    fireEvent.change(piesa.getByLabelText("Electrician"), { target: { value: "elec1" } });
    await click(piesa, "Save the electrician");
    expect(calls).toEqual([{ fn: "changeJobElectricianFn", data: { jobId: "j1", workerId: "elec1", start: "2026-11-11T22:00:00Z" } }]);
  });

  test("Change electrician while the electricians are loading shows its own loading line, not the deposit line", async () => {
    const was = electricians;
    electricians = undefined;
    try {
      const piesa = draw(boxFor({ readyCheck: { start: null, done: true, missing: [] }, quote: "accepted", piesa: { start: "2026-11-11T22:00:00Z", outcome: null, upgradesDone: false, certificateIn: false } }));
      await click(piesa, "Change electrician");
      const b = piesa.getByRole("button", { name: "Save the electrician" }) as HTMLButtonElement;
      expect(b.disabled).toBe(true);
      disabledHaveReasons(piesa);
      expect(piesa.getByText("Loading your electricians…")).toBeTruthy();
      expect(piesa.queryByText(/Deposit:/)).toBeNull();
    } finally { electricians = was; }
  });

  test("install_booked / install_locked change links", async () => {
    calls.length = 0;
    cleanup();
    const inst = { readyCheck: { start: null, done: true, missing: [] }, quote: "accepted" as const, piesa: { start: null, outcome: "pass" as const, upgradesDone: false, certificateIn: false }, depositPaidAt: "2026-11-05T00:00:00Z", install: { start: "2026-11-12T20:30:00Z", lead: "Dave Lead", swmsSigned: 1, swmsTotal: 3 } };
    const booked = draw(boxFor({ ...inst, now: new Date("2026-11-08T22:00:00Z") }));
    expect(booked.getByRole("button", { name: "Change time" })).toBeTruthy();
    await click(booked, "Change Lead Installer");
    fireEvent.change(booked.getByLabelText("Lead Installer"), { target: { value: "lead1" } });
    await click(booked, "Save the Lead Installer");
    expect(calls).toEqual([{ fn: "changeInHouseLeadInstaller", data: { jobId: "j1", workerId: "lead1" } }]);
    cleanup();
    // Wed 11 Nov 5:00pm Melbourne = locked (Part 9 rule in the core): no change links at all.
    const locked = boxFor({ ...inst, now: new Date("2026-11-11T06:00:00Z") });
    expect(locked.kind).toBe("install_locked");
    const lk = draw(locked);
    expect(lk.queryByRole("button", { name: "Change time" })).toBeNull();
    expect(lk.queryByRole("button", { name: "Change Lead Installer" })).toBeNull();
  });

  test("Change time on a booked install re-saves through inHouseBookVisit (same guarded writer)", async () => {
    team = { ...(team as object), selection: { lead: "lead1", additional: [{ workerId: "crew2" }] } };
    try {
      const r = draw(boxFor({ readyCheck: { start: null, done: true, missing: [] }, quote: "accepted", piesa: { start: null, outcome: "pass", upgradesDone: false, certificateIn: false }, depositPaidAt: "2026-11-05T00:00:00Z", install: { start: "2026-11-12T20:30:00Z", lead: "Dave Lead", swmsSigned: 0, swmsTotal: 3 }, now: new Date("2026-11-08T22:00:00Z") }));
      await click(r, "Change time");
      fill(r, "2026-11-16", "07:00");
      await click(r, "Save the new time");
      expect(calls).toEqual([{ fn: "inHouseBookVisit", data: { jobId: "j1", kind: "installation", start: "2026-11-15T20:00:00.000Z", workerId: "lead1", crewIds: ["crew2"] } }]);
    } finally { team = { ...(team as object), selection: null }; }
  });

  test("alsoBookInstall: the warning sits above a second Book the install button; booking goes ahead and the warning stays", async () => {
    const box = boxFor({ readyCheck: { start: null, done: true, missing: [] }, quote: "accepted", piesa: { start: null, outcome: "upgrades", upgradesDone: false, certificateIn: false }, depositPaidAt: "2026-11-05T00:00:00Z" });
    expect(box.kind).toBe("upload_certificate");
    expect(box.alsoBookInstall).not.toBeNull();
    const r = draw(box);
    const warn = r.getByText(box.alsoBookInstall!.warn);
    const button = r.getByRole("button", { name: "Book the install" });
    expect(warn.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fill(r, "2026-11-13", "07:30");
    fireEvent.change(r.getByLabelText("Lead Installer"), { target: { value: "lead1" } });
    await click(r, "Book the install");
    expect(calls.map((c) => c.fn)).toEqual(["inHouseBookVisit"]);
    expect(r.getByText(box.alsoBookInstall!.warn)).toBeTruthy();
    expect(r.queryByRole("alert")).toBeNull();
  });

  test("while the access check is still pending the box shows only the checking line (no own-customer form, no 'not open' line)", () => {
    accessPending = true;
    const r = draw(boxFor({ channel: "installer_sourced" }), { ownCustomer: true });
    expect(r.getByText("Checking your Team and deposit before booking.")).toBeTruthy();
    expect(r.container.querySelector("form")).toBeNull();
    expect(r.queryByText(/isn't open for this job yet/)).toBeNull();
    expect(r.queryByRole("button", { name: "Book" })).toBeNull();
  });

  test("own customer, not in-house, booked Ready Check: no Change time link (nothing here could save it)", () => {
    access = { allowed: false, blockers: ["forbidden"] };
    const r = draw(boxFor({ channel: "installer_sourced", readyCheck: { start: "2026-11-11T22:00:00Z", done: false, missing: [] } }), { ownCustomer: true });
    expect(r.queryByRole("button", { name: "Change time" })).toBeNull();
  });

  test("crew ticks: once two are ticked the rest are disabled (never a silent drop)", () => {
    const r = draw(boxFor({ readyCheck: { start: null, done: true, missing: [] }, quote: "accepted", piesa: { start: null, outcome: "pass", upgradesDone: false, certificateIn: false }, depositPaidAt: "2026-11-05T00:00:00Z" }));
    fireEvent.change(r.getByLabelText("Lead Installer"), { target: { value: "lead1" } });
    const a = r.getByLabelText("Sam Crew") as HTMLInputElement, b = r.getByLabelText("Jo Crew") as HTMLInputElement;
    fireEvent.click(a);
    expect(b.disabled).toBe(false);
    // a third crew member appears → disabled once two are ticked
    const three = { ...(team as { workers: unknown[] }), workers: [...(team as { workers: unknown[] }).workers, { id: "crew3", name: "Lee Crew", phone: null, tradeRole: "installer", workerRole: "crew", cleared: true, reason: null,crewAllowed:true }] };
    const was = team; team = three;
    try {
      cleanup();
      const r2 = draw(boxFor({ readyCheck: { start: null, done: true, missing: [] }, quote: "accepted", piesa: { start: null, outcome: "pass", upgradesDone: false, certificateIn: false }, depositPaidAt: "2026-11-05T00:00:00Z" }));
      fireEvent.change(r2.getByLabelText("Lead Installer"), { target: { value: "lead1" } });
      fireEvent.click(r2.getByLabelText("Sam Crew"));
      fireEvent.click(r2.getByLabelText("Jo Crew"));
      expect((r2.getByLabelText("Lee Crew") as HTMLInputElement).disabled).toBe(true);
      expect((r2.getByLabelText("Sam Crew") as HTMLInputElement).disabled).toBe(false);
      fireEvent.click(r2.getByLabelText("Sam Crew"));
      expect((r2.getByLabelText("Lee Crew") as HTMLInputElement).disabled).toBe(false);
    } finally { team = was; }
  });

  test("a server refusal shows its message inline; a dropped connection shows plain words", async () => {
    const r = draw(boxFor({}));
    fill(r);
    fireEvent.change(r.getByLabelText("Who's going"), { target: { value: "lead1" } });
    refuse = "Failed to fetch";
    await click(r, "Book");
    expect(within(r.getByRole("alert")).getByText(/Couldn't save/)).toBeTruthy();
    refuse = "The deposit hasn't been paid yet.";
    await click(r, "Book");
    expect(r.getByRole("alert").textContent).toContain("The deposit hasn't been paid yet.");
    expect((r.getByRole("button", { name: "Book" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(r.getByLabelText("Arrival"), { target: { value: "10:00" } });
    expect((r.getByRole("button", { name: "Book" }) as HTMLButtonElement).disabled).toBe(false);
  });

  test("no greyed-out button without a reason, across the booking kinds", () => {
    for (const f of [{}, { readyCheck: { start: null, done: true, missing: [] }, quote: "accepted" as const, acceptedAt: "2026-10-30T00:00:00Z" }]) {
      const r = draw(boxFor(f));
      disabledHaveReasons(r);
      cleanup();
    }
  });
});

describe("Can't do this one / Owner cancelled", () => {
  const fns = readFileSync("src/lib/trade-view.functions.ts", "utf8");
  const handler = (name: string) => { const at = fns.indexOf(`export const ${name} `); return fns.slice(at, fns.indexOf("export const", at + 1)); };
  test("the typed-reason confirm stays and calls the two guarded writers", () => {
    // Task 11 moved these out of the retired booking card into ReturnActions.tsx.
    const card = readFileSync("src/components/trade/ReturnActions.tsx", "utf8");
    const ra = card.slice(card.indexOf("export function ReturnActions"));
    expect(ra).toContain("Can't do this one");
    expect(ra).toContain("Owner cancelled");
    expect(ra).toMatch(/reason\.trim\(\)\.length<3/);
    expect(ra).toContain("back({data:{jobId,reason}})");
    expect(ra).toContain("cancel({data:{jobId,reason}})");
    expect(readFileSync("src/routes/_authenticated/field.$jobId.tsx", "utf8")).toContain("<ReturnActions jobId={jobId} />");
  });
  test("both handlers ask for the ESC withdrawal (Part 9) after their cancel; only hand-back emails the owner about a booked visit", () => {
    expect(handler("tradeHandBack")).toContain("handBackJob(");
    const srv = readFileSync("src/lib/trade-view.server.ts", "utf8");
    const back = srv.slice(srv.indexOf("export async function handBackJob"), srv.indexOf("\n}\n", srv.indexOf("export async function handBackJob")));
    const cancelled = handler("tradeOwnerCancelled");
    expect(back).toContain("requireEscWithdrawal(");
    expect(back).toContain('"cant_do_this_one"');
    expect(back).toContain("queueVisitCancelledOwnerEmail(");
    // read booked visits → pull back → cancel what is still booked → ESC withdrawal → owner email (with its outcome logged)
    expect(back.indexOf("stillConfirmedBookings(")).toBeLessThan(back.indexOf("pullBackInHouseJob("));
    expect(back.indexOf("pullBackInHouseJob(")).toBeLessThan(back.indexOf("cancelBookingsAfterHandBack("));
    expect(back.indexOf("cancelBookingsAfterHandBack(")).toBeLessThan(back.indexOf("requireEscWithdrawal("));
    expect(back.indexOf("requireEscWithdrawal(")).toBeLessThan(back.indexOf("queueVisitCancelledOwnerEmail("));
    expect(back).toContain('"trade_handback_owner_email"');
    expect(cancelled).toContain("requireEscWithdrawal(");
    expect(cancelled).toContain('"owner_cancelled"');
    expect(cancelled).not.toContain("queueVisitCancelledOwnerEmail(");
    expect(cancelled.indexOf("cancelJobFully(")).toBeLessThan(cancelled.indexOf("requireEscWithdrawal("));
  });
});

describe("tidy-ups (fix round 1)", () => {
  test("one fmtDay, exported from next-step-dates.core; no copies", () => {
    expect(readFileSync("src/lib/next-step-dates.core.ts", "utf8")).toMatch(/export function fmtDay\(/);
    for (const f of ["src/lib/next-step-box.core.ts", "src/components/trade/NextStepBox.tsx", "src/lib/job-page-rows.core.ts"]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/const DAYS = \[/);
      expect(src, f).toContain("fmtDay");
    }
  });
  test("every box word lives in NEXT_STEP_BOX_WORDS for Task 12's paste", () => {
    const src = readFileSync("src/components/trade/NextStepBox.tsx", "utf8");
    const words = src.slice(src.indexOf("export const NEXT_STEP_BOX_WORDS"), src.indexOf("} as const;"));
    for (const w of ['"Choose the electrician"', '"Choose the Lead Installer"', '"Choose the person going"', '"Time…"', '"Ready Check"', '"PIESA"', '"Install"', '"Loading your electricians…"']) expect(words, w).toContain(w);
    const rest = src.slice(src.indexOf("} as const;"));
    for (const w of ['"Choose the electrician"', '"Choose the Lead Installer"', '"Choose the person going"', '"Time…"']) expect(rest, `${w} used only via W`).not.toContain(w);
  });
});

describe("job page wiring", () => {
  const page = readFileSync("src/routes/_authenticated/field.$jobId.tsx", "utf8");
  test("the installer page renders the box through NextStepBox and the old crew picker is gone", () => {
    expect(page).toContain("<NextStepBox");
    expect(page).not.toContain("<PiisaCrewPicker");
    expect(page).not.toContain("TODO(Task 6)");
  });
});
