// Part 4 Task 11 (Jo 2 Nov 2026): ?screen=finish — "TWO LAST THINGS": 1 sign the rebate form (official ESC VEEC form), 2 pay the
// balance. Phone-first. A step already done shows as done and is not asked again; the page falls back if its state can't load.
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ownerSignAndPayFn, ownerSignAndPayFormFn, ownerSignAndPayStateFn } from "@/lib/owner-link.functions";
import { SIGN_AND_PAY, signAndPayBlockers, signAndPayButtons, signAndPayRows } from "@/lib/sign-and-pay.core";
import { OFFICE_EMAIL, P2, centsAud } from "@/lib/owner-pages.core";
import { AuthorityChoice, FactRows, FormCard, InfoBox, LockHint, LockedButton, OwnerFooter, PageIntro, SectionTitle, SmallNote, TickCard, TypedField } from "./OwnerPageKit";
import { OwnerCodeGate } from "./OwnerSign";

const errText = (e: unknown) => (e instanceof Error ? e.message : "Please try again.");

function useSession(token: string): [string | null, (value: string | null) => void] {
  const [value, setValue] = useState<string | null>(null);
  const key = `owner-verified-visit:${token}`;
  useEffect(() => { try { const saved = JSON.parse(sessionStorage.getItem(key) ?? "null"); if (saved?.expires > Date.now() && typeof saved.value === "string") setValue(saved.value); } catch { /* verification remains required */ } }, [key]);
  return [value, (next) => { setValue(next); try { if (next) sessionStorage.setItem(key, JSON.stringify({ value: next, expires: Date.now() + 30 * 60 * 1000 })); else sessionStorage.removeItem(key); } catch { /* memory-only session */ } }];
}

const Done = ({ children }: { children: string }) => <p className="mt-2 rounded-[10px] bg-estimate-mint p-3 text-sm font-bold">✓ {children}</p>;

