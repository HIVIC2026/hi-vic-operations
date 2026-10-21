import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, LogOut, Search } from "lucide-react";
import { getJobRightNow, searchOffice } from "@/lib/office.functions";
import { MORE_SECTIONS, OFFICE_HEADINGS, OFFICE_TOOLS, sectionFor } from "@/lib/office-nav";
import { OFFICE_STAGES, timeLeft } from "@/lib/office-status.core";
import { aud } from "@/lib/workflow";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import logo from "@/assets/home-insulation-victoria-logo.png.asset.json";

const HEADINGS = OFFICE_HEADINGS;

function OfficeSearch() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const run = useServerFn(searchOffice);
  const { data } = useQuery({ queryKey: ["office-search", q], queryFn: () => run({ data: { q } }), enabled: q.trim().length >= 2 });
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { const h = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); }; document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h); }, []);
  return (
    <div ref={box} className="relative w-full min-w-0 md:max-w-xs">
      <label className="flex h-10 items-center gap-2 rounded-full border bg-card px-3 text-sm">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input aria-label="Find a job, owner or address" placeholder="Find a job, owner or address" className="min-w-0 flex-1 bg-transparent outline-none" value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} />
      </label>
      {open && q.trim().length >= 2 && (
        <div className="absolute left-0 right-0 top-11 z-50 max-h-80 overflow-y-auto rounded-[18px] border bg-card p-1 shadow-lg">
          {!data ? <p className="p-3 text-sm text-muted-foreground">Searching…</p> : data.length === 0 ? <p className="p-3 text-sm text-muted-foreground">No match.</p> : data.map((r) => (
            <Link key={r.id ?? r.job_number} to="/admin/jobs/$jobId" params={{ jobId: r.id ?? "" }} onClick={() => setOpen(false)} className="block rounded-xl px-3 py-2 text-sm hover:bg-workspace-mist">
              <span className="font-semibold">{r.job_number}</span> · {r.owner_name ?? "No owner"}<span className="block truncate text-xs text-muted-foreground">{r.property_address}{r.source === "qa_test" ? " · TEST" : ""}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function AvatarMenu({ name, onSignOut }: { name: string; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { const h = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); }; document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h); }, []);
  const initials = name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";
  const item = "block rounded-xl px-3 py-2 text-sm hover:bg-workspace-mist";
  return (
    <div ref={box} className="relative">
      <Button variant="outline" type="button" aria-label="More and account" aria-expanded={open} onClick={() => setOpen(!open)} className="flex h-10 items-center gap-1 rounded-full border bg-card pl-1 pr-2"><span className="grid h-8 w-8 place-items-center rounded-full bg-workspace-blush text-xs font-bold text-foreground">{initials}</span><span className="text-xs">More</span><ChevronDown className="h-4 w-4 text-muted-foreground" /></Button>
      {open && (
        <div className="absolute right-0 top-11 z-50 max-h-[75vh] w-72 overflow-y-auto rounded-lg border bg-card p-1 shadow-lg" onClick={() => setOpen(false)}>
          <p className="px-3 pb-1 pt-2 text-xs font-bold text-muted-foreground">Office tools</p>
          {OFFICE_TOOLS.map((t) => <Link key={t.label} to={t.to} search={(t.search ?? {}) as never} className={item}>{t.label}</Link>)}
          {MORE_SECTIONS.map((section) => (
            <div key={section.label}>
              <p className="px-3 pb-1 pt-2 text-xs font-bold text-muted-foreground">{section.label}</p>
              {section.tabs.map((t) => <Link key={t.label} to={t.to} search={(t.search ?? {}) as never} className={item}>{t.label}</Link>)}
            </div>
          ))}
          <p className="px-3 pb-1 pt-3 text-xs font-bold text-muted-foreground">Public forms</p>
          <a href="/calculator" target="_blank" rel="noopener" className={item}>Customer calculator</a>
          <a href="/electrician-onboarding" target="_blank" rel="noopener" className={item}>Electrician application form</a>
          <a href="/installer-onboarding" target="_blank" rel="noopener" className={item}>Installer application form</a>
          <Button variant="ghost" type="button" onClick={onSignOut} className={cn(item, "mt-1 flex w-full items-center gap-2 border-t text-left")}><LogOut className="h-4 w-4" /> Sign out</Button>
        </div>
      )}
    </div>
  );
}

/** Phase-3 office navigation: no legacy task polling; existing tools live in More. */
export function OfficeTopBar({ name, onSignOut }: { name: string; onSignOut: () => void }) {
  const loc = useRouterState({ select: (s) => ({ pathname: s.location.pathname, search: s.location.search as Record<string, unknown> }) });
  const section = sectionFor(loc.pathname, loc.search);
  return (
    <>
      <header className="sticky top-0 z-40 border-b border-line bg-paper">
        <div className="mx-auto grid max-w-[1180px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 px-4 py-2.5 sm:px-[26px]">
          <Link to="/admin/enquiries" className="flex min-w-0 shrink-0 items-center gap-2" aria-label="Home Insulation Victoria — Enquiries">
            <img src={logo.url} alt="Home Insulation Victoria" className="h-9 w-auto shrink-0" />
          </Link>
          <nav aria-label="Office" className="hidden min-w-0 items-center gap-1 overflow-x-auto md:flex">
            {HEADINGS.map((h) => (
              <Link key={h.key} to={h.to} search={(h.search ?? {}) as never} aria-current={section === h.key ? "page" : undefined} className={cn("flex items-center gap-1.5 whitespace-nowrap rounded-[10px] px-3 py-2 text-sm font-semibold", section === h.key ? "bg-mist text-ink" : "text-sub hover:text-ink")}>
                {h.label}
              </Link>
            ))}
          </nav>
          <div className="col-start-3 flex min-w-0 items-center justify-end gap-2"><div className="hidden lg:block lg:w-64"><OfficeSearch /></div><AvatarMenu name={name} onSignOut={onSignOut} /></div>
        </div>
        <div className="border-t border-line px-4 py-2 lg:hidden"><OfficeSearch /></div>
      </header>
      <nav aria-label="Office menu" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper pb-[env(safe-area-inset-bottom)] md:hidden">
        <div className="grid grid-cols-5">
          {HEADINGS.map((h) => (
            <Link key={h.key} to={h.to} search={(h.search ?? {}) as never} aria-current={section === h.key ? "page" : undefined} className={cn("flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 text-center text-[10px] font-semibold", section === h.key ? "text-hiv-blue" : "text-sub")}>
              <span className="flex items-center gap-1">{h.label}</span>
            </Link>
          ))}
        </div>
      </nav>
    </>
  );
}

/** Six-step tracker: done / now / next. */
export function StageTracker({ current }: { current: string | null }) {
  const idx = OFFICE_STAGES.findIndex((s) => s.key === current);
  return (
    <ol className="mb-4 grid grid-cols-6 gap-1" aria-label="Job stages">
      {OFFICE_STAGES.map((s, i) => {
        const state = current === "ended" ? "done" : i < idx ? "done" : i === idx ? "now" : "next";
        return (
          <li key={s.key} aria-current={state === "now" ? "step" : undefined} className="min-w-0">
            <div className={cn("h-2 rounded-full", state === "done" ? "bg-success" : state === "now" ? "bg-primary" : "bg-border")} />
            <div className={cn("mt-1 truncate text-[11px] font-semibold sm:text-xs", state === "now" ? "text-foreground" : "text-muted-foreground")}>{state === "done" ? <Check className="mr-0.5 inline h-3 w-3" /> : null}{s.label}</div>
          </li>
        );
      })}
    </ol>
  );
}

const WAIT_LABEL: Record<string, string> = { Us: "Waiting on Home Insulation Victoria", Owner: "Waiting on the owner", Installer: "Waiting on the installer", Electrician: "Waiting on the electrician", "Owner + Installer": "Waiting on the owner and installer", "Owner + Electrician": "Waiting on the owner and electrician", System: "Happening automatically", Nobody: "Nothing waiting" };

/** "Right now" card + tracker + money side panel for the office job page. */
export function JobRightNow({ jobId, people }: { jobId: string; people: { owner: string | null; ownerPhone: string | null; ownerEmail: string | null; installer: string | null; electrician: string | null } }) {
  const load = useServerFn(getJobRightNow);
  const { data, error } = useQuery({ queryKey: ["job-right-now", jobId], queryFn: () => load({ data: { jobId } }) });
  if (error) return <div role="alert" className="mb-4 rounded-[22px] border border-danger/40 bg-danger-soft p-4 text-sm text-danger">Couldn't work out this job's status: {(error as Error).message}</div>;
  if (!data) return <p className="mb-4 text-sm text-muted-foreground">Working out where this job is…</p>;
  const s = data.status;
  const since = s ? new Date(s.since).getTime() : 0, due = s?.dueAt ? new Date(s.dueAt).getTime() : null;
  const pct = due && due > since ? Math.min(100, Math.max(0, ((data.now - since) / (due - since)) * 100)) : null;
  const card = "rounded-[22px] border bg-card p-5 shadow-sm";
  return (
    <>
      <StageTracker current={s?.stage ?? null} />
      <div className="mb-4 grid items-start gap-4 lg:grid-cols-[1fr_300px]">
        <section className={cn(card, s?.late && "border-workspace-blush-strong")} aria-label="Right now">
          <p className="text-xs font-bold text-muted-foreground">Right now</p>
          <h2 className="mt-1 font-display text-xl font-extrabold">{s ? s.label : "No status — check this job"}{s?.detail ? <span className="font-sans text-base font-semibold text-muted-foreground"> · {s.detail}</span> : null}</h2>
          {s && <p className="mt-1 text-sm">{WAIT_LABEL[s.waitingOn]}{s.dueAt ? ` · ${timeLeft(s.dueAt, data.now)}` : ""}</p>}
          {pct != null && <div className="mt-3 h-2 overflow-hidden rounded-full bg-border" aria-label="Time used"><div className={cn("h-full rounded-full", s?.late ? "bg-workspace-blush-strong" : pct > 75 ? "bg-warning" : "bg-success")} style={{ width: `${pct}%` }} /></div>}
          {data.why && <p className="mt-3 rounded-xl bg-workspace-blush px-3 py-2 text-sm"><strong>Why it needs you:</strong> {data.why}</p>}
          {data.failures.map((f) => <p key={f} className="mt-2 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{f}</p>)}
        </section>
        <aside className="grid gap-4">
          <section className={card} aria-label="People">
            <p className="text-xs font-bold text-muted-foreground">People</p>
            <dl className="mt-2 grid gap-2 text-sm">
              <div><dt className="text-xs text-muted-foreground">Owner</dt><dd className="font-semibold">{people.owner ?? "—"}</dd>{people.ownerPhone && <dd><a className="text-primary underline" href={`tel:${people.ownerPhone}`}>{people.ownerPhone}</a></dd>}{people.ownerEmail && <dd className="truncate"><a className="text-primary underline" href={`mailto:${people.ownerEmail}`}>{people.ownerEmail}</a></dd>}</div>
              <div><dt className="text-xs text-muted-foreground">Installer</dt><dd className="font-semibold">{people.installer ?? "Not yet"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Electrician</dt><dd className="font-semibold">{people.electrician ?? "Not yet"}</dd></div>
            </dl>
          </section>
          <section className={card} aria-label="Money">
            <p className="text-xs font-bold text-muted-foreground">Money</p>
            <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
              <div><dt className="text-xs text-muted-foreground">Estimated rebate</dt><dd className="font-semibold">{data.money.rebate != null ? aud(data.money.rebate) : "—"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Owner pays</dt><dd className="font-semibold">{data.money.ownerPays != null ? aud(data.money.ownerPays) : "—"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Paid so far</dt><dd className="font-semibold">{data.money.paid != null ? aud(data.money.paid) : "—"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Our margin</dt><dd className="font-semibold">{data.money.margin != null ? aud(data.money.margin) : "—"}</dd></div>
            </dl>
          </section>
        </aside>
      </div>
    </>
  );
}

export function useOfficeSignOut() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    await qc.cancelQueries(); qc.clear(); await supabase.auth.signOut(); navigate({ to: "/auth", replace: true });
  };
}
