// Owner paperwork gates on the secure link: shows what's left to sign, one document at a time, code-verified.
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ownerPaperworkFn, ownerReconfirmVariationFn, ownerSignPaperworkFn } from "@/lib/owner-gates.functions";
import { OwnerCodeGate, Tick, signBtn } from "./OwnerSign";
import { PAPERWORK_SCREENS as S } from "@/lib/owner-gates.core";

type Todo = { gate: string; key: string; title: string; tick: string; version: string; draft: boolean; text: string };
const input = "h-12 w-full rounded-2xl border border-estimate-line bg-card px-4 text-base";

export function OwnerPaperwork({ token }: { token: string }) {
  const load = useServerFn(ownerPaperworkFn);
  const sign = useServerFn(ownerSignPaperworkFn);
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["owner-paperwork", token], queryFn: () => load({ data: { token } }) });
  const [session, setSession] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [tick, setTick] = useState(false);
  const [ans, setAns] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [signed, setSigned] = useState(false);
  const reconfirm = useServerFn(ownerReconfirmVariationFn);
  const todo = (data?.todo ?? []) as Todo[];
  const pv = (data?.pendingVariation ?? null) as { id: string; reasons: string[] } | null;
  if (data && pv) return (
    <section data-testid="owner-reconfirm" className="space-y-3">
      <div className="rounded-[22px] bg-card p-5 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-wide text-estimate-blue">Please check and reconfirm</p>
        <h3 className="mt-1 font-display text-lg font-extrabold">{S.D.changed.replace(": {list}. Please check and reconfirm.", "")}</h3>
        <ul className="mt-3 list-disc space-y-1 rounded-2xl bg-estimate-mist p-3 pl-7 text-sm">{pv.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        <p className="mt-3 text-sm">Please check and reconfirm.</p>
      </div>
      {!session ? <OwnerCodeGate token={token} onVerified={setSession} /> : (
        <div className="rounded-[22px] bg-card p-5 shadow-sm">
          <label className="block text-sm font-semibold">Type your full name to reconfirm<input className={`${input} mt-1 font-display italic`} value={name} onChange={(e) => setName(e.target.value)} /></label>
          <button className={`${signBtn} mt-3`} disabled={busy || name.trim().length < 2} onClick={async () => {
            setErr(""); setBusy(true);
            try { await reconfirm({ data: { token, session, variationId: pv.id, signatureName: name } }); await qc.invalidateQueries(); }
            catch (e) { setErr(e instanceof Error ? e.message : "Please try again."); } finally { setBusy(false); }
          }}>Reconfirm</button>
          <p className="mt-2 text-xs">We'll email you a copy.</p>
          {err && <p role="alert" className="mt-2 text-sm font-semibold text-destructive">{err}</p>}
        </div>
      )}
    </section>
  );
  if (!data || !todo.length) return signed ? <p data-testid="owner-signed" className="rounded-[22px] bg-estimate-blush p-4 text-sm font-bold">{S.sign.signed}</p> : null;
  const d = todo[0]!;
  const choice = (k: string, opts: [string, string][]) => (
    <div className="mt-3 grid grid-cols-2 gap-2">{opts.map(([v, l]) => <button key={v} type="button" onClick={() => setAns({ ...ans, [k]: v })} className={`h-12 rounded-full border text-sm font-bold ${ans[k] === v ? "border-estimate-navy bg-estimate-navy text-estimate-canvas" : "border-estimate-line bg-card"}`}>{l}</button>)}</div>
  );
  const submit = async () => {
    setErr(""); setBusy(true);
    try {
      await sign({ data: { token, session: session!, key: d.key as never, signatoryName: name, ticked: tick, answers: ans } });
      setTick(false); setAns({}); setSigned(true);
      await qc.invalidateQueries({ queryKey: ["owner-paperwork", token] });
      await qc.invalidateQueries();
    } catch (e) { setErr(e instanceof Error ? e.message : "Please try again."); } finally { setBusy(false); }
  };
  return (
    <section data-testid="owner-paperwork" className="space-y-3">
      {signed && <p className="rounded-[22px] bg-estimate-blush p-4 text-sm font-bold">{S.sign.signed}</p>}
      <div className="rounded-[22px] bg-card p-5 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-wide text-estimate-blue">{d.gate === "A" ? S.A.heading : d.gate === "B" ? S.B.heading : S.C.heading} · {todo.length} to go</p>
        <h3 className="mt-1 font-display text-lg font-extrabold">{d.title}</h3>
        {d.draft && <p className="mt-2 rounded-2xl bg-estimate-blush p-3 text-sm font-bold">{d.key === "payment_terms" ? "Draft, awaiting Jo's approval" : "DRAFT wording"}{data.isTest ? " — TEST job only" : ""}</p>}
        <p className="mt-3 whitespace-pre-line rounded-2xl bg-estimate-mist p-3 text-sm">{d.text.replace(/^DRAFT[^\n]*\n\n/, "")}</p>
        {d.key === "details_confirmation" && choice("role", S.A.ownership)}
        {d.key === "details_confirmation" && ans["role"] === "tenant" && <p className="mt-2 text-sm">{S.A.tenantNote}</p>}
        {d.key === "life_support_answer" && choice("life_support", [["no", "No"], ["yes", "Yes"]])}
        {d.key === "life_support_answer" && ans["life_support"] === "yes" && <p className="mt-2 text-sm">{S.A.lifeSupportYes}</p>}
        {d.gate === "B" && d.key === "quote_acceptance" && <div className="mt-3 space-y-2 rounded-2xl bg-estimate-blush p-3 text-sm"><p className="font-bold">What happens next</p>{S.B.next.map((t) => <p key={t}>{t}</p>)}</div>}
        {d.gate === "C" && <div className="mt-3 space-y-1 rounded-2xl bg-estimate-blush p-3 text-sm"><p className="font-bold">Please remember</p>{S.C.remember.map((t) => <p key={t}>{t}</p>)}</div>}
        {d.key === "tenancy_details" && <div className="mt-3 space-y-2">
          <label className="block text-sm font-semibold">Landlord or agent's name<input className={`${input} mt-1`} value={ans["landlord_name"] ?? ""} onChange={(e) => setAns({ ...ans, landlord_name: e.target.value })} /></label>
          <label className="block text-sm font-semibold">Phone<input className={`${input} mt-1`} inputMode="tel" value={ans["landlord_phone"] ?? ""} onChange={(e) => setAns({ ...ans, landlord_phone: e.target.value })} /></label>
          <label className="block text-sm font-semibold">Email<input className={`${input} mt-1`} type="email" value={ans["landlord_email"] ?? ""} onChange={(e) => setAns({ ...ans, landlord_email: e.target.value })} /></label>
        </div>}
      </div>
      {!session ? <OwnerCodeGate token={token} onVerified={setSession} /> : (
        <div className="rounded-[22px] bg-card p-5 shadow-sm">
          <label className="block text-sm font-semibold">{S.sign.name}<input className={`${input} mt-1 font-display italic`} value={name} onChange={(e) => setName(e.target.value)} /></label>
          <Tick on={tick} set={setTick}>{d.tick}</Tick>
          <button className={`${signBtn} mt-2`} disabled={busy || !tick || name.trim().length < 2} onClick={submit}>{d.gate === "A" ? S.A.button : d.gate === "B" ? S.B.button : S.C.button}</button>
          {err && <p role="alert" className="mt-2 text-sm font-semibold text-destructive">{err}</p>}
        </div>
      )}
    </section>
  );
}
