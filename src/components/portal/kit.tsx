// Shared portal look (Jo approved 7 Oct 2026, phase 1). Presentation only: these pieces never decide
// workflow, prices or access — pages pass in facts they already have.
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Link, type LinkProps } from "@tanstack/react-router";
import { Plus, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { menuOffset } from "@/lib/portal-presentation.core";
import { Button } from "@/components/ui/button";

/* ---------- Page frame ---------- */
export function PageHeader({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-6 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4">
      <div className="min-w-0">
        <h1 className="font-display text-[30px] font-extrabold leading-[1.14] tracking-[-0.5px] text-ink">{title}</h1>
        {sub && <p className="mt-1.5 text-sm text-sub">{sub}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap justify-end gap-2">{actions}</div>}
    </header>
  );
}

/* ---------- Card / panel ---------- */
export function Panel({ children, className, title, action }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode }) {
  return (
    <section className={cn("rounded-[18px] border border-line bg-paper p-5 shadow-card", className)}>
      {(title || action) && (
        <div className="mb-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          {title && <h3 className="truncate font-display text-base font-semibold text-ink">{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/* ---------- Buttons ---------- */
type BtnTone = "primary" | "secondary" | "navy" | "rose";
const BTN: Record<BtnTone, string> = {
  primary: "bg-hiv-green text-white hover:bg-hiv-green/90",
  secondary: "border border-line bg-paper text-hiv-blue hover:bg-mist",
  navy: "bg-ink text-white hover:bg-ink/90",
  rose: "bg-rose text-white hover:bg-rose/90",
};
export const btnClass = (tone: BtnTone = "primary", className?: string) =>
  cn("inline-flex min-h-[42px] items-center justify-center gap-2 rounded-[10px] px-4 text-[13px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50", BTN[tone], className);

export function Btn({ tone = "primary", className, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: BtnTone }) {
  return <button type="button" {...p} className={btnClass(tone, className)} />;
}

/* ---------- Dropdown menu panel ---------- */
/**
 * The panel under a "More ▾" / "Actions ▾" button. Render it inside the button's `relative` wrapper. It anchors to the
 * button's start edge, flips to the end edge when it would run past the right of the viewport, and is clamped inside
 * the viewport either way, so a button at the left of a phone screen and one at the right both show the whole menu.
 * Presentation only.
 */
export function MenuPanel({ open, onPick, children, className, width = 240 }: { open: boolean; onPick?: () => void; children: ReactNode; className?: string; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [left, setLeft] = useState(0);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const el = ref.current, anchor = el?.parentElement;
      if (!el || !anchor) return;
      const a = anchor.getBoundingClientRect();
      setLeft(menuOffset({ anchorLeft: a.left, anchorWidth: a.width, menuWidth: el.offsetWidth || width, viewportWidth: window.innerWidth }));
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open, width]);
  if (!open) return null;
  return (
    <div ref={ref} role="menu" style={{ left, width }} className={cn("absolute top-[calc(100%+6px)] z-30 max-w-[calc(100vw-16px)] rounded-[14px] border border-line bg-paper p-1 shadow-lg", className)} onClick={onPick}>
      {children}
    </div>
  );
}
/* ---------- Pills ---------- */
export type PillTone = "plain" | "green" | "rose" | "amber";
const PILL: Record<PillTone, string> = { plain: "bg-mist text-hiv-blue", green: "bg-mint text-hiv-green", rose: "bg-pink text-rose", amber: "bg-warning-soft text-foreground" };
/** Green = moving or done, rose = needs attention, plain = waiting. */
export function Pill({ tone = "plain", children, className }: { tone?: PillTone; children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center whitespace-nowrap rounded-[18px] px-2.5 py-0.5 text-[11px] font-semibold", PILL[tone], className)}>{children}</span>;
}

/* ---------- "Now" panel: the current step ---------- */
export type NowPair = { label: string; value: ReactNode };
export function NowPanel({ eyebrow, due, status, next, pairs = [], action, attention = false }: {
  eyebrow: ReactNode; due?: ReactNode; status: ReactNode; next?: ReactNode; pairs?: NowPair[]; action?: ReactNode; attention?: boolean;
}) {
  return (
    <section aria-label="Current step" className={cn("rounded-[19px] border p-[23px]", attention ? "border-rose/25 bg-pink" : "border-mist-line bg-mist")}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <p className={cn("truncate text-[11px] font-semibold uppercase tracking-wide", attention ? "text-rose" : "text-sub")}>{eyebrow}</p>
        {due && <p className={cn("shrink-0 text-xs font-semibold", attention ? "text-rose" : "text-sub")}>{due}</p>}
      </div>
      <h2 className="mt-2 font-display text-[21px] font-bold leading-tight text-ink">{status}</h2>
      {next && <p className="mt-1.5 text-sm text-ink/85">{next}</p>}
      {pairs.length > 0 && (
        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          {pairs.map((p) => <div key={p.label} className="min-w-0"><dt className="text-[11px] font-semibold text-sub">{p.label}</dt><dd className="truncate text-sm font-semibold text-ink">{p.value}</dd></div>)}
        </dl>
      )}
      {action && <div className="mt-5">{action}</div>}
    </section>
  );
}

/* ---------- Stat tiles + segmented filters ---------- */
export function StatTile({ label, value, sub, selected, onClick }: { label: string; value: ReactNode; sub?: ReactNode; selected?: boolean; onClick?: () => void }) {
  return (
    <Button variant="outline" type="button" onClick={onClick} aria-pressed={selected} className={cn("h-auto min-w-0 flex-col items-start whitespace-normal rounded-[14px] border p-4 text-left transition-colors", selected ? "border-mist-line bg-mist" : "border-line bg-paper hover:bg-mist/60")}>
      <span className="block break-words text-xs text-sub">{label}</span>
      <span className="mt-1 block font-display text-[25px] font-bold leading-none text-ink">{value}</span>
      {sub && <span className="mt-1.5 block break-words text-[11px] text-sub">{sub}</span>}
    </Button>
  );
}

export function Segmented<T extends string>({ options, value, onChange, label }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex flex-wrap gap-1 rounded-[11px] bg-mist p-1">
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}
          className={cn("rounded-[8px] border px-3 py-1.5 text-xs font-semibold", o.value === value ? "border-line bg-paper text-ink" : "border-transparent text-sub hover:text-ink")}>{o.label}</button>
      ))}
    </div>
  );
}

