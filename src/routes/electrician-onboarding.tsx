import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  acknowledgementsFor, agreementText, CAPACITY_BANDS, DAYS, LEAD_TIMES, RADII, RECT_ITEMS, REC_AGREEMENT_VERSION,
  firstName, parseRecSampleStep, recDraftRole, stepErrors, firstIncompleteStep, validAbn, visibleSteps, type RecData, type StepKey,
} from "@/lib/rec-onboarding.core";
import {
  confirmInsuranceUpload, getRecAgreement, insuranceUploadUrl, loadRecOnboarding, saveRecOnboarding, signRecAgreement, startRecOnboarding,
} from "@/lib/rec-onboarding.functions";
import { loadTeamInvite, respondTeamInvite } from "@/lib/teaming.functions";
import { defaultAddressProvider } from "@/lib/address-provider";
import type { AddressSuggestion } from "@/lib/whatif-location";
import { TradeOnboardingFooter, TradeOnboardingShell } from "@/components/portal/trade-onboarding-shell";

// Public REC (electrician) onboarding + partner agreement signing. Progress is saved
// server-side against an opaque resume token kept in this browser.
const BLUE = "#3C51C4";
const GREEN = "#07BF61";
const NAVY = "#22376B";
const MUTED = "#4A5578";
const TOKEN_KEY = "hivic_rec_onboarding_token";

export const Route = createFileRoute("/electrician-onboarding")({
  ssr: false,
  headers: () => ({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" }),
  head: () => ({ meta: [
    { title: "Electrician Partner Onboarding — Home Insulation Victoria" },
    { name: "description", content: "Join the Home Insulation Victoria trade partner network as a Registered Electrical Contractor." },
    { property: "og:title", content: "Electrician Partner Onboarding — Home Insulation Victoria" },
    { property: "og:description", content: "Join the Home Insulation Victoria trade partner network as a Registered Electrical Contractor." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
    { name: "robots", content: "noindex, nofollow" },
  ] }),
  component: RecOnboarding,
});

const input: React.CSSProperties = { width: "100%", padding: "12px 14px", borderRadius: 12, border: "1px solid #D7DCE8", fontSize: 15, fontFamily: "inherit", color: NAVY, background: "#fff", boxSizing: "border-box", minHeight: 48 };
const card: React.CSSProperties = { background: "#fff", borderRadius: 24, padding: 24, border: `1px solid ${BLUE}1A`, boxShadow: "0 10px 30px -18px rgba(34,55,107,.35)" };
const infoCard: React.CSSProperties = { background: "#EAF8F0", border: `1px solid ${GREEN}55`, borderRadius: 14, padding: "12px 14px", fontSize: 14, color: NAVY, lineHeight: 1.5, marginBottom: 18 };
const btn = (primary: boolean, disabled = false): React.CSSProperties => ({ minHeight: 48, padding: "0 20px", borderRadius: 12, border: primary ? "none" : `1px solid #D7DCE8`, background: primary ? (disabled ? "#8FDCAF" : GREEN) : "#fff", color: primary ? NAVY : BLUE, fontWeight: 800, fontSize: 14, cursor: disabled ? "default" : "pointer", fontFamily: "inherit" });

function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: "block", fontWeight: 700, fontSize: 14, color: NAVY, marginBottom: 6 }}>{label}{required && <span style={{ color: BLUE }}> *</span>}</label>
      {children}
      {hint && <div style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>{hint}</div>}
    </div>
  );
}
function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "12px 14px", border: "1px solid #D7DCE8", borderRadius: 12, marginBottom: 10, cursor: "pointer", background: checked ? "#F2F4FC" : "#fff", fontSize: 14, lineHeight: 1.5 }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ width: 20, height: 20, marginTop: 1, accentColor: BLUE, flexShrink: 0 }} />
      <span>{children}</span>
    </label>
  );
}
function Money({ value, onChange, unit }: { value: number | null | undefined; onChange: (v: number | null) => void; unit?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontWeight: 700 }}>$</span>
      <input style={{ ...input, maxWidth: 160 }} type="number" inputMode="decimal" min="0" step="0.01" value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} />
      {unit && <span style={{ color: MUTED, fontSize: 14 }}>/ {unit}</span>}
    </div>
  );
}
/** Type-ahead Victorian address lookup (same service as the website form). Selection fills the field; editing keeps free text. */
function AddressInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [items, setItems] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    const q = value.trim();
    if (q.length < 4) { setItems([]); setOpen(false); return; }
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = (await defaultAddressProvider.search(q)).slice(0, 6);
        if (mine !== seq.current) return;
        setItems(r); setOpen(r.length > 0);
      } catch { if (mine === seq.current) { setItems([]); setOpen(false); } }
      finally { if (mine === seq.current) setLoading(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [value]);
  return (
    <div style={{ position: "relative" }}>
      <input style={input} autoComplete="off" placeholder="Start typing your address…" value={value}
        onChange={(e) => onChange(e.target.value)} onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {loading && <div style={{ position: "absolute", right: 14, top: 14, fontSize: 12, color: MUTED }}>Searching…</div>}
      {open && (
        <ul style={{ position: "absolute", zIndex: 20, top: "100%", left: 0, right: 0, margin: "4px 0 0", padding: 0, listStyle: "none", background: "#fff", border: "1px solid #D7DCE8", borderRadius: 12, boxShadow: "0 12px 30px -12px rgba(34,55,107,.35)", overflow: "hidden" }}>
          {items.map((s) => (
            <li key={s.id} style={{ padding: "12px 14px", fontSize: 14, cursor: "pointer", borderBottom: "1px solid #F0F2F8" }}
              onMouseDown={(e) => { e.preventDefault(); onChange(s.label); setOpen(false); setItems([]); seq.current++; }}>{s.label}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Choice<T extends string | number | boolean>({ options, value, onChange }: { options: { v: T; l: string }[]; value: T | null | undefined; onChange: (v: T) => void }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {options.map((o) => {
        const on = value === o.v;
        return <button type="button" key={String(o.v)} onClick={() => onChange(o.v)} style={{ minHeight: 44, padding: "0 16px", borderRadius: 12, border: `1px solid ${on ? BLUE : "#D7DCE8"}`, background: on ? BLUE : "#fff", color: on ? "#fff" : NAVY, fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit" }}>{o.l}</button>;
      })}
    </div>
  );
}

function RecOnboarding() {
  const rawSample = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("sample") : null;
  const sampleStep = parseRecSampleStep(rawSample);
  const sampleMode = rawSample !== null;
  const invalidSample = sampleMode && sampleStep === null;
  const [token, setToken] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [started, setStarted] = useState(false);
  const [d, setD] = useState<RecData>({});
  const [step, setStep] = useState<StepKey>("about");
  const [status, setStatus] = useState<"draft" | "submitted">("draft");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [testMode, setTestMode] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("test") === "1");
  const [entryRole, setEntryRole] = useState<"business" | "worker" | null>(null);

  const [invite, setInvite] = useState<string | null>(null);
  const [inviteInfo, setInviteInfo] = useState<Awaited<ReturnType<typeof loadTeamInvite>> | null>(null);
  useEffect(() => {
    if (sampleMode) return;
    const i = new URLSearchParams(window.location.search).get("invite");
    if (!i) return;
    setInvite(i);
    loadTeamInvite({ data: { invite: i } }).then(setInviteInfo).catch((e) => setError(e instanceof Error ? e.message : "Invitation not found."));
  }, [sampleMode]);
  async function answerInvite(accept: boolean) {
    if (sampleMode) return;
    if (!invite) return;
    setBusy(true); setError(null);
    try {
      let t = token;
      if (accept && !t) { t = (await startRecOnboarding({ data: { test: testMode } })).token; localStorage.setItem(TOKEN_KEY, t); setToken(t); }
      await respondTeamInvite({ data: { invite, accept, recToken: accept ? t ?? undefined : undefined } });
      if (accept && t) { const r = await loadRecOnboarding({ data: { token: t } }); setD(r.data as RecData); setStatus(r.status as "draft" | "submitted"); setStarted(true); }
      setInviteInfo((x) => (x ? { ...x, answered: accept ? "accepted" : "declined" } : x));
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save your answer."); } finally { setBusy(false); }
  }

  useEffect(() => {
    if (invalidSample) { setLoaded(true); return; }
    if (sampleStep) {
      setD(SAMPLE_REC_DATA); setToken("sample-preview-token"); setTestMode(false);
      if (sampleStep === "welcome") { setStarted(false); setStatus("draft"); }
      else if (sampleStep === "submitted") { setStarted(true); setStatus("submitted"); }
      else { setStarted(true); setStatus("draft"); setStep(sampleStep); }
      setLoaded(true); return;
    }
    if (new URLSearchParams(window.location.search).get("reset") === "1") { localStorage.removeItem(TOKEN_KEY); setLoaded(true); return; }
    const t = localStorage.getItem(TOKEN_KEY);
    if (!t) { setLoaded(true); return; }
    loadRecOnboarding({ data: { token: t } }).then((r) => {
      setToken(t); setD(r.data as RecData); setStatus(r.status as "draft" | "submitted"); setStarted(true);
      if (r.test_mode) setTestMode(true);
      const first = firstIncompleteStep(r.data as RecData);
      setStep(r.status === "submitted" ? "sign" : ((first ?? r.step_key ?? "about") as StepKey));
    }).catch(() => localStorage.removeItem(TOKEN_KEY)).finally(() => setLoaded(true));
  }, [invalidSample, sampleStep]);

  const steps = useMemo(() => visibleSteps(d), [d]);
  const idx = Math.max(0, steps.findIndex((s) => s.key === step));
  const errs = stepErrors(step, d);
  const up = (patch: Partial<RecData>) => setD((x) => ({ ...x, ...patch }));

  async function beginBusiness() {
    if (sampleMode) {
      setD(SAMPLE_REC_DATA); setToken("sample-preview-token"); setStep("about"); setStarted(true); setError(null);
      return;
    }
    setBusy(true); setError(null);
    try {
      const { token: t } = await startRecOnboarding({ data: { test: testMode } });
      const initial: RecData = { ...d, works_under_rec: false };
      await saveRecOnboarding({ data: { token: t, step_key: "about", data: initial as never } });
      localStorage.setItem(TOKEN_KEY, t); setToken(t); setD(initial); setStarted(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not start."); } finally { setBusy(false); }
  }
  async function persist(nextStep: StepKey) {
    if (sampleMode) return;
    if (!token) return;
    const { insurance_uploaded: _u, ...data } = d;
    const r = await saveRecOnboarding({ data: { token, step_key: nextStep, data: data as never } });
    setD(r.data as RecData);
  }
  async function go(delta: 1 | -1) {
    setError(null);
    if (delta === 1 && d.works_under_rec === true) return; // workers join via the business invitation link
    if (delta === 1 && errs.length && !testMode && !sampleMode) { setShowErrors(true); return; }
    setShowErrors(false);
    const target = steps[Math.min(steps.length - 1, Math.max(0, idx + delta))]?.key ?? "about";
    setBusy(true);
    try { await persist(target); setStep(target); window.scrollTo({ top: 0 }); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not save."); } finally { setBusy(false); }
  }

  const shell = (children: React.ReactNode, footer?: React.ReactNode) => <TradeOnboardingShell {...(started && status === "draft" ? { progress: { current: idx + 1, total: steps.length, label: steps[idx]?.title ?? "Application" } } : {})} footer={footer ?? <TradeOnboardingFooter />}>{children}</TradeOnboardingShell>;

  if (!loaded) return shell(<p>Loading…</p>);

  if (invalidSample) return shell(<div style={card}><p className="text-xs font-extrabold uppercase tracking-[1.2px] text-estimate-green">Sample preview</p><h1 className="mt-2 text-[28px] leading-tight text-estimate-navy">That sample step is not available</h1><p className="mt-3 text-sm leading-relaxed">Open the welcome sample to review this flow safely. No data has been loaded or saved.</p><a href="/electrician-onboarding?sample=welcome" className="mt-5 inline-flex min-h-12 items-center rounded-xl bg-estimate-green px-5 text-sm font-extrabold text-estimate-navy">Open welcome sample →</a></div>);

  const previewBanner = sampleMode ? <div role="status" className="mb-4 rounded-xl border border-estimate-blue/25 bg-estimate-mist p-3 text-sm font-bold text-estimate-navy">Sample preview only — no data is saved and no application, invitation or signature is submitted.</div> : null;

  if (invite && inviteInfo && !inviteInfo.answered) return shell(
    <div style={card}>
      <div style={{ fontSize: 13, fontWeight: 700, color: GREEN, textTransform: "uppercase", letterSpacing: 0.8 }}>You've been invited</div>
       <h1 style={{ fontSize: 26, fontWeight: 800, margin: "8px 0 10px", color: NAVY }}>Hi {inviteInfo.firstName || "there"}, {inviteInfo.installer} invited you to connect</h1>
      {inviteInfo.usable ? <>
         <p style={{ fontSize: 15, lineHeight: 1.6, color: MUTED }}>Accept to continue the REC business application connected with {inviteInfo.installer}. Home Insulation Victoria still reviews the business, registration, insurance and licences before approving access. This does not guarantee jobs.</p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 18 }}>
           <button type="button" disabled={busy} onClick={() => answerInvite(true)} style={{ minHeight: 48, padding: "0 22px", borderRadius: 12, border: "none", background: GREEN, color: NAVY, fontWeight: 800, cursor: "pointer" }}>Accept and continue →</button>
          <button type="button" disabled={busy} onClick={() => answerInvite(false)} style={{ minHeight: 48, padding: "0 22px", borderRadius: 12, border: "1px solid #D7DCE8", background: "#fff", color: NAVY, fontWeight: 700, cursor: "pointer" }}>No thanks</button>
        </div>
      </> : <p style={{ color: "#B3261E" }}>{inviteInfo.reason}</p>}
      {error && <p style={{ color: "#B3261E" }}>{error}</p>}
    </div>,
  );
  if (invite && inviteInfo?.answered === "declined") return shell(<div style={card}><h1 style={{ color: BLUE }}>Thanks for letting us know</h1><p style={{ color: MUTED }}>We've told Home Insulation Victoria you'd rather not team up. You can still join our trade network any time from this page.</p></div>);

  if (!started) return shell(<div style={card}>
    {previewBanner}
    <p className="text-xs font-extrabold uppercase tracking-[1.2px] text-estimate-green">REC partner onboarding</p>
    <h1 className="mt-2 text-[30px] leading-tight text-estimate-navy sm:text-[36px]">Join our electrician network</h1>
    <p className="mt-4 text-[15px] leading-relaxed">Set up your REC business once. Then invite the licensed electricians who work with you.</p>
    <div className="mt-6 rounded-[18px] bg-estimate-mist p-4 sm:p-5">
      <h2 className="text-lg text-estimate-navy">Which describes you?</h2>
      <div className="mt-3 grid gap-3">
        <button type="button" aria-pressed={entryRole === "business"} onClick={() => setEntryRole("business")} className={`min-h-16 rounded-xl border-2 p-4 text-left text-sm font-bold leading-relaxed ${entryRole === "business" ? "border-estimate-blue bg-estimate-white" : "border-estimate-line bg-estimate-white"}`}>I’m setting up an REC business<br /><span className="font-normal">I’m authorised to provide its REC registration, ABN, insurance, rates and payment details.</span></button>
        <button type="button" aria-pressed={entryRole === "worker"} onClick={() => setEntryRole("worker")} className={`min-h-16 rounded-xl border-2 p-4 text-left text-sm font-bold leading-relaxed ${entryRole === "worker" ? "border-estimate-blue bg-estimate-white" : "border-estimate-line bg-estimate-white"}`}>I work for an REC business<br /><span className="font-normal">I need a personal invitation link from the business administrator.</span></button>
      </div>
    </div>
    {entryRole === "business" && <>
      <ul className="mt-6 space-y-3 text-sm leading-relaxed">{["One business profile for REC registration, ABN, insurance, coverage, proposed supplier rates and payment details.", "Clear job scope, agreed rates and central job records with Home Insulation Victoria coordination.", "After office approval, invite each staff electrician to provide their own licence details and declarations."].map((t) => <li key={t} className="flex gap-3"><span className="font-bold text-estimate-green">✓</span><span>{t}</span></li>)}</ul>
      <p className="mt-5 text-xs leading-relaxed text-estimate-navy/70">Progress is saved on this device. No invitation or application is sent automatically.</p>
      {error && <p role="alert" className="mt-3 text-sm font-bold text-danger">{error}</p>}
      <button className="mt-5 min-h-14 w-full rounded-xl bg-estimate-green px-5 py-3 text-base font-extrabold text-estimate-navy disabled:opacity-50" disabled={busy} onClick={beginBusiness}>{busy ? "Starting…" : "Set up my REC business →"}</button>
    </>}
    {entryRole === "worker" && <div className="mt-6 rounded-[18px] bg-estimate-blush p-5"><h2 className="text-lg text-estimate-navy">Ask your REC administrator for your link</h2><p className="mt-2 text-sm leading-relaxed">They create and copy a personal invitation from their Home Insulation Victoria portal. You then enter your own contact and Victorian electrical licence details and sign your declarations. The office must approve you before you can access assigned jobs.</p><p className="mt-3 text-sm font-bold">You do not need a separate business account or a shared company password.</p></div>}
  </div>);

  if (status === "submitted") return shell(
    <div style={{ ...card, textAlign: "center" }}>
      {previewBanner}
      <div style={{ width: 56, height: 56, borderRadius: "50%", background: GREEN, color: "#fff", fontSize: 28, lineHeight: "56px", margin: "0 auto 16px" }}>✓</div>
      <h1 style={{ fontSize: 24, fontWeight: 800, margin: "0 0 8px" }}>Thanks, {d.primary_contact_name?.split(" ")[0] || "partner"} — we've got everything.</h1>
      <p style={{ color: MUTED, lineHeight: 1.6 }}>Your application and signed agreement are now with the Home Insulation Victoria team. We'll review your details, check your REC registration, licences and insurance, and be in touch if we need anything else.</p>
       <p style={{ color: MUTED, lineHeight: 1.6 }}>The office will review the REC registration, insurance and application, then agree supplier rates before approving portal access. Approval and work are not guaranteed.</p>
       <div style={{ ...infoCard, textAlign: "left", marginTop: 8 }}><strong>What happens next:</strong> office review and rates agreed → business portal access arranged → invite each staff electrician → office approves each worker before job access. A REC owner who performs electrical work must also be listed and approved as a worker.</div>
       <p style={{ color: MUTED, lineHeight: 1.6 }}>Invitation links are created and copied in the portal; they are not sent automatically.</p>
      <p style={{ color: MUTED, fontSize: 13 }}>Agreement version {REC_AGREEMENT_VERSION} · A copy of everything you've submitted is kept on your file.</p>
    </div>,
  );

  const draftRole = recDraftRole(d);
  if (status === "draft" && draftRole !== "business") return shell(<div style={card}>
    {previewBanner}
    <p className="text-xs font-extrabold uppercase tracking-[1.2px] text-estimate-green">Resume your application</p>
    {draftRole === "worker" ? <>
      <h1 className="mt-2 text-[28px] leading-tight text-estimate-navy">Continue through your REC business invitation</h1>
      <div className="mt-5 rounded-[18px] bg-estimate-blush p-5"><h2 className="text-lg text-estimate-navy">Ask your REC administrator for your personal link</h2><p className="mt-2 text-sm leading-relaxed">Your saved answers show that you work under an REC business. The business administrator creates and copies your invitation from their portal. Your existing draft has not been converted or overwritten.</p></div>
    </> : <>
      <h1 className="mt-2 text-[28px] leading-tight text-estimate-navy">Are you setting up the REC business?</h1>
      <p className="mt-3 text-sm leading-relaxed">This older draft needs one role choice before it can continue. Your saved answers will remain in place.</p>
      <div className="mt-5 grid gap-3">
        <button type="button" onClick={async () => {
          const next = { ...d, works_under_rec: false };
          setBusy(true); setError(null);
          try { if (!sampleMode && token) await saveRecOnboarding({ data: { token, step_key: "about", data: next as never } }); setD(next); setStep("about"); }
          catch (e) { setError(e instanceof Error ? e.message : "Could not save your choice."); }
          finally { setBusy(false); }
        }} disabled={busy} className="min-h-14 rounded-xl bg-estimate-green px-5 text-left text-sm font-extrabold text-estimate-navy">Yes, I’m setting up the REC business →</button>
        <button type="button" onClick={() => setD((current) => ({ ...current, works_under_rec: true }))} className="min-h-14 rounded-xl border-2 border-estimate-line bg-estimate-white px-5 text-left text-sm font-bold text-estimate-navy">No, I work for an REC business</button>
      </div>
    </>}
    {error && <p role="alert" className="mt-3 text-sm font-bold text-danger">{error}</p>}
  </div>);

  const footer = (
    <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "#fff", borderTop: "1px solid #E4E8F0", padding: "12px 20px", zIndex: 10 }}>
      <div style={{ maxWidth: 672, margin: "0 auto", display: "flex", justifyContent: "space-between", gap: 12 }}>
        <button style={btn(false, busy || idx === 0)} disabled={busy || idx === 0} onClick={() => go(-1)}>Back</button>
        {step !== "sign" && <button style={btn(true, busy)} disabled={busy} onClick={() => go(1)}>{busy ? "Saving…" : "Save & continue"}</button>}
      </div>
    </div>
  );

  return shell(
    <div style={card}>
      {previewBanner}
      {testMode && !sampleMode && <div style={{ background: "#FFF8E6", border: "1px solid #E0A100", borderRadius: 12, padding: "10px 14px", fontSize: 13, fontWeight: 700, color: "#7A5A00", marginBottom: 14 }}>TEST MODE — validation is relaxed for testing. If submitted, this is stored as a test application and not treated as a real applicant.</div>}
      <p className="text-xs font-extrabold uppercase tracking-[1.2px] text-estimate-green">REC business application</p>
      <h1 style={{ fontSize: 26, fontWeight: 800, margin: "6px 0 4px", color: NAVY }}>{steps[idx]?.title}</h1>
      {firstName(d) && step !== "about" && <div style={{ fontSize: 14, color: MUTED, marginBottom: 12 }}>Application for {d.trading_name || d.legal_entity_name || `${firstName(d)}'s REC business`}.</div>}
      {!firstName(d) && <div style={{ marginBottom: 12 }} />}
        <StepBody step={step} d={d} up={up} token={token ?? ""} setError={setError} preview={sampleMode} />
        {step === "sign" && <SignStep d={d} token={token ?? ""} onSigned={() => setStatus("submitted")} preview={sampleMode} />}
      {showErrors && errs.length > 0 && (
        <div style={{ background: "#FDECEA", border: "1px solid #F5C2BE", borderRadius: 12, padding: "10px 14px", color: "#8C1D18", fontSize: 14, marginTop: 8 }}>
          {errs.map((e) => <div key={e}>• {e}</div>)}
        </div>
      )}
      {error && <p style={{ color: "#B3261E", fontSize: 14 }}>{error}</p>}
    </div>,
    footer,
  );
}

function StepBody({ step, d, up, token, setError, preview }: { step: StepKey; d: RecData; up: (p: Partial<RecData>) => void; token: string; setError: (s: string | null) => void; preview: boolean }) {
  const t = (k: keyof RecData, upper = false) => ({ value: (d[k] as string) ?? "", onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => up({ [k]: upper ? e.target.value.toUpperCase() : e.target.value } as Partial<RecData>) });
  switch (step) {
    case "about":
      return <>
        <div style={infoCard}><strong>Your licence and the business registration are different.</strong><br />Enter your own Victorian electrical licence. If you manage the business but are not a licensed electrician, contact our team for help setting up the REC profile.</div>
        <Field label="Authorised representative's name" required><input style={input} autoFocus placeholder="e.g. Sam Taylor" {...t("primary_contact_name")} /></Field>
        <Field label="Your personal Victorian electrical licence number" required hint="This is your individual ESV electrical licence, not the business REC registration number."><input style={input} {...t("licence_number", true)} /></Field>
        <Field label="Your mobile" required><input style={input} type="tel" {...t("business_phone")} /></Field>
        <Field label="Your email" required><input style={input} type="email" {...t("business_email")} /></Field>
      </>;
    case "business":
      return <>
        {d.works_under_rec === true ? <>
          <div style={infoCard}>Easy — no ABN, business, insurance, rates or bank details needed. The REC you work under holds all of that, agrees the rates and receives payment; we just verify with them. We only need your details and your licence.</div>
          <Field label="Your full legal name" required><input style={input} {...t("legal_entity_name")} /></Field>
          <Field label="The REC business you work under" required hint="Their registered business name"><input style={input} {...t("host_rec_name")} /></Field>
          <Field label="Their REC number" required hint="Ask them — it's on their ESV registration"><input style={input} {...t("host_rec_number", true)} /></Field>
        </> : d.works_under_rec === false ? <>
          <Field label="Legal entity / REC registered name" required><input style={input} {...t("legal_entity_name")} /></Field>
          <Field label="Trading name"><input style={input} {...t("trading_name")} /></Field>
          <Field label="ABN" required hint="11 digits"><input style={input} inputMode="numeric" {...t("abn")} /></Field>
          <Field label="REC number" required hint="Your Victorian REC registration"><input style={input} {...t("rec_registration_number", true)} /></Field>
          {validAbn(d.abn) && (d.rec_registration_number ?? "").trim() && <div style={{ ...infoCard, display: "inline-block" }}>✓ Ready for verification</div>}
        </> : null}
      </>;
    case "contact":
      return <>
        <Field label="Business address" required hint="Start typing and pick your address from the list"><AddressInput value={d.business_address ?? ""} onChange={(v) => up({ business_address: v })} /></Field>
        <div style={{ ...infoCard, marginBottom: 16 }}>Contact: <strong>{d.primary_contact_name}</strong> · {d.business_phone} · {d.business_email} — if any of these are wrong, go back to "About you".</div>
        {d.works_under_rec !== true && <Check checked={d.authorised_to_register === true} onChange={(v) => up({ authorised_to_register: v })}>I'm authorised to set up this REC.</Check>}
      </>;
    case "insurance":
      return <InsuranceStep d={d} up={up} token={token} setError={setError} preview={preview} />;
    case "services":
      return <>
        <div style={infoCard}>
          <strong>Every Home Insulation Victoria REC partner provides all three electrical services:</strong>
          <ol style={{ margin: "8px 0 0", paddingLeft: 20, lineHeight: 1.6 }}>
            <li><strong>PIESA</strong> — the pre-installation electrical safety assessment.</li>
            <li><strong>Electrical rectification</strong> — completing required electrical work after approval.</li>
            <li><strong>Installation-day electrical attendance</strong> — attending when required for the job.</li>
          </ol>
          <p style={{ margin: "8px 0 0", fontSize: 13, color: MUTED }}>Rectification and installation-day attendance happen when a job requires them. The insulation installer does the ceiling measure-up — you don't measure the ceiling.</p>
        </div>
        <Check checked={d.services_all_confirmed === true} onChange={(v) => up({ services_all_confirmed: v })}>I confirm our REC can provide all three electrical services listed above, as required for each job.</Check>
      </>;
    case "coverage":
      return <>
        <Field label="Service starting location" required><AddressInput value={d.service_origin ?? ""} onChange={(v) => up({ service_origin: v })} /></Field>
        {d.business_address && d.service_origin !== d.business_address && <button type="button" style={{ ...btn(false), marginBottom: 16 }} onClick={() => up({ service_origin: d.business_address ?? "" })}>Use business address</button>}
        <Field label="Travel radius" required><Choice options={RADII.map((r) => ({ v: r.v as number, l: r.l }))} value={d.travel_radius_km ?? null} onChange={(v) => up({ travel_radius_km: v })} /></Field>
        {d.travel_radius_km != null && <div style={infoCard}>You'll be offered jobs {d.travel_radius_km === 9999 ? "anywhere in Victoria" : `within ${d.travel_radius_km} km of your starting location`}.</div>}
        <Field label="Need to exclude a particular area?"><textarea style={{ ...input, minHeight: 70 }} {...t("excluded_areas")} /></Field>
      </>;
    case "availability": {
      const days = d.typical_days ?? [];
      return <>
        <Field label="Typical assessment days" required>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{DAYS.map((x) => { const on = days.includes(x); return <button key={x} type="button" onClick={() => up({ typical_days: on ? days.filter((y) => y !== x) : DAYS.filter((y) => days.includes(y) || y === x) })} style={{ minWidth: 56, minHeight: 44, borderRadius: 12, border: `1px solid ${on ? BLUE : "#D7DCE8"}`, background: on ? BLUE : "#fff", color: on ? "#fff" : NAVY, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>{x}</button>; })}</div>
        </Field>
        <Field label="Usual lead time" required><Choice options={LEAD_TIMES.map((l) => ({ v: l as string, l }))} value={d.normal_attendance_speed} onChange={(v) => up({ normal_attendance_speed: v })} /></Field>
      </>;
    }
    case "capacity":
      return <>
        <Field label="Weekly assessment visits" required><Choice options={CAPACITY_BANDS.map((b) => ({ v: b.v as string, l: b.v }))} value={d.capacity_band} onChange={(v) => up({ capacity_band: v })} /></Field>
        <Check checked={d.accepting_jobs === true} onChange={(v) => up({ accepting_jobs: v })}>Accepting new Home Insulation Victoria work now</Check>
      </>;
    case "assessment_pricing": {
      const unit = d.gst_registered === false ? "total rate" : "inc GST";
      return <>
        <Field label="GST registered?" required><Choice options={[{ v: true, l: "Yes" }, { v: false, l: "No" }]} value={d.gst_registered ?? null} onChange={(v) => up({ gst_registered: v })} /></Field>
        <div style={infoCard}>{d.gst_registered === false ? "Enter your total rates because the business is not GST registered." : "Enter rates including GST."} These are proposed supplier rates, not customer prices. Home Insulation Victoria reviews and agrees them with the business before use.</div>
        <Field label={`Pre-Insulation Electrical Safety Assessment (PIESA) visit (${unit})`} required hint="Formal electrical safety assessment and PIESA only. The installer completes the separate eligibility measure-up."><Money value={d.assessment_rate} onChange={(v) => up({ assessment_rate: v })} unit="visit" /></Field>
        {<Field label={`Installation-day attendance (${unit})`} required><Money value={d.installation_attendance_rate} onChange={(v) => up({ installation_attendance_rate: v })} unit="visit" /></Field>}
      </>;
    }
    case "rectification_pricing": {
      const r = d.rectification_rates ?? {};
      return <>
        <div style={infoCard}>{d.gst_registered === false ? "Enter total rates (not GST registered)." : "Enter rates including GST."}</div>
        {RECT_ITEMS.map((it) => <Field key={it.key} label={it.label} required><Money value={r[it.key]} onChange={(v) => up({ rectification_rates: { ...r, [it.key]: v } })} unit={it.unit} /></Field>)}
        <Field label="Certificate of Electrical Safety" required><Choice options={[{ v: "included" as const, l: "Included" }, { v: "separate" as const, l: "Separate fee" }]} value={d.coes_fee_choice || null} onChange={(v) => up({ coes_fee_choice: v })} /></Field>
        {d.coes_fee_choice === "separate" && <Field label="CoES fee" required><Money value={d.coes_fee} onChange={(v) => up({ coes_fee: v })} /></Field>}
        <p style={{ fontSize: 13, color: MUTED }}>Anything outside these standard items is quoted separately on the specific job before owner approval.</p>
      </>;
    }
    case "bank":
      return <>
        <div style={infoCard}>These details stay in your private partner application and are used only for approved Home Insulation Victoria payments.</div>
        <Field label="Account name" required><input style={input} autoComplete="off" {...t("bank_account_name")} /></Field>
        <Field label="BSB" required hint="6 digits"><input style={input} inputMode="numeric" autoComplete="off" {...t("bank_bsb")} /></Field>
        <Field label="Account number" required><input style={input} inputMode="numeric" autoComplete="off" {...t("bank_account_number")} /></Field>
      </>;
    case "review":
      return <ReviewStep d={d} up={up} token={token} preview={preview} />;
    default:
      return null;
  }
}

function InsuranceStep({ d, up, token, setError, preview }: { d: RecData; up: (p: Partial<RecData>) => void; token: string; setError: (s: string | null) => void; preview: boolean }) {
  const [uploading, setUploading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [found, setFound] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  async function onFile(f: File | undefined) {
    if (!f) return;
    if (preview) { setError("Sample preview only — certificate upload is disabled."); return; }
    setError(null);
    if (!["application/pdf", "image/jpeg", "image/png"].includes(f.type)) { setError("Upload a PDF, JPG or PNG."); return; }
    if (f.size > 20 * 1024 * 1024) { setError("File must be 20 MB or smaller."); return; }
    setUploading(true);
    try {
      const u = await insuranceUploadUrl({ data: { token, content_type: f.type as "application/pdf", size: f.size } });
      const { error } = await supabase.storage.from("partner-files").uploadToSignedUrl(u.path, u.token, f, { contentType: f.type });
      if (error) throw new Error("Upload failed. Please try again.");
      setChecking(true);
      const r = await confirmInsuranceUpload({ data: { token, path: u.path } });
      const x = r.extracted;
      const patch: Partial<RecData> = { insurance_uploaded: true };
      const notes: string[] = [];
      if (x) {
        if (x.insurer) patch.insurer = x.insurer;
        if (x.policy_number) patch.insurance_policy_number = x.policy_number;
        if (x.cover_amount) patch.public_liability_cover_amount = x.cover_amount;
        if (x.expiry) patch.public_liability_expiry = x.expiry;
        const norm = (v?: string | null) => (v ?? "").toLowerCase().replace(/pty|ltd|limited|the|[^a-z0-9]/g, "");
        if (x.insured_name) {
          const n = norm(x.insured_name);
          const ok = [d.legal_entity_name, d.trading_name].some((b) => { const m = norm(b); return !!m && (n.includes(m) || m.includes(n)); });
          if (!ok) notes.push(`The certificate is in the name "${x.insured_name}", which doesn't match your business name. Please check you uploaded the right certificate.`);
        } else notes.push("We couldn't read the insured business name — please check the certificate.");
        if (x.is_public_liability === false) notes.push("This doesn't look like a public liability certificate.");
        if (x.cover_amount && x.cover_amount < 5_000_000) notes.push("Cover shown is under the $5,000,000 minimum.");
        if (x.expiry && x.expiry < new Date().toISOString().slice(0, 10)) notes.push("This certificate appears to have expired.");
        setFound(x.insured_name ? `We read the certificate for ${x.insured_name} and filled in the details below — please check them.` : "We filled in what we could read below — please check the details.");
      } else setFound("We couldn't read the certificate automatically — please enter the details below.");
      setWarnings(notes);
      up(patch);
    } catch (e) { setError(e instanceof Error ? e.message : "Upload failed."); } finally { setUploading(false); setChecking(false); }
  }
  return <>
    {d.insurance_uploaded
      ? <div style={{ ...infoCard }}>✓ Certificate uploaded. It's stored privately — only the Home Insulation Victoria office can view it. {!preview && <label style={{ color: BLUE, fontWeight: 700, cursor: "pointer", marginLeft: 6 }}>Replace<input type="file" hidden accept="application/pdf,image/jpeg,image/png" onChange={(e) => onFile(e.target.files?.[0])} /></label>}</div>
      : <Field label="Certificate of Currency" required hint="PDF, JPG or PNG, up to 20 MB">
          <label style={{ ...btn(false, uploading), display: "inline-flex", alignItems: "center" }}>{checking ? "Checking certificate…" : uploading ? "Uploading…" : "Upload certificate"}<input type="file" hidden disabled={uploading} accept="application/pdf,image/jpeg,image/png" onChange={(e) => onFile(e.target.files?.[0])} /></label>
        </Field>}
    {checking && <div style={{ ...infoCard }}>Checking your certificate…</div>}
    {found && !checking && <div style={{ ...infoCard }}>{found}</div>}
    {warnings.map((w) => <div key={w} style={{ ...infoCard, borderColor: "#E0A100", background: "#FFF8E6" }}>⚠ {w}</div>)}
    <Field label="Insurer" required><input style={input} value={d.insurer ?? ""} onChange={(e) => up({ insurer: e.target.value })} /></Field>
    <Field label="Policy number" required><input style={input} value={d.insurance_policy_number ?? ""} onChange={(e) => up({ insurance_policy_number: e.target.value })} /></Field>
    <Field label="Public liability cover" required hint="Minimum $5,000,000"><Money value={d.public_liability_cover_amount} onChange={(v) => up({ public_liability_cover_amount: v })} /></Field>
    <Field label="Expiry date" required><input style={{ ...input, maxWidth: 220 }} type="date" value={d.public_liability_expiry ?? ""} onChange={(e) => up({ public_liability_expiry: e.target.value })} /></Field>
  </>;
}

function ReviewStep({ d, up, token, preview }: { d: RecData; up: (p: Partial<RecData>) => void; token: string; preview: boolean }) {
  const [text, setText] = useState<string | null>(null);
  const [version, setVersion] = useState("");
  useEffect(() => {
    if (preview) { setText(agreementText(d)); setVersion(REC_AGREEMENT_VERSION); return; }
    // Save first so the schedules reflect the latest answers, then load the exact text.
    getRecAgreement({ data: { token } }).then((a) => { setText(a.text); setVersion(a.version); }).catch(() => setText("Could not load the agreement. Please go back and try again."));
  }, [d, preview, token]);
  return <>
    <div style={{ fontSize: 12, fontWeight: 800, color: GREEN, textTransform: "uppercase", letterSpacing: 0.8 }}>Activity 48 · VEU</div>
    <div style={{ fontSize: 13, color: MUTED, marginBottom: 6 }}>Version {version}</div>
    <div style={{ fontSize: 14, marginBottom: 4 }}><strong>AP:</strong> DC Construction Solutions Pty Ltd trading as Home Insulation Victoria</div>
    <div style={{ fontSize: 14, marginBottom: 12 }}><strong>REC:</strong> {d.trading_name || d.legal_entity_name} · {d.rec_registration_number}</div>
    <div style={{ maxHeight: 420, overflowY: "auto", border: "1px solid #E4E8F0", borderRadius: 14, padding: 16, fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap", background: "#FBFCFA", marginBottom: 16 }}>{text ?? "Loading agreement…"}</div>
    <Check checked={d.agreement_reviewed === true} onChange={(v) => up({ agreement_reviewed: v })}>I've reviewed the REC partner agreement and the schedules above.</Check>
  </>;
}

function SignStep({ d, token, onSigned, preview }: { d: RecData; token: string; onSigned: () => void; preview: boolean }) {
  const [acks, setAcks] = useState<Record<string, boolean>>({});
  const [name, setName] = useState(d.primary_contact_name ?? "");
  const [position, setPosition] = useState("");
  const [email, setEmail] = useState(d.business_email ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ackList = acknowledgementsFor(d);
  const ready = ackList.every((a) => acks[a.key]) && name.trim().length > 1 && position.trim().length > 1 && email.includes("@");
  async function sign() {
    if (preview) { setErr("Sample preview only — no agreement was signed or submitted."); return; }
    setBusy(true); setErr(null);
    try {
      await signRecAgreement({ data: { token, signer_name: name, signer_position: position, signer_email: email, acknowledgements: acks, agreement_version: REC_AGREEMENT_VERSION } });
      onSigned(); window.scrollTo({ top: 0 });
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not sign."); } finally { setBusy(false); }
  }
  return <>
        <div style={infoCard}><strong>Electronic signature record.</strong> We store the exact wording you signed, its version, your details and the time, so both parties have the same record.</div>
    {ackList.map((a) => <Check key={a.key} checked={!!acks[a.key]} onChange={(v) => setAcks((x) => ({ ...x, [a.key]: v }))}>{a.text}</Check>)}
    <Field label="Signer full legal name" required><input style={input} value={name} onChange={(e) => setName(e.target.value)} /></Field>
    <Field label="Position / title" required><input style={input} placeholder="e.g. Director" value={position} onChange={(e) => setPosition(e.target.value)} /></Field>
    <Field label="Signer email" required><input style={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
    {err && <p style={{ color: "#B3261E", fontSize: 14 }}>{err}</p>}
    <button style={{ ...btn(true, !ready || busy), width: "100%" }} disabled={!ready || busy} onClick={sign}>{busy ? "Signing…" : preview ? "Preview only — signing disabled" : "Sign agreement & submit"}</button>
  </>;
}

const SAMPLE_REC_DATA: RecData = {
  works_under_rec: false, primary_contact_name: "Sample REC representative", licence_number: "ESV SAMPLE", business_phone: "0400 000 000", business_email: "sample@example.com",
  legal_entity_name: "Sample Electrical Pty Ltd", trading_name: "Sample Electrical", abn: "51824753556", rec_registration_number: "REC SAMPLE", business_address: "100 Sample Road, Melbourne VIC 3000", authorised_to_register: true,
  insurance_uploaded: true, insurer: "Sample insurer", insurance_policy_number: "SAMPLE-001", public_liability_cover_amount: 10_000_000, public_liability_expiry: "2099-12-31",
  services_all_confirmed: true, service_origin: "Melbourne VIC", travel_radius_km: 50, typical_days: ["Mon", "Tue", "Wed"], normal_attendance_speed: "3-5 business days", capacity_band: "6-10", accepting_jobs: true,
  gst_registered: true, assessment_rate: 330, installation_attendance_rate: 220, rectification_rates: { prohibited_luminaires: 55, circuit_protection: 110, rcd_installation: 220, tps_cable_replacement: 11, basic_protection: 165 }, coes_fee_choice: "included",
  bank_account_name: "Sample Electrical Pty Ltd", bank_bsb: "123-456", bank_account_number: "12345678", agreement_reviewed: true,
};
