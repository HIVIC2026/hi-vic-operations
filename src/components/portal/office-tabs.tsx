// Office build B (O5 Partners, O6 Money, O7 Communications / Settings): shared presentation pieces only.
// Tabs live in the URL (?tab=) so a tab can be shared or reloaded; nothing here decides workflow, money or access.
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type OfficeTabDef<T extends string> = { key: T; label: string; count?: number | string | null; why: string };

/** One row of tabs under the page header. `why` is the decision/rule each tab traces to (decision 241), never shown. */
export function OfficeTabs<T extends string>({ tabs, value, onChange, label }: { tabs: OfficeTabDef<T>[]; value: T; onChange: (t: T) => void; label: string }) {
  return (
    <nav aria-label={label} className="mb-5 flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <button key={t.key} type="button" data-why={t.why} aria-current={t.key === value ? "page" : undefined} onClick={() => onChange(t.key)}
          className={cn("-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold", t.key === value ? "border-hiv-blue text-ink" : "border-transparent text-sub hover:text-ink")}>
          {t.label}{t.count != null && t.count !== "" ? <span className="ml-1.5 rounded-full bg-mist px-1.5 text-[11px] text-hiv-blue">{t.count}</span> : null}
        </button>
      ))}
    </nav>
  );
}

/** A plain table in the portal style; horizontal scroll inside the card on phones (never the page). */
export function OfficeTable({ head, children, why, empty, isEmpty }: { head: ReactNode[]; children: ReactNode; why?: string; empty?: ReactNode; isEmpty?: boolean }) {
  if (isEmpty) return <div data-why={why} className="rounded-[18px] border border-line bg-paper p-6 text-sm text-sub">{empty ?? "Nothing here right now."}</div>;
  return (
    <div data-why={why} className="overflow-x-auto rounded-[18px] border border-line bg-paper shadow-card">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="bg-table-head text-left text-[11px] font-semibold text-sub"><tr>{head.map((h, i) => <th key={i} scope="col" className="px-[15px] py-2.5">{h}</th>)}</tr></thead>
        <tbody className="[&>tr]:border-t [&>tr]:border-line [&_td]:px-[15px] [&_td]:py-3 [&_td]:align-top">{children}</tbody>
      </table>
    </div>
  );
}

export function Loading({ what }: { what: string }) {
  return <p role="status" className="rounded-[18px] border border-line bg-paper p-5 text-sm text-sub">Loading {what}…</p>;
}

export function LoadError({ what, error, retry }: { what: string; error: unknown; retry?: () => void }) {
  return (
    <div role="alert" className="rounded-[18px] border border-rose/30 bg-pink p-4 text-sm text-rose">
      {what} couldn't load: {error instanceof Error ? error.message : "unknown error"}. Nothing was changed.
      {retry && <button type="button" className="ml-2 font-semibold underline" onClick={retry}>Try again</button>}
    </div>
  );
}

/** A small caption line under a tab ("212 held · 7 queued …"). */
export function TabCaption({ children, why }: { children: ReactNode; why?: string }) {
  return <p data-why={why} className="mb-3 text-sm text-sub">{children}</p>;
}

export const fmtDay = (iso: string | null | undefined) => iso ? new Date(iso.length === 10 ? `${iso}T12:00:00+11:00` : iso).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "Australia/Melbourne" }) : "—";
export const fmtWhen = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Australia/Melbourne" }) : "—";
export const dollars = (n: number | null | undefined, signed = false) => n == null ? "—" : `${signed && n > 0 ? "+" : n < 0 ? "−" : ""}$${Math.abs(Math.round(n)).toLocaleString("en-AU")}`;
