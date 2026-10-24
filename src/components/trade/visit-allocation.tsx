// "Who's doing this" (decision 161; mock-up M2): the business owner picks the staff member for each visit on the
// installer job screen. Presentation only — eligibility, the event and the Mitti hand-over all happen on the server.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { allocateVisitFn, getVisitAllocation } from "@/lib/visit-allocation.functions";
import { Group, Note } from "@/components/trade/installer-kit";

export function WhosDoingThis({ jobId, readyCheckDone = false }: { jobId: string; readyCheckDone?: boolean }) {
  const load = useServerFn(getVisitAllocation);
  const allocate = useServerFn(allocateVisitFn);
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["visit-allocation", jobId], queryFn: () => load({ data: { jobId } }), retry: false });
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Record<string, string>>({});
  if (!data || !data.visits.length) return null;
  const hasInstall = data.visits.some((v) => v.kind === "install");
  return (
    <Group title="Who's doing this">
      {data.visits.map((v, i) => (
        <div key={v.kind} className={i < data.visits.length - 1 ? "border-b border-line" : ""}>
          <div className="flex min-h-12 items-center justify-between gap-3 text-[15px]">
            <span className="text-sub">{v.label}</span>
            <span className="text-right font-medium">
              {v.current ? v.current.name : <span className="text-sub">Not allocated yet</span>}
              {v.kind === "ready_check" && v.current && readyCheckDone && <span className="text-[13px] text-sub"> · done</span>}
              {v.kind === "install" && v.current && <span className="text-[13px] text-hiv-green"> · CII cleared</span>}
              {data.canAllocate && !(v.kind === "ready_check" && readyCheckDone) && <button type="button" className="ml-1.5 min-h-10 font-semibold text-hiv-blue" aria-expanded={open === v.kind} onClick={() => setOpen(open === v.kind ? null : v.kind)}>{v.current ? "Change" : "Choose"}</button>}
            </span>
          </div>
          {open === v.kind && data.canAllocate && (
            <ul className="mb-3 divide-y divide-line rounded-xl border border-line">
              {v.options.map((o) => {
                const picked = v.current?.workerId === o.workerId;
                const key = `${v.kind}:${o.workerId}`;
                return (
                  <li key={o.workerId} className="flex min-h-12 flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <span className="min-w-0">
                      <span className={o.allowed ? "block font-medium" : "block font-medium text-sub"}>{o.name}{picked ? " · allocated" : ""}</span>
                      {o.reason && <span className="block text-[13px] text-sub">{o.reason}</span>}
                      {o.note && <span className="block text-[13px] text-sub">{o.note}</span>}
                    </span>
                    <button type="button" disabled={!o.allowed || picked || busy === key}
                      className="min-h-10 shrink-0 rounded-[10px] border border-hiv-blue px-3 text-sm font-semibold text-hiv-blue disabled:opacity-40"
                      onClick={async () => {
                        setBusy(key);
                        try {
                          const r = await allocate({ data: { jobId, kind: v.kind, workerId: o.workerId } });
                          setMsg((m) => ({ ...m, [v.kind]: r.form === "reassigned" ? `${r.name} now has the Mitti form.` : `${r.name} allocated. The Mitti form isn't created yet.` }));
                          setOpen(null);
                          await qc.invalidateQueries({ queryKey: ["visit-allocation", jobId] });
                        } catch (e) { setMsg((m) => ({ ...m, [v.kind]: (e as Error).message })); }
                        finally { setBusy(null); }
                      }}>
                      {busy === key ? "Saving…" : picked ? "Allocated" : "Allocate"}
                    </button>
                  </li>
                );
              })}
              {!v.options.length && <li className="p-3 text-sm text-sub">No staff on your list yet. Add them under My business → Team.</li>}
            </ul>
          )}
          {msg[v.kind] && <p role="status" className="pb-2 text-sm font-semibold">{msg[v.kind]}</p>}
        </div>
      ))}
      {data.canAllocate && <Note>{hasInstall ? `The Mitti install form and the 6:30am text go to ${data.visits.find((v) => v.kind === "install")?.current?.name ?? "the person you choose"}. Only CII-cleared staff can do install days.` : "The Mitti form and the 6:30am text go to the person you choose."}</Note>}
    </Group>
  );
}
