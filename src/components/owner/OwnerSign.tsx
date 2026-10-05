// No-login owner signing pieces: 6-digit code check, then the signed action. Session lives in memory only.
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ownerCodeOptionsFn, requestOwnerCodeFn, verifyOwnerCodeFn } from "@/lib/owner-link.functions";

const btn = "flex h-12 w-full items-center justify-center rounded-full bg-estimate-green font-bold text-estimate-canvas disabled:opacity-50";
const input = "h-12 w-full rounded-2xl border border-estimate-line bg-card px-4 text-base";

export function OwnerCodeGate({ token, onVerified }: { token: string; onVerified: (session: string) => void }) {
  const opts = useServerFn(ownerCodeOptionsFn);
  const ask = useServerFn(requestOwnerCodeFn);
  const check = useServerFn(verifyOwnerCodeFn);
  const { data } = useQuery({ queryKey: ["owner-code-opts", token], queryFn: () => opts({ data: { token } }) });
  const [sent, setSent] = useState<{ masked: string; testCode: string | null } | null>(null);
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (f: () => Promise<void>) => { setErr(""); setBusy(true); try { await f(); } catch (e) { setErr(e instanceof Error ? e.message : "Please try again."); } finally { setBusy(false); } };
  return (
    <section className="rounded-[22px] bg-card p-5 shadow-sm">
      <h3 className="font-display text-lg font-extrabold">Quick check it's you</h3>
      {!sent ? <>
        <p className="mt-1 text-sm">We'll send you a 6-digit code. No password needed.</p>
        <div className="mt-3 space-y-2">
          {data?.sms && <button className={btn} disabled={busy} onClick={() => run(async () => setSent(await ask({ data: { token, channel: "sms" } })))}>Text me a code ({data.sms})</button>}
          {data?.email && <button className={`${btn} bg-estimate-blue`} disabled={busy} onClick={() => run(async () => setSent(await ask({ data: { token, channel: "email" } })))}>Email me a code ({data.email})</button>}
          {data && !data.sms && !data.email && <p className="text-sm">We don't have a mobile or email for you yet. Please use "Got a question? Message us".</p>}
        </div>
      </> : <>
        <p className="mt-1 text-sm">We sent a code to {sent.masked}. It works for 10 minutes.</p>
        {sent.testCode && <p className="mt-2 rounded-2xl bg-estimate-blush p-3 text-sm font-bold">TEST job, nothing is sent. Your code: {sent.testCode}</p>}
        <input className={`${input} mt-3 text-center font-display text-2xl tracking-[0.4em]`} inputMode="numeric" autoComplete="one-time-code" maxLength={6} aria-label="6-digit code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} />
        <button className={`${btn} mt-3`} disabled={busy || code.length !== 6} onClick={() => run(async () => onVerified((await check({ data: { token, code } })).session))}>Check my code</button>
        <button className="mt-2 h-12 w-full text-sm font-bold text-estimate-blue" onClick={() => { setSent(null); setCode(""); }}>Send a new code</button>
      </>}
      {err && <p role="alert" className="mt-2 text-sm font-semibold text-destructive">{err}</p>}
    </section>
  );
}

export function SignerFields({ v, set }: { v: { name: string; authority: "owner" | "authorised_representative"; sig: string }; set: (p: Partial<{ name: string; authority: "owner" | "authorised_representative"; sig: string }>) => void }) {
  return <div className="space-y-3">
    <div className="grid grid-cols-2 gap-2">{(["owner", "authorised_representative"] as const).map((k) => <button key={k} type="button" onClick={() => set({ authority: k })} className={`h-12 rounded-full border text-sm font-bold ${v.authority === k ? "border-estimate-navy bg-estimate-navy text-estimate-canvas" : "border-estimate-line bg-card"}`}>{k === "owner" ? "I'm the owner" : "Signing for the owner"}</button>)}</div>
    <label className="block text-sm font-semibold">Your full name<input className={`${input} mt-1`} value={v.name} onChange={(e) => set({ name: e.target.value })} /></label>
    <label className="block text-sm font-semibold">Type your name to sign<input className={`${input} mt-1 font-display italic`} value={v.sig} onChange={(e) => set({ sig: e.target.value })} /></label>
  </div>;
}

export const Tick = ({ on, set, children }: { on: boolean; set: (b: boolean) => void; children: React.ReactNode }) => (
  <label className="flex min-h-12 cursor-pointer items-start gap-3 py-2 text-sm"><input type="checkbox" className="mt-1 h-5 w-5" checked={on} onChange={(e) => set(e.target.checked)} /><span>{children}</span></label>
);
export const signBtn = btn;
