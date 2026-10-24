// "Who's doing this" (decision 161): the business owner picks the staff member for each visit on the installer job screen.
// Presentation only — eligibility, the event and the Mitti hand-over all happen on the server.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Section } from "@/components/trade/trade-ui";
import { allocateVisitFn, getVisitAllocation } from "@/lib/visit-allocation.functions";

export function WhosDoingThis({ jobId }: { jobId: string }) {
  const load = useServerFn(getVisitAllocation);
  const allocate = useServerFn(allocateVisitFn);
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["visit-allocation", jobId], queryFn: () => load({ data: { jobId } }), retry: false });
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Record<string, string>>({});
  if (!data || !data.visits.length) return null;
  return (
    <>
      {data.visits.map((v) => (
        <Section key={v.kind} title={`Who's doing this · ${v.label}`}>
          <p className="text-sm">{v.current ? <>Allocated to <span className="font-bold">{v.current.name}</span>.</> : "Not allocated yet – it's on the business owner."}</p>
          {!v.hasForm && <p className="mt-1 text-xs text-sub">No Mitti form for this visit yet. The allocation is saved; the form is handed over in Mitti when you allocate once it exists.</p>}
          {data.canAllocate && (
            <ul className="mt-3 divide-y divide-line rounded-[12px] border border-line">
              {v.options.map((o) => {
                const picked = v.current?.workerId === o.workerId;
                return (
                  <li key={o.workerId} className="flex flex-wrap items-center justify-between gap-2 p-3">
                    <span className="min-w-0">
                      <span className={o.allowed ? "block font-semibold" : "block font-semibold text-sub"}>{o.name}{picked ? " · allocated" : ""}</span>
                      {o.reason && <span className="block text-xs text-sub">{o.reason}</span>}
                      {o.note && <span className="block text-xs text-sub">{o.note}</span>}
                    </span>
                    <button type="button" disabled={!o.allowed || picked || busy === `${v.kind}:${o.workerId}`}
                      className="h-10 shrink-0 rounded-[10px] border-2 border-estimate-blue px-3 text-sm font-bold text-estimate-blue disabled:opacity-40"
                      onClick={async () => {
                        const key = `${v.kind}:${o.workerId}`;
                        setBusy(key);
                        try {
                          const r = await allocate({ data: { jobId, kind: v.kind, workerId: o.workerId } });
                          setMsg((m) => ({ ...m, [v.kind]: r.form === "reassigned" ? `${r.name} now has the Mitti form.` : `${r.name} allocated. The Mitti form isn't created yet.` }));
                          await qc.invalidateQueries({ queryKey: ["visit-allocation", jobId] });
                        } catch (e) { setMsg((m) => ({ ...m, [v.kind]: (e as Error).message })); }
                        finally { setBusy(null); }
                      }}>
                      {busy === `${v.kind}:${o.workerId}` ? "Saving…" : picked ? "Allocated" : "Allocate"}
                    </button>
                  </li>
                );
              })}
              {!v.options.length && <li className="p-3 text-sm text-sub">No staff on your list yet. Add them under My business → Team.</li>}
            </ul>
          )}
          {msg[v.kind] && <p role="status" className="mt-2 text-sm font-semibold">{msg[v.kind]}</p>}
          {data.canAllocate && <p className="mt-2 text-xs text-sub">Ready Checks can go to anyone on your staff list; install days only to CII-cleared installers. The 6:30am text goes to the allocated person's mobile.</p>}
        </Section>
      ))}
    </>
  );
}
