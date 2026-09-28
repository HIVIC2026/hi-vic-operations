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
  const link = "rounded-md px-3 py-2 text-sm font-medium text-brand-dark-foreground/80 hover:bg-sidebar-accent";
  const active = { className: "bg-sidebar-accent text-brand-dark-foreground" };
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 bg-brand-dark text-brand-dark-foreground">
        <div className={`mx-auto flex h-14 items-center gap-2 px-4 ${wide ? "max-w-[1600px]" : "max-w-5xl"}`}>
          <Link to="/home" className="mr-3 flex items-center gap-2 font-bold tracking-tight">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-sidebar-primary text-sm text-sidebar-primary-foreground">HI</span>
            <span className="hidden sm:inline">HI VIC Portal</span>
          </Link>
          <nav className="flex flex-1 items-center gap-1 overflow-x-auto">
            {roles.includes("admin") && (
              <>
                <Link to="/admin" className={link} activeProps={active} activeOptions={{ exact: true }}>Pipeline</Link>
                <Link to="/admin/partners" className={link} activeProps={active}>Partner Enquiries</Link>
                <Link to="/admin/users" className={link} activeProps={active}>Users</Link>
              </>
            )}
            {(roles.includes("electrician") || roles.includes("installer")) && <Link to="/field" className={link} activeProps={active}>My jobs</Link>}
            {roles.includes("owner") && <Link to="/owner" className={link} activeProps={active}>My home</Link>}
          </nav>
          <span className="hidden text-sm opacity-70 md:inline">{me?.profile?.full_name}</span>
          <Button variant="ghost" size="icon" onClick={signOut} aria-label="Sign out" className="text-brand-dark-foreground hover:bg-sidebar-accent hover:text-brand-dark-foreground">
            <LogOut />
          </Button>
        </div>
      </header>
      <main className={`mx-auto px-4 py-6 ${wide ? "max-w-[1600px]" : "max-w-5xl"}`}>{children}</main>
    </div>
  );
}
