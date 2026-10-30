import { Link, useNavigate } from "@tanstack/react-router";
import { clearTradeCache } from "@/lib/trade-cache.client";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut, Menu, X } from "lucide-react";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAccess, useMe } from "@/hooks/use-me";
import { Button } from "@/components/ui/button";
import logo from "@/assets/home-insulation-victoria-logo.png.asset.json";
import { OfficeTopBar } from "@/components/portal/office";

/** Office users get the office frame (top bar, decision 218); trades and owners keep their own small menu. */
export function AppShell({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { data: me } = useMe();
  const { data: access } = useAccess();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const roles = me?.roles ?? [];
  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    clearTradeCache();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };
  if (roles.includes("admin") || roles.includes("qa_office")) return (
    <div className="portal-theme min-h-screen bg-background">
      <OfficeTopBar name={me?.profile?.full_name ?? ""} onSignOut={() => void signOut()} />
      <main className={`mx-auto w-full px-4 pb-24 pt-6 sm:px-8 md:pb-10 lg:pt-8 ${wide ? "max-w-[1800px]" : "max-w-[1216px]"}`}>{children}</main>
    </div>
  );
  const link = "flex min-h-10 items-center gap-3 rounded-md px-3 py-2 text-sm font-semibold text-sidebar-foreground/65 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground";
  const active = { className: "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm ring-1 ring-workspace-blush-strong/40" };
  const nav = (
    <>
      {(roles.includes("electrician") || roles.includes("installer")) && <>
        <Link to="/field" className={link} activeProps={active} onClick={() => setMobileOpen(false)}>My work</Link>
        {access?.installerBusinessAdmin && <Link to="/partner/import" className={link} activeProps={active} onClick={() => setMobileOpen(false)}>Add one job</Link>}
        {access?.businessAdmin && <Link to="/field/business" className={link} activeProps={active} onClick={() => setMobileOpen(false)}>Business</Link>}
      </>}
      {roles.includes("owner") && <Link to="/owner" className={link} activeProps={active}>My home</Link>}
    </>
  );
  const brand = (
    <Link to="/home" className="flex min-w-0 items-center gap-2 font-bold">
      <span className="grid h-9 shrink-0 place-items-center rounded-md bg-card px-1.5 shadow-sm ring-1 ring-sidebar-border"><img src={logo.url} alt="Home Insulation Victoria" className="h-7" /></span>
      <span className="min-w-0"><span className="block truncate font-display text-sm">Home Insulation Victoria</span></span>
    </Link>
  );
  return (
    <div className="portal-theme flex min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
        <div className="flex h-16 items-center border-b border-sidebar-border px-5">{brand}</div>
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-4">{nav}</nav>
        <div className="flex items-center justify-between gap-2 border-t border-sidebar-border px-4 py-3">
          <span className="truncate text-sm text-sidebar-foreground/70">{me?.profile?.full_name}</span>
          <Button variant="ghost" size="icon" onClick={signOut} aria-label="Sign out" className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
            <LogOut />
          </Button>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-sidebar-border bg-sidebar text-sidebar-foreground shadow-sm md:hidden">
          <div className="flex h-16 items-center justify-between px-4">
            {brand}
            <Button variant="ghost" size="icon" onClick={() => setMobileOpen(!mobileOpen)} aria-label={mobileOpen ? "Close navigation" : "Open navigation"} className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
              {mobileOpen ? <X /> : <Menu />}
            </Button>
          </div>
          {mobileOpen && <div className="border-t border-sidebar-border px-3 pb-4"><nav className="flex max-h-[70vh] flex-col overflow-y-auto">{nav}</nav><Button variant="ghost" onClick={signOut} className="mt-3 w-full justify-start text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"><LogOut /> Sign out</Button></div>}
        </header>
        <main className={`mx-auto w-full px-4 py-6 sm:px-[26px] lg:py-[26px] ${wide ? "max-w-[1800px]" : "max-w-[1180px]"}`}>{children}</main>
      </div>
    </div>
  );
}
