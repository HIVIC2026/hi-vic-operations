// Shared pieces for O3 Jobs and O4 Enquiries (decisions 225, 226, 227, 228, 286): multi-select filter chips (Jobs),
// sortable column headers, column headings that sort AND filter from a small popover (Enquiries, decision 286), the
// quiet Actions ▾ menu with bulk Cancel, and the reason dialog. Presentation only.
import { useState, type ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { MenuPanel } from "@/components/portal/kit";
import type { SortDir } from "@/lib/office-filters.core";
import type { ListColumn, Range } from "@/lib/enquiry-columns.core";

export function ChipGroup<T extends string>({ label, options, labels, value, onChange }: { label: string; options: readonly T[]; labels: Record<T, string>; value: T[]; onChange: (v: T[]) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={label}>
      <span className="mr-1 text-xs font-bold text-sub">{label}</span>
      {options.map((o) => {
        const on = value.includes(o);
        return <button key={o} type="button" aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])} className={cn("rounded-full border px-3 py-1 text-xs font-semibold", on ? "border-ink bg-ink text-white" : "border-line bg-paper text-sub hover:text-ink")}>{on ? "✓ " : ""}{labels[o]}</button>;
      })}
    </div>
  );
}

export function FilterPanel({ children, note, onClear, active }: { children: ReactNode; note: string; onClear: () => void; active: boolean }) {
  return (
    <div className="mb-3 space-y-2 rounded-[14px] border border-line bg-paper p-3" data-why="decision 225/226: filters on every column, multi-select">
      {children}
      <p className="text-xs text-sub">{note}{active && <> · <button type="button" className="font-semibold text-hiv-blue underline" onClick={onClear}>Clear filters</button></>}</p>
    </div>
  );
}

/** Column header that sorts (every column sortable). */
export function SortHead({ label, k, sort, dir, onSort, className }: { label: string; k: string; sort: string; dir: SortDir; onSort: (k: string, d: SortDir) => void; className?: string }) {
  const on = sort === k;
  return (
    <button type="button" className={cn("text-left text-[11px] font-bold uppercase tracking-wide", on ? "text-ink" : "text-sub hover:text-ink", className)} onClick={() => onSort(k, on && dir === "asc" ? "desc" : "asc")} aria-label={`Sort by ${label}`}>
      {label}{on ? (dir === "asc" ? " ▲" : " ▼") : ""}
    </button>
  );
}

export type ColumnFilterValue = string | Range | string[] | undefined;

/**
 * Decision 286: a column heading that sorts AND filters. Tapping it opens a small popover: sort A→Z / Z→A, then the
 * column's own filter — free text (Job / Owner / Address), min–max (Size / Estimate) or picks (Insulation / Last heard).
 * A filtered heading shows a dot; "Clear" drops just this column's filter.
 */
