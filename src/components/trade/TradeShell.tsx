// Phone-first trade frame (Jo-approved): logo + today's date, owner-page fonts/colours, bottom tabs.
import { Link, useRouterState } from "@tanstack/react-router";
import { Briefcase, Building2, PlusCircle, Wallet } from "lucide-react";
import logo from "@/assets/home-insulation-victoria-logo.png.asset.json";

export function TradeShell({ children, installer, boss = true, test = false }: { children: React.ReactNode; installer: boolean; boss?: boolean; test?: boolean }) {
  const today = new Date().toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", timeZone: "Australia/Melbourne" });
  return (
    <div className="estimate-brand min-h-screen bg-estimate-canvas font-sans text-estimate-navy">
      <header className="border-b border-line bg-paper">
        <div className="mx-auto grid max-w-[1180px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 px-4 py-2.5 sm:px-[26px]">
          <img src={logo.url} alt="Home Insulation Victoria" className="h-9 w-auto shrink-0" />
          <TradeTopNav installer={installer} boss={boss} />
          <span className="col-start-3 truncate text-xs font-semibold text-sub">{today}</span>
        </div>
      </header>
      {test && <p className="mx-auto max-w-md px-4 pt-3"><span className="inline-block rounded-full bg-owner-house-pink px-3 py-1 text-[11px] font-bold uppercase tracking-wide">TEST account — practice jobs only</span></p>}
      <main className="trade-forms mx-auto max-w-md space-y-4 px-4 pb-28 pt-4 md:pb-12">{children}</main>
      <TradeTabBar installer={installer} boss={boss} />
    </div>
  );
}

/** Trade menu items (Jo approved 7 Oct): My work · upload/customers (installer boss) · Money · My business. Staff see only My work. */
function useTradeItems(installer: boolean, boss: boolean) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const work = path === "/field" || path.startsWith("/field/offer") || path.startsWith("/field/day") || /^\/field\/[0-9a-f-]{36}/.test(path);
  return [
    { to: "/field", label: "My work", Icon: Briefcase, on: work, show: true },
    { to: "/partner/bulk-import", label: "Upload jobs", Icon: PlusCircle, on: path.startsWith("/partner/add") || path.startsWith("/partner/bulk") || path.startsWith("/partner/import"), show: installer && boss },
    { to: "/field/money", label: "Money", Icon: Wallet, on: path.startsWith("/field/money"), show: boss },
    { to: "/field/business", label: "My business", Icon: Building2, on: path.startsWith("/field/business"), show: boss },
  ].filter((i) => i.show);
}

function TradeTopNav({ installer, boss }: { installer: boolean; boss: boolean }) {
  const items = useTradeItems(installer, boss);
  return (
    <nav aria-label="Trade menu (desktop)" className="hidden min-w-0 items-center gap-1 md:flex">
      {items.map((i) => <Link key={i.to} to={i.to as never} aria-current={i.on ? "page" : undefined} className={`whitespace-nowrap rounded-[10px] px-3 py-2 text-sm font-semibold ${i.on ? "bg-mist text-ink" : "text-sub hover:text-ink"}`}>{i.label}</Link>)}
    </nav>
  );
}

export function TradeTabBar({ installer, boss }: { installer: boolean; boss: boolean }) {
  const items = useTradeItems(installer, boss);
  return (
    <nav aria-label="Trade menu" className="estimate-brand fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper pb-[env(safe-area-inset-bottom)] md:hidden">
      <div className="mx-auto flex max-w-md">
        {items.map((i) => <Link key={i.to} to={i.to as never} aria-current={i.on ? "page" : undefined} className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-bold ${i.on ? "text-hiv-blue" : "text-sub"}`}><i.Icon className="h-5 w-5" />{i.label}</Link>)}
      </div>
    </nav>
  );
}

export const card = "rounded-[22px] bg-card p-5 shadow-sm";
export const navyCard = "rounded-[22px] bg-estimate-navy p-5 text-estimate-canvas shadow-sm";
export const greenBtn = "flex h-12 w-full items-center justify-center gap-2 rounded-full bg-estimate-green px-4 font-bold text-white disabled:bg-estimate-line disabled:text-estimate-navy/50";
export const ghostBtn = "flex h-12 w-full items-center justify-center rounded-full border border-estimate-line bg-card px-4 font-bold text-estimate-navy";
export const aud = (n: number | null | undefined) => (n == null ? "—" : `$${Math.floor(n).toLocaleString("en-AU")}`);

/** Same frame as the trade screens, without the bottom menu (rate offer, set password). */
export function TradePublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="estimate-brand min-h-screen bg-estimate-canvas font-sans text-estimate-navy">
      <header className="mx-auto flex max-w-md items-center justify-between px-4 pb-2 pt-4">
        <img src={logo.url} alt="Home Insulation Victoria" className="h-9 w-auto" />
      </header>
      <main className="trade-forms mx-auto max-w-md space-y-4 px-4 pb-12 pt-3">{children}</main>
    </div>
  );
}
export const inputCls = "h-12 w-full rounded-2xl border border-estimate-line bg-card px-4 text-base text-estimate-navy";
