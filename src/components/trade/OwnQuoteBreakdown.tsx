// Photo-quote installers Part 2 (Jo 5 Nov 16:44 / 16:50): the owner's price as the standard own-customer rows, read-only.
// The same rows on Add a job's live box and on the installer job page. Long labels wrap; the amount stays right-aligned.
import type { OwnQuoteRow } from "@/lib/own-photo-quote.core";

export function OwnQuoteBreakdown({ rows, note, className = "mt-3" }: { rows: OwnQuoteRow[]; note?: string | null; className?: string }) {
  return (
    <div className={`rounded-[12px] bg-paper p-3 text-[15px] ${className}`} data-own-quote-breakdown>
      {rows.map((r) => (
        <p key={r.label} className={`flex items-start justify-between gap-3 ${r.total ? "mt-1 border-t border-line pt-1 font-bold" : ""}`}>
          <span className="min-w-0 break-words">{r.label}</span><span className="shrink-0 tabular-nums">{r.amount}</span>
        </p>
      ))}
      {note && <p className="mt-2 text-[13px] text-sub">{note}</p>}
    </div>
  );
}
