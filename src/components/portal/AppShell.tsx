import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { BriefcaseBusiness, Calculator, ClipboardCheck, ExternalLink, FileCheck2, FlaskConical, LayoutDashboard, LogOut, MailCheck, MapPinned, Menu, Sun, Users, X } from "lucide-react";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAccess, useMe } from "@/hooks/use-me";
import { Button } from "@/components/ui/button";
import logo from "@/assets/home-insulation-victoria-logo.png.asset.json";
import { OfficeTopBar } from "@/components/portal/office";

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
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };
  const link = "flex min-h-10 items-center gap-3 rounded-md px-3 py-2 text-sm font-semibold text-sidebar-foreground/65 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground";
  const active = { className: "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm ring-1 ring-workspace-blush-strong/40" };
  const group = "px-3 pb-1 pt-5 text-[11px] font-bold uppercase text-sidebar-foreground/45";
  const nav = (
    <>
      {roles.includes("admin") && (
        <>
          <div className={group}>Jobs</div>
          <Link to="/admin" search={{}} className={link} activeProps={active} activeOptions={{ exact: true, includeSearch: true }} onClick={() => setMobileOpen(false)}><LayoutDashboard className="h-4 w-4" /> Pipeline</Link>
          <Link to="/admin/today" className={link} activeProps={active} onClick={() => setMobileOpen(false)}><Sun className="h-4 w-4" /> Today</Link>
          <Link to="/admin/ap-queue" className={link} activeProps={active} onClick={() => setMobileOpen(false)}><ClipboardCheck className="h-4 w-4" /> AP approval queue</Link>
          <Link to="/admin" search={{ tab: "enquiries" }} className={link} activeProps={active} activeOptions={{ exact: true, includeSearch: true }} onClick={() => setMobileOpen(false)}><MailCheck className="h-4 w-4" /> Enquiries</Link>
          <Link to="/admin/enquiry-groups" className={link} activeProps={active} onClick={() => setMobileOpen(false)}><MailCheck className="h-4 w-4" /> Enquiry email groups</Link>
           <Link to="/admin/launch-campaign" className={link} activeProps={active} onClick={() => setMobileOpen(false)}><MailCheck className="h-4 w-4" /> Save my spot follow-ups</Link>
          <Link to="/admin" search={{ tab: "quotes" }} className={link} activeProps={active} activeOptions={{ exact: true, includeSearch: true }} onClick={() => setMobileOpen(false)}><FileCheck2 className="h-4 w-4" /> Pending quote approval</Link>
          <Link to="/admin" search={{ tab: "jobs" }} className={link} activeProps={active} activeOptions={{ exact: true, includeSearch: true }} onClick={() => setMobileOpen(false)}><BriefcaseBusiness className="h-4 w-4" /> Active jobs</Link>
          <Link to="/admin" search={{ tab: "ineligible" }} className={link} activeProps={active} activeOptions={{ exact: true, includeSearch: true }} onClick={() => setMobileOpen(false)}><X className="h-4 w-4" /> Ineligible</Link>
          <Link to="/admin/interests" className={link} activeProps={active} onClick={() => setMobileOpen(false)}><MailCheck className="h-4 w-4" /> Registered interest</Link>
          <Link to="/admin/coverage" className={link} activeProps={active} onClick={() => setMobileOpen(false)}><MapPinned className="h-4 w-4" /> Service coverage</Link>
          <Link to="/admin/team-ups" className={link} activeProps={active} onClick={() => setMobileOpen(false)}><Users className="h-4 w-4" /> Electrician team-ups</Link>
          <div className={group}>People</div>
          <Link to="/admin/businesses" className={link} activeProps={active} onClick={() => setMobileOpen(false)}><BriefcaseBusiness className="h-4 w-4" /> Approved partners</Link>
          <Link to="/admin/electrician-rates" className={link} activeProps={active} onClick={() => setMobileOpen(false)}><Calculator className="h-4 w-4" /> Electrician rates</Link>
          <Link to="/admin/pricing" className={link} activeProps={active} onClick={() => setMobileOpen(false)}><Calculator className="h-4 w-4" /> Prices &amp; margins</Link>
          <Link to="/admin/partners" search={{ enquiry: undefined }} className={link} activeProps={active} onClick={() => setMobileOpen(false)}><ClipboardCheck className="h-4 w-4" /> Partner applications</Link>
          <Link to="/admin/workers" className={link} activeProps={active} onClick={() => setMobileOpen(false)}><Users className="h-4 w-4" /> Staff approvals</Link>
          <Link to="/admin/users" className={link} activeProps={active} onClick={() => setMobileOpen(false)}><Users className="h-4 w-4" /> Users & access</Link>
          <div className={group}>Money</div>
          <Link to="/admin/veec" className={link} activeProps={active} onClick={() => setMobileOpen(false)}><Calculator className="h-4 w-4" /> VEECs</Link>
          <div className={group}>Settings</div>
          <Link to="/admin/compliance" className={link} activeProps={active} onClick={() => setMobileOpen(false)}><FileCheck2 className="h-4 w-4" /> Compliance</Link>
          <Link to="/admin/templates" search={{ cat: "email" }} className={link} activeProps={active} onClick={() => setMobileOpen(false)}><FileCheck2 className="h-4 w-4" /> Templates</Link>
          <Link to="/admin/communications" className={link} activeProps={active} onClick={() => setMobileOpen(false)}><MailCheck className="h-4 w-4" /> Customer communications</Link>
          <Link to="/admin/test-centre" className={link} activeProps={active} onClick={() => setMobileOpen(false)}><FlaskConical className="h-4 w-4" /> Test Centre</Link>
          <a href="/calculator" target="_blank" rel="noopener" className={link}>
             <Calculator className="h-4 w-4" /> Customer calculator <ExternalLink className="ml-auto h-3.5 w-3.5" />
           </a>
          <a href="/electrician-onboarding" target="_blank" rel="noopener" className={link}><ExternalLink className="h-4 w-4" /> REC application form</a>
          <a href="/installer-onboarding" target="_blank" rel="noopener" className={link}><ExternalLink className="h-4 w-4" /> Installer application form</a>
        </>
      )}
      {(roles.includes("electrician") || roles.includes("installer")) && !roles.includes("admin") && <>
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
  if (roles.includes("admin")) return (
    <div className="portal-theme min-h-screen bg-background">
      <OfficeTopBar name={me?.profile?.full_name ?? ""} onSignOut={() => void signOut()} />
      <main className={`mx-auto w-full px-4 pb-24 pt-6 sm:px-[26px] md:pb-10 lg:pt-[26px] ${wide ? "max-w-[1800px]" : "max-w-[1180px]"}`}>{children}</main>
    </div>
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
