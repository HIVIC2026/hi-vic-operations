// Install crew for the A3 PIISA: verified staff of this installer business + "Other". Uses existing trade styles.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { card, ghostBtn, greenBtn } from "@/components/trade/TradeShell";
import { getPiisaCrew, savePiisaCrew } from "@/lib/piisa-a3.functions";
import { A3_NATIVE_CREW_LOOKUP, crewSelectionProblems, type CrewPick, type CrewSelection, type StaffOption } from "@/lib/piisa-a3.core";

const ready = (s: StaffOption) => s.approved !== false && s.eecVerified && !!s.eec;
const tag = (s: StaffOption) => s.approved === false ? " · waiting for office approval" : s.eecVerified ? ` · EEC ${s.eec}` : " · EEC not verified";

export function PiisaCrewPicker({ jobId }: { jobId: string }) {
  const get = useServerFn(getPiisaCrew), save = useServerFn(savePiisaCrew);
  const { data, refetch } = useQuery({ queryKey: ["piisa-crew", jobId], queryFn: () => get({ data: { jobId } }) });
  const [lead, setLead] = useState<CrewSelection["lead"]>(null);
  const [extra, setExtra] = useState<CrewPick[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!data) return; if (data.selection) { setLead(data.selection.lead); setExtra(data.selection.additional); } else { const r = data.staff.filter(ready); if (r.length === 1) setLead(r[0]!.workerId); } }, [data]);
  if (!data) return null;
  const check = crewSelectionProblems({ lead, additional: extra }, data.staff);
  const sel = "h-12 w-full rounded-[12px] border border-line bg-paper px-3 text-sm";
  return (
    <section className={card} data-piisa-crew>
      <h2 className="font-display text-xl font-bold">Who's on the install?</h2>
      <p className="mt-1 text-sm">These names and EEC numbers go on the safety form for you.</p>
      <p className="mt-1 text-xs text-sub" data-native-lookup-note>{A3_NATIVE_CREW_LOOKUP.note}</p>
      {!data.staff.some(ready) && <p className="mt-2 text-sm font-semibold" data-no-staff>No approved installer with a checked EEC certificate is on your staff list yet, You can enter the lead installer under Other; the office must check them before work starts.</p>}
      <label className="mt-3 block text-sm font-bold">Lead installer
        <select aria-label="Lead installer" className={`${sel} mt-1`} value={typeof lead === "string" ? lead : lead ? "other" : ""} onChange={(e) => setLead(e.target.value === "other" ? { other: { name: "", eec: "" } } : e.target.value || null)}>
          <option value="">Choose</option>
          {data.staff.map((s) => <option key={s.workerId} value={s.workerId} disabled={!ready(s)}>{s.name}{tag(s)}</option>)}
          <option value="other">Other</option>
        </select>
      </label>
      {typeof lead === "string" && (() => { const s0 = data.staff.find((x) => x.workerId === lead); return s0 ? <p className="mt-2 text-sm" data-lead-cert>{s0.name} · EEC {s0.eecVerified && s0.eec ? `${s0.eec} (checked certificate on file)` : "not verified"}</p> : null; })()}
      {typeof lead === "object" && lead !== null && <div className="mt-2 grid grid-cols-2 gap-2" data-lead-other>
        <input className={sel} aria-label="Lead installer full legal name" placeholder="Full legal name" value={lead.other.name} onChange={(e) => setLead({ other: { ...lead.other, name: e.target.value } })} />
        <input className={sel} aria-label="Lead installer EEC certificate number" placeholder="EEC certificate number" value={lead.other.eec} onChange={(e) => setLead({ other: { ...lead.other, eec: e.target.value } })} />
      </div>}
      {extra.map((a, i) => (
        <div key={i} className="mt-3 space-y-2">
          <select className={sel} value={"workerId" in a ? a.workerId : "other"} onChange={(e) => setExtra(extra.map((x, j) => j !== i ? x : e.target.value === "other" ? { other: { name: "", eec: "" } } : { workerId: e.target.value }))}>
            {data.staff.map((s) => <option key={s.workerId} value={s.workerId} disabled={!ready(s)}>{s.name}{tag(s)}</option>)}
            <option value="other">Other</option>
          </select>
          {"workerId" in a && (() => { const s0 = data.staff.find((x) => x.workerId === a.workerId); return s0 ? <p className="text-sm" data-extra-cert>EEC {s0.eecVerified && s0.eec ? `${s0.eec} (checked certificate on file)` : "not verified"}</p> : null; })()}
          {"other" in a && <div className="grid grid-cols-2 gap-2">
            <input className={sel} placeholder="Full name" value={a.other.name} onChange={(e) => setExtra(extra.map((x, j) => j === i ? { other: { ...a.other, name: e.target.value } } : x))} />
            <input className={sel} placeholder="EEC certificate number" value={a.other.eec} onChange={(e) => setExtra(extra.map((x, j) => j === i ? { other: { ...a.other, eec: e.target.value } } : x))} />
          </div>}
          <button type="button" className="text-sm font-bold text-estimate-blue" onClick={() => setExtra(extra.filter((_, j) => j !== i))}>Remove</button>
        </div>
      ))}
      {extra.length < 3 && <button type="button" className={`${ghostBtn} mt-3`} onClick={() => setExtra([...extra, data.staff.find((s) => ready(s) && s.workerId !== lead && !extra.some((x) => "workerId" in x && x.workerId === s.workerId)) ? { workerId: data.staff.find((s) => ready(s) && s.workerId !== lead && !extra.some((x) => "workerId" in x && x.workerId === s.workerId))!.workerId } : { other: { name: "", eec: "" } }])}>Add another installer</button>}
      {(check.problems.length > 0 || check.needsVerification.length > 0) && <ul className="mt-3 list-disc pl-5 text-sm">{[...check.problems, ...check.needsVerification].map((p) => <li key={p}>{p}</li>)}</ul>}
      {msg && <p className="mt-2 text-sm">{msg}</p>}
      <button type="button" className={`${greenBtn} mt-4`} disabled={busy || check.problems.length > 0} onClick={async () => { setBusy(true); setMsg(null); try { const r = await save({ data: { jobId, lead, additional: extra } }); setMsg(r.needsVerification.length ? "Saved. The office must check the extra installer before work starts." : "Crew saved."); await refetch(); } catch (e) { setMsg(e instanceof Error ? e.message : "Couldn't save."); } finally { setBusy(false); } }}>Save crew</button>
    </section>
  );
}
