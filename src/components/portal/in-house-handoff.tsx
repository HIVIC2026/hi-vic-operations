import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { allocateInHouseBatch, getInHouseBatches } from "@/lib/in-house-batch.functions";
import { readyInHouseBatch } from "@/lib/in-house-batch.core";

/** Same admin boundary and guarded batch writer as the legacy in-house page. */
export function InHouseHandoff() {
  const load = useServerFn(getInHouseBatches);
  const send = useServerFn(allocateInHouseBatch);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["in-house-batches"], queryFn: () => load() });
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  async function give(businessId: string, jobIds: string[]) {
    if (busy) return;
    setBusy(businessId); setNotice("");
    try {
      const result = await send({ data: { businessId, jobIds } });
      setNotice(result.refused.length ? result.refused.map(r => r.reason).join("; ") : `${result.sent.length} jobs allocated.`);
      await qc.invalidateQueries();
    } catch (e) { setNotice(e instanceof Error ? e.message : "Allocation could not be saved."); }
    finally { setBusy(null); }
  }
  return <section aria-label="In-house installers" className="mb-6 border-b border-line pb-4">
    <h2 className="font-display text-lg font-semibold text-ink">In-house installers</h2>
    {notice && <p role="status" className="mt-2 text-sm text-ink">{notice}</p>}
    {q.isError ? <p role="alert" className="mt-2 text-sm text-danger">{q.error instanceof Error ? q.error.message : "Installers could not be loaded."}</p> : !q.data ? <p className="text-sm text-sub">Loading installers…</p> :
      <ul className="divide-y divide-line">{q.data.partners.map(partner => {
        const waiting = q.data.suggestions.find(g => g.businessId === partner.id)?.jobIds ?? [];
        const ready = readyInHouseBatch(waiting);
        return <li key={partner.id} className="py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><p className="font-semibold text-ink">{partner.name}</p><p className="text-sm text-sub">{waiting.length} waiting</p></div>
            <Button disabled={!!busy || ready.length === 0} onClick={() => void give(partner.id, ready)}>{busy === partner.id ? "Allocating…" : `Give 5 jobs to ${partner.name}`}</Button>
          </div>
          <ul className="mt-2 text-sm text-sub">{ready.map(id => { const job = q.data.jobs.find(j => j.id === id); return <li key={id}>{job?.job_number} · {job?.address}</li>; })}</ul>
        </li>;
      })}</ul>}
  </section>;
}