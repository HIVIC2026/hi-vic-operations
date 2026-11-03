// Part 4 Task 5 (Jo 2 Nov 2026, answers 10 and 21): ?screen=clear — ONE page: 1 confirm the safety check, 2 sign the government
// consent form, 3 pay the 10% deposit. Phone-first. Steps already done (old flow) show as done and are not asked again.
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ownerConfirmSignPayFn, ownerConfirmSignPayFormFn, ownerConfirmSignPayStateFn } from "@/lib/owner-link.functions";
import { CONFIRM_SIGN_PAY, consentTickLine, confirmSignPayBlockers, confirmSignPayFooter, piesaConfirmTick } from "@/lib/confirm-sign-pay.core";
import { OWNER_DECLARATIONS } from "@/lib/consent.core";
import { OFFICE_EMAIL, centsAud } from "@/lib/owner-pages.core";
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

export function OwnerConfirmSignPay({ token }: { v?: unknown; token: string }) {
  const load = useServerFn(ownerConfirmSignPayStateFn);
  const form = useServerFn(ownerConfirmSignPayFormFn);
  const go = useServerFn(ownerConfirmSignPayFn);
  const qc = useQueryClient();
  const { data, isError, isLoading } = useQuery({ queryKey: ["owner-confirm-sign-pay", token], queryFn: () => load({ data: { token } }) });
  const [session, setSession] = useSession(token);
  const [needCode, setNeedCode] = useState<"card" | "bank" | null>(null);
  const [authority, setAuthority] = useState<"owner" | "authorised_representative">("owner");
  const [piesaTick, setPiesaTick] = useState(false);
  const [ticks, setTicks] = useState<[boolean, boolean, boolean, boolean]>([false, false, false, false]);
  const [name, setName] = useState("");
  const [bank, setBank] = useState<string[] | null>(null);
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  if (!data) {
    if (isLoading) return <p role="status" className="py-10 text-center text-sm">Opening your page…</p>;
    return <section data-testid="confirm-sign-pay-error" className="space-y-4">
      <PageIntro kicker={CONFIRM_SIGN_PAY.kicker} title={CONFIRM_SIGN_PAY.title} />
      <p role="alert" className="text-sm font-semibold text-destructive">{isError ? "We couldn't open this page just now." : "This page isn't ready yet."}</p>
      <p className="text-xs text-estimate-sub">Something wrong? <a className="font-bold text-estimate-blue" href={`mailto:${OFFICE_EMAIL}?subject=${encodeURIComponent("My job page")}`}>Tell us</a></p>
      <OwnerFooter />
    </section>;
  }
  const { state, footer } = data;
  const blockers = confirmSignPayBlockers({ piesaTick, consentTicks: ticks, typedName: name, state });
  const ready = blockers.length === 0;
  const amount = centsAud(state.deposit.amountCents / 100);

  const openForm = async (doc: "piesa" | "consent") => {
    setErr("");
    try {
      const d = await form({ data: { token, doc } });
      if (!d) { setErr("That form isn't ready yet. Please try again soon."); return; }
      const bytes = Uint8Array.from(atob(d.base64), (c) => c.charCodeAt(0));
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      a.target = "_blank"; a.download = d.filename; a.rel = "noopener"; a.click();
    } catch (e) { setErr(errText(e)); }
  };
  const submit = async (method: "card" | "bank", s: string) => {
    setErr(""); setBusy(true);
    try {
      const r = await go({ data: { token, session: s, piesaTick, consentTicks: ticks, typedName: name.trim(), authorityType: authority, method } });
      await qc.invalidateQueries({ queryKey: ["owner-confirm-sign-pay", token] });
      if ("checkoutUrl" in r) window.location.assign(r.checkoutUrl);
      else if ("bank" in r) { setBank(r.bank); await qc.invalidateQueries({ queryKey: ["my-job", token] }); }
      else await qc.invalidateQueries({ queryKey: ["my-job", token] });
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const press = (method: "card" | "bank") => { if (!session) { setNeedCode(method); return; } void submit(method, session); };
  const viewBtn = (doc: "piesa" | "consent") => <button type="button" className="mt-2 text-[13px] font-bold text-estimate-blue" onClick={() => void openForm(doc)}>{CONFIRM_SIGN_PAY.viewForm}</button>;
  const needName = !state.piesa.done || !state.consent.done;

  return <section data-testid="confirm-sign-pay" className="space-y-4">
    <PageIntro kicker={CONFIRM_SIGN_PAY.kicker} title={CONFIRM_SIGN_PAY.title} />

    <FormCard eyebrow="STEP 1">
      <SectionTitle className="mt-1.5 mb-1">{CONFIRM_SIGN_PAY.step1}</SectionTitle>
      <FactRows rows={[{ label: "Checked on", value: state.piesa.checkedOn }, { label: "Electrician", value: state.piesa.electrician }, { label: "Result", value: state.piesa.result }]} />
      {state.piesa.done ? <Done>You've already confirmed this.</Done> : <>
        <TickCard on={piesaTick} set={setPiesaTick} title={piesaConfirmTick(state.piesa.checkedOn)} bold={false} />
        {viewBtn("piesa")}
      </>}
    </FormCard>

    <FormCard eyebrow="STEP 2">
      <SectionTitle className="mt-1.5 mb-1">{CONFIRM_SIGN_PAY.step2}</SectionTitle>
      <p className="text-[13px] text-estimate-sub">{CONFIRM_SIGN_PAY.step2Sub}</p>
      <FactRows rows={[{ label: "Name", value: state.consent.name || "—" }, { label: "Address", value: state.consent.address || "—" }, { label: "Phone", value: state.consent.phone || "—" }, { label: "Email", value: state.consent.email || "—" }]} />
      <p className="mt-2 text-xs text-estimate-sub">Something wrong? <a className="font-bold text-estimate-blue" href={`mailto:${OFFICE_EMAIL}?subject=${encodeURIComponent("Correct my details")}`}>Tell us</a></p>
      {state.consent.done ? <Done>{`You signed this on ${state.consent.signedOn ?? "an earlier day"}.`}</Done> : <>
        {OWNER_DECLARATIONS.map((d, n) => <TickCard key={d.key} on={ticks[n] === true} set={(b) => setTicks((t) => t.map((x, k) => (k === n ? b : x)) as typeof ticks)} title={consentTickLine(d.key, d.text)} bold={false} />)}
        {viewBtn("consent")}
      </>}
    </FormCard>

    {needName && <FormCard>
      <AuthorityChoice value={authority} onChange={setAuthority} />
      <TypedField label={CONFIRM_SIGN_PAY.nameLabel} value={name} onChange={setName} placeholder="Type here" autoComplete="name" />
    </FormCard>}

    <FormCard eyebrow="STEP 3">
      <SectionTitle className="mt-1.5 mb-1">{CONFIRM_SIGN_PAY.step3}</SectionTitle>
      {state.deposit.paid ? <Done>Your deposit is paid.</Done> : <p className="font-display text-3xl font-extrabold">{amount}</p>}
    </FormCard>

    {bank && <InfoBox><b>Bank transfer</b><ul className="mt-1 space-y-0.5">{bank.map((l) => <li key={l}>{l}</li>)}</ul></InfoBox>}
    {needCode && !session && <OwnerCodeGate token={token} onVerified={(s) => { setSession(s); const m = needCode; setNeedCode(null); void submit(m, s); }} />}
    {err && <p role="alert" className="text-sm font-semibold text-destructive">{err}</p>}
    {!state.deposit.paid && <div>
      <LockedButton ready={ready} busy={busy} busyLabel="Please wait…" onClick={() => press("card")}>{CONFIRM_SIGN_PAY.card}</LockedButton>
      <button type="button" disabled={!ready || busy} onClick={() => press("bank")} className="mt-3 flex min-h-12 w-full items-center justify-center rounded-[14px] border border-estimate-blue px-4 text-[15px] font-bold text-estimate-blue disabled:opacity-50">{CONFIRM_SIGN_PAY.bank}</button>
      {!ready && <LockHint>Tick the boxes and type your name</LockHint>}
    </div>}
    {footer && <SmallNote>{confirmSignPayFooter(footer.installer, footer.installBy)}</SmallNote>}
    <OwnerFooter />
  </section>;
}
