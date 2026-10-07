// "I'm at the property now – start a Ready Check" (Jo, 7 Oct 2026). Phone first, minimum fields only.
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/trade/trade-ui";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ElectricianPicker, inviteResultMessage } from "@/components/trade/job-intake";
import { addBulkElectrician, bulkElectricianChoices } from "@/lib/bulk-import.functions";
import { onsiteFormStatus, startOnsiteReadyCheck } from "@/lib/onsite-ready-check.functions";
import { OWNER_CONTACT_PERMISSION, usualElectrician, type ElectricianPlan } from "@/lib/job-electrician.core";
import { PREPARING, START_BUTTON, addressFromReverse, onsiteProblems, type OnsiteInput, type OnsiteState } from "@/lib/onsite-ready-check.core";

const DRAFT_KEY = "hiv-onsite-draft";
const blank: OnsiteInput = { full_name: "", address_line: "", suburb: "", postcode: "", phone: "", email: "", contact_permission: false };

export function OnsiteStart({ businessId, onBack }: { businessId: string; onBack: () => void }) {
  const [v, setV] = useState<OnsiteInput>(blank);
  const [touched, setTouched] = useState(false);
  const [loc, setLoc] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [job, setJob] = useState<{ jobId: string; jobNumber: string | null; state: OnsiteState } | null>(null);
  const start = useServerFn(startOnsiteReadyCheck);
  const getEl = useServerFn(bulkElectricianChoices), addEl = useServerFn(addBulkElectrician);
  const { data: el, refetch } = useQuery({ queryKey: ["bulk-electricians", businessId], queryFn: () => getEl({ data: { businessId } }) });
  const [plan, setPlan] = useState<ElectricianPlan | null>(null);
  useEffect(() => { if (plan || !el) return; const u = usualElectrician(el.approved); setPlan(u?.businessId ? { mode: "mine", business_id: u.businessId } : { mode: "hivic" }); }, [el, plan]);

  // Poor signal: what's typed is kept on the phone until the job is saved.
  useEffect(() => { try { const d = localStorage.getItem(DRAFT_KEY); if (d) setV({ ...blank, ...JSON.parse(d), contact_permission: false }); } catch { /* ignore */ } }, []);
  useEffect(() => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...v, contact_permission: false })); } catch { /* ignore */ } }, [v]);

  const useLocation = () => {
    if (!navigator.geolocation) { setLoc("This phone can't share its location — type the address."); return; }
    setLoc("Finding the address…");
    navigator.geolocation.getCurrentPosition(async (p) => {
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&lat=${p.coords.latitude}&lon=${p.coords.longitude}`);
        const a = addressFromReverse(await r.json());
        if (!a) { setLoc("Couldn't find an address here — type it in."); return; }
        setV((x) => ({ ...x, address_line: a.address_line || x.address_line, suburb: a.suburb || x.suburb, postcode: a.postcode || x.postcode }));
        setLoc("Address filled in from your location — check it's right.");
      } catch { setLoc("No signal for the address lookup — type it in."); }
    }, () => setLoc("Location is off — type the address."), { enableHighAccuracy: true, timeout: 10000 });
  };

  if (job) return <FormReady job={job} />;
  const problems = onsiteProblems(v);
  const set = (k: keyof OnsiteInput) => (e: React.ChangeEvent<HTMLInputElement>) => setV((x) => ({ ...x, [k]: e.target.value }));
  const field = (k: keyof OnsiteInput, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="block text-sm"><span className="font-bold">{label}</span><Input className="mt-1 h-12" value={String(v[k])} onChange={set(k)} {...props} /></label>
  );
  return (
    <div className="mt-4 space-y-4" data-onsite>
      <section className="space-y-3 rounded-[18px] border border-line bg-paper p-4">
        <h2 className="font-display text-lg font-bold">Owner</h2>
        {field("full_name", "Name", { autoComplete: "name" })}
        {field("phone", "Mobile", { inputMode: "tel", autoComplete: "tel" })}
        {field("email", "Email", { inputMode: "email", autoComplete: "email" })}
      </section>
      <section className="space-y-3 rounded-[18px] border border-line bg-paper p-4">
        <div className="flex items-center justify-between gap-2"><h2 className="font-display text-lg font-bold">Address</h2><Button type="button" variant="outline" size="sm" onClick={useLocation}>Use my location</Button></div>
        {loc && <p className="text-xs text-sub">{loc}</p>}
        {field("address_line", "Street", { autoComplete: "address-line1" })}
        <div className="grid grid-cols-[1fr_7rem] gap-2">{field("suburb", "Suburb")}{field("postcode", "Postcode", { inputMode: "numeric", maxLength: 4 })}</div>
      </section>
      {plan && <ElectricianPicker value={plan} onChange={setPlan} approved={el?.approved ?? []} pending={el?.pending ?? []} onAdd={async (d) => { const r = await addEl({ data: { businessId, name: d.name, mobile: d.mobile, email: d.email, business: d.business } }); await refetch(); setPlan({ mode: "mine", ...(r.businessId ? { business_id: r.businessId } : { nomination_id: r.nominationId }) }); return { message: inviteResultMessage(r) }; }} />}
      <label className="flex items-start gap-3 rounded-[18px] border border-line bg-paper p-4 text-sm" data-owner-consent><Checkbox className="mt-0.5" checked={v.contact_permission} onCheckedChange={(c) => setV((x) => ({ ...x, contact_permission: c === true }))} aria-label={OWNER_CONTACT_PERMISSION} /><span>{OWNER_CONTACT_PERMISSION}</span></label>
      {touched && problems.length > 0 && <ul className="space-y-1 text-sm text-danger" data-onsite-problems>{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
      {err && <p className="text-sm text-danger">{err}</p>}
      <Button size="field" className="w-full" disabled={busy} onClick={async () => {
        setTouched(true); setErr(null);
        if (problems.length) return;
        setBusy(true);
        try {
          const r = await start({ data: { businessId, owner: v, electrician: plan && plan.mode === "mine" ? { mode: "mine", business_id: plan.business_id ?? null, nomination_id: plan.nomination_id ?? null } : { mode: "hivic" } } });
          try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
          setJob(r);
        } catch (e) { setErr(e instanceof Error ? e.message : "No signal — your details are kept. Tap again when you have signal."); }
        finally { setBusy(false); }
      }}>{busy ? PREPARING : START_BUTTON}</Button>
      <p className="text-xs text-sub">Nothing is sent to the owner.</p>
      <Button variant="outline" className="w-full" onClick={onBack}>Back</Button>
    </div>
  );
}

function FormReady({ job }: { job: { jobId: string; jobNumber: string | null; state: OnsiteState } }) {
  const [state, setState] = useState(job.state);
  const [tries, setTries] = useState(0);
  const status = useServerFn(onsiteFormStatus);
  const opened = useRef(false);
  useEffect(() => {
    if (state.kind === "open") { if (!opened.current) { opened.current = true; window.location.href = state.url; } return; }
    if ((state.kind !== "preparing" && state.kind !== "retry") || tries >= 30) return;
    const t = setTimeout(async () => { try { setState(await status({ data: { jobId: job.jobId, retry: false } })); } catch { /* poor signal: keep trying */ } setTries((n) => n + 1); }, 4000);
    return () => clearTimeout(t);
  }, [state, tries, job.jobId, status]);
  return (
    <section className="mt-4 space-y-3 rounded-[18px] border border-line bg-paper p-5" data-onsite-state={state.kind}>
      <p className="text-xs font-bold uppercase tracking-wide text-sub">{job.jobNumber ?? "Job"} saved</p>
      {state.kind === "open" ? <>
        <h2 className="font-display text-xl font-bold">Opening your Ready Check form…</h2>
        <a className="inline-flex h-12 w-full items-center justify-center rounded-full bg-primary font-bold text-primary-foreground" href={state.url}>Open it in Mitti</a>
      </> : state.kind === "preparing" ? <>
        <h2 className="font-display text-xl font-bold">{PREPARING}</h2>
        <p className="text-sm text-sub">It opens by itself as soon as it's ready.</p>
      </> : <>
        <h2 className="font-display text-xl font-bold">{state.kind === "retry" ? "Still getting your form ready" : "Job saved"}</h2>
        <p className="text-sm">{state.message}</p>
        {state.kind === "retry" && <Button size="field" className="w-full" onClick={async () => { try { setState(await status({ data: { jobId: job.jobId, retry: true } })); } catch { /* keep */ } setTries(0); }}>Try again</Button>}
      </>}
      <Link to="/field/$jobId" params={{ jobId: job.jobId }} className="block text-center text-sm font-bold underline">Go to the job</Link>
    </section>
  );
}