/* ---------- Compact list table (stacked cards on phones) ---------- */
export type Cell = { main: ReactNode; sub?: ReactNode };
export type Column = { key: string; label: string; className?: string };
export function ListTable({ columns, rows, empty = "Nothing here right now." }: { columns: Column[]; rows: { id: string; cells: Record<string, Cell>; to?: LinkProps["to"]; params?: Record<string, string> }[]; empty?: ReactNode }) {
  if (!rows.length) return <div className="rounded-[18px] border border-line bg-paper p-6 text-sm text-sub">{empty}</div>;
  const cell = (c?: Cell) => c ? <><span className="block font-semibold text-ink">{c.main}</span>{c.sub && <span className="mt-0.5 block text-xs text-sub">{c.sub}</span>}</> : null;
  return (
    <div className="overflow-hidden rounded-[18px] border border-line bg-paper shadow-card">
      <table className="hidden w-full text-sm md:table">
        <thead className="bg-table-head"><tr>{columns.map((c) => <th key={c.key} scope="col" className={cn("px-[15px] py-2.5 text-left text-[11px] font-semibold text-sub", c.className)}>{c.label}</th>)}</tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.id} className="border-t border-line align-top hover:bg-mist/40">
            {columns.map((c, i) => <td key={c.key} className={cn("px-[15px] py-4", c.className)}>{i === 0 && r.to ? <Link to={r.to} params={r.params as never} className="block hover:underline">{cell(r.cells[c.key])}</Link> : cell(r.cells[c.key])}</td>)}
          </tr>
        ))}</tbody>
      </table>
      <ul className="divide-y divide-line md:hidden">{rows.map((r) => {
        const body = <div className="space-y-2 p-4">{columns.map((c) => <div key={c.key} className="min-w-0"><span className="block text-[11px] font-semibold text-sub">{c.label}</span>{cell(r.cells[c.key])}</div>)}</div>;
        return <li key={r.id}>{r.to ? <Link to={r.to} params={r.params as never} className="block hover:bg-mist/40">{body}</Link> : body}</li>;
      })}</ul>
    </div>
  );
}

/* ---------- Record rows (expandable) ---------- */
export function RecordRow({ title, sub, children, defaultOpen = false }: { title: ReactNode; sub?: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-line first:border-t-0">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3 text-left">
        <span className="min-w-0"><span className="block truncate font-semibold text-ink">{title}</span>{sub && <span className="block truncate text-xs text-sub">{sub}</span>}</span>
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-line text-hiv-blue">{open ? <Minus className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}</span>
      </button>
      {open && <div className="pb-4 text-sm text-ink">{children}</div>}
    </div>
  );
}

/* ---------- Aside, note box, form field ---------- */
/** "People & property": right column on desktop, below on phones. Use inside <WithAside>. */
export function WithAside({ children, aside }: { children: ReactNode; aside: ReactNode }) {
  return <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]"><div className="min-w-0 space-y-5">{children}</div><aside className="min-w-0 space-y-5">{aside}</aside></div>;
}
export function AsidePanel({ title = "People & property", children }: { title?: ReactNode; children: ReactNode }) {
  return <Panel title={title}>{children}</Panel>;
}
export function NoteBox({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-[13px] bg-mist px-4 py-3 text-xs text-sub", className)}>{children}</div>;
}
export const fieldInput = "w-full rounded-[9px] border border-field-line bg-paper px-3 py-[11px] text-sm text-ink placeholder:text-sub/70 focus:outline-none focus:ring-2 focus:ring-hiv-blue/30";
export function Field({ label, htmlFor, children, hint }: { label: string; htmlFor?: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-xs font-semibold text-ink">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-sub">{hint}</p>}
    </div>
  );
}
