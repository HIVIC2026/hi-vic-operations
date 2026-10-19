// Shared pieces for Add one job and each Upload jobs customer card (Jo, 7 Oct 2026). Presentation + upload plumbing only.
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Camera, FileText, Paperclip, X, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { partnerFileUrl, partnerUploadUrl } from "@/lib/pilot.functions";
import { getJobElectrician, switchJobElectricianToHivic } from "@/lib/job-electrician.functions";
import { SAFETY_CHECK_NOTE, jobElectricianLabel, newElectricianProblems, usualElectrician, type ElectricianPlan } from "@/lib/job-electrician.core";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { openFileViewer } from "@/components/portal/file-viewer";

export type AttachedFile = { path: string; name: string; type?: string | null };
const isImage = (f: { name: string; type?: string | null }) => /^image\//.test(f.type ?? "") || /\.(jpe?g|png|heic|heif|webp)$/i.test(f.name);

/** Uploads to this business's private import folder; returns stored refs (never public URLs). */
export function useUploadFiles(businessId: string) {
  const upload = useServerFn(partnerUploadUrl);
  return async (files: File[]) => {
    const out: AttachedFile[] = [];
    for (const f of files) {
      const { path, token } = await upload({ data: { businessId, folder: "imports", fileName: f.name } });
      const { error } = await supabase.storage.from("job-files").uploadToSignedUrl(path, token, f, { contentType: f.type });
      if (error) throw new Error(`${f.name} didn't upload. Try again.`);
      out.push({ path, name: f.name, type: f.type });
    }
    return out;
  };
}

function Thumb({ f, businessId }: { f: AttachedFile; businessId: string }) {
  const sign = useServerFn(partnerFileUrl);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { let on = true; if (isImage(f) && f.path.startsWith(`partners/${businessId}/`)) sign({ data: { businessId, path: f.path } }).then((r) => on && setUrl(r.url)).catch(() => {}); return () => { on = false; }; /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [f.path]);
  return url ? <img src={url} alt="" className="h-full w-full object-cover" /> : <FileText className="h-5 w-5 text-sub" />;
}

/** "Take photo" (phone camera) + "Choose files", with small previews and a remove button on each. */
export function AttachFiles({ businessId, files, onAdd, onRemove, canRemove = () => true, disabled = false, onBusyChange, label = "Photos and files" }: { businessId: string; files: AttachedFile[]; onAdd: (f: File[]) => Promise<void>; onRemove: (path: string) => Promise<void>; canRemove?: (path: string) => boolean; disabled?: boolean; onBusyChange?: (busy: boolean) => void; label?: string }) {
  const [operation, setOperation] = useState<"adding" | "removing" | null>(null);
  const locked = useRef(false);
  const busy = operation !== null;
  const [err, setErr] = useState<string | null>(null);
  const sign = useServerFn(partnerFileUrl);
  const view = async (f: AttachedFile) => {
    setErr(null);
    try { const r = await sign({ data: { businessId, path: f.path } }); openFileViewer(r.url, f.name); }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn't open this file. Try again."); }
  };
  const cam = useRef<HTMLInputElement>(null), pick = useRef<HTMLInputElement>(null);
  const mutate = async (kind: "adding" | "removing", action: () => Promise<void>) => {
    if (locked.current || disabled) return;
    locked.current = true; setOperation(kind); onBusyChange?.(true); setErr(null);
    try { await action(); } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't save the file change. Try again."); }
    finally { locked.current = false; setOperation(null); onBusyChange?.(false); }
  };
  const add = async (list: FileList | null) => {
    const f = [...(list ?? [])]; if (!f.length) return;
    await mutate("adding", () => onAdd(f));
    if (cam.current) cam.current.value = ""; if (pick.current) pick.current.value = "";
  };
  return (
    <div className="space-y-2" data-attach-files>
      <div className="flex flex-col gap-2 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"><span className="flex items-center gap-1.5 text-sm font-semibold"><Paperclip className="h-4 w-4 text-hiv-blue" />{label}</span>
        <div className="grid grid-cols-2 gap-1.5 sm:flex">
          <Button type="button" variant="outline" disabled={busy || disabled} onClick={() => cam.current?.click()} className="min-h-11 rounded-[9px] px-2.5 text-xs font-semibold text-hiv-blue sm:h-8 sm:min-h-0"><Camera className="h-3.5 w-3.5" />Take photo</Button>
          <Button type="button" variant="outline" disabled={busy || disabled} onClick={() => pick.current?.click()} className="min-h-11 rounded-[9px] px-2.5 text-xs font-semibold text-hiv-blue sm:h-8 sm:min-h-0">Choose files</Button>
        </div>
      </div>
      <input ref={cam} disabled={busy || disabled} type="file" accept="image/*" capture="environment" className="sr-only" aria-label="Take photo" onChange={(e) => add(e.target.files)} />
      <input ref={pick} disabled={busy || disabled} type="file" multiple accept="image/*,application/pdf,.pdf,.doc,.docx,.xls,.xlsx,.csv,.eml,.msg" className="sr-only" aria-label="Choose files" onChange={(e) => add(e.target.files)} />
      {busy && <p role="status" className="text-xs text-sub">{operation === "removing" ? "Removing file…" : "Saving and checking files…"}</p>}
      {err && <p role="alert" className="text-xs text-danger">{err}</p>}
      {files.length > 0 && <ul className="flex flex-wrap gap-2">{files.map((f) => (
        <li key={f.path} className="relative w-20">
          <Button type="button" variant="outline" aria-label={`Open ${f.name}`} onClick={() => view(f)} className="grid h-16 w-20 place-items-center overflow-hidden rounded-[10px] border border-line bg-mist p-0"><Thumb f={f} businessId={businessId} /></Button>
          <span className="mt-0.5 block truncate text-[10px] text-sub">{f.name.split("/").pop()}</span>
          {canRemove(f.path) && <Button type="button" variant="outline" size="icon" aria-label={`Remove ${f.name}`} disabled={busy || disabled} onClick={() => mutate("removing", () => onRemove(f.path))} className="absolute -right-1.5 -top-1.5 h-6 w-6 rounded-full border border-line bg-paper text-ink shadow-card"><X className="h-3 w-3" /></Button>}
        </li>))}</ul>}
    </div>
  );
}

