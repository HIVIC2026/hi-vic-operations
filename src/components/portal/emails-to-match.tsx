// Enquiries "Emails to match" (Jo 26 Oct 2026): emails that couldn't be matched to a job, with the best guess,
// Match / Not a customer and Review and match all — the same audited actions Needs me used before.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getUnmatchedEmailRows } from "@/lib/email-office.functions";
import { bulkMatchable } from "@/lib/needs-cards.core";
import { ageLabel } from "@/lib/office-needs.core";
import { BulkMatch, EmailActions } from "@/components/portal/email-match";

export function EmailsToMatch() {
  const load = useServerFn(getUnmatchedEmailRows);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["enquiries-emails-to-match"], queryFn: () => load(), staleTime: 30_000 });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["enquiries-emails-to-match"] });
  if (q.isPending) return null;
  if (q.isError) return <div role="alert" className="mb-4 rounded-[14px] border border-danger/40 bg-danger-soft p-3 text-sm">Emails to match could not load. <button type="button" className="font-semibold underline" onClick={() => void q.refetch()}>Try again</button></div>;
  const rows = q.data ?? [];
  if (!rows.length) return null;
  const now = Date.now();
  return (
    <details className="mb-4 overflow-hidden rounded-[14px] border border-line bg-paper" aria-label="Emails to match">
      <summary className="cursor-pointer bg-mist px-4 py-3 font-display text-base font-bold text-ink">Emails to match ({rows.length})</summary>
      <BulkMatch rows={bulkMatchable(rows)} onDone={refresh} />
      <ul>
        {rows.map((row) => (
          <li key={row.key} className="grid gap-2 border-b border-line px-4 py-3 last:border-b-0">
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="shrink-0 text-[11px] font-bold uppercase tracking-wide text-sub">Unmatched email</span>
              <span className="ml-auto shrink-0 text-xs text-sub">{ageLabel(row.since, now)}</span>
            </span>
            <span className="block min-w-0 break-words text-sm text-ink">{row.line}</span>
            <EmailActions row={row} onDone={refresh} matchTone="secondary" />
          </li>
        ))}
      </ul>
    </details>
  );
}
