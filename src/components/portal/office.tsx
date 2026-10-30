// The office frame (decision 218, approved O1–O7): logo · Needs me · Enquiries · Jobs · Partners · Money · More ▾ ·
// search · initials; on a phone the five headings become bottom tabs. Presentation only — no task polling.
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { clearTradeCache } from "@/lib/trade-cache.client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, LogOut, Search } from "lucide-react";
import { searchOffice } from "@/lib/office.functions";
import { MORE_SECTIONS, OFFICE_HEADINGS, OFFICE_HOME, sectionFor } from "@/config/office-nav";
import { cn } from "@/lib/utils";
import { MenuPanel } from "@/components/portal/kit";
import { useEmailsCount } from "@/components/portal/emails-count";
import logo from "@/assets/home-insulation-victoria-logo.png.asset.json";

/** One search for the whole office: job number, owner or address (top bar, decision 218). */
export function OfficeSearch({ onPick }: { onPick?: (job: { id: string; jobNumber: string }) => void } = {}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const run = useServerFn(searchOffice);
  const { data } = useQuery({ queryKey: ["office-search", q], queryFn: () => run({ data: { q } }), enabled: q.trim().length >= 2 });
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { const h = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); }; document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h); }, []);
  return (
    <div ref={box} className="relative w-full min-w-0">
      <label className="flex h-10 items-center gap-2 rounded-[10px] border border-line bg-mist px-3 text-sm">
        <Search className="h-4 w-4 shrink-0 text-sub" aria-hidden />
        <input aria-label="Find a job, owner or address" placeholder="Find a job, owner or address" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-sub" value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} />
      </label>
      {open && q.trim().length >= 2 && (
        <div className="absolute left-0 right-0 top-11 z-50 max-h-80 overflow-y-auto rounded-[14px] border border-line bg-paper p-1 shadow-lg">
          {!data ? <p className="p-3 text-sm text-sub">Searching…</p> : data.length === 0 ? <p className="p-3 text-sm text-sub">No match.</p> : data.map((r) => onPick ? (
            <button key={r.id ?? r.job_number} type="button" onClick={() => { if (r.id) onPick({ id: r.id, jobNumber: r.job_number ?? "" }); setOpen(false); setQ(""); }} className="block w-full rounded-[10px] px-3 py-2 text-left text-sm hover:bg-mist">
              <span className="font-semibold">{r.job_number}</span> · {r.owner_name ?? "No owner"}<span className="block truncate text-xs text-sub">{r.property_address}{r.source === "qa_test" ? " · TEST" : ""}</span>
            </button>
          ) : (
            <Link key={r.id ?? r.job_number} to="/admin/jobs/$jobId" params={{ jobId: r.id ?? "" }} onClick={() => setOpen(false)} className="block rounded-[10px] px-3 py-2 text-sm hover:bg-mist">
              <span className="font-semibold">{r.job_number}</span> · {r.owner_name ?? "No owner"}<span className="block truncate text-xs text-sub">{r.property_address}{r.source === "qa_test" ? " · TEST" : ""}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function useOutside(open: boolean, close: () => void) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) close(); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open, close]);
  return box;
}

/** More ▾ (decision 218): Communications · Templates · Settings · Test Centre. */
function MoreMenu({ active }: { active: boolean }) {
  const [open, setOpen] = useState(false);
  const box = useOutside(open, () => setOpen(false));
  return (
    <div ref={box} className="relative">
      <button type="button" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(!open)} className={cn("flex items-center gap-1 whitespace-nowrap rounded-[10px] px-3 py-2 text-sm font-semibold", active ? "bg-mist text-ink" : "text-sub hover:text-ink")}>
        More <ChevronDown className="h-4 w-4" aria-hidden />
      </button>
      <MenuPanel open={open} onPick={() => setOpen(false)} width={256} className="z-50">
        {MORE_SECTIONS.map((s) => (
          <div key={s.label}>
            <p className="px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wide text-sub">{s.label}</p>
            {s.tabs.map((t) => <Link role="menuitem" key={t.label} to={t.to} search={(t.search ?? {}) as never} className="block rounded-[10px] px-3 py-2 text-sm hover:bg-mist">{t.label}</Link>)}
          </div>
        ))}
      </MenuPanel>
    </div>
  );
}

/** Initials (decision 218): who is signed in, and Sign out. */
function Initials({ name, onSignOut }: { name: string; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const box = useOutside(open, () => setOpen(false));
  const initials = name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";
  return (
    <div ref={box} className="relative">
      <button type="button" aria-label={`Signed in as ${name || "office user"}`} aria-expanded={open} onClick={() => setOpen(!open)} className="grid h-10 w-10 place-items-center rounded-full bg-ink text-xs font-bold text-white">{initials}</button>
      {open && (
        <div className="absolute right-0 top-12 z-50 w-56 rounded-[14px] border border-line bg-paper p-1 shadow-lg">
          <p className="truncate px-3 py-2 text-sm font-semibold">{name || "Office"}</p>
          <button type="button" onClick={onSignOut} className="flex w-full items-center gap-2 rounded-[10px] px-3 py-2 text-left text-sm hover:bg-mist"><LogOut className="h-4 w-4" aria-hidden /> Sign out</button>
        </div>
      )}
    </div>
  );
}

export function OfficeTopBar({ name, onSignOut }: { name: string; onSignOut: () => void }) {
  const loc = useRouterState({ select: (s) => ({ pathname: s.location.pathname, search: s.location.search as Record<string, unknown> }) });
  const section = sectionFor(loc.pathname, loc.search);
  const emails = useEmailsCount();
  const badge = (key: string) => key === "emails" && emails ? <span className="ml-1 rounded-full bg-red-100 px-1.5 text-[11px] font-semibold text-red-800" aria-label={`${emails} emails waiting`}>{emails}</span> : null;
  return (
    <>
      <header className="sticky top-0 z-40 border-b border-line bg-paper">
        <div className="mx-auto flex max-w-[1216px] items-center gap-4 px-4 py-2.5 sm:px-8">
          <Link to={OFFICE_HOME} className="flex shrink-0 items-center" aria-label="Home Insulation Victoria — Needs me">
            <img src={logo.url} alt="Home Insulation Victoria" className="h-9 w-auto" />
          </Link>
          <nav aria-label="Office" className="hidden min-w-0 items-center gap-1 md:flex">
            {OFFICE_HEADINGS.map((h) => (
              <Link key={h.key} to={h.to} search={(h.search ?? {}) as never} aria-current={section === h.key ? "page" : undefined} className={cn("whitespace-nowrap rounded-[10px] px-3 py-2 text-sm font-semibold", section === h.key ? "bg-mist text-ink" : "text-sub hover:text-ink")}>
                {h.label}{badge(h.key)}
              </Link>
            ))}
            <MoreMenu active={section === "more"} />
          </nav>
          <div className="ml-auto flex min-w-0 items-center gap-2">
            <div className="hidden w-64 lg:block"><OfficeSearch /></div>
            <div className="md:hidden"><MoreMenu active={section === "more"} /></div>
            <Initials name={name} onSignOut={onSignOut} />
          </div>
        </div>
        <div className="border-t border-line px-4 py-2 lg:hidden"><OfficeSearch /></div>
      </header>
      <nav aria-label="Office menu" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper pb-[env(safe-area-inset-bottom)] md:hidden">
        <div className="grid grid-cols-6">
          {OFFICE_HEADINGS.map((h) => (
            <Link key={h.key} to={h.to} search={(h.search ?? {}) as never} aria-current={section === h.key ? "page" : undefined} className={cn("flex min-h-14 flex-col items-center justify-center px-1 text-center text-[11px] font-semibold", section === h.key ? "text-hiv-blue" : "text-sub")}>
              <span>{h.label}{badge(h.key)}</span>
            </Link>
          ))}
        </div>
      </nav>
    </>
  );
}

export function useOfficeSignOut() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    await qc.cancelQueries(); qc.clear(); clearTradeCache(); await supabase.auth.signOut(); navigate({ to: "/auth", replace: true });
  };
}