export type ElectricianOption = { businessId?: string; nominationId?: string; name: string; status: string; primary?: boolean; business?: string | null };
export type NewElectrician = { name: string; business: string; mobile: string; email: string };

/** "Your electrician or ours?" — My electrician (usual one preselected) / + Add another electrician / Home Insulation Victoria arranges. */
export function ElectricianPicker({ value, onChange, approved, pending, onAdd, compact = false, note = true, title = "Your electrician or ours?", ownOnly = false }: {
  value: ElectricianPlan; onChange: (v: ElectricianPlan) => void; approved: ElectricianOption[]; pending: ElectricianOption[];
  onAdd?: (d: NewElectrician) => Promise<{ message: string }>; compact?: boolean; note?: boolean; title?: string;
  /** Own-electrician picker only (approved / invited / add) — used beneath a separate who-arranges choice. */
  ownOnly?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [d, setD] = useState<NewElectrician>({ name: "", business: "", mobile: "", email: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const options = [...approved.map((x) => ({ ...x, key: `b:${x.businessId}` })), ...pending.map((x) => ({ ...x, key: `n:${x.nominationId}` }))];
  const selected = value.business_id ? `b:${value.business_id}` : value.nomination_id ? `n:${value.nomination_id}` : "";
  const pickMine = () => {
    const u = usualElectrician(approved) ?? null;
    if (u?.businessId) onChange({ mode: "mine", business_id: u.businessId });
    else if (pending[0]?.nominationId) onChange({ mode: "mine", nomination_id: pending[0].nominationId });
    else onChange({ mode: "mine" });
  };
  const problems = newElectricianProblems(d);
  const opt = (on: boolean) => cn("min-h-9 rounded-[8px] border px-2 py-1 text-xs font-semibold leading-tight", on ? "border-line bg-paper text-ink" : "border-transparent text-sub hover:text-ink");
  const invitedPick = value.mode === "mine" && value.nomination_id && !value.business_id;
  return (
    <div className={compact ? "space-y-2 rounded-[12px] bg-mist/60 p-2" : "space-y-2 rounded-[18px] border border-line bg-paper p-3 shadow-card"} data-electrician-choice>
      {!ownOnly && <><div className="flex items-center gap-1.5 text-sm font-semibold"><Zap className="h-4 w-4 text-hiv-blue" />{title}</div>
      <div role="group" aria-label="Electrician" className="grid grid-cols-2 gap-1 rounded-[11px] bg-mist p-1">
        <button type="button" aria-pressed={value.mode === "mine"} className={opt(value.mode === "mine")} onClick={pickMine}>My electrician</button>
        <button type="button" aria-pressed={value.mode !== "mine"} className={opt(value.mode !== "mine")} onClick={() => { setAdding(false); onChange({ mode: "hivic" }); }}>Home Insulation Victoria arranges</button>
      </div></>}
      {value.mode === "mine" && (
        <select aria-label="My electrician" className="h-9 w-full rounded-[9px] border border-line bg-paper px-2 text-sm" value={selected} onChange={(e) => { const [k, id] = e.target.value.split(":"); if (!id) return; onChange(k === "b" ? { mode: "mine", business_id: id } : { mode: "mine", nomination_id: id }); }}>
          <option value="">Choose your electrician</option>
          {options.map((x) => <option key={x.key} value={x.key}>{x.name}{x.nominationId ? " · invited" : ""}</option>)}
        </select>
      )}
      {invitedPick && <p className="text-xs font-semibold text-rose">{pending.find((x) => x.nominationId === value.nomination_id)?.status === "invited" ? "Electrician invited – waiting to onboard" : "Electrician added – invitation delivery not confirmed"}</p>}
      {onAdd && !adding && value.mode === "mine" && <Button type="button" variant="link" className="h-12 px-0 text-xs" onClick={() => { setAttempted(false); setAdding(true); }}>+ Add another electrician</Button>}
      {onAdd && adding && value.mode === "mine" && (
        <div className="grid gap-2 rounded-[12px] bg-mist p-2 sm:grid-cols-2" data-add-electrician>
          {([["name", "Name", "text"], ["business", "Business", "text"], ["mobile", "Mobile", "tel"], ["email", "Email", "email"]] as const).map(([k, l, t]) => (
            <label key={k} className="block text-xs"><span className="font-semibold text-sub">{l}</span><input aria-label={`Electrician ${l.toLowerCase()}`} type={t} inputMode={t === "tel" ? "tel" : undefined} value={d[k]} onChange={(e) => setD({ ...d, [k]: e.target.value })} className="mt-0.5 h-10 w-full rounded-[10px] border border-line bg-paper px-2.5 text-sm" /></label>
          ))}
          <div className="flex items-center gap-2 sm:col-span-2">
            <Button type="button" disabled={busy} onClick={async () => { setAttempted(true); if (problems.length) return; setBusy(true); setMsg(null); try { const r = await onAdd(d); setMsg(r.message); setAdding(false); setD({ name: "", business: "", mobile: "", email: "" }); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); } }} className="h-12 text-xs">{busy ? "Sending…" : "Send them the invite"}</Button>
            <Button type="button" variant="ghost" disabled={busy} className="h-12 text-xs" onClick={() => setAdding(false)}>Cancel</Button>
          </div>
          {problems.length > 0 && (attempted || d.name || d.business || d.mobile || d.email) && <p role="alert" className="text-xs text-danger sm:col-span-2">{problems.join(" · ")}</p>}
        </div>
      )}
      {msg && <p className="text-xs font-semibold" role="status">{msg}</p>}
      {note && <p className="text-xs text-sub" data-safety-check-note>{SAFETY_CHECK_NOTE}</p>}
    </div>
  );
}

/** Message shown after the invite is sent, from the server result. */
export function inviteResultMessage(r: { invite?: { status: string; to: string } | null; status: string }): string {
  if (!r.invite) return r.status;
  if (r.invite.status === "sent") return `Invite sent to ${r.invite.to}. The job shows "Electrician invited – waiting to onboard".`;
  if (r.invite.status === "dry_run") return `Invite ready for ${r.invite.to} (test run, not sent).`;
  return `The invite didn't send to ${r.invite.to}. Home Insulation Victoria will follow up.`;
}

/** Job page: who does the electrical, with "Home Insulation Victoria arranges" available until an electrician accepts. */
export function JobElectricianCard({ jobId }: { jobId: string }) {
  const get = useServerFn(getJobElectrician);
  const sw = useServerFn(switchJobElectricianToHivic);
  const [s, setS] = useState<Awaited<ReturnType<typeof getJobElectrician>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { get({ data: { jobId } }).then(setS).catch(() => {}); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [jobId]);
  if (!s || s.intake) return null; // Add job jobs: one guarded editor (job details) owns the electrician choice
  const label = jobElectricianLabel(s);
  const canSwitch = !s.assignedName && (s.invitedName || s.chosenName);
  return (
    <section className="rounded-[18px] border border-line bg-paper p-4 shadow-card" data-job-electrician>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <div className="min-w-0"><p className="text-[11px] font-semibold text-sub">Electrician</p><p className={cn("text-sm font-semibold", s.invitedName ? "text-rose" : "text-ink")}>{label}</p></div>
        {canSwitch && <button type="button" disabled={busy} onClick={async () => { setBusy(true); setErr(null); try { await sw({ data: { jobId } }); setS(await get({ data: { jobId } })); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } }} className="h-8 rounded-[9px] border border-line bg-paper px-2.5 text-xs font-semibold text-hiv-blue disabled:opacity-50">Let Home Insulation Victoria arrange</button>}
      </div>
      {err && <p className="mt-1 text-xs text-danger">{err}</p>}
    </section>
  );
}