export function OwnerSignAndPay({ token }: { token: string }) {
  const load = useServerFn(ownerSignAndPayStateFn);
  const form = useServerFn(ownerSignAndPayFormFn);
  const go = useServerFn(ownerSignAndPayFn);
  const qc = useQueryClient();
  const { data, isError, isLoading } = useQuery({ queryKey: ["owner-sign-and-pay", token], queryFn: () => load({ data: { token } }) });
  const [session, setSession] = useSession(token);
  const [needCode, setNeedCode] = useState<"card" | "bank" | "sign" | null>(null);
  const [authority, setAuthority] = useState<"owner" | "authorised_representative">("owner");
  const [tick, setTick] = useState(false);
  const [over18, setOver18] = useState(false);
  const [name, setName] = useState("");
  const [bank, setBank] = useState<string[] | null>(null);
  const [showText, setShowText] = useState(false);
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  if (!data) {
    if (isLoading) return <p role="status" className="py-10 text-center text-sm">Opening your page…</p>;
    return <section data-testid="sign-and-pay-error" className="space-y-4">
      <PageIntro kicker={SIGN_AND_PAY.kicker} title={SIGN_AND_PAY.title} />
      <p role="alert" className="text-sm font-semibold text-destructive">{isError ? "We couldn't open this page just now." : "This page isn't ready yet."}</p>
      <p className="text-xs text-estimate-sub">Something wrong? <a className="font-bold text-estimate-blue" href={`mailto:${OFFICE_EMAIL}?subject=${encodeURIComponent("My job page")}`}>Tell us</a></p>
      <OwnerFooter />
    </section>;
  }
  const { state, form: official } = data;
  const blockers = signAndPayBlockers({ tick, over18, typedName: name, state });
  const orderBlocked = !state.sign.done && !!state.sign.blocker;
  const ready = blockers.length === 0 && !orderBlocked;
  const buttons = signAndPayButtons(state);

  const openForm = async () => {
    setErr("");
    try {
      const d = await form({ data: { token } });
      if (!d) { setShowText(true); return; } // new PDF look not approved yet: the official wording is shown as text instead
      const bytes = Uint8Array.from(atob(d.base64), (c) => c.charCodeAt(0));
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      a.target = "_blank"; a.download = d.filename; a.rel = "noopener"; a.click();
    } catch (e) { setErr(errText(e)); }
  };
  const submit = async (method: "card" | "bank", s: string) => {
    setErr(""); setBusy(true);
    try {
      const r = await go({ data: { token, session: s, tick, over18, typedName: name.trim(), authorityType: authority, method } });
      await qc.invalidateQueries({ queryKey: ["owner-sign-and-pay", token] });
      if ("checkoutUrl" in r) window.location.assign(r.checkoutUrl);
      else if ("bank" in r) { setBank(r.bank); await qc.invalidateQueries({ queryKey: ["my-job", token] }); }
      else await qc.invalidateQueries({ queryKey: ["my-job", token] });
    } catch (e) { setErr(errText(e)); await qc.invalidateQueries({ queryKey: ["owner-sign-and-pay", token] }); } finally { setBusy(false); }
  };
  // "Sign my rebate form" (payment already done) signs only; the method is not used then.
  const press = (method: "card" | "bank" | "sign") => { if (!session) { setNeedCode(method); return; } void submit(method === "sign" ? "bank" : method, session); };

  return <section data-testid="sign-and-pay" className="space-y-4">
    <PageIntro kicker={SIGN_AND_PAY.kicker} title={SIGN_AND_PAY.title} />

    <FormCard eyebrow="STEP 1">
      <SectionTitle className="mt-1.5 mb-1">{SIGN_AND_PAY.step1}</SectionTitle>
      <p className="text-[13px] text-estimate-sub">{SIGN_AND_PAY.step1Sub}</p>
      <FactRows rows={signAndPayRows(state)} />
      <p className="mt-2 text-xs text-estimate-sub">Something wrong? <a className="font-bold text-estimate-blue" href={`mailto:${OFFICE_EMAIL}?subject=${encodeURIComponent("Rebate form details")}`}>Tell us</a></p>
      {state.sign.done ? <Done>{`You signed this on ${state.sign.signedOn ?? "an earlier day"}.`}</Done> : <>
        <button type="button" className="mt-2 text-[13px] font-bold text-estimate-blue" onClick={() => void openForm()}>{SIGN_AND_PAY.viewForm}</button>
        {showText && <div className="mt-2 space-y-2 rounded-[10px] bg-estimate-panel p-3 text-[13px] leading-relaxed">
          <pre className="whitespace-pre-wrap font-sans">{official.rights}</pre>
          <FactRows rows={official.rows} labelWidth="42%" />
          <pre className="whitespace-pre-wrap font-sans">{official.declarations.join("\n\n")}</pre>
        </div>}
        {orderBlocked ? <p role="status" className="mt-3 text-sm font-semibold">{state.sign.blocker}</p> : <>
          <TickCard on={tick} set={setTick} title={SIGN_AND_PAY.tick} bold={false} />
          <TickCard on={over18} set={setOver18} title={P2.tick3} bold={false} />
          <AuthorityChoice value={authority} onChange={setAuthority} />
          <TypedField label={SIGN_AND_PAY.nameLabel} value={name} onChange={setName} placeholder="Type here" autoComplete="name" />
        </>}
      </>}
    </FormCard>

    {(state.balance.paid || state.balance.payable) && <FormCard eyebrow="STEP 2">
          <SectionTitle className="mt-1.5 mb-1">{SIGN_AND_PAY.step2}</SectionTitle>
          {state.balance.paid ? <Done>Your balance is paid.</Done> : <p className="font-display text-3xl font-extrabold">{centsAud(state.balance.amountCents / 100)} <span className="text-base font-bold text-estimate-sub">{SIGN_AND_PAY.dueToday}</span></p>}
        </FormCard>}

    {bank && <InfoBox><b>Bank transfer</b><ul className="mt-1 space-y-0.5">{bank.map((l) => <li key={l}>{l}</li>)}</ul></InfoBox>}
    {needCode && !session && <OwnerCodeGate token={token} onVerified={(s) => { setSession(s); const m = needCode; setNeedCode(null); void submit(m === "sign" ? "bank" : m, s); }} />}
    {err && <p role="alert" className="text-sm font-semibold text-destructive">{err}</p>}
    {(buttons.card || buttons.sign) && <div>
      {buttons.sign
        ? <LockedButton ready={ready} busy={busy} busyLabel="Please wait…" onClick={() => press("sign")}>{buttons.sign}</LockedButton>
        : <>
          <LockedButton ready={ready || (state.sign.done && !state.balance.paid)} busy={busy} busyLabel="Please wait…" onClick={() => press("card")}>{buttons.card}</LockedButton>
          <button type="button" disabled={!(ready || (state.sign.done && !state.balance.paid)) || busy} onClick={() => press("bank")} className="mt-3 flex min-h-12 w-full items-center justify-center rounded-[14px] border border-estimate-blue px-4 text-[15px] font-bold text-estimate-blue disabled:opacity-50">{buttons.bank}</button>
        </>}
      {!ready && !state.sign.done && <LockHint>Tick both boxes and type your name</LockHint>}
    </div>}
    {(state.balance.paid || state.balance.payable) && <SmallNote>{SIGN_AND_PAY.footer}</SmallNote>}
    <OwnerFooter />
  </section>;
}
