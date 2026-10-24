// O3 Jobs piles (decision 224): "Ready Checks started in Mitti" (Mitti-first pickup rule) and "Mitti sync problems".
// Moved unchanged from the old Active jobs workspace; same query keys, so Needs me's fold shares the cache.
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getMittiPickups, linkMittiPickup, getMittiSyncProblems, retryMittiSyncFn } from "@/lib/mitti-pickup.functions";
import { pickupLabel } from "@/lib/mitti-pickup.core";

/** Ready Checks an installer started straight in Mitti (no portal job yet) — office links each one. */
export function MittiPickupsToLink() {
  const fetchRows = useServerFn(getMittiPickups);
  const link = useServerFn(linkMittiPickup);
  const { data, isPending, isError, error, refetch } = useQuery({ queryKey: ["mitti-pickups"], queryFn: () => fetchRows(), staleTime: 60_000, retry: 1 });
  const [busy, setBusy] = useState<string | null>(null);
  const [jobNumber, setJobNumber] = useState<Record<string, string>>({});
  const [result, setResult] = useState<Record<string, { ok: string } | { err: string }>>({});
  const act = async (auditId: string) => {
    setBusy(auditId); setResult((r) => ({ ...r, [auditId]: { err: "" } as { err: string } }));
    try {
      const out = await link({ data: { auditId, jobId: (jobNumber[auditId] ?? "").trim() } });
      setResult((r) => ({ ...r, [auditId]: { ok: `Linked to ${out.jobNumber}. ${out.issues.length ? `Sync notes: ${out.issues.join(" · ")}` : "Answers synced."}` } }));
      await refetch();
    } catch (e) { setResult((r) => ({ ...r, [auditId]: { err: e instanceof Error ? e.message : "Linking failed." } })); }
    finally { setBusy(null); }
  };
  if (isError) return (
    <section aria-label="Ready Checks started in Mitti" className="rounded-md border-2 border-warning/40 bg-card p-4">
      <h2 className="font-display text-lg font-bold">Ready Checks started in Mitti</h2>
      <p role="alert" className="mt-2 text-sm">Mitti could not be checked. <Button variant="link" onClick={() => refetch()}>Try again</Button> <span className="text-xs">{(error as Error)?.message}</span></p>
    </section>
  );
  const rows = data?.rows ?? [];
  if (isPending || !rows.length) return null;
  return (
    <section aria-label="Ready Checks started in Mitti" className="rounded-md border-2 border-warning/50 bg-card p-4">
      <h2 className="font-display text-lg font-bold">Ready Checks started in Mitti <span className="ml-1 rounded-full bg-warning px-2 py-0.5 text-sm text-warning-foreground">{rows.length}</span></h2>
      <p className="mt-1 text-sm text-sub">Started in Mitti without a portal job. Enter the job number to link the form — its answers then sync onto the job. Nothing is sent to anyone.</p>
      <ul className="mt-2 divide-y">
        {rows.map((r) => {
          const res = result[r.auditId];
          return (
            <li key={r.auditId} className="py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold">{pickupLabel(r)}</p>
                  <p className="text-sm text-sub">
                    {r.business ? `${r.business.name} · ` : "Mitti user not matched · "}
                    {r.templateKind === "hivic_form" ? "Home Insulation Victoria form" : "Installer form"} · checked {r.modifiedAt ? r.modifiedAt.slice(0, 10) : "—"}
                    {r.assessorName ? ` · assessor ${r.assessorName}` : ""}
                  </p>
                  {r.duplicates.length > 0 && (
                    <p className="text-sm font-semibold text-warning">Possible duplicate — {r.duplicates.map((d) => `${d.jobNumber} (${d.owner ?? "unknown owner"})`).join(", ")}. Check before linking; linking never blocks.</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    aria-label={`Job number for Mitti form ${r.mittiRef ?? r.auditId}`}
                    placeholder="HV number"
                    value={jobNumber[r.auditId] ?? ""}
                    onChange={(e) => setJobNumber((m) => ({ ...m, [r.auditId]: e.target.value }))}
                    className="h-10 w-32"
                  />
                  <Button size="sm" className="h-10" disabled={busy === r.auditId} onClick={() => act(r.auditId)}>{busy === r.auditId ? "Linking…" : "Link to job"}</Button>
                </div>
              </div>
              {res && "ok" in res && <p role="status" className="text-sm text-success">{res.ok}</p>}
              {res && "err" in res && res.err && <p role="alert" className="text-sm text-danger">{res.err}</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Jobs whose Mitti sync last failed — one Retry per job; the same guarded sync runs again. */
export function MittiSyncProblems() {
  const fetchRows = useServerFn(getMittiSyncProblems);
  const retry = useServerFn(retryMittiSyncFn);
  const { data, refetch } = useQuery({ queryKey: ["mitti-sync-problems"], queryFn: () => fetchRows(), staleTime: 60_000 });
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, string>>({});
  const rows = data?.rows ?? [];
  if (!rows.length) return null;
  const act = async (jobId: string) => {
    setBusy(jobId);
    try {
      const out = await retry({ data: { jobId } });
      setDone((d) => ({ ...d, [jobId]: out.issues.length ? `Retried ${out.jobNumber}. Sync notes: ${out.issues.join(" · ")}` : `Retried ${out.jobNumber}. Synced.` }));
      await refetch();
    } catch (e) { setDone((d) => ({ ...d, [jobId]: e instanceof Error ? e.message : "Retry failed." })); }
    finally { setBusy(null); }
  };
  return (
    <section aria-label="Mitti sync problems" className="rounded-md border-2 border-destructive/50 bg-card p-4">
      <h2 className="font-display text-lg font-bold">Mitti sync problems <span className="ml-1 rounded-full bg-destructive px-2 py-0.5 text-sm text-destructive-foreground">{rows.length}</span></h2>
      <p className="mt-1 text-sm text-sub">The last Mitti sync for these jobs failed. Retry runs the same sync again — it never completes anything or sends anything.</p>
      <ul className="mt-2 divide-y">
        {rows.map((r) => (
          <li key={r.jobId} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <div className="min-w-0">
              <p className="font-semibold">{r.jobNumber} · {r.owner ?? "Owner"}{r.address ? ` · ${r.address}` : ""}</p>
              <p className="text-sm text-danger">{r.message}</p>
              {done[r.jobId] && <p role="status" className="text-sm text-sub">{done[r.jobId]}</p>}
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="h-10" disabled={busy === r.jobId} onClick={() => act(r.jobId)}>{busy === r.jobId ? "Retrying…" : "Retry"}</Button>
              <Button asChild size="sm" className="h-10"><Link to="/admin/jobs/$jobId" params={{ jobId: r.jobId }}>Open job</Link></Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
