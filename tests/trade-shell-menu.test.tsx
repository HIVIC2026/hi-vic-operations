// Installer redesign shell (plan Task 3): left menu on computer, top bar + bottom tabs on phone.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();
import { describe, expect, mock, test, afterEach } from "bun:test";
import type { ReactNode } from "react";

let path = "/field";
mock.module("@tanstack/react-router", () => ({
  Link: ({ to, children, className, ...rest }: { to: string; children: ReactNode; className?: string }) => <a href={to} className={className} {...rest}>{children}</a>,
  useRouterState: ({ select }: { select: (s: { location: { pathname: string } }) => unknown }) => select({ location: { pathname: path } }),
}));
mock.module("@tanstack/react-query", () => ({
  useQuery: () => ({ data: { email: "deep@example.com", user_metadata: { full_name: "Deep Singh" } } }),
  useQueryClient: () => ({ cancelQueries: async () => {} }),
}));
mock.module("@/integrations/supabase/client", () => ({ supabase: { auth: { signOut: async () => {} } } }));
mock.module("@/lib/route-guards", () => ({ currentUser: async () => ({ data: { user: null } }) }));
mock.module("@/hooks/use-me", () => ({ useAccess: () => ({ data: { businessAdmin: true, admin: false } }) }));
mock.module("@/lib/trade-cache", () => ({ clearTradeCache: () => {} }));

const { render, cleanup } = await import("@testing-library/react");
const { TradeShell } = await import("../src/components/trade/TradeShell");
afterEach(() => cleanup());

describe("TradeShell redesign", () => {
  test("redesign draws one nav with Action items first and the count", () => {
    const { container } = render(<TradeShell installer redesign actionCount={4} boss money business="Reinsulate"><p>body</p></TradeShell>);
    const nav = container.querySelector('nav[aria-label="Main"]')!;
    expect(nav).not.toBeNull();
    const links = [...nav.querySelectorAll("a")];
    expect(links[0]!.textContent).toContain("Action items");
    expect(links[0]!.textContent).toContain("4");
    expect(links[0]!.getAttribute("aria-current")).toBe("page");
    expect(links.map((a) => a.textContent)).toEqual(["Action items4", "Money", "My business"]);
    expect([...container.querySelectorAll("a")].some((a) => a.textContent === "+ Add a job" && a.getAttribute("href") === "/partner/import")).toBe(true);
    expect(container.querySelector('nav[aria-label="Main (phone)"]')).not.toBeNull();
    expect(container.textContent).toContain("Reinsulate");
    expect(container.textContent).toContain("Deep Singh");
    expect(container.textContent).toContain("body");
  });
  test("no add a job for office staff", () => {
    const { container } = render(<TradeShell installer redesign actionCount={0} boss={false} money={false}><p /></TradeShell>);
    expect(container.textContent).not.toContain("Add a job");
    expect([...container.querySelector('nav[aria-label="Main"]')!.querySelectorAll("a")].map((a) => a.textContent)).toEqual(["Action items"]);
  });
  test("old mode unchanged", () => {
    const { container } = render(<TradeShell installer boss money><p /></TradeShell>);
    expect(container.querySelector('nav[aria-label="Trade menu (desktop)"]')).not.toBeNull();
    expect(container.querySelector('nav[aria-label="Main"]')).toBeNull();
    expect(container.textContent).toContain("My work");
  });
  test("no boss word", () => {
    const { container } = render(<TradeShell installer redesign actionCount={2} boss money business="Rapid"><p /></TradeShell>);
    expect(container.textContent ?? "").not.toMatch(/boss/i);
  });
});
