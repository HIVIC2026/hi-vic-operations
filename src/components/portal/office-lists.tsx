// Shared pieces for O3 Jobs and O4 Enquiries (decisions 225, 226, 227, 228): multi-select filter chips on every
// column, sortable column headers, the quiet Actions ▾ menu with bulk Cancel, and the reason dialog. Presentation only.
import { useState, type ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { SortDir } from "@/lib/office-filters.core";

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

export type BulkAction = { key: string; label: string; danger?: boolean; needsSelection?: boolean };
export function ActionsMenu({ actions, selected, onPick }: { actions: BulkAction[]; selected: number; onPick: (key: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button type="button" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(!open)} className="inline-flex min-h-[38px] items-center rounded-[10px] border border-line bg-paper px-3 text-[13px] font-bold text-hiv-blue">Actions ▾{selected ? ` (${selected})` : ""}</button>
      {open && (
        <div role="menu" className="absolute right-0 top-11 z-30 w-60 rounded-[14px] border border-line bg-paper p-1 shadow-lg" onClick={() => setOpen(false)}>
          {selected === 0 && <p className="px-3 py-2 text-xs text-sub">Tick rows first.</p>}
          {actions.map((a) => <button key={a.key} role="menuitem" type="button" disabled={selected === 0} onClick={() => onPick(a.key)} className={cn("block w-full rounded-[10px] px-3 py-2 text-left text-sm hover:bg-mist disabled:opacity-40", a.danger && "text-rose")}>{a.label}{selected ? ` (${selected})` : ""}</button>)}
        </div>
      )}
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
