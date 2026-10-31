// Who's on the crew today? (mock-up M4; decisions 153, 161; Jo 29 Oct 2026 D6): the ONE install crew picker, on the Job
// page and Today's job. The install crew for the A5 PIISA from this business's cleared staff, plus "Enter installer
// details" for someone not on the list (office verification before work starts). The Lead gets the Mitti install form.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getPiisaCrew, savePiisaCrew } from "@/lib/piisa-a3.functions";
import { A3_NATIVE_CREW_LOOKUP, crewSelectionProblems, savedCrewNeedsRepick, type CrewPick, type CrewSelection, type StaffOption } from "@/lib/piisa-crew.core";
import { Group, LinkRow, Note, PrimaryButton, QuietButton } from "@/components/trade/installer-kit";
import { CREW_TITLE } from "@/lib/installer-screens.core";

// Decision 153: ready = cleared (verified CII + recorded level + not expired); office login approval is not the gate.
const ready = (s: StaffOption) => s.cleared !== false && s.eecVerified && !!s.eec;
const tag = (s: StaffOption) => s.cleared === false ? ` · ${s.clearanceReason ?? "not cleared yet"}` : s.eecVerified ? ` · EEC ${s.eec}` : " · EEC not verified";

export function PiisaCrewPicker({ jobId }: { jobId: string }) {
  const get = useServerFn(getPiisaCrew), save = useServerFn(savePiisaCrew);
  const { data, refetch } = useQuery({ queryKey: ["piisa-crew", jobId], queryFn: () => get({ data: { jobId } }), retry: false, staleTime: 20_000 });
  const [lead, setLead] = useState<string | null>(null);
  const [extra, setExtra] = useState<CrewPick[]>([]);
  const [editing, setEditing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!data) return; if (data.selection && !savedCrewNeedsRepick(data.selection)) { setLead(typeof data.selection.lead === "string" ? data.selection.lead : null); setExtra(data.selection.additional); } else { const r = data.staff.filter(ready); if (r.length === 1 && r[0]) setLead(r[0].workerId); } }, [data]);
  if (!data) return null;
  const check = crewSelectionProblems({ lead, additional: extra }, data.staff);
  const sel = "min-h-11 w-full rounded-xl border border-line bg-paper px-3 text-[15px]";
  const name = (p: CrewPick | CrewSelection["lead"]) => typeof p === "string" ? data.staff.find((s) => s.workerId === p)?.name ?? "Staff member" : p && "workerId" in p ? data.staff.find((s) => s.workerId === p.workerId)?.name ?? "Staff member" : p && "other" in p ? p.other.name || "Entered installer" : null;
  const status = (p: CrewPick | CrewSelection["lead"]) => { const id = typeof p === "string" ? p : p && "workerId" in p ? p.workerId : null; const s = id ? data.staff.find((x) => x.workerId === id) : null; return s ? (ready(s) ? { t: "CII cleared", ok: true } : { t: s.clearanceReason ?? "Not cleared", ok: false }) : { t: "Office to verify", ok: false }; };
  const saved = data.selection && !savedCrewNeedsRepick(data.selection) ? data.selection : null;
  const leadName = saved ? name(saved.lead) : null;
  const rows = saved ? [{ pick: saved.lead, lead: true }, ...saved.additional.map((a) => ({ pick: a, lead: false }))].filter((r) => r.pick) : [];
  const form = (
    <div className="mt-2" data-piisa-crew-form>
      <p className="text-[13px] text-sub" data-native-lookup-note>{A3_NATIVE_CREW_LOOKUP.note}</p>
      {!data.staff.some(ready) && <p className="mt-2 text-sm font-semibold" data-no-staff>No CII-cleared installer is on your Team list yet. Add them under My business → Team.</p>}
      <label className="mt-3 block text-sm font-semibold">Lead installer
        <select aria-label="Lead installer" className={`${sel} mt-1`} value={lead ?? ""} onChange={(e) => setLead(e.target.value || null)}>
          <option value="">Choose</option>
          {data.staff.map((s) => <option key={s.workerId} value={s.workerId} disabled={!ready(s)}>{s.name}{tag(s)}</option>)}
        </select>
      </label>
      {typeof lead === "string" && (() => { const s0 = data.staff.find((x) => x.workerId === lead); return s0 ? <p className="mt-2 text-sm" data-lead-cert>{s0.name} · EEC {s0.eecVerified && s0.eec ? `${s0.eec} (checked certificate on file)` : "not verified"}</p> : null; })()}
      {extra.map((a, i) => (
        <div key={i} className="mt-3 space-y-2">
          <select className={sel} aria-label={`Crew member ${i + 2}`} value={"workerId" in a ? a.workerId : "other"} onChange={(e) => setExtra(extra.map((x, j) => j !== i ? x : e.target.value === "other" ? { other: { name: "", eec: "" } } : { workerId: e.target.value }))}>
            {data.staff.map((s) => <option key={s.workerId} value={s.workerId} disabled={!ready(s)}>{s.name}{tag(s)}</option>)}
            <option value="other">Enter installer details</option>
          </select>
          {"workerId" in a && (() => { const s0 = data.staff.find((x) => x.workerId === a.workerId); return s0 ? <p className="text-sm" data-extra-cert>EEC {s0.eecVerified && s0.eec ? `${s0.eec} (checked certificate on file)` : "not verified"}</p> : null; })()}
          {"other" in a && <div className="grid grid-cols-2 gap-2">
            <input className={sel} placeholder="Full legal name" value={a.other.name} onChange={(e) => setExtra(extra.map((x, j) => j === i ? { other: { ...a.other, name: e.target.value } } : x))} />
            <input className={sel} placeholder="Certified Insulation Installer (CII) certification number" value={a.other.eec} onChange={(e) => setExtra(extra.map((x, j) => j === i ? { other: { ...a.other, eec: e.target.value } } : x))} />
          </div>}
          <button type="button" className="min-h-9 text-sm font-semibold text-hiv-blue" onClick={() => setExtra(extra.filter((_, j) => j !== i))}>Remove</button>
        </div>
      ))}
      {extra.length < 2 && <QuietButton className="mt-3" onClick={() => setExtra([...extra, (() => { const next = data.staff.find((s) => ready(s) && s.workerId !== lead && !extra.some((x) => "workerId" in x && x.workerId === s.workerId)); return next ? { workerId: next.workerId } : { other: { name: "", eec: "" } }; })()])}>Add another installer</QuietButton>}
      {(check.problems.length > 0 || check.needsVerification.length > 0) && <ul className="mt-3 list-disc pl-5 text-sm">{[...check.problems, ...check.needsVerification].map((p) => <li key={p}>{p}</li>)}</ul>}
      <QuietButton className="mt-3 border-hiv-blue" disabled={busy || check.problems.length > 0} onClick={async () => { setBusy(true); setMsg(null); try { const r = await save({ data: { jobId, lead, additional: extra } }); setMsg(r.needsVerification.length ? "Saved. The office must check the extra installer before work starts." : "Crew saved."); setEditing(false); await refetch(); } catch (e) { setMsg(e instanceof Error ? e.message : "Couldn't save."); } finally { setBusy(false); } }}>{busy ? "Saving…" : "Save crew"}</QuietButton>
    </div>
  );
  return (
    <Group title={CREW_TITLE}>
      <div data-piisa-crew>
        {rows.map((r, i) => { const s = status(r.pick); return (
          <div key={i} className="flex min-h-12 items-center justify-between gap-3 border-b border-line text-[15px]">
            <span className="font-medium">{name(r.pick)}{r.lead && <span className="text-[13px] text-sub"> · lead</span>}</span>
            <span className={`text-[13px] font-semibold ${s.ok ? "text-hiv-green" : "text-sub"}`}>{s.t}</span>
          </div>
        ); })}
        {!editing && !saved && form}
        {saved && !editing && <LinkRow onClick={() => setEditing(true)}>Change</LinkRow>}
        {saved && editing && form}
        {msg && <p role="status" className="mt-2 text-sm font-semibold">{msg}</p>}
        <Note>{`The Mitti install form and the 6:30am text go to ${leadName ?? "the Lead"}. Only CII-cleared staff can be on an install. The crew goes on the PIISA.`}</Note>
      </div>
    </Group>
  );
}
