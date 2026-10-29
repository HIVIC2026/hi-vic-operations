// "Who's doing this" (decision 161; mock-up M2 + approved state M2-change-allocation): the business owner picks the
// staff member for the Ready Check on the installer job screen; install days use the one crew picker (D6, PiisaCrewPicker).
// Presentation only — eligibility, the event and the Mitti hand-over all happen on the server; the sheet's words come
// from the pure `allocationSheet`.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { allocateVisitFn, getVisitAllocation } from "@/lib/visit-allocation.functions";
import { allocationSheet } from "@/lib/installer-screens.core";
import { Group, Note, PrimaryButton } from "@/components/trade/installer-kit";

export function WhosDoingThis({ jobId, readyCheckDone = false, visitAt = null, suburb = null }: { jobId: string; readyCheckDone?: boolean; visitAt?: string | null; suburb?: string | null }) {
  const load = useServerFn(getVisitAllocation);
  const allocate = useServerFn(allocateVisitFn);
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["visit-allocation", jobId], queryFn: () => load({ data: { jobId } }), retry: false, staleTime: 20_000 });
  const [open, setOpen] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Record<string, string>>({});
  if (!data) return null;
  const visits = data.visits.filter((v) => v.kind === "ready_check");
  if (!visits.length) return null;
  return (
    <Group title="Who's doing this">
      {visits.map((v, i) => {
        const sheet = open === v.kind ? allocationSheet({ kind: v.kind, visitAt, suburb, chosen, options: v.options.map((o) => ({ workerId: o.workerId, name: o.name, mobile: o.mobile, allowed: o.allowed, reason: o.reason, picked: v.current?.workerId === o.workerId })) }) : null;
        return (
          <div key={v.kind} className={i < visits.length - 1 ? "border-b border-line" : ""}>
            <div className="flex min-h-12 items-center justify-between gap-3 text-[15px]">
              <span className="text-sub">{v.label}</span>
              <span className="text-right font-medium">
                {v.current ? v.current.name : <span className="text-sub">Not yet</span>}
                {v.kind === "ready_check" && v.current && readyCheckDone && <span className="text-[13px] text-sub"> · done</span>}
                {data.canAllocate && !(v.kind === "ready_check" && readyCheckDone) && <button type="button" className="ml-1.5 min-h-10 font-semibold text-hiv-blue" aria-expanded={open === v.kind} onClick={() => { setOpen(open === v.kind ? null : v.kind); setChosen(null); }}>{v.current ? "Change" : "Choose"}</button>}
              </span>
            </div>
            {sheet && data.canAllocate && (
              <section className="mb-3 rounded-[18px] border border-line p-4" data-allocation-sheet role="dialog" aria-label={sheet.title}>
                <h3 className="text-[17px] font-semibold">{sheet.title}</h3>
                <p className="mt-1 text-sm leading-[1.45] text-sub">{sheet.sub}</p>
                <ul className="mt-3 divide-y divide-line">
                  {sheet.rows.map((r) => (
                    <li key={r.workerId}>
                      <button type="button" disabled={!r.allowed || busy} aria-pressed={chosen === r.workerId || r.picked} onClick={() => setChosen(r.workerId)} className="flex min-h-14 w-full items-center justify-between gap-3 py-2 text-left disabled:opacity-60">
                        <span className="min-w-0">
                          <span className="block text-[15px] font-semibold">{r.name}{r.picked ? " · allocated" : ""}</span>
                          <span className="block text-[13px] text-sub">{r.line}</span>
                          <span className={`block text-[13px] font-semibold ${r.tone === "green" ? "text-hiv-green" : "text-[#8A3B4A]"}`}>{r.status}</span>
                        </span>
                        <span aria-hidden className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-sm font-bold ${chosen === r.workerId || r.picked ? "border-hiv-blue bg-hiv-blue text-white" : "border-line"}`}>{chosen === r.workerId || r.picked ? "✓" : ""}</span>
                      </button>
                    </li>
                  ))}
                  {!sheet.rows.length && <li className="py-3 text-sm text-sub">No staff on your list yet. Add them under My business → Team.</li>}
                </ul>
                {sheet.button && <PrimaryButton className="mt-3" disabled={busy} onClick={async () => {
                  if (!chosen) return;
                  setBusy(true);
                  try {
                    const r = await allocate({ data: { jobId, kind: v.kind, workerId: chosen } });
                    setMsg((m) => ({ ...m, [v.kind]: r.form === "reassigned" ? `${r.name} now has the Mitti form.` : `${r.name} allocated. The Mitti form isn't created yet.` }));
                    setOpen(null); setChosen(null);
                    await qc.invalidateQueries({ queryKey: ["visit-allocation", jobId] });
                  } catch (e) { setMsg((m) => ({ ...m, [v.kind]: (e as Error).message })); }
                  finally { setBusy(false); }
                }}>{busy ? "Saving…" : sheet.button}</PrimaryButton>}
                <button type="button" className="mt-2 flex min-h-11 w-full items-center justify-center text-[15px] font-semibold text-sub" onClick={() => { setOpen(null); setChosen(null); }}>Cancel</button>
              </section>
            )}
            {msg[v.kind] && <p role="status" className="pb-2 text-sm font-semibold">{msg[v.kind]}</p>}
          </div>
        );
      })}
      {data.canAllocate && <Note>The Mitti form and the 6:30am text go to the person you choose.</Note>}
    </Group>
  );
}
