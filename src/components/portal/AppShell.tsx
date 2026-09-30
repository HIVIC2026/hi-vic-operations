import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/hooks/use-me";
import { Button } from "@/components/ui/button";

export function AppShell({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const roles = me?.roles ?? [];
  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };
  const link = "rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors";
  const active = { className: "bg-sidebar-accent text-sidebar-accent-foreground" };
  const nav = (
    <>
      {roles.includes("admin") && (
        <>
          <Link to="/admin" className={link} activeProps={active} activeOptions={{ exact: true }}>Pipeline</Link>
          <Link to="/admin/step3-design" className={link} activeProps={active}>Step 3 Design</Link>
          <Link to="/admin/businesses" className={link} activeProps={active}>Partners</Link>
          <Link to="/admin/partners" className={link} activeProps={active}>Partner Enquiries</Link>
          <Link to="/admin/compliance" className={link} activeProps={active}>Compliance Setup</Link>
          <Link to="/admin/users" className={link} activeProps={active}>Users</Link>
        </>
      )}
      {(roles.includes("electrician") || roles.includes("installer")) && <Link to="/field" className={link} activeProps={active}>My jobs</Link>}
      {(me?.profile?.business_id || roles.includes("installer") || roles.includes("electrician")) && !roles.includes("admin") && <Link to="/partner" className={link} activeProps={active}>Partner</Link>}
      {roles.includes("owner") && <Link to="/owner" className={link} activeProps={active}>My home</Link>}
    </>
  );
  const brand = (
    <Link to="/home" className="flex items-center gap-2 font-bold tracking-tight">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-sidebar-primary text-sm text-sidebar-primary-foreground">HI</span>
      <span className="font-display">HI VIC Portal</span>
    </Link>
  );
  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col bg-sidebar text-sidebar-foreground md:flex">
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
        {/* Mobile top bar */}
        <header className="sticky top-0 z-30 bg-sidebar text-sidebar-foreground md:hidden">
          <div className="flex h-14 items-center gap-2 px-4">
            {brand}
            <nav className="flex flex-1 items-center gap-1 overflow-x-auto">{nav}</nav>
            <Button variant="ghost" size="icon" onClick={signOut} aria-label="Sign out" className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
              <LogOut />
            </Button>
          </div>
        </header>
        <main className={`mx-auto w-full px-4 py-6 ${wide ? "max-w-[1600px]" : "max-w-5xl"}`}>{children}</main>
      </div>
    </div>
  );
}
