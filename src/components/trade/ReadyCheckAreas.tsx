// Ceiling areas on the installer's Ready Check: carried-forward facts (with who supplied them and when), per-area
// removal/product, and per-area missing evidence with supplier/reviewer. Uploads use the existing evidence panel.
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button, Section } from "@/components/trade/trade-ui";
import { Input } from "@/components/ui/input";
import { saveReadyCheckAreas } from "@/lib/ready-check-draft.functions";
import type { RcArea, AreaTask, AreaSource } from "@/lib/ready-check-areas.core";

type Data = { areas: RcArea[]; areasSaved: boolean; suggestedAreas: RcArea[]; preliminaryOnly: boolean; areaTasks: AreaTask[]; areaWorksBlockers: string[];
  areaTotals: { areaM2: number | null; removalM2: number | null }; supportingFiles: { id: string; title: string; uploadedAt: string }[]; status: string };

const n = (s: string) => (s.trim() === "" ? null : Number(s));
const when = (s: string | null) => (s ? new Date(s).toLocaleString("en-AU", { day: "numeric", month: "short", year: "numeric" }) : "date not recorded");
const srcText = (s?: AreaSource) => (!s ? null : s.kind === "installer_supplied" ? `From your job details (${when(s.at)}) — check it` : `Recorded ${when(s.at)}`);

