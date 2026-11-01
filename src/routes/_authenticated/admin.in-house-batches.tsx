import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Send } from "lucide-react";
import { AppShell } from "@/components/portal/AppShell";
import { PageHeader } from "@/components/portal/kit";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { allocateInHouseBatch, getInHouseBatches } from "@/lib/in-house-batch.functions";
import { readyInHouseBatch } from "@/lib/in-house-batch.core";

const batchesQuery = queryOptions({ queryKey: ["in-house-batches"], queryFn: () => getInHouseBatches() });
export const Route = createFileRoute("/_authenticated/admin/in-house-batches")({
  loader: ({ context }) => context.queryClient.ensureQueryData(batchesQuery),
  head: () => ({ meta: [
    { title: "In-house batches — Home Insulation Victoria Office" },
    { name: "description", content: "Allocate saved Ready Check jobs to in-house partners." },
    { property: "og:title", content: "In-house batches — Home Insulation Victoria Office" },
    { property: "og:description", content: "Office allocation of saved Ready Check jobs." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
    { name: "robots", content: "noindex, nofollow" },
  ] }),
  errorComponent: ({ error }) => <AppShell><PageHeader title="In-house batches" /><p role="alert" className="text-destructive">{error instanceof Error ? error.message : "Batches could not be loaded."}</p></AppShell>,
  component: BatchAllocationPage,
});
function BatchAllocationPage() {
  const query = useSuspenseQuery(batchesQuery);
  const send = useServerFn(allocateInHouseBatch);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [refused, setRefused] = useState<{ jobId: string; reason: string }[]>([]);
  const [notice, setNotice] = useState("");
  const { jobs, partners, suggestions } = query.data;
  async function allocate(businessId: string, jobIds: string[]) {
    setBusy(businessId); setNotice(""); setRefused([]);
    try {
      const result = await send({ data: { businessId, jobIds } });
      setRefused(result.refused);
      setNotice(`${result.sent.length} jobs allocated.`);
      setSelected(previous => new Set([...previous].filter(id => !result.sent.includes(id))));
      await query.refetch();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Allocation could not be saved."); }
    finally { setBusy(null); }
  }
  return <AppShell>
    <PageHeader title="In-house batches" />
    {notice && <p role="status" className="mb-4 text-sm text-ink">{notice}</p>}
    {refused.length > 0 && <section aria-label="Not allocated" className="mb-6 border-l-2 border-destructive pl-4"><h2 className="font-semibold text-ink">Not allocated</h2><ul className="mt-2 space-y-2 text-sm text-destructive">{refused.map(r => <li key={r.jobId}>{jobs.find(j => j.id === r.jobId)?.job_number ?? r.jobId}: {r.reason}</li>)}</ul></section>}
    {suggestions.length === 0 && <p className="text-sm text-sub">No saved spots match an available in-house partner.</p>}
    {suggestions.map(group => {
      const partner = partners.find(p => p.id === group.businessId);
      const checkedIds = group.jobIds.filter(id => selected.has(id));
      return <section key={group.businessId} className="mb-8 border-b border-line pb-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-xl font-semibold text-ink">{partner?.name}</h2>
          <Button disabled={busy !== null || checkedIds.length < 5} onClick={() => void allocate(group.businessId, readyInHouseBatch(checkedIds))} className="h-auto min-h-11 max-w-full whitespace-normal"><Send className="size-4 shrink-0" />{busy === group.businessId ? "Allocating…" : `Send to ${partner?.name ?? "partner"}`}</Button>
        </div>
        <ul className="divide-y divide-line">{group.jobIds.map(id => {
          const job = jobs.find(j => j.id === id);
          return <li key={id}><label className="flex min-h-14 cursor-pointer items-center gap-3 py-3">
            <Checkbox checked={selected.has(id)} disabled={busy !== null} aria-label={`Select ${job?.job_number ?? id}`} onCheckedChange={checked => setSelected(previous => { const next = new Set(previous); if (checked === true) next.add(id); else next.delete(id); return next; })} />
            <span className="min-w-0"><span className="block text-sm font-semibold text-ink">{job?.job_number}</span><span className="block break-words text-sm text-sub">{job?.address}</span></span>
          </label></li>;
        })}</ul>
      </section>;
    })}
  </AppShell>;
}