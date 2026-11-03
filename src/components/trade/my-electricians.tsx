// Part 2b: the installer boss's own electricians — who is on the list and where each stands, plus the "Add an electrician"
// form. Rules live in my-electricians.core.ts (the same `addElectricianProblems` the server runs); this file only shows them.
// Files are uploaded when the form is sent, never before, so an abandoned form leaves nothing behind.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { card } from "@/components/trade/TradeShell";
import { field, greenBtn, navyBtn } from "./business-pages";
import { addMyElectrician, getMyElectricianUploadUrl, getMyElectricians } from "@/lib/my-electricians.functions";
import { draftProblems, draftToInput, MIN_PUBLIC_LIABILITY, PROBLEM_FIELD, statusChip, type ElectricianDraft } from "@/lib/my-electricians.core";
import { melbourneToday } from "@/lib/melbourne-time.core";
import { shortDate } from "@/lib/trade-view.core";

export const MY_ELECTRICIANS_KEY = ["my-electricians"] as const;
const ADD_ELECTRICIAN_INTRO = "Electricians you add here can do the safety check (PIESA) and electrical upgrades on your own jobs. Home Insulation Victoria checks their paperwork before they're approved. They're never offered Home Insulation Victoria leads.";
const EMPLOYS_QUESTION = "Does this electrician employ anyone, including themselves through a company?";
const SOLE_TRADER_TICK = "Sole trader with no staff — no WorkCover needed";
const CHIP = { green: "bg-estimate-green-soft text-estimate-green", blue: "bg-estimate-panel text-estimate-blue", pink: "bg-owner-house-pink text-[#5A1F2C]" } as const;

/** "Licence to 4 Mar 2099 · Public liability to 6 May 2098" */
function paperworkLine(r: { licenceExpiry: string | null; plExpiry: string | null }): string {
  const parts = [r.licenceExpiry ? `Licence to ${shortDate(r.licenceExpiry)}` : "No licence expiry on file", r.plExpiry ? `Public liability to ${shortDate(r.plExpiry)}` : "No public liability on file"];
  return parts.join(" · ");
}

export function MyElectricians() {
  const load = useServerFn(getMyElectricians);
  const { data, error, refetch, isLoading } = useQuery({ queryKey: MY_ELECTRICIANS_KEY, queryFn: () => load() });
  const [adding, setAdding] = useState(false);
  return (<>
    <section className="space-y-2">
      <h2 className="font-display text-xl font-bold">On your list</h2>
      {error && <p role="alert" className={card}>{(error as Error).message}</p>}
      {!error && isLoading && <p className="text-sm">Loading…</p>}
      {data && <ul data-my-electricians className="divide-y divide-line overflow-hidden rounded-[18px] border border-line bg-paper shadow-card">
        {data.length === 0 && <li className="p-4 text-sm text-sub">Nobody yet. Add your electrician below.</li>}
        {data.map((r) => { const chip = statusChip(r.status, r.reason); return (
          <li key={r.id} data-electrician={r.status} className="flex flex-col gap-2 p-4 md:flex-row md:items-center md:justify-between">
            <span className="min-w-0"><span className="block font-bold">{r.name}</span><span className="block text-xs text-sub">{paperworkLine(r)}</span></span>
            <span className={`inline-block w-fit shrink-0 rounded-[18px] px-2.5 py-1 text-[12px] font-semibold ${CHIP[chip.tone]}`}>{chip.text}</span>
          </li>
        ); })}
      </ul>}
    </section>
    {!adding ? <button type="button" className={navyBtn} data-add-electrician onClick={() => setAdding(true)}>Add an electrician</button>
      : <AddElectricianForm onCancel={() => setAdding(false)} onAdded={() => { setAdding(false); void refetch(); }} />}
  </>);
}

type Draft = ElectricianDraft & { licenceFile: File | null; plFile: File | null; workcoverFile: File | null };
const EMPTY: Draft = { name: "", email: "", mobile: "", recNumber: "", licenceNumber: "", licenceExpiry: "", licenceFile: null, plFile: null, plAmount: "", plExpiry: "", employs: "", workcoverFile: null, workcoverExpiry: "", soleTraderTick: false };

function AddElectricianForm({ onCancel, onAdded }: { onCancel: () => void; onAdded: () => void }) {
  const uploadUrl = useServerFn(getMyElectricianUploadUrl);
  const add = useServerFn(addMyElectrician);
  const [d, setD] = useState<Draft>(EMPTY);
  const [problems, setProblems] = useState<string[]>([]);
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"" | "uploading" | "saving">("");
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));
  const under = (k: keyof Draft) => { const m = problems.filter((p) => PROBLEM_FIELD[p] === k); return m.length ? <span role="alert" className="block text-xs font-semibold text-danger">{m.join(". ")}</span> : null; };
  const unplaced = problems.filter((p) => !PROBLEM_FIELD[p]);

  const upload = async (kind: "licence" | "pl" | "workcover", f: File) => {
    const u = await uploadUrl({ data: { kind, fileName: f.name } });
    const { error } = await supabase.storage.from("job-files").uploadToSignedUrl(u.path, u.token, f, { contentType: f.type });
    if (error) throw new Error(`The ${kind === "licence" ? "licence" : kind === "pl" ? "public liability" : "WorkCover"} file didn't upload. Try again.`);
    return u.path;
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setServerError(null);
    const found = draftProblems(d, melbourneToday());
    setProblems(found);
    if (found.length) return;
    try {
      setBusy("uploading");
      const licence = await upload("licence", d.licenceFile!);
      const pl = await upload("pl", d.plFile!);
      const workcover = d.employs === "yes" && d.workcoverFile ? await upload("workcover", d.workcoverFile) : "";
      setBusy("saving");
      const r = await add({ data: draftToInput(d, { licence, pl, workcover }) });
      toast.success(r.result === "linked" ? `${d.name.trim()} is already approved with Home Insulation Victoria — added to your list.` : `${d.name.trim()} added. Home Insulation Victoria will check their paperwork.`);
      onAdded();
    } catch (err) { setServerError(err instanceof Error ? err.message : "Could not add the electrician. Please try again."); }
    finally { setBusy(""); }
  };
  const lbl = "block space-y-1 text-sm font-semibold";
  const fileInput = (k: "licenceFile" | "plFile" | "workcoverFile", id: string) => (<>
    <input id={id} type="file" accept="application/pdf,image/*" className="mt-1 block w-full text-sm" disabled={!!busy} onChange={(e) => set(k, e.target.files?.[0] ?? null)} />
    {d[k] && <span className="block text-xs font-normal text-sub">{d[k]!.name}</span>}
  </>);
  const disabled = !!busy;
  return (
    <form className={`${card} space-y-5`} onSubmit={(e) => void submit(e)} noValidate data-add-electrician-form>
      <div><h2 className="font-display text-xl font-bold">Add an electrician</h2><p className="mt-1 text-sm text-sub">{ADD_ELECTRICIAN_INTRO}</p></div>

      <fieldset className="space-y-3 border-0 p-0" disabled={disabled}>
        <legend className="text-[11px] font-bold uppercase tracking-[1.3px] text-estimate-blue">Who they are</legend>
        <div className="grid gap-3 md:grid-cols-2">
          <label className={lbl}>Name<input className={field} value={d.name} onChange={(e) => set("name", e.target.value)} maxLength={200} autoComplete="off" />{under("name")}</label>
          <label className={lbl}>REC number<input className={field} value={d.recNumber} onChange={(e) => set("recNumber", e.target.value)} maxLength={60} autoComplete="off" />{under("recNumber")}</label>
          <label className={lbl}>Email<input className={field} type="email" inputMode="email" value={d.email} onChange={(e) => set("email", e.target.value)} maxLength={254} autoComplete="off" />{under("email")}</label>
          <label className={lbl}>Mobile<input className={field} type="tel" inputMode="tel" value={d.mobile} onChange={(e) => set("mobile", e.target.value)} maxLength={30} autoComplete="off" />{under("mobile")}</label>
        </div>
      </fieldset>

      <fieldset className="space-y-3 border-0 p-0" disabled={disabled}>
        <legend className="text-[11px] font-bold uppercase tracking-[1.3px] text-estimate-blue">Electrical licence</legend>
        <div className="grid gap-3 md:grid-cols-2">
          <label className={lbl}>Licence number<input className={field} value={d.licenceNumber} onChange={(e) => set("licenceNumber", e.target.value)} maxLength={60} autoComplete="off" />{under("licenceNumber")}</label>
          <label className={lbl}>Licence expiry<input className={field} type="date" value={d.licenceExpiry} onChange={(e) => set("licenceExpiry", e.target.value)} />{under("licenceExpiry")}</label>
        </div>
        <label htmlFor="el-licence-file" className={lbl}>Photo or PDF of the licence{fileInput("licenceFile", "el-licence-file")}{under("licenceFile")}</label>
      </fieldset>

      <fieldset className="space-y-3 border-0 p-0" disabled={disabled}>
        <legend className="text-[11px] font-bold uppercase tracking-[1.3px] text-estimate-blue">Public liability insurance</legend>
        <div className="grid gap-3 md:grid-cols-2">
          <label className={lbl}>Cover amount ($)<input className={field} inputMode="numeric" placeholder={MIN_PUBLIC_LIABILITY.toLocaleString("en-AU")} value={d.plAmount} onChange={(e) => set("plAmount", e.target.value)} maxLength={15} autoComplete="off" /><span className="block text-xs font-normal text-sub">At least $5 million.</span>{under("plAmount")}</label>
          <label className={lbl}>Expiry<input className={field} type="date" value={d.plExpiry} onChange={(e) => set("plExpiry", e.target.value)} />{under("plExpiry")}</label>
        </div>
        <label htmlFor="el-pl-file" className={lbl}>Certificate (PDF or photo){fileInput("plFile", "el-pl-file")}{under("plFile")}</label>
      </fieldset>

      <fieldset className="space-y-3 border-0 p-0" disabled={disabled}>
        <legend className="text-sm font-semibold text-estimate-navy">{EMPLOYS_QUESTION}</legend>
        <div className="flex flex-col gap-2 md:flex-row md:gap-6">
          {(["yes", "no"] as const).map((v) => (
            <label key={v} className="flex min-h-11 items-center gap-2 text-[15px]"><input type="radio" name="employs" value={v} checked={d.employs === v} onChange={() => set("employs", v)} />{v === "yes" ? "Yes" : "No"}</label>
          ))}
        </div>
        {under("employs")}
        {d.employs === "yes" && <div className="grid gap-3 md:grid-cols-2">
          <label htmlFor="el-wc-file" className={lbl}>WorkCover certificate (PDF or photo){fileInput("workcoverFile", "el-wc-file")}{under("workcoverFile")}</label>
          <label className={lbl}>WorkCover expiry<input className={field} type="date" value={d.workcoverExpiry} onChange={(e) => set("workcoverExpiry", e.target.value)} />{under("workcoverExpiry")}</label>
        </div>}
        {d.employs === "no" && <label className="flex min-h-11 items-start gap-2 text-[15px]"><input type="checkbox" className="mt-1" checked={d.soleTraderTick} onChange={(e) => set("soleTraderTick", e.target.checked)} /><span>{SOLE_TRADER_TICK}{under("soleTraderTick")}</span></label>}
      </fieldset>

      {unplaced.length > 0 && <p role="alert" className="text-sm font-semibold text-danger">{unplaced.join(". ")}</p>}
      {serverError && <p role="alert" data-server-error className="rounded-[12px] bg-owner-house-pink/40 p-3 text-sm font-semibold text-[#5A1F2C]">{serverError}</p>}
      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <button type="submit" className={greenBtn} disabled={disabled}>{busy === "uploading" ? "Uploading files…" : busy === "saving" ? "Adding…" : "Add electrician"}</button>
        <button type="button" className="min-h-11 w-full text-center text-sm font-bold text-estimate-blue md:w-auto md:px-4" disabled={disabled} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
