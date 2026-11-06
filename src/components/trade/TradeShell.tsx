// Phone-first trade frame (Jo-approved; Style A frame per approved mock-ups M1–M3, decision 198): logo + initials
// circle, bottom tabs My work · Add a job · Money · My business. Presentation only.
import { clearTradeCache } from "@/lib/trade-cache";
export { greenBtn, ghostBtn, inputCls } from "./trade-classes";
import * as React from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import logo from "@/assets/home-insulation-victoria-logo.png.asset.json";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { currentUser } from "@/lib/route-guards";
import { useAccess } from "@/hooks/use-me";
import { tradeMenu } from "@/lib/trade-menu.core";

export function TradeShell({ children, installer, boss: bossProp, money: moneyProp, test = false, redesign = false, actionCount = 0, business }: { children: React.ReactNode; installer: boolean; boss?: boolean | undefined; money?: boolean | undefined; test?: boolean; redesign?: boolean; actionCount?: number; business?: string | undefined }) {
  // Owner-only tabs (Add a job, Money, My business) stay hidden until the person is known to be the business owner.
  const { data: access } = useAccess();
  const boss = bossProp ?? (!!access?.businessAdmin || !!access?.admin);
  // Money tab: the boss always; an Office person only when the boss turned "Can see Money" on (getTradeHome sends `money`).
  const money = moneyProp ?? boss;
  const path = useRouterState({ select: s => s.location.pathname });
  const [saved, setSaved] = React.useState<{path: string; line: string} | null>(null);
  React.useEffect(() => {
    const receive = (event: Event) => setSaved((event as CustomEvent<{path: string; line: string}>).detail);
    window.addEventListener('trade-saved', receive);
    return () => window.removeEventListener('trade-saved', receive);
  }, []);
  const status = saved?.path === path ? <p role="status" className="break-words text-sm font-semibold text-ink">{saved.line}</p> : null;
  if (redesign) return <RedesignShell installer={installer} admin={boss} money={money} test={test} actionCount={actionCount} business={business} path={path} status={status}>{children}</RedesignShell>;
  return (
    <div className={`estimate-brand portal-theme min-h-screen text-ink ${redesign ? "installer-redesign bg-paper" : "bg-canvas"}`}>
      <header className="trade-safe-header sticky top-0 z-30 border-b border-line bg-paper pt-[env(safe-area-inset-top)]">
        <div className="mx-auto grid max-w-[1180px] grid-cols-[minmax(0,1fr)_auto] items-center gap-[26px] px-5 py-3 md:flex md:px-[26px] md:py-[18px]">
          <img src={logo.url} alt="Home Insulation Victoria" className="h-auto w-24 shrink-0 md:w-28" />
          <TradeTopNav installer={installer} boss={boss} money={money} />
          <TradeAvatar />
        </div>
      </header>
      {test && <p className="mx-auto max-w-[1180px] px-5 pt-3 md:px-[26px]"><span className="inline-flex rounded-[18px] bg-pink px-[9px] py-[5px] text-[11px] font-semibold text-rose">TEST account — practice jobs only</span></p>}
      <main className={`trade-forms mx-auto min-w-0 max-w-[1180px] px-5 pb-28 pt-5 md:px-[26px] md:pb-[30px] md:pt-7 ${redesign ? "space-y-[22px]" : "space-y-[19px]"}`}>{saved?.path === path && <p role="status" className="break-words text-sm font-semibold text-ink">{saved.line}</p>}{children}</main>
      <TradeTabBar installer={installer} boss={boss} money={money} />
    </div>
  );
}

