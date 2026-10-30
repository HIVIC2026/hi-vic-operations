// Phone-first trade frame (Jo-approved; Style A frame per approved mock-ups M1–M3, decision 198): logo + initials
// circle, bottom tabs My work · Add a job · Money · My business. Presentation only.
import { clearTradeCache } from "@/lib/trade-cache";
import * as React from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import logo from "@/assets/home-insulation-victoria-logo.png.asset.json";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { currentUser } from "@/lib/route-guards";
import { useAccess } from "@/hooks/use-me";

export function TradeShell({ children, installer, boss: bossProp, test = false, redesign = false }: { children: React.ReactNode; installer: boolean; boss?: boolean | undefined; test?: boolean; redesign?: boolean }) {
  // Owner-only tabs (Add a job, Money, My business) stay hidden until the person is known to be the business owner.
  const { data: access } = useAccess();
  const boss = bossProp ?? (!!access?.businessAdmin || !!access?.admin);
  return (
    <div className={`estimate-brand portal-theme min-h-screen text-ink ${redesign ? "installer-redesign bg-paper" : "bg-canvas"}`}>
      <header className="border-b border-line bg-paper">
        <div className="mx-auto flex max-w-[1180px] items-center gap-[26px] px-5 py-3 md:px-[26px] md:py-[18px]">
          <img src={logo.url} alt="Home Insulation Victoria" className="h-auto w-24 shrink-0 md:w-28" />
          <TradeTopNav installer={installer} boss={boss} />
          <TradeAvatar />
        </div>
      </header>
      {test && <p className="mx-auto max-w-[1180px] px-5 pt-3 md:px-[26px]"><span className="inline-flex rounded-[18px] bg-pink px-[9px] py-[5px] text-[11px] font-semibold text-rose">TEST account — practice jobs only</span></p>}
      <main className={`trade-forms mx-auto max-w-[1180px] px-5 pb-28 pt-5 md:px-[26px] md:pb-[30px] md:pt-7 ${redesign ? "space-y-[22px]" : "space-y-[19px]"}`}>{children}</main>
      <TradeTabBar installer={installer} boss={boss} />
    </div>
  );
}

/** Trade menu items: My work · Add a job (installer boss) · Money · My business. Staff see only My work. */
function useTradeItems(installer: boolean, boss: boolean) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const work = path === "/field" || path.startsWith("/field/offer") || path.startsWith("/field/day") || /^\/field\/[0-9a-f-]{36}/.test(path);
  return [
    { to: "/field", label: "My work", on: work, show: true },
    { to: "/partner/import", label: "Add a job", on: path.startsWith("/partner/import"), show: installer && boss },
    { to: "/field/money", label: "Money", on: path.startsWith("/field/money"), show: boss },
    { to: "/field/business", label: "My business", on: path.startsWith("/field/business"), show: boss },
  ].filter((i) => i.show);
}

function TradeTopNav({ installer, boss }: { installer: boolean; boss: boolean }) {
  const items = useTradeItems(installer, boss);
  return (
    <nav aria-label="Trade menu (desktop)" className="hidden min-w-0 flex-wrap items-center gap-[3px] md:flex">
      {items.map((i) => <Link key={i.to} to={i.to as never} aria-current={i.on ? "page" : undefined} className={`whitespace-nowrap rounded-[24px] px-3 py-[9px] text-sm font-semibold ${i.on ? "bg-ink text-paper" : "text-ink hover:bg-mist"}`}>{i.label}</Link>)}
    </nav>
  );
}

/** Initials circle (mock-up: 36px mist circle, thin line, navy initials), top right. Presentation only. */
function TradeAvatar() {
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
      {open && <div className="absolute right-0 z-20 mt-2 w-48 rounded-[12px] border border-line bg-paper p-2 shadow-card">
        {data?.email && <p className="truncate px-2 pb-2 text-xs text-sub">{data.email}</p>}
        <button type="button" onClick={() => void signOut()} className="h-11 w-full rounded-[9px] px-2 text-left text-sm font-bold text-hiv-blue hover:bg-mist">Sign out</button>
      </div>}
    </div>
  );
}

/** Bottom tabs (mock-up): text only, 13px, active blue bold, 44px tap targets. */
function TradeTabBar({ installer, boss }: { installer: boolean; boss: boolean }) {
  const items = useTradeItems(installer, boss);
  return (
    <nav aria-label="Trade menu" className="estimate-brand fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper pb-[max(22px,env(safe-area-inset-bottom))] pt-2 md:hidden">
      <div className="mx-auto grid max-w-md px-1.5" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((i) => <Link key={i.to} to={i.to as never} aria-current={i.on ? "page" : undefined} className={`flex min-h-11 items-center justify-center text-center text-[13px] ${i.on ? "font-bold text-hiv-blue" : "font-medium text-sub"}`}>{i.label}</Link>)}
      </div>
    </nav>
  );
}

export const card = "rounded-[18px] border border-line bg-paper p-[19px] shadow-card";
export const navyCard = "rounded-[18px] bg-ink p-[19px] text-paper shadow-card";
export const greenBtn = "flex h-12 w-full items-center justify-center gap-[7px] rounded-[10px] bg-action px-[15px] text-[13px] font-bold text-action-foreground disabled:cursor-not-allowed disabled:opacity-45 md:h-[42px] md:w-auto";
export const ghostBtn = "flex h-12 w-full items-center justify-center gap-[7px] rounded-[10px] border border-line bg-paper px-[15px] text-[13px] font-bold text-hiv-blue md:h-[42px] md:w-auto";
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
export const inputCls = "h-12 w-full rounded-[9px] border border-field-line bg-paper px-3 text-base text-ink md:h-[42px] md:text-sm";
