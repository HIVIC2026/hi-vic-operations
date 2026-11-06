// Installer redesign — Action items page (plan Task 6). Renders the page with getTradeHome / getTradeStops faked.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { afterEach, describe, expect, mock, test } from "bun:test";
import type { ReactNode } from "react";
import type { NextStepBox } from "../src/lib/next-step-box.core";

const box = (o: Partial<NextStepBox>): NextStepBox => ({ kind: "book_install", title: "Book the install", sub: null, yours: true, bookBy: null, overdue: false, phone: null, button: "Book the install", lines: [], alsoBookInstall: null, pickPerson: null, ...o });
let n = 0;
const row = (suburb: string, o: Partial<NextStepBox> = {}, extra: Record<string, unknown> = {}) => ({ jobId: `00000000-0000-4000-8000-00000000000${n++}`, jobNumber: `HV-10${n}`, owner: "Sam Lee", street: `1 High St, ${suburb}`, suburb, channel: "hivic_sourced", box: box(o), reason: "", stop: null, waitingOn: "Home Insulation Victoria", ownerFirst: "Sam", installAt: null, ...extra });

let home: unknown;
let stops: Record<string, string> = {};
let fail = false;
const makeHome = (rows: unknown[]) => ({ kind: "installer", boss: true, money: true, business: "Reinsulate", isTest: false, actionHome: { greeting: "Good morning, Deep", rows }, weekBookings: [] });

mock.module("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({ ...opts, useRouteContext: () => ({ user: { id: "u1" } }) }),
  Link: ({ to, children, className, params }: { to: string; children: ReactNode; className?: string; params?: { jobId?: string } }) => <a href={params?.jobId ? to.replace("$jobId", params.jobId) : to} className={className}>{children}</a>,
}));
mock.module("@/components/trade/TradeShell", () => ({ TradeShell: ({ children }: { children: ReactNode }) => <div>{children}</div>, card: "card", inputCls: "input" }));
mock.module("@/lib/trade-cache", () => ({ readTradeCache: () => null, writeTradeCache: () => {} }));
mock.module("@/lib/trade-route-prefetch", () => ({ headStartOr: (_u: string, _k: unknown, f: () => unknown) => f(), startTradeScreen: () => undefined }));
mock.module("@tanstack/react-start", () => ({ useServerFn: (f: unknown) => f }));
mock.module("@/lib/trade-view.functions", () => ({ getTradeHome: async () => home, getTradeStops: async () => stops }));
mock.module("@tanstack/react-query", () => ({
  useQuery: (o: { queryKey: unknown[]; enabled?: boolean }) => {
    if (o.queryKey[0] === "trade-stops") return { data: o.enabled === false ? undefined : stops };
    return fail ? { data: undefined, error: new Error("x"), refetch: () => {} } : { data: home, error: null, refetch: () => {} };
  },
}));

const { render, cleanup, fireEvent } = await import("@testing-library/react");
const { Route } = await import("../src/routes/_authenticated/field.index");
const Page = (Route as unknown as { component: () => JSX.Element }).component;
afterEach(() => { cleanup(); stops = {}; fail = false; });

const waitingKind = { kind: "piesa_booked" as const, title: "PIESA booked", yours: false, button: null };
const full = () => {
  const fixRow = row("Melton", {}, { installAt: "2026-11-10T21:00:00Z" });
  stops = { [fixRow.jobId]: "Book an electrician for install day" };
  home = makeHome([fixRow, row("Sunbury"), row("Bacchus Marsh"), row("Melton West", waitingKind), row("Kew", waitingKind), row("Brunswick", waitingKind)]);
};

describe("Action items page", () => {
  test("three groups in order", () => {
    full();
    const { container } = render(<Page />);
    expect([...container.querySelectorAll("h2")].map((h) => h.textContent)).toEqual(["Fix before work starts", "Your turn", "Waiting on someone else", "This week"]);
    expect(container.querySelector("h1")!.textContent).toBe("Good morning, Deep");
    expect(container.textContent).toContain("3 jobs need you today. 1 must be fixed before work starts.");
    expect(container.querySelectorAll("[data-action-row]").length).toBe(3);
    for (const a of container.querySelectorAll("[data-action-row] a")) expect(a.getAttribute("href")).toMatch(/^\/field\/0000/);
  });
  test("waiting folded", () => {
    full();
    const { container, getByRole } = render(<Page />);
    expect(container.querySelectorAll("[data-waiting-row]").length).toBe(0);
    const btn = getByRole("button", { name: /Waiting on someone else/ });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(btn);
    const rows = [...container.querySelectorAll("[data-waiting-row]")];
    expect(rows.length).toBe(3);
    for (const r of rows) expect(r.textContent).toContain("Waiting on ");
  });
  test("no fix box when none", () => {
    home = makeHome([row("Sunbury")]);
    const { container } = render(<Page />);
    expect(container.textContent).not.toContain("Fix before work starts");
    expect(container.textContent).toContain("1 job needs you today.");
  });
  test("search filters every group", () => {
    full();
    const { container, getByRole } = render(<Page />);
    fireEvent.change(container.querySelector('input[type="search"]')!, { target: { value: "melton" } });
    fireEvent.click(getByRole("button", { name: /Waiting on someone else/ }));
    expect(container.querySelectorAll("[data-action-row]").length).toBe(1);
    expect([...container.querySelectorAll("[data-waiting-row]")].map((r) => r.textContent).join()).toContain("Melton West");
    expect(container.querySelectorAll("[data-waiting-row]").length).toBe(1);
  });
  test("error keeps retry", () => {
    fail = true;
    const { container } = render(<Page />);
    expect(container.textContent).toContain("Your work couldn't load. Check your signal and try again.");
    expect(container.textContent).toContain("Try again");
  });
  test("no boss word, no price", () => {
    full();
    const { container } = render(<Page />);
    expect(container.textContent ?? "").not.toMatch(/boss|\$\d/i);
  });
});