/** Installer redesign frame (spec v2 §4.1, canvas "Action items"): left menu on computer; top bar + bottom tabs on phone. */
function RedesignShell({ children, installer, admin, money, test, actionCount, business, path, status }: { children: React.ReactNode; installer: boolean; admin: boolean; money: boolean; test: boolean; actionCount: number; business: string | undefined; path: string; status: React.ReactNode }) {
  const { items, addJob } = tradeMenu({ path, installer, admin, money, actionCount });
  const { data: user } = useQuery({ queryKey: ["trade-avatar"], queryFn: async () => (await currentUser()).data.user, staleTime: 300_000 });
  const person = String((user?.user_metadata as { full_name?: string } | undefined)?.full_name ?? "");
  const addBtn = (cls: string) => <Link to={"/partner/import" as never} className={`inline-flex items-center justify-center rounded-[10px] bg-hiv-blue font-bold text-white hover:opacity-90 ${cls}`}>+ Add a job</Link>;
  return (
    <div className="estimate-brand portal-theme installer-redesign min-h-screen bg-canvas text-ink md:grid md:grid-cols-[232px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-screen flex-col border-r border-line bg-paper px-4 py-6 md:flex">
        <img src={logo.url} alt="Home Insulation Victoria" className="mb-6 h-auto w-28 px-2" />
        {addJob && addBtn("mb-5 min-h-11 w-full text-sm")}
        <nav aria-label="Main" className="flex flex-col gap-1">
          {items.map((i) => <Link key={i.key} to={i.to as never} aria-current={i.on ? "page" : undefined} className={`flex min-h-11 items-center justify-between rounded-[10px] px-3 text-[15px] font-semibold ${i.on ? "bg-[#eaeefb] text-hiv-blue" : "text-ink hover:bg-mist"}`}>{i.label}{i.count != null && <span className="ml-2 rounded-full bg-hiv-blue px-2 py-0.5 text-xs font-bold text-white">{i.count}</span>}</Link>)}
        </nav>
        <div className="mt-auto flex items-center gap-3 border-t border-line px-2 pt-4">
          <div className="min-w-0 flex-1">
            {business && <p className="truncate text-sm font-bold text-ink">{business}</p>}
            {person && <p className="truncate text-xs text-sub">{person}</p>}
          </div>
          <TradeAvatar up />
        </div>
      </aside>
      <div className="min-w-0">
        <header className="trade-safe-header sticky top-0 z-30 border-b border-line bg-paper pt-[env(safe-area-inset-top)] md:hidden">
          <div className="flex items-center gap-3 px-4 py-3">
            <img src={logo.url} alt="Home Insulation Victoria" className="h-auto w-24 shrink-0" />
            <div className="ml-auto flex items-center gap-2">{addJob && addBtn("min-h-10 px-3 text-sm")}<TradeAvatar /></div>
          </div>
        </header>
        {test && <p className="mx-auto max-w-[1120px] px-4 pt-3 md:px-8"><span className="inline-flex rounded-[18px] bg-pink px-[9px] py-[5px] text-[11px] font-semibold text-rose">TEST account — practice jobs only</span></p>}
        <main className="trade-forms mx-auto min-w-0 max-w-[1120px] space-y-[22px] px-4 pb-28 pt-5 md:px-8 md:pb-10 md:pt-8">{status}{children}</main>
      </div>
      <nav aria-label="Main (phone)" className="estimate-brand fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper pb-[max(14px,env(safe-area-inset-bottom))] pt-1.5 md:hidden">
        <div className="mx-auto grid max-w-md px-1.5" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
          {items.map((i) => <Link key={i.key} to={i.to as never} aria-current={i.on ? "page" : undefined} className={`relative flex min-h-11 min-w-0 items-center justify-center whitespace-normal text-center text-[13px] ${i.on ? "font-bold text-hiv-blue" : "font-medium text-sub"}`}>{i.label}{i.count != null && <span className="ml-1 rounded-full bg-hiv-blue px-1.5 text-[11px] font-bold text-white">{i.count}</span>}</Link>)}
        </div>
      </nav>
    </div>
  );
}

/** Trade menu items: My work · Add a job (installer boss) · Money (boss, or Office with Can see Money) · My business (boss). */
function useTradeItems(installer: boolean, boss: boolean, money: boolean) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const work = path === "/field" || path.startsWith("/field/offer") || path.startsWith("/field/day") || /^\/field\/[0-9a-f-]{36}/.test(path);
  return [
    { to: "/field", label: "My work", on: work, show: true },
    { to: "/partner/import", label: "Add a job", on: path.startsWith("/partner/import"), show: installer && boss },
    { to: "/field/money", label: "Money", on: path.startsWith("/field/money"), show: money },
    { to: "/field/business", label: "My business", on: path.startsWith("/field/business"), show: boss },
  ].filter((i) => i.show);
}

