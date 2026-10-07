import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronLeft } from "lucide-react";
import { TradeShell, card } from "@/components/trade/TradeShell";
import { useState } from "react";
import { addTradeInstaller, getTradeBusiness, requestTeamLoginInvite } from "@/lib/trade-view.functions";
import { useQueryClient } from "@tanstack/react-query";
import { inputCls, greenBtn } from "@/components/trade/TradeShell";
import { nonEecWarning } from "@/lib/cii-issuer.core";

export const Route = createFileRoute("/_authenticated/field/business_/team")({
  head: () => ({ meta: [{ title: "Team – Home Insulation Victoria" }, { name: "description", content: "The people in your business who can see Home Insulation Victoria jobs." }, { property: "og:title", content: "Team – Home Insulation Victoria" }, { property: "og:description", content: "The people in your business who can see Home Insulation Victoria jobs." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" }] }),
  component: Team,
});

function Team() {
  const load = useServerFn(getTradeBusiness);
  const { data, error } = useQuery({ queryKey: ["trade-business"], queryFn: () => load() });
  const invite = useServerFn(requestTeamLoginInvite);
  const [asked, setAsked] = useState<Record<string, string>>({});
  const installer = data?.kind !== "electrician";
  return (
    <TradeShell installer={installer} boss={data?.boss}>
      <Link to="/field/business" className="inline-flex items-center gap-1 text-sm font-bold text-estimate-blue"><ChevronLeft className="h-4 w-4" />My business</Link>
      <div><h1 className="font-display text-[26px] font-bold leading-tight">Team</h1><p className="mt-1 text-sm text-sub">The people you listed when you applied. You don&apos;t need to invite staff: you can run every job from your own login. Tap "Send login invite" only if you want someone to see their own jobs.</p></div>
      {error ? <p role="alert" className={card}>{(error as Error).message}</p> : !data ? <p className="text-sm">Loading…</p> : (<>
        <ul className="divide-y divide-line overflow-hidden rounded-[18px] border border-line bg-paper shadow-card">{data.team.map((t, i) => <li key={t.name + i} className="flex items-center justify-between gap-3 p-4"><span className="min-w-0"><span className="block font-bold">{t.name}</span><span className="block text-sm text-sub">{t.role}{t.hasLogin && t.role !== "Business owner" ? " · Has a login" : ""}</span></span>{data.boss && t.id && !t.hasLogin && (asked[t.id] ? <span className="text-sm font-bold text-estimate-green">{asked[t.id]}</span> : <button type="button" className="h-12 shrink-0 rounded-[10px] border-2 border-estimate-blue px-4 text-sm font-bold text-estimate-blue" onClick={async () => { const id = t.id!; try { await invite({ data: { workerId: id } }); setAsked((a) => ({ ...a, [id]: "Invite requested" })); } catch (e) { setAsked((a) => ({ ...a, [id]: (e as Error).message })); } }}>Send login invite</button>)}</li>)}</ul>
        {data.boss && installer && <AddInstaller />}
      </>)}
    </TradeShell>
  );
}

function AddInstaller() {
  const add = useServerFn(addTradeInstaller);
  const qc = useQueryClient();
  const [f, setF] = useState({ name: "", email: "", mobile: "", ciiNumber: "", issuer: "Energy Efficiency Council (EEC)" });
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const warn = nonEecWarning(f.issuer);
  const ok = f.name.trim().length > 1 && /@/.test(f.email) && f.ciiNumber.trim().length > 1 && !warn;
  const save = async () => { setBusy(true); setMsg(null); try { await add({ data: f }); setMsg("Added. Our office will check the certificate. They can't be given jobs until it's verified."); setF({ ...f, name: "", email: "", mobile: "", ciiNumber: "" }); await qc.invalidateQueries({ queryKey: ["trade-business"] }); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); } };
  return (
    <section className={`${card} space-y-3`} data-add-installer>
      <h2 className="font-display text-lg font-bold">Add an installer</h2>
      <p className="text-sm text-sub">They need an EEC Certified Insulation Installer certificate. Our office checks it before they can be put on a job.</p>
      <label className="block text-sm font-semibold">Full name<input className={`${inputCls} mt-1`} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
      <label className="block text-sm font-semibold">Email<input type="email" className={`${inputCls} mt-1`} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
      <label className="block text-sm font-semibold">Mobile<input type="tel" className={`${inputCls} mt-1`} value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value })} /></label>
      <label className="block text-sm font-semibold">EEC CII certificate number<input className={`${inputCls} mt-1`} value={f.ciiNumber} onChange={(e) => setF({ ...f, ciiNumber: e.target.value })} /></label>
      <label className="block text-sm font-semibold">Issued by (must be EEC)<input className={`${inputCls} mt-1`} value={f.issuer} onChange={(e) => setF({ ...f, issuer: e.target.value })} /></label>
      {warn && <p className="text-sm font-semibold text-rose">Only EEC certificates are accepted.</p>}
      <button type="button" className={greenBtn} disabled={!ok || busy} onClick={() => void save()}>{busy ? "Adding…" : "Add installer"}</button>
      {msg && <p role="status" className="text-sm font-semibold">{msg}</p>}
    </section>
  );
}