export function ColumnHead({ col, sort, dir, value, onSort, onFilter, className }: {
  col: ListColumn; sort: string; dir: SortDir; value: ColumnFilterValue; onSort: (k: string, d: SortDir) => void; onFilter: (k: string, v: ColumnFilterValue) => void; className?: string;
}) {
  const on = sort === col.key;
  const active = col.filter === "text" ? !!(value as string | undefined)?.trim() : col.filter === "range" ? (value as Range | undefined)?.min != null || (value as Range | undefined)?.max != null : !!(value as string[] | undefined)?.length;
  const num = (s: string) => (s.trim() === "" ? undefined : Number.isFinite(Number(s)) ? Number(s) : undefined);
  const sortBtn = (d: SortDir, label: string) => <button type="button" className={cn("rounded-[8px] border border-line px-2.5 py-1 text-xs font-semibold", on && dir === d ? "bg-ink text-white" : "bg-paper text-ink")} onClick={() => onSort(col.key, d)}>{label}</button>;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={cn("inline-flex items-center gap-1 text-left text-[11px] font-bold uppercase tracking-wide", on || active ? "text-ink" : "text-sub hover:text-ink", className)} aria-label={`Sort or filter by ${col.label}`}>
          {col.label}{on ? (dir === "asc" ? " ▲" : " ▼") : ""}{active && <span aria-label="filtered" className="inline-block h-1.5 w-1.5 rounded-full bg-hiv-blue" />}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 rounded-[12px] border-line bg-paper p-3 text-sm">
        <div className="mb-2 flex items-center justify-between"><span className="text-xs font-bold uppercase tracking-wide text-sub">{col.label}</span>{active && <button type="button" className="text-xs font-semibold text-hiv-blue underline" onClick={() => onFilter(col.key, undefined)}>Clear</button>}</div>
        <div className="mb-3 flex gap-1.5">{sortBtn("asc", col.sortLabels?.[0] ?? (col.filter === "range" ? "Low → high" : col.filter === "pick" && col.key === "heard" ? "Oldest first" : "A → Z"))}{sortBtn("desc", col.sortLabels?.[1] ?? (col.filter === "range" ? "High → low" : col.filter === "pick" && col.key === "heard" ? "Newest first" : "Z → A"))}</div>
        {col.filter === "text" && <Input value={(value as string | undefined) ?? ""} onChange={(e) => onFilter(col.key, e.target.value || undefined)} placeholder={`Filter ${col.label.toLowerCase()}…`} className="h-9 bg-paper" aria-label={`Filter ${col.label}`} />}
        {col.filter === "range" && (
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs font-semibold text-sub">Min {col.unit}<Input inputMode="numeric" value={(value as Range | undefined)?.min ?? ""} onChange={(e) => onFilter(col.key, { ...((value as Range | undefined) ?? {}), min: num(e.target.value) })} className="mt-1 h-9 bg-paper" /></label>
            <label className="text-xs font-semibold text-sub">Max {col.unit}<Input inputMode="numeric" value={(value as Range | undefined)?.max ?? ""} onChange={(e) => onFilter(col.key, { ...((value as Range | undefined) ?? {}), max: num(e.target.value) })} className="mt-1 h-9 bg-paper" /></label>
          </div>
        )}
        {col.filter === "pick" && (
          <div className="flex flex-wrap gap-1.5">
            {(col.options as readonly string[]).map((o) => {
              const picked = ((value as string[] | undefined) ?? []).includes(o);
              const label = (col.labels as Record<string, string>)[o] ?? o;
              return <button key={o} type="button" aria-pressed={picked} className={cn("rounded-full border px-3 py-1 text-xs font-semibold", picked ? "border-hiv-blue bg-hiv-blue text-white" : "border-line bg-paper text-ink")} onClick={() => { const cur = ((value as string[] | undefined) ?? []); const next = picked ? cur.filter((x) => x !== o) : [...cur, o]; onFilter(col.key, next.length ? next : undefined); }}>{label}</button>;
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export type BulkAction = { key: string; label: string; danger?: boolean; needsSelection?: boolean };
export function ActionsMenu({ actions, selected, onPick }: { actions: BulkAction[]; selected: number; onPick: (key: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button type="button" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(!open)} className="inline-flex min-h-[38px] items-center rounded-[10px] border border-line bg-paper px-3 text-[13px] font-bold text-hiv-blue">Actions ▾{selected ? ` (${selected})` : ""}</button>
      <MenuPanel open={open} onPick={() => setOpen(false)}>
        {selected === 0 && <p className="px-3 py-2 text-xs text-sub">Tick rows first.</p>}
        {actions.map((a) => <button key={a.key} role="menuitem" type="button" disabled={selected === 0} onClick={() => onPick(a.key)} className={cn("block w-full rounded-[10px] px-3 py-2 text-left text-sm hover:bg-mist disabled:opacity-40", a.danger && "text-rose")}>{a.label}{selected ? ` (${selected})` : ""}</button>)}
      </MenuPanel>
    </div>
  );
}

export function ReasonDialog({ open, title, description, action, danger, onOpenChange, run, presets }: { open: boolean; title: string; description: string; action: string; danger?: boolean; onOpenChange: (v: boolean) => void; run: (reason: string) => Promise<boolean>; presets?: string[] }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
        {presets && <div className="flex flex-wrap gap-1.5">{presets.map((p) => <button key={p} type="button" aria-pressed={reason === p} onClick={() => setReason(p)} className={cn("rounded-full border px-3 py-1 text-xs font-semibold", reason === p ? "border-ink bg-ink text-white" : "border-line bg-paper text-sub")}>{p}</button>)}</div>}
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required, kept in the history)" aria-label="Reason" />
        <div className="flex gap-2">
          <button type="button" disabled={busy || reason.trim().length < 3} className={cn("inline-flex min-h-[40px] items-center rounded-[10px] px-4 text-[13px] font-bold text-white disabled:opacity-50", danger ? "bg-rose" : "bg-ink")} onClick={async () => { setBusy(true); try { if (await run(reason.trim())) { setReason(""); onOpenChange(false); } } finally { setBusy(false); } }}>{busy ? "Working…" : action}</button>
          <button type="button" className="inline-flex min-h-[40px] items-center rounded-[10px] border border-line bg-paper px-4 text-[13px] font-bold text-hiv-blue" onClick={() => onOpenChange(false)}>Close</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function Pager({ page, totalPages, total, shown, onPage }: { page: number; totalPages: number; total: number; shown: number; onPage: (p: number) => void }) {
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-sub">
      <span>Showing {shown} of {total.toLocaleString("en-AU")}</span>
      <span className="flex gap-3">
        {page > 1 && <button type="button" className="font-semibold text-hiv-blue" onClick={() => onPage(page - 1)}>‹ previous page</button>}
        {page < totalPages && <button type="button" className="font-semibold text-hiv-blue" onClick={() => onPage(page + 1)}>next page ›</button>}
      </span>
    </div>
  );
}

export const heardLabel = (at: string | null, channel: string | null) => {
  if (!at) return "Never";
  const d = new Date(at);
  const mel = (x: Date) => x.toLocaleDateString("en-CA", { timeZone: "Australia/Melbourne" });
  const now = new Date();
  const yest = new Date(now.getTime() - 86_400_000);
  const when = mel(d) === mel(now) ? `Today ${d.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", timeZone: "Australia/Melbourne" })}` : mel(d) === mel(yest) ? "Yesterday" : d.toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "Australia/Melbourne" });
  return `${when}${channel ? ` · ${channel}` : ""}`;
};
