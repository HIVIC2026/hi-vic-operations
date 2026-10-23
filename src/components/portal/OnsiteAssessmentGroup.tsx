// Jo 23 Oct 2026: holding group, collapsed by default, count only. NOT a to-do list.
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { onsiteAssessmentListFn, onsiteAssessmentOfferFn } from "@/lib/enquiry-groups.functions";

export function OnsiteAssessmentGroup() {
  const list = useServerFn(onsiteAssessmentListFn);
  const offer = useServerFn(onsiteAssessmentOfferFn);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["office-onsite-assessment"], queryFn: () => list(), staleTime: 60_000 });
  const rows = q.data ?? [];
  const send = async (ids: string[]) => {
    if (busy || !ids.length) return;
    if (!confirm(`Send the Save my spot email to ${ids.length} owner${ids.length === 1 ? "" : "s"}? Every usual check runs first.`)) return;
    setBusy(true); setMsg(null);
    try {
      const r = await offer({ data: { jobIds: ids } });
      const sent = r.filter((x) => x.outcome === "sent").length;
      const other = r.filter((x) => x.outcome !== "sent").map((x) => `${x.jobNumber ?? "Job"}: ${x.detail}`);
      setMsg([`${sent} sent.`, ...other].join(" "));
      setPicked(new Set());
      await q.refetch();
    } catch { setMsg("Could not send. Check communication history before trying again."); }
    finally { setBusy(false); }
  };
  return (
    <section aria-label="Needs onsite assessment" className="rounded-md border bg-card">
      <button type="button" className="flex h-12 w-full items-center justify-between px-4 text-left font-semibold" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>Needs onsite assessment ({q.isLoading ? "…" : rows.length})</span>
        <span aria-hidden>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="space-y-2 border-t p-3">
          {q.error && <p role="alert" className="text-sm text-destructive">Could not load this group.</p>}
          {rows.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" disabled={busy || picked.size === 0} onClick={() => send([...picked])}>Offer to selected ({picked.size})</Button>
            </div>
          )}
          {rows.length === 0 && !q.isLoading && <p className="text-sm text-sub">No one here right now.</p>}
          <ul className="divide-y">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <input type="checkbox" className="h-5 w-5" aria-label={`Select ${r.owner ?? r.jobNumber}`} checked={picked.has(r.id)}
                  onChange={(e) => { const n = new Set(picked); if (e.target.checked) n.add(r.id); else n.delete(r.id); setPicked(n); }} />
                <span className="min-w-0 flex-1">
                  <b>{r.owner ?? "Owner"}</b> · {r.suburb ?? "—"} · {r.houseAge} · <span className="text-sub">{r.said}</span>
                </span>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => send([r.id])}>Offer Save my spot</Button>
              </li>
            ))}
          </ul>
          {msg && <p role="status" className="text-sm">{msg}</p>}
        </div>
      )}
    </section>
  );
}
