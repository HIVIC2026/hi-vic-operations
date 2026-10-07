// My business section pages (Jo, 7 Oct): trade-style, read-only facts; changes go to the office as requests.
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { ChevronLeft } from "lucide-react";
import { TradeShell, card } from "@/components/trade/TradeShell";
import { getTradeBusinessFile, sendTradeChangeRequest } from "@/lib/trade-view.functions";

export const greenBtn = "flex h-12 w-full items-center justify-center rounded-full bg-estimate-green font-bold text-white disabled:opacity-50";
export const navyBtn = "flex h-12 w-full items-center justify-center rounded-full bg-estimate-navy font-bold text-estimate-canvas disabled:opacity-50";
export const field = "h-12 w-full rounded-2xl border border-estimate-line bg-card px-4 text-base";

export type BizFile = Awaited<ReturnType<typeof getTradeBusinessFile>>;

export function useBizFile() {
  const load = useServerFn(getTradeBusinessFile);
  return useQuery({ queryKey: ["trade-business-file"], queryFn: () => load() });
}

export function BizPage({ title, intro, children }: { title: string; intro?: string; children: (d: BizFile, refetch: () => void) => React.ReactNode }) {
  const { data, error, refetch } = useBizFile();
  const installer = data?.kind !== "electrician";
  return (
    <TradeShell installer={installer} boss={data?.boss ?? true}>
      <Link to="/field/business" className="inline-flex items-center gap-1 text-sm font-bold text-estimate-blue"><ChevronLeft className="h-4 w-4" />My business</Link>
      <div><h1 className="font-display text-3xl font-extrabold">{title}</h1>{intro && <p className="mt-1 text-sm text-estimate-navy/70">{intro}</p>}</div>
      {error ? <p role="alert" className={card}>{(error as Error).message}</p> : !data ? <p className="text-sm">Loading…</p> : children(data, () => void refetch())}
    </TradeShell>
  );
}

export function Rows({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="divide-y divide-estimate-line overflow-hidden rounded-[22px] bg-card shadow-sm">
      {rows.map(([k, v]) => <div key={k} className="p-4"><dt className="text-xs font-bold uppercase tracking-wide text-estimate-navy/60">{k}</dt><dd className="mt-0.5 font-semibold">{v ?? "—"}</dd></div>)}
    </dl>
  );
}

/** Sends a change request to the office (Needs me). Never changes anything itself. */
export function AskToChange({ kind, label, placeholder, open, onSent }: { kind: "details" | "rates" | "area" | "other"; label: string; placeholder: string; open: BizFile["openRequests"]; onSent: () => void }) {
  const send = useServerFn(sendTradeChangeRequest);
  const [show, setShow] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const mine = open.filter((o) => o.kind === kind);
  return (
    <section className="space-y-3">
      {mine.map((o) => <p key={o.created_at} className="rounded-[22px] bg-estimate-green-soft p-4 text-sm"><span className="block font-bold text-estimate-green">Sent to the office — we'll be in touch</span>{o.message}</p>)}
      {!show ? <button type="button" className={navyBtn} onClick={() => setShow(true)}>{label}</button> : (
        <div className={`${card} space-y-3`}>
          <label htmlFor={`ask-${kind}`} className="block font-bold">{label}</label>
          <textarea id={`ask-${kind}`} rows={4} className="w-full rounded-2xl border border-estimate-line bg-card p-3 text-base" placeholder={placeholder} value={msg} onChange={(e) => setMsg(e.target.value)} />
          <p className="text-xs text-estimate-navy/70">This goes to the Home Insulation Victoria office. Nothing changes until we've agreed it with you.</p>
          <button type="button" className={greenBtn} disabled={busy || msg.trim().length < 3} onClick={async () => {
            setBusy(true);
            try { await send({ data: { kind, message: msg } }); toast.success("Sent to the office"); setMsg(""); setShow(false); onSent(); }
            catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
          }}>Send to the office</button>
          <button type="button" className="w-full text-center text-sm font-bold text-estimate-blue" onClick={() => setShow(false)}>Cancel</button>
        </div>
      )}
    </section>
  );
}

export const aud2 = (n: number) => n.toLocaleString("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: 2 });