function TradeTopNav({ installer, boss, money }: { installer: boolean; boss: boolean; money: boolean }) {
  const items = useTradeItems(installer, boss, money);
  return (
    <nav aria-label="Trade menu (desktop)" className="hidden min-w-0 flex-wrap items-center gap-[3px] md:flex">
      {items.map((i) => <Link key={i.to} to={i.to as never} aria-current={i.on ? "page" : undefined} className={`whitespace-nowrap rounded-[24px] px-3 py-[9px] text-sm font-semibold ${i.on ? "bg-ink text-paper" : "text-ink hover:bg-mist"}`}>{i.label}</Link>)}
    </nav>
  );
}

/** Initials circle (mock-up: 36px mist circle, thin line, navy initials), top right. Presentation only. */
function TradeAvatar({ up = false }: { up?: boolean }) {
  const { data } = useQuery({ queryKey: ["trade-avatar"], queryFn: async () => (await currentUser()).data.user, staleTime: 300_000 });
  const name = String((data?.user_metadata as { full_name?: string } | undefined)?.full_name ?? data?.email ?? "");
  const ini = name.replace(/[^A-Za-z\s@.]/g, "").split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
  const [open, setOpen] = React.useState(false);
  const qc = useQueryClient();
  // Everyone (business owner and staff) can sign out from the top-right circle on every trade page.
  const signOut = async () => { await qc.cancelQueries(); clearTradeCache(); await supabase.auth.signOut(); window.location.replace("/portal"); };
  return (
    <div className="relative ml-auto shrink-0">
      <button type="button" aria-label="Account menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="grid h-9 w-9 place-items-center rounded-full border border-line bg-mist text-[13px] font-semibold text-ink">{ini || "·"}</button>
      {open && <div className={`absolute right-0 z-20 ${up ? "bottom-full mb-2" : "mt-2"} w-48 rounded-[12px] border border-line bg-paper p-2 shadow-card`}>
        {data?.email && <p className="truncate px-2 pb-2 text-xs text-sub">{data.email}</p>}
        <button type="button" onClick={() => void signOut()} className="h-11 w-full rounded-[9px] px-2 text-left text-sm font-bold text-hiv-blue hover:bg-mist">Sign out</button>
      </div>}
    </div>
  );
}

/** Bottom tabs (mock-up): text only, 13px, active blue bold, 44px tap targets. */
function TradeTabBar({ installer, boss, money }: { installer: boolean; boss: boolean; money: boolean }) {
  const items = useTradeItems(installer, boss, money);
  return (
    <nav aria-label="Trade menu" className="estimate-brand fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper pb-[max(22px,env(safe-area-inset-bottom))] pt-2 md:hidden">
      <div className="mx-auto grid max-w-md px-1.5" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((i) => <Link key={i.to} to={i.to as never} aria-current={i.on ? "page" : undefined} className={`flex min-h-11 min-w-0 items-center justify-center whitespace-normal text-center text-[13px] ${i.on ? "font-bold text-hiv-blue" : "font-medium text-sub"}`}>{i.label}</Link>)}
      </div>
    </nav>
  );
}

export const card = "rounded-[18px] border border-line bg-paper p-[19px] shadow-card";
export const navyCard = "rounded-[18px] bg-ink p-[19px] text-paper shadow-card";
export const aud = (n: number | null | undefined) => (n == null ? "—" : `$${Math.floor(n).toLocaleString("en-AU")}`);

/** Same frame as the trade screens, without the bottom menu (rate offer, set password). */
export function TradePublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="estimate-brand portal-theme min-h-screen bg-canvas text-ink">
      <header className="border-b border-line bg-paper">
        <div className="mx-auto flex max-w-[1180px] items-center px-4 py-3 md:px-[26px] md:py-[18px]"><img src={logo.url} alt="Home Insulation Victoria" className="h-8 w-auto md:h-9" /></div>
      </header>
      <main className="trade-forms mx-auto max-w-[640px] space-y-[19px] px-4 pb-12 pt-5 md:pt-7">{children}</main>
    </div>
  );
}