export function ReadyCheckAreas({ jobId, data }: { jobId: string; data: Data }) {
  const qc = useQueryClient();
  const save = useServerFn(saveReadyCheckAreas);
  const start = data.areasSaved ? data.areas : data.suggestedAreas;
  const [areas, setAreas] = useState<RcArea[]>(start);
  const [dirty, setDirty] = useState(!data.areasSaved && data.suggestedAreas.length > 0);
  const [busy, setBusy] = useState(false); const inFlight = useRef(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { if (!dirty && !busy) setAreas(data.areasSaved ? data.areas : data.suggestedAreas); }, [data, dirty, busy]);
  const locked = data.status === "submitted";
  const upd = (i: number, p: Partial<RcArea>) => { setAreas((a) => a.map((x, j) => (j === i ? { ...x, ...p } : x))); setDirty(true); setMsg(null); };
  const add = () => { setAreas((a) => [...a, { key: `area-${Date.now().toString(36)}`, label: `Area ${a.length + 1}`, areaM2: null, existing: null, rValue: null, removal: null, removalM2: null, product: null, scope: null, sources: {} }]); setDirty(true); };
  const onSave = async () => {
    if (busy || inFlight.current || locked) return;
    inFlight.current = true; setBusy(true); setMsg(null);
    try { const r = await save({ data: { jobId, areas } }); qc.setQueryData(["rc-draft", jobId], r); setDirty(false); setMsg({ ok: true, text: "Areas saved. Nothing has been accepted — the office reviews each photo." }); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message || "Couldn't save — try again." }); }
    finally { setBusy(false); inFlight.current = false; }
  };
  return (
    <Section title="Ceiling areas" right={<span className="text-xs text-sub">{data.areaTotals.areaM2 != null ? `${data.areaTotals.areaM2} m² total` : "total not known yet"}</span>}>
      <div className="space-y-3" data-rc-areas>
        {data.preliminaryOnly && <p className="text-xs text-sub" data-rc-areas-preliminary>No site visit is recorded, so nothing from the estimate is copied here. Enter what you find onsite.</p>}
        {!data.areasSaved && data.suggestedAreas.length > 0 && <p className="text-xs font-semibold" data-rc-areas-suggested>We've copied what you already told us. Check it and save — nothing is accepted until the office reviews it.</p>}
        {areas.map((a, i) => (
          <div key={a.key} className="space-y-2 rounded-[12px] border border-line p-3" data-rc-area={a.key}>
            <Input className="h-12 text-base font-bold" aria-label="Area name" disabled={locked || busy} value={a.label} onChange={(e) => upd(i, { label: e.target.value })} />
            <Field label="Area (m²)" hint={srcText(a.sources.areaM2)}><Input className="h-12" inputMode="decimal" disabled={locked || busy} value={a.areaM2 ?? ""} onChange={(e) => upd(i, { areaM2: n(e.target.value) })} /></Field>
            <Field label="Existing insulation" hint={srcText(a.sources.existing)}><Sel v={a.existing} opts={[["none", "None"], ["present", "Present"], ["unknown", "Can't tell"]]} off={locked || busy} on={(x) => upd(i, { existing: x as RcArea["existing"] })} /></Field>
            <Field label="Removal needed" hint={srcText(a.sources.removal)}><Sel v={a.removal} opts={[["yes", "Yes"], ["no", "No"], ["unknown", "Not sure"]]} off={locked || busy} on={(x) => upd(i, { removal: x as RcArea["removal"], removalM2: x === "no" ? null : a.removalM2 })} /></Field>
            {a.removal === "yes" && <Field label="Removal area (m²)" hint={srcText(a.sources.removalM2)}><Input className="h-12" inputMode="decimal" disabled={locked || busy} value={a.removalM2 ?? ""} onChange={(e) => upd(i, { removalM2: n(e.target.value) })} /></Field>}
            <Field label="Proposed product" hint={srcText(a.sources.product)}><Input className="h-12" disabled={locked || busy} value={a.product ?? ""} onChange={(e) => upd(i, { product: e.target.value || null })} /></Field>
            {!locked && <Button variant="outline" disabled={busy} onClick={() => { setAreas((x) => x.filter((_, j) => j !== i)); setDirty(true); }}>Remove this area</Button>}
          </div>
        ))}
        {!locked && <div className="grid grid-cols-2 gap-2"><Button size="field" variant="outline" disabled={busy} onClick={add}>Add an area</Button><Button size="field" disabled={busy || !dirty} aria-busy={busy} onClick={onSave}>{busy ? "Saving…" : dirty ? "Save areas" : "Saved"}</Button></div>}
        {msg && <p role="status" className={`text-sm ${msg.ok ? "" : "text-danger"}`} data-rc-areas-msg>{msg.text}</p>}
        {data.areaWorksBlockers.length > 0 && <div className="rounded-[12px] bg-mist p-3 text-sm" data-rc-area-blockers><p className="font-bold">Removal or covering can't start in these areas yet</p><ul className="list-disc pl-5">{data.areaWorksBlockers.map((b) => <li key={b}>{b}</li>)}</ul><p className="mt-1 text-xs text-sub">You can still upload the before photos now.</p></div>}
        {data.areaTasks.length > 0 && <div className="text-sm" data-rc-area-tasks><p className="text-xs font-bold uppercase tracking-wide text-sub">Still missing</p><ul className="list-disc pl-5">{data.areaTasks.map((t) => <li key={t.item}>{t.item}: {t.status} — {t.due}. You upload it; {t.reviewedBy} checks it.</li>)}</ul></div>}
        {data.supportingFiles.length > 0 && <div className="text-xs text-sub" data-rc-supporting><p className="font-bold">Files you already sent (not yet accepted as evidence)</p><ul className="list-disc pl-5">{data.supportingFiles.map((f) => <li key={f.id}>{f.title} — {when(f.uploadedAt)}</li>)}</ul></div>}
      </div>
    </Section>
  );
}

function Field({ label, hint, children }: { label: string; hint: string | null; children: React.ReactNode }) {
  return <label className="block text-sm font-bold">{label}{hint && <span className="block text-xs font-normal text-sub">{hint}</span>}<div className="mt-1 font-normal">{children}</div></label>;
}
function Sel({ v, opts, off, on }: { v: string | null; opts: [string, string][]; off: boolean; on: (x: string | null) => void }) {
  return <select className="h-12 w-full rounded-[10px] border border-line bg-paper px-3 text-base" disabled={off} value={v ?? ""} onChange={(e) => on(e.target.value || null)}><option value="">Not recorded yet</option>{opts.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>;
}
