// Office build B (O5 Partners, O6 Money, O7 Communications / Settings): shared presentation pieces only.
// Tabs live in the URL (?tab=) so a tab can be shared or reloaded; nothing here decides workflow, money or access.
import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type OfficeTabDef<T extends string> = { key: T; label: string; count?: number | string | null; why: string };

/** One row of tabs under the page header. `why` is the decision/rule each tab traces to (decision 241), never shown. */
export function OfficeTabs<T extends string>({ tabs, value, onChange, label, wrapOnPhone = false }: { tabs: OfficeTabDef<T>[]; value: T; onChange: (t: T) => void; label: string; wrapOnPhone?: boolean }) {
  return (
    <nav aria-label={label} className={cn("mb-5 flex gap-1 border-b border-line", wrapOnPhone ? "flex-wrap sm:flex-nowrap sm:overflow-x-auto" : "overflow-x-auto")}>
      {tabs.map((t) => (
        <button key={t.key} type="button" data-why={t.why} aria-current={t.key === value ? "page" : undefined} onClick={() => onChange(t.key)}
          className={cn("-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold", t.key === value ? "border-hiv-blue text-ink" : "border-transparent text-sub hover:text-ink")}>
          {t.label}{t.count != null && t.count !== "" ? <span className="ml-1.5 rounded-full bg-mist px-1.5 text-[11px] text-hiv-blue">{t.count}</span> : null}
        </button>
      ))}
    </nav>
  );
}

/** Phone cards: give each cell its column heading as `data-label` (shown above the value under 640px). The first
 *  column is the card's title, so it gets no label; a full-width row (colSpan) is left as it is. */
function labelCells(children: ReactNode, head: ReactNode[]): ReactNode {
  return Children.map(children, (row) => {
    if (!isValidElement(row) || row.type !== "tr") return row;
    const tr = row as ReactElement<{ children?: ReactNode }>;
    let i = 0;
    const cells = Children.map(tr.props.children, (cell) => {
      if (!isValidElement(cell) || cell.type !== "td") return cell;
      const td = cell as ReactElement<{ colSpan?: number }>;
      const at = i;
      i += td.props.colSpan ?? 1;
      const label = at > 0 && (td.props.colSpan ?? 1) === 1 && typeof head[at] === "string" && head[at] ? (head[at] as string) : undefined;
      return label ? cloneElement(td, { "data-label": label } as Record<string, unknown>) : td;
    });
    return cloneElement(tr, {}, cells);
  });
}

/** A plain table in the portal style; horizontal scroll inside the card on phones (never the page).
 *  `phoneCards` shows each row as a labelled card under 640px instead (design review 27 Oct: nothing cut off). */
export function OfficeTable({ head, children, why, empty, isEmpty, phoneCards = false }: { head: ReactNode[]; children: ReactNode; why?: string; empty?: ReactNode; isEmpty?: boolean; phoneCards?: boolean }) {
  if (isEmpty) return <div data-why={why} className="rounded-[18px] border border-line bg-paper p-6 text-sm text-sub">{empty ?? "Nothing here right now."}</div>;
  return (
    <div data-why={why} className={cn("overflow-x-auto rounded-[18px] border border-line bg-paper shadow-card", phoneCards && "office-cards")}>
      <table className={cn("w-full text-sm", phoneCards ? "sm:min-w-[640px]" : "min-w-[640px]")}>
        <thead className="bg-table-head text-left text-[11px] font-semibold text-sub"><tr>{head.map((h, i) => <th key={i} scope="col" className="px-[15px] py-2.5">{h}</th>)}</tr></thead>
        <tbody className="[&>tr]:border-t [&>tr]:border-line [&_td]:px-[15px] [&_td]:py-3 [&_td]:align-top">{phoneCards ? labelCells(children, head) : children}</tbody>
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
