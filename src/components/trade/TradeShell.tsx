// Phone-first trade frame (Jo-approved): logo + today's date, owner-page fonts/colours, bottom tabs.
import { Link, useRouterState } from "@tanstack/react-router";
import { Briefcase, Building2, PlusCircle, Wallet } from "lucide-react";
import logo from "@/assets/home-insulation-victoria-logo.png.asset.json";

export function TradeShell({ children, installer, boss = true, test = false }: { children: React.ReactNode; installer: boolean; boss?: boolean; test?: boolean }) {
  const today = new Date().toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", timeZone: "Australia/Melbourne" });
  return (
    <div className="estimate-brand min-h-screen bg-estimate-canvas font-sans text-estimate-navy">
      <header className="mx-auto flex max-w-md items-center justify-between px-4 pb-2 pt-4">
        <img src={logo.url} alt="Home Insulation Victoria" className="h-9 w-auto" />
        <span className="text-xs font-semibold text-estimate-navy/70">{today}</span>
      </header>
      {test && <p className="mx-auto max-w-md px-4"><span className="inline-block rounded-full bg-owner-house-pink px-3 py-1 text-[11px] font-bold uppercase tracking-wide">TEST account — practice jobs only</span></p>}
      <main className="mx-auto max-w-md space-y-4 px-4 pb-28 pt-3">{children}</main>
      <TradeTabBar installer={installer} boss={boss} />
    </div>
  );
}

export function TradeTabBar({ installer, boss }: { installer: boolean; boss: boolean }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const tab = (to: string, label: string, Icon: typeof Briefcase, on: boolean) => (
    <Link to={to as never} className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-bold ${on ? "text-estimate-blue" : "text-estimate-navy/55"}`}><Icon className="h-5 w-5" />{label}</Link>
  );
  const work = path === "/field" || path.startsWith("/field/offer") || path.startsWith("/field/day") || /^\/field\/[0-9a-f-]{36}/.test(path);
  return (
    <nav aria-label="Trade menu" className="estimate-brand fixed inset-x-0 bottom-0 z-40 border-t border-estimate-line bg-card pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_rgba(34,55,107,0.08)]">
      <div className="mx-auto flex max-w-md">
        {tab("/field", "Work", Briefcase, work)}
        {installer && boss && tab("/partner/bulk-import", "Upload jobs", PlusCircle, path.startsWith("/partner/add") || path.startsWith("/partner/bulk") || path.startsWith("/partner/import"))}
        {boss && tab("/field/money", "Money", Wallet, path.startsWith("/field/money"))}
        {boss && tab("/field/business", "My business", Building2, path.startsWith("/field/business"))}
      </div>
    </nav>
  );
}

export const card = "rounded-[22px] bg-card p-5 shadow-sm";
export const navyCard = "rounded-[22px] bg-estimate-navy p-5 text-estimate-canvas shadow-sm";
export const greenBtn = "flex h-12 w-full items-center justify-center gap-2 rounded-full bg-estimate-green px-4 font-bold text-white disabled:bg-estimate-line disabled:text-estimate-navy/50";
export const ghostBtn = "flex h-12 w-full items-center justify-center rounded-full border border-estimate-line bg-card px-4 font-bold text-estimate-navy";
export const aud = (n: number | null | undefined) => (n == null ? "—" : `$${Math.floor(n).toLocaleString("en-AU")}`);
