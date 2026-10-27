import { BLUE, GREEN, NAVY, MUTED, btn, Check } from "@/components/rec/rec-ui";
import { RecReviewPanel, type ReviewedAgreement } from "@/components/rec/RecReviewPanel";
import { WorkerStop } from "@/components/portal/worker-stop";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import logo from "@/assets/home-insulation-victoria-logo.png.asset.json";
import {
  acknowledgementsFor, agreementText, DAYS, LEAD_TIMES, RADII, RECT_ITEMS, REC_AGREEMENT_VERSION, MIN_REC_PL_COVER,
  applyMaterialReset, isAlwaysMandatoryStep, pageErrors, pageMembers, parseRecSampleStep, firstIncompleteStep, stepErrors, recReviewGateOpen, resumeFailureMode, MAX_CUSTOM_RECT_ITEMS, validAbn, validBusinessEmail, visiblePageForStep, visibleSteps, type RecData, type ResolvedAddress, type StepKey,
} from "@/lib/rec-onboarding.core";
import {
  confirmInsuranceUpload, getRecAgreement, insuranceUploadUrl, loadRecOnboarding, saveRecOnboarding, signRecAgreement, startRecOnboarding,
} from "@/lib/rec-onboarding.functions";
import { signRecWithRecovery } from "@/lib/rec-sign.core";
import { loadTeamInvite, respondTeamInvite } from "@/lib/teaming.functions";
import { newResumeToken, takeStaffLink } from "@/lib/onboarding-security.core";
import { prepareCertificate } from "@/lib/certificate-file";
import { VerifiedAddressInput } from "@/components/onboarding/VerifiedAddressInput";

// Public REC (electrician) onboarding + partner agreement signing. Progress is saved
// server-side against an opaque resume token kept in this browser.
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
const card: React.CSSProperties = { background: "#fff", borderRadius: 22, padding: 24, border: "1px solid #E4E9F5", boxShadow: "0 18px 40px -26px rgba(34,55,107,.28), 0 2px 6px -4px rgba(34,55,107,.08)" };
const DISPLAY = "'Outfit', 'Figtree', system-ui, sans-serif";
const infoCard: React.CSSProperties = { background: "#EAF8F0", border: `1px solid ${GREEN}55`, borderRadius: 14, padding: "12px 14px", fontSize: 14, color: NAVY, lineHeight: 1.5, marginBottom: 18 };

function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: "block", fontWeight: 700, fontSize: 14, color: NAVY, marginBottom: 6 }}>{label}{required && <span style={{ color: BLUE }}> *</span>}</label>
      {children}
      {hint && <div style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>{hint}</div>}
    </div>
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

/** Green tick list — used wherever we tell the REC what we provide, so it reads as a checklist not a paragraph. */
function TickList({ items }: { items: string[] }) {
  return (
    <ul style={{ margin: "10px 0 0", padding: 0, listStyle: "none" }}>
      {items.map((line) => (
        <li key={line} style={{ display: "flex", gap: 10, alignItems: "flex-start", marginTop: 8 }}>
          <span aria-hidden="true" style={{ flexShrink: 0, width: 22, height: 22, borderRadius: "50%", background: GREEN, color: "#fff", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", marginTop: 1 }}>✓</span>
          <span>{line}</span>
        </li>
      ))}
    </ul>
  );
}

/** A titled block that groups related fields, so a pricing step reads as sections instead of one long list. */
function Group({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section style={{ borderTop: "1px solid #E4E8F0", paddingTop: 16, marginTop: 18, marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
        <strong style={{ fontFamily: DISPLAY, fontSize: 15, color: NAVY }}>{title}</strong>
        {note && <span style={{ background: "#fff", border: `1px solid ${GREEN}66`, borderRadius: 999, padding: "4px 12px", fontSize: 12.5, fontWeight: 700, color: NAVY, whiteSpace: "nowrap" }}>{note}</span>}
      </div>
      {children}
    </section>
  );
}

/** One rate line: item name on the left, amount on the right, so the rate schedule scans like a table. */
function RateRow({ label, unit, value, onChange, last = false }: { label: string; unit: string; value: number | null | undefined; onChange: (v: number | null) => void; last?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", padding: "10px 0", borderBottom: last ? "none" : "1px solid #EDF0F7" }}>
      <span style={{ fontWeight: 700, fontSize: 14, color: NAVY }}>{label}<span style={{ color: BLUE }}> *</span></span>
      <Money value={value} onChange={onChange} unit={unit} />
    </div>
  );
}

/** Australian address lookup. Free text is never treated as a verified address. */
function AddressInput({ value, resolved, onChange, onSelect, onPendingChange, victoriaOnly = false, id = "address" }: { value: string; resolved?: ResolvedAddress | null | undefined; onChange: (v: string) => void; onSelect: (v: ResolvedAddress | null) => void; onPendingChange?: (pending: boolean) => void; victoriaOnly?: boolean; id?: string }) {
  return <VerifiedAddressInput id={id} value={value} resolved={resolved} onChange={onChange} onSelect={onSelect} onPendingChange={onPendingChange} victoriaOnly={victoriaOnly} inputStyle={input} mutedColor={MUTED} />;

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
  const [addressPending, setAddressPending] = useState(false);
  const navigationLock = useRef(false);
  const latestData = useRef(d);
  latestData.current = d;
  const [baseUpdatedAt, setBaseUpdatedAt] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState<ReviewedAgreement | null>(null);
  const [resumeState, setResumeState] = useState<"ok" | "retry" | "invalid">("ok");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  // Test mode is decided by the server (staff-issued link only); `testMode` = relaxed required steps.
  const [testMode, setTestMode] = useState(false);
  const [isTest, setIsTest] = useState(false);
  const [staffLink] = useState(() => takeStaffLink());
  const startWith = async () => {
    const r = await startRecOnboarding({ data: { token: newResumeToken(), ...(staffLink ? { staff_link: staffLink } : {}) } });
    setIsTest(r.test_mode); setTestMode(r.relaxed);
    return r;
  };

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
      if (accept && !t) { t = (await startWith()).token; localStorage.setItem(TOKEN_KEY, t); setToken(t); }
      await respondTeamInvite({ data: { invite, accept, recToken: accept ? t ?? undefined : undefined } });
      if (accept && t) { const r = await loadRecOnboarding({ data: { token: t } }); setD(r.data as RecData); setBaseUpdatedAt(r.updated_at); setStatus(r.status as "draft" | "submitted"); setStarted(true); }
      setInviteInfo((x) => (x ? { ...x, answered: accept ? "accepted" : "declined" } : x));
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save your answer."); } finally { setBusy(false); }
  }

  useEffect(() => {
    if (invalidSample) { setLoaded(true); return; }
    if (sampleStep) {
      setD(SAMPLE_REC_DATA); setToken("sample-preview-token"); setTestMode(false);
      if (sampleStep === "welcome") { setStarted(false); setStatus("draft"); }
      else if (sampleStep === "submitted") { setStarted(true); setStatus("submitted"); }
      else { setStarted(true); setStatus("draft"); setStep(visiblePageForStep(sampleStep)); }
      setLoaded(true); return;
    }
    if (new URLSearchParams(window.location.search).get("reset") === "1") { localStorage.removeItem(TOKEN_KEY); setLoaded(true); return; }
    const t = localStorage.getItem(TOKEN_KEY);
    if (!t) { setLoaded(true); return; }
    loadRecOnboarding({ data: { token: t } }).then((r) => {
      setResumeState("ok"); setError(null); resumeLoadFailed.current = false;
      setToken(t); setD(r.data as RecData); setBaseUpdatedAt(r.updated_at); setStatus(r.status as "draft" | "submitted"); setStarted(true);
      setIsTest(!!r.test_mode); setTestMode(!!r.relaxed);
      const first = firstIncompleteStep(r.data as RecData);
      setStep(r.status === "submitted" ? "sign" : (first ?? visiblePageForStep(r.step_key)));
    }).catch((e) => {
      // Never clear the saved token here; only an explicit "Start a new application" does.
      resumeLoadFailed.current = true;
      const mode = resumeFailureMode(e);
      setResumeState(mode);
      setError(mode === "invalid" ? "This saved application link is no longer valid." : "We couldn't load your saved application just now. Your progress is safe — try again in a moment.");
    }).finally(() => setLoaded(true));
  }, [invalidSample, sampleStep, loadAttempt]);
  useEffect(() => {
    if (!started || status !== "draft") return;
    const onPop = (event: PopStateEvent) => { const candidate = visiblePageForStep(event.state?.recStep); if (visibleSteps(latestData.current).some((item) => item.key === candidate)) setStep(candidate); };
    window.addEventListener("popstate", onPop); return () => window.removeEventListener("popstate", onPop);
  }, [started, status]);

  const steps = useMemo(() => visibleSteps(d), [d]);
  const idx = Math.max(0, steps.findIndex((s) => s.key === step));
  const errs = pageErrors(step, d);
  const up = (patch: Partial<RecData>) => setD((x) => applyMaterialReset(x, { ...x, ...patch }));

  const resumeLoadFailed = useRef(false);
  async function begin() {
    if (resumeLoadFailed.current) {
      if (resumeState === "invalid") { localStorage.removeItem(TOKEN_KEY); resumeLoadFailed.current = false; setResumeState("ok"); setError(null); }
      else { setError(null); setLoadAttempt((x) => x + 1); return; }
    }
    if (token) { setStarted(true); setError(null); return; }
    if (sampleMode) { setD(SAMPLE_REC_DATA); setToken("sample-preview-token"); setStep("about"); setStarted(true); setError(null); return; }
    setBusy(true); setError(null);
    try {
      const { token: t } = await startWith();
      localStorage.setItem(TOKEN_KEY, t); setToken(t); setStarted(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not start."); } finally { setBusy(false); }
  }
  async function persist(nextStep: StepKey) {
    if (sampleMode) return;
    if (!token) return;
    const submitted = d;
    const { insurance_uploaded: _u, ...data } = submitted;
    const r = await saveRecOnboarding({ data: { token, step_key: nextStep, data: data as never, base_updated_at: baseUpdatedAt } });
    setBaseUpdatedAt(r.updated_at);
    setD((current) => {
      const server = r.data as RecData;
      const concurrent = Object.fromEntries(Object.keys(current).filter((key) => JSON.stringify(current[key as keyof RecData]) !== JSON.stringify(submitted[key as keyof RecData])).map((key) => [key, current[key as keyof RecData]])) as Partial<RecData>;
      const merged = applyMaterialReset(server, { ...server, ...concurrent });
      return { ...merged, agreement_reviewed: server.agreement_reviewed === false ? false : (merged.agreement_reviewed ?? false) };
    });
  }
  async function go(delta: 1 | -1) {
    if (navigationLock.current || addressPending) return;
    navigationLock.current = true; setError(null);
    try {
      if (delta === 1 && d.works_under_rec === true) return;
      const underCover = step === "insurance" && d.works_under_rec !== true && typeof d.public_liability_cover_amount === "number" && d.public_liability_cover_amount < MIN_REC_PL_COVER;
      const mandatoryGroupError = pageMembers(step).some((member) => isAlwaysMandatoryStep(member) && stepErrors(member, d).length > 0);
      const reviewBlocked = step === "review" && !recReviewGateOpen(d, reviewed);
      if (delta === 1 && (underCover || mandatoryGroupError || reviewBlocked || (errs.length && !testMode && !sampleMode))) { setShowErrors(true); return; }
      setShowErrors(false);
      const target = steps[Math.min(steps.length - 1, Math.max(0, idx + delta))]?.key ?? "about";
      if (delta === -1) { setStep(target); window.history.pushState({ recStep: target }, ""); window.scrollTo({ top: 0 }); }
      setBusy(true);
      await persist(target);
      if (delta === 1) { setStep(target); window.history.pushState({ recStep: target }, ""); window.scrollTo({ top: 0 }); }
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save."); }
    finally { navigationLock.current = false; setBusy(false); }
  }

  const shell = (children: React.ReactNode, footer?: React.ReactNode) => (
    <div style={{ minHeight: "100vh", background: "#FBFCFA", fontFamily: "'Figtree', system-ui, sans-serif", color: NAVY, overflowX: "hidden" }}>
      <style>{`h1,h2,h3{font-family:${DISPLAY}}`}</style>
      <header style={{ position: "sticky", top: 0, zIndex: 10, background: "rgba(251,252,250,.96)", borderBottom: "1px solid #E4E9F5" }}>
        <div style={{ maxWidth: 672, margin: "0 auto", padding: "10px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <img src={logo.url} alt="Home Insulation Victoria" style={{ height: 40 }} />
          {started && status === "draft" && <span style={{ fontSize: 13, fontWeight: 700, color: MUTED }}>{idx + 1} of {steps.length}</span>}
        </div>
        {started && status === "draft" && (
          <div style={{ maxWidth: 672, margin: "0 auto", padding: "0 20px 10px" }}>
            <div style={{ height: 6, borderRadius: 99, background: "#E4E8F0", overflow: "hidden" }}>
              <div style={{ width: `${((idx + 1) / steps.length) * 100}%`, height: "100%", background: `linear-gradient(90deg, ${GREEN}, ${BLUE})`, transition: "width .3s" }} />
            </div>
          </div>
        )}
      </header>
      <main style={{ maxWidth: 672, margin: "0 auto", padding: "24px 20px 120px" }}>{children}</main>
      {footer}
    </div>
  );

  if (!loaded) return shell(<p>Loading…</p>);
  if (invalidSample) return shell(<div style={card}><h1 style={{ fontSize: 24, fontWeight: 800, color: BLUE }}>That sample step is not available</h1><p style={{ color: MUTED }}>No data has been loaded or saved.</p><a href="/electrician-onboarding?sample=welcome" style={{ color: BLUE, fontWeight: 700 }}>Open the welcome sample →</a></div>);
  const previewBanner = sampleMode ? <div role="status" style={{ background: "#FFF8E6", border: "1px solid #E0A100", borderRadius: 12, padding: "10px 14px", fontSize: 13, fontWeight: 700, color: "#7A5A00", marginBottom: 14 }}>SAMPLE PREVIEW — no data is saved and no application, invitation or signature is submitted.</div> : null;

  if (invite && inviteInfo && !inviteInfo.answered) return shell(
    <div style={card}>
      <div style={{ fontSize: 13, fontWeight: 700, color: GREEN, textTransform: "uppercase", letterSpacing: 0.8 }}>You've been invited</div>
      <h1 style={{ fontSize: 26, fontWeight: 800, margin: "8px 0 10px", color: BLUE }}>Hi {inviteInfo.firstName || "there"}, {inviteInfo.installer} has chosen you as their preferred electrician</h1>
      {inviteInfo.usable ? <>
        <p style={{ fontSize: 15, lineHeight: 1.6, color: MUTED }}>Join Home Insulation Victoria's trade network and you'll be teamed up with {inviteInfo.installer}. Once Home Insulation Victoria has checked your licence, REC and insurance, their jobs in your area come straight to you.</p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 18 }}>
          <button type="button" disabled={busy} onClick={() => answerInvite(true)} style={{ minHeight: 48, padding: "0 22px", borderRadius: 12, border: "none", background: BLUE, color: "#fff", fontWeight: 800, cursor: "pointer" }}>Yes, team me up and sign up</button>
          <button type="button" disabled={busy} onClick={() => answerInvite(false)} style={{ minHeight: 48, padding: "0 22px", borderRadius: 12, border: "1px solid #D7DCE8", background: "#fff", color: NAVY, fontWeight: 700, cursor: "pointer" }}>No thanks</button>
        </div>
      </> : <p style={{ color: "#B3261E" }}>{inviteInfo.reason}</p>}
      {error && <p style={{ color: "#B3261E" }}>{error}</p>}
    </div>,
  );
  if (invite && inviteInfo?.answered === "declined") return shell(<div style={card}><h1 style={{ color: BLUE }}>Thanks for letting us know</h1><p style={{ color: MUTED }}>We've told Home Insulation Victoria you'd rather not team up. You can still join our trade network any time from this page.</p></div>);

  if (!started) return shell(
    <div style={{ ...card, padding: 0, overflow: "hidden" }}>
      <div style={{ height: 6, background: `linear-gradient(90deg, ${GREEN}, ${BLUE})` }} />
      <div style={{ padding: "28px 26px 26px" }}>
        {previewBanner}
        <div style={{ display: "inline-block", fontSize: 12, fontWeight: 800, color: "#7B3553", textTransform: "uppercase", letterSpacing: 1.2, fontFamily: DISPLAY, background: "#FCE7F0", borderRadius: 999, padding: "5px 12px" }}>REC partners</div>
        <h1 style={{ fontSize: 30, fontWeight: 800, margin: "14px 0 8px", color: NAVY, lineHeight: 1.2 }}>Join our <span style={{ textDecoration: "underline", textDecorationColor: "#F4A9C7", textUnderlineOffset: 5 }}>electrical</span> network</h1>
        <p style={{ fontSize: 15, lineHeight: 1.55, color: MUTED, margin: "0 0 22px" }}>Register your REC with Home Insulation Victoria.</p>
        <div style={{ margin: "0 0 6px", fontFamily: DISPLAY, fontWeight: 800, fontSize: 13, color: NAVY }}>What you'll need</div>
        <div style={{ marginBottom: 20 }}>
          {[
            "REC registration + ABN",
            "Your personal Victorian electrician licence",
            "Public liability Certificate of Currency",
            "Your supplier rates + bank details",
          ].map((t, i, arr) => (
            <div key={t} style={{ display: "flex", gap: 10, alignItems: "center", padding: "7px 0", fontSize: 14, fontWeight: 600, color: NAVY }}>
              <span aria-hidden="true" style={{ flexShrink: 0, color: GREEN, fontSize: 17, fontWeight: 900 }}>✓</span>
              {t}
            </div>
          ))}
        </div>
        {error && <p style={{ color: "#B3261E" }}>{error}</p>}
        <button style={{ ...btn(true, busy), width: "100%", minHeight: 52, borderRadius: 16, fontSize: 15 }} disabled={busy} onClick={begin}>{busy ? "Starting…" : resumeState === "invalid" ? "Start a new application →" : resumeState === "retry" ? "Try again →" : token ? "Continue registration →" : "Start registration →"}</button>
        <p style={{ fontSize: 12, color: MUTED, textAlign: "center", margin: "10px 0 0" }}>Save your progress after each step.</p>
      </div>
    </div>,
  );

  if (status === "submitted") return shell(
    <div style={{ ...card, textAlign: "center" }}>
      {previewBanner}
      <div style={{ width: 56, height: 56, borderRadius: "50%", background: GREEN, color: "#fff", fontSize: 28, lineHeight: "56px", margin: "0 auto 16px" }}>✓</div>
      <h1 style={{ fontSize: 24, fontWeight: 800, margin: "0 0 8px" }}>Thanks, {d.primary_contact_name?.split(" ")[0] || "partner"} — your application is in</h1>
      <p style={{ color: MUTED, lineHeight: 1.6 }}>Your signed agreement and business details are now with Home Insulation Victoria.</p>
      <div style={{ ...infoCard, textAlign: "left", marginTop: 8 }}>
        <strong>What we're checking</strong>
        <TickList items={["Your REC registration and licences", "Your $5 million public liability insurance", "Your proposed rates"]} />
      </div>
      <div style={{ ...infoCard, textAlign: "left", marginTop: 12 }}>
        <strong>What happens next</strong>
        <TickList items={["We confirm your approval and agreed rates", "Your business gets access to the portal", "Your administrator invites your electricians to add their details", "We approve each electrician before they can see jobs"]} />
      </div>
      <p style={{ color: MUTED, fontSize: 13, textAlign: "left" }}>We'll contact you if we need anything else. If the business owner will do electrical work, they also need their own approved electrician profile. Payments follow the timing in your signed agreement and each accepted job.</p>
      <p style={{ color: MUTED, fontSize: 13 }}>Agreement version {REC_AGREEMENT_VERSION} · A copy of everything you've submitted is kept on your file.</p>
    </div>,
  );

  const footer = (
    <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "#fff", borderTop: "1px solid #E4E8F0", padding: "12px 20px", zIndex: 10 }}>
      <div style={{ maxWidth: 672, margin: "0 auto", display: "flex", justifyContent: "space-between", gap: 12 }}>
         <button style={btn(false, busy || addressPending)} disabled={busy || addressPending} onClick={() => { if (idx === 0) { setStarted(false); window.scrollTo({ top: 0 }); } else void go(-1); }}>Back</button>
        {step !== "sign" && !(step === "about" && d.works_under_rec === true) && <button style={btn(true, busy || addressPending)} disabled={busy || addressPending} onClick={() => go(1)}>{addressPending ? "Checking address…" : busy ? "Saving…" : "Save & continue"}</button>}
      </div>
    </div>
  );

  return shell(
    <div style={card}>
      {previewBanner}
      {isTest && !sampleMode && <div style={{ background: "#FFF8E6", border: "1px solid #E0A100", borderRadius: 12, padding: "10px 14px", fontSize: 13, fontWeight: 700, color: "#7A5A00", marginBottom: 14 }}>TEST MODE — staff test link. This application is marked as a test and won't count as a real applicant. The services confirmation is always required.</div>}
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 4px", color: BLUE }}>{steps[idx]?.title}</h1>
      <div style={{ width: 34, height: 3, borderRadius: 99, background: "#F4A9C7", margin: "10px 0 18px" }} />
      <StepBody step={step} d={d} up={up} token={token ?? ""} setError={setError} preview={sampleMode} onRevision={setBaseUpdatedAt} showErrors={showErrors} onReviewReady={setReviewed} onAddressPending={setAddressPending} />
      {step === "sign" && <SignStep d={d} token={token ?? ""} reviewed={reviewed} revision={baseUpdatedAt} onSigned={() => setStatus("submitted")} preview={sampleMode} />}
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

function StepBody({ step, d, up, token, setError, preview, onRevision, showErrors, onReviewReady, onAddressPending }: { step: StepKey; d: RecData; up: (p: Partial<RecData>) => void; token: string; setError: (s: string | null) => void; preview: boolean; onRevision: (revision: string) => void; showErrors: boolean; onReviewReady: (r: ReviewedAgreement | null) => void; onAddressPending: (pending: boolean) => void }) {
  const t = (k: keyof RecData, upper = false) => ({ value: (d[k] as string) ?? "", onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => up({ [k]: upper ? e.target.value.toUpperCase() : e.target.value } as Partial<RecData>) });
  switch (step) {
    case "about":
      return <>
        <Field label="What would you like to do?" required>
          <Choice options={[{ v: false as boolean, l: "Register my REC business" }, { v: true as boolean, l: "Join as staff" }]} value={d.works_under_rec ?? null} onChange={(v) => up({ works_under_rec: v })} />
        </Field>
        {d.works_under_rec === true && <>
          <WorkerStop who="REC" />
          <button type="button" style={{ ...btn(false), marginTop: 12 }} onClick={() => up({ works_under_rec: false })}>Register my REC business instead</button>
        </>}
        {d.works_under_rec === false && <>
          <Field label="Your name" required><input style={input} placeholder="e.g. Sam Taylor" {...t("primary_contact_name")} /></Field>
          <Check checked={d.contact_is_licensed_electrician === true} onChange={(v) => up({ contact_is_licensed_electrician: v ? true : null })} required error={showErrors && d.contact_is_licensed_electrician !== true ? "Confirm you are a licensed electrician to continue." : null}>I am a licensed electrician.</Check>
          <Field label="Your Victorian electrician licence number" required hint="Your personal Energy Safe Victoria electrical licence number."><input style={input} {...t("licence_number", true)} /></Field>
          <Field label="Electrical licence expiry date" required><input style={input} type="date" value={d.licence_expiry ?? ""} onChange={(e) => up({ licence_expiry: e.target.value })} /></Field>
          <Field label="Your mobile" required><input style={input} type="tel" {...t("business_phone")} /></Field>
          <Field label="Your email" required><input style={input} type="email" {...t("business_email")} /></Field>
        </>}
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
          <Field label="Australian business address" required hint="Choose a verified address"><AddressInput id="business-address" value={d.business_address ?? ""} resolved={d.business_address_details} onChange={(v) => up({ business_address: v })} onSelect={(v) => up({ business_address_details: v })} onPendingChange={onAddressPending} /></Field>
          {validAbn(d.abn) && (d.rec_registration_number ?? "").trim() && <p style={{ color: GREEN, fontWeight: 700, fontSize: 13 }}>✓ Ready for verification</p>}
        </> : null}
      </>;
    case "insurance":
      return <InsuranceStep d={d} up={up} token={token} setError={setError} preview={preview} onRevision={onRevision} />;
    case "services":
      return <>
        <TickList items={["PIESAs", "Approved electrical fixes", "Installation-day electrical attendance when required"]} />
        <Check required checked={d.services_all_confirmed === true} error={showErrors && d.services_all_confirmed !== true ? "Confirm your REC can provide all three electrical services." : null} onChange={(v) => up({ services_all_confirmed: v })}>I confirm our REC can provide all three electrical services listed above, as required for each job.</Check>
        <div style={{ borderTop: "1px solid #E4E8F0", margin: "18px 0 16px" }} />
         <Field label="Victorian service starting location" required hint="Choose a verified Victorian address"><AddressInput id="service-origin" victoriaOnly value={d.service_origin ?? ""} resolved={d.service_origin_details} onChange={(v) => up({ service_origin: v })} onSelect={(v) => up({ service_origin_details: v })} onPendingChange={onAddressPending} /></Field>
         {d.business_address && d.service_origin !== d.business_address && <button type="button" style={{ ...btn(false), marginBottom: 16 }} onClick={() => up({ service_origin: d.business_address ?? "", service_origin_details: d.business_address_details ?? null })}>Use business address</button>}
        <Field label="Travel radius" required><Choice options={RADII.map((r) => ({ v: r.v as number, l: r.l }))} value={d.travel_radius_km ?? null} onChange={(v) => up({ travel_radius_km: v })} /></Field>
        <Field label="Need to exclude a particular area?"><textarea style={{ ...input, minHeight: 70 }} {...t("excluded_areas")} /></Field>
      </>;
    case "availability": {
      const days = d.typical_days ?? [];
      return <>
        <Field label="Typical availability" required>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{DAYS.map((x) => { const on = days.includes(x); return <button key={x} type="button" onClick={() => up({ typical_days: on ? days.filter((y) => y !== x) : DAYS.filter((y) => days.includes(y) || y === x) })} style={{ minWidth: 56, minHeight: 44, borderRadius: 12, border: `1px solid ${on ? BLUE : "#D7DCE8"}`, background: on ? BLUE : "#fff", color: on ? "#fff" : NAVY, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>{x}</button>; })}</div>
        </Field>
        <Field label="Usual lead time" required><Choice options={LEAD_TIMES.map((l) => ({ v: l as string, l }))} value={d.normal_attendance_speed} onChange={(v) => up({ normal_attendance_speed: v })} /></Field>
         <Field label="Are you accepting new Home Insulation Victoria work now?" required><Choice options={[{ v: true, l: "Yes" }, { v: false, l: "Not right now" }]} value={d.accepting_jobs ?? null} onChange={(v) => up({ accepting_jobs: v })} /></Field>
      </>;
    }
    case "assessment_pricing": {
      const unit = d.gst_registered === false ? "total rate" : "inc GST";
      const r = d.rectification_rates ?? {};
      return <>
        <Field label="GST registered?" required><Choice options={[{ v: true, l: "Yes" }, { v: false, l: "No" }]} value={d.gst_registered ?? null} onChange={(v) => up({ gst_registered: v })} /></Field>
        <p style={{ color: MUTED, fontSize: 13, lineHeight: 1.5 }}>{d.gst_registered === false ? "Enter total supplier rates." : "Enter supplier rates including GST."} Home Insulation Victoria approves rates separately from customer prices.</p>
        <p style={{ background: "#FCE7F0", color: "#7B3553", borderRadius: 8, padding: "9px 11px", fontSize: 13, fontWeight: 700, lineHeight: 1.45 }}>Sharper rates can help win more work. Keep them sustainable—job volume isn’t guaranteed.</p>
        {d.paid_by_installer === true
          ? <p data-paid-by-installer style={{ background: "#EEF0FC", color: NAVY, borderRadius: 8, padding: "9px 11px", fontSize: 13, lineHeight: 1.45 }}>{d.paid_by_installer_name || "Your installer"} pays you for safety checks and install-day visits at the rate you agreed with them, so we don't need those two rates.</p>
          : <>
            <Field label={`Pre Insulation Electrical Safety Assessment (PIESA) visit (${unit})`} required hint="Formal Pre Insulation Electrical Safety Assessment (PIESA), required tests, evidence and PIESA submission."><Money value={d.assessment_rate} onChange={(v) => up({ assessment_rate: v })} unit="visit" /></Field>
            <Field label={`Installation-day attendance (${unit})`} required><Money value={d.installation_attendance_rate} onChange={(v) => up({ installation_attendance_rate: v })} unit="visit" /></Field>
          </>}
        <p style={{ color: MUTED, fontSize: 13 }}>Your approved rates calculate electrical fixes quotes; Home Insulation Victoria manages customer approval.</p>
        <Group title="Mandatory item rates" note={d.gst_registered === false ? "Enter total rates (not GST registered)." : "Enter rates including GST."}>
          {RECT_ITEMS.map((it, i) => <RateRow key={it.key} label={it.label} unit={it.unit} value={r[it.key]} last={i === RECT_ITEMS.length - 1} onChange={(v) => up({ rectification_rates: { ...r, [it.key]: v } })} />)}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", padding: "10px 0", borderTop: "1px solid #EDF0F7" }}>
            <span style={{ fontWeight: 700, fontSize: 14, color: NAVY }}>Certificate of Electrical Safety<span style={{ color: BLUE }}> *</span></span>
            <Choice options={[{ v: "included" as const, l: "Included" }, { v: "separate" as const, l: "Separate fee" }]} value={d.coes_fee_choice || null} onChange={(v) => up({ coes_fee_choice: v })} />
          </div>
          {d.coes_fee_choice === "separate" && <div style={{ padding: "10px 0 2px" }}><Field label="CoES fee" required><Money value={d.coes_fee} onChange={(v) => up({ coes_fee: v })} /></Field></div>}
        </Group>
        <Group title="Your other repeatable electrical fixes items">
          <p style={{ fontSize: 13, color: MUTED, margin: "0 0 10px" }}>Add work you regularly price. Each item remains a proposed supplier rate until the office approves it.</p>
          {(d.custom_rectification_rates ?? []).map((item, index) => <div key={item.id} style={{ border: "1px solid #D7DCE8", borderRadius: 12, padding: 12, marginBottom: 10, background: "#fff" }}>
            <Field label="Description" required><input style={input} value={item.description} onChange={(e) => up({ custom_rectification_rates: (d.custom_rectification_rates ?? []).map((x, i) => i === index ? { ...x, description: e.target.value } : x) })} /></Field>
            <Field label="Unit" required hint="For example: each, metre or visit"><input style={input} value={item.unit} onChange={(e) => up({ custom_rectification_rates: (d.custom_rectification_rates ?? []).map((x, i) => i === index ? { ...x, unit: e.target.value } : x) })} /></Field>
            <Field label={d.gst_registered === false ? "Total supplier rate" : "Supplier rate (inc GST)"} required><Money value={item.price} onChange={(v) => up({ custom_rectification_rates: (d.custom_rectification_rates ?? []).map((x, i) => i === index ? { ...x, price: v } : x) })} {...(item.unit ? { unit: item.unit } : {})} /></Field>
            <button type="button" style={btn(false)} onClick={() => up({ custom_rectification_rates: (d.custom_rectification_rates ?? []).filter((_, i) => i !== index) })}>Remove item</button>
          </div>)}
          {(d.custom_rectification_rates ?? []).length < MAX_CUSTOM_RECT_ITEMS ? <button type="button" style={btn(false)} onClick={() => up({ custom_rectification_rates: [...(d.custom_rectification_rates ?? []), { id: crypto.randomUUID(), description: "", unit: "each", price: null }].slice(0, MAX_CUSTOM_RECT_ITEMS) })}>Add custom item</button> : <p style={{ fontSize: 13, color: MUTED }}>Up to {MAX_CUSTOM_RECT_ITEMS} custom items.</p>}
        </Group>
        <p style={{ fontSize: 13, color: MUTED }}>Anything outside your approved rate schedule is quoted separately through Home Insulation Victoria on the specific job before owner approval.</p>
      </>;
    }
    case "bank":
      return <>
        <p style={{ color: MUTED, fontSize: 13 }}>Kept private and used only for approved Home Insulation Victoria payments.</p>
        <Field label="Account name" required><input style={input} autoComplete="off" {...t("bank_account_name")} /></Field>
        <Field label="BSB" required hint="6 digits"><input style={input} inputMode="numeric" autoComplete="off" {...t("bank_bsb")} /></Field>
        <Field label="Account number" required><input style={input} inputMode="numeric" autoComplete="off" {...t("bank_account_number")} /></Field>
      </>;
    case "review":
      return <RecReviewPanel d={d} up={up} preview={preview} load={() => getRecAgreement({ data: { token } })} onReady={onReviewReady} />;
    default:
      return null;
  }
}

function InsuranceStep({ d, up, token, setError, preview, onRevision }: { d: RecData; up: (p: Partial<RecData>) => void; token: string; setError: (s: string | null) => void; preview: boolean; onRevision?: (revision: string) => void }) {
  const [uploading, setUploading] = useState(false);
  async function onFile(picked: File | undefined) {
    if (!picked) return;
    if (preview) { setError("Sample preview only — certificate upload is disabled."); return; }
    setError(null);
    let f: File; let mime: "application/pdf" | "image/jpeg" | "image/png";
    try { ({ file: f, mime } = await prepareCertificate(picked)); } catch (e) { setError(e instanceof Error ? e.message : "Upload a PDF, JPG or PNG."); return; }
    setUploading(true);
    try {
      const u = await insuranceUploadUrl({ data: { token, content_type: mime, size: f.size, filename: f.name } });
      const { error } = await supabase.storage.from("partner-files").uploadToSignedUrl(u.path, u.token, f, { contentType: mime });
      if (error) throw new Error("Upload failed. Please try again.");
      const r = await confirmInsuranceUpload({ data: { token, path: u.path, content_type: mime } });
      onRevision?.(r.updated_at);
      up({ insurance_uploaded: true });
    } catch (e) { setError(e instanceof Error ? e.message : "Upload failed."); } finally { setUploading(false); }
  }
  return <>
    {d.insurance_uploaded
      ? <div style={{ ...infoCard }}>✓ Certificate uploaded. It's stored privately — only the Home Insulation Victoria office can view it. {!preview && <label style={{ color: BLUE, fontWeight: 700, cursor: "pointer", marginLeft: 6 }}>Replace<input type="file" hidden accept="application/pdf,image/jpeg,image/png,image/heic,image/heif,.heic,.heif" onChange={(e) => onFile(e.target.files?.[0])} /></label>}</div>
      : <Field label="Certificate of Currency" required hint="PDF, JPG or PNG, up to 10 MB">
          <label style={{ ...btn(false, uploading), display: "inline-flex", alignItems: "center" }}>{uploading ? "Uploading…" : "Upload certificate"}<input type="file" hidden disabled={uploading} accept="application/pdf,image/jpeg,image/png,image/heic,image/heif,.heic,.heif" onChange={(e) => onFile(e.target.files?.[0])} /></label>
        </Field>}
    <Field label="Insurer" required><input style={input} value={d.insurer ?? ""} onChange={(e) => up({ insurer: e.target.value })} /></Field>
    <Field label="Policy number" required><input style={input} value={d.insurance_policy_number ?? ""} onChange={(e) => up({ insurance_policy_number: e.target.value })} /></Field>
    <Field label="Public liability cover" required hint="Minimum $5,000,000"><Money value={d.public_liability_cover_amount} onChange={(v) => up({ public_liability_cover_amount: v })} />
      {typeof d.public_liability_cover_amount === "number" && d.public_liability_cover_amount < MIN_REC_PL_COVER && <div role="alert" style={{ color: "#B42318", fontWeight: 700, fontSize: 14, marginTop: 6 }}>Cover must be at least $5,000,000. You can't continue with less.</div>}
    </Field>
    <Field label="Expiry date" required><input style={{ ...input, maxWidth: 220 }} type="date" value={d.public_liability_expiry ?? ""} onChange={(e) => up({ public_liability_expiry: e.target.value })} /></Field>
  </>;
}


function SignStep({ d, token, reviewed, revision, onSigned, preview }: { d: RecData; token: string; reviewed: ReviewedAgreement | null; revision: string | null; onSigned: () => void; preview: boolean }) {
  const [acks, setAcks] = useState<Record<string, boolean>>({});
  const [name, setName] = useState(d.primary_contact_name ?? "");
  const [position, setPosition] = useState("");
  const [email, setEmail] = useState(d.business_email ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ackList = acknowledgementsFor(d);
  const acknowledgementRevision = `${REC_AGREEMENT_VERSION}:${agreementText(d)}`;
  useEffect(() => setAcks({}), [acknowledgementRevision]);
  const ready = ackList.every((a) => acks[a.key]) && name.trim().length > 1 && position.trim().length > 1 && validBusinessEmail(email) && (preview || (!!reviewed && !!revision));
  async function sign() {
    if (preview) { setErr("Sample preview only — no agreement was signed or submitted."); return; }
    setBusy(true); setErr(null);
    try {
      const reviewedSha = reviewed?.sha256 ?? "";
      const submit = (expectedUpdatedAt: string, agreementSha256: string) => signRecAgreement({ data: { token, signer_name: name, signer_position: position, signer_email: email, acknowledgements: acks, agreement_version: REC_AGREEMENT_VERSION, expected_updated_at: expectedUpdatedAt, agreement_sha256: agreementSha256 } });
      await signRecWithRecovery(revision ?? "", reviewedSha, {
        load: async () => { const current = await loadRecOnboarding({ data: { token } }); return { status: current.status, updated_at: current.updated_at }; },
        sign: submit,
      });
      onSigned(); window.scrollTo({ top: 0 });
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not sign."); } finally { setBusy(false); }
  }
  return <>
    <div style={infoCard}>🛡 You're signing electronically. We store the exact wording you signed, its version, your details and the time, so both parties have the same record.</div>
    {ackList.map((a) => <Check key={a.key} checked={!!acks[a.key]} onChange={(v) => setAcks((x) => ({ ...x, [a.key]: v }))}>{a.text}</Check>)}
    <Field label="Signer full legal name" required><input style={input} value={name} onChange={(e) => setName(e.target.value)} /></Field>
    <Field label="Position / title" required><input style={input} placeholder="e.g. Director" value={position} onChange={(e) => setPosition(e.target.value)} /></Field>
    <Field label="Signer email" required><input style={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
    {!preview && !reviewed && <p role="alert" style={{ color: "#8C1D18", fontSize: 14 }}>Go back and review the agreement before signing.</p>}
    {err && <p style={{ color: "#B3261E", fontSize: 14 }}>{err}</p>}
    <button style={{ ...btn(true, !ready || busy), width: "100%" }} disabled={!ready || busy || preview} onClick={sign}>{busy ? "Signing…" : preview ? "Preview only — signing disabled" : "Sign agreement & submit"}</button>
  </>;
}

const SAMPLE_REC_DATA: RecData = {
  works_under_rec: false, primary_contact_name: "Sample REC representative", contact_is_licensed_electrician: true, licence_number: "ESV SAMPLE", business_phone: "0400 000 000", business_email: "sample@example.com",
  legal_entity_name: "Sample Electrical Pty Ltd", trading_name: "Sample Electrical", abn: "51824753556", rec_registration_number: "REC SAMPLE", business_address: "100 Sample Road, Melbourne VIC 3000", business_address_details: { label: "100 Sample Road, Melbourne VIC 3000", suburb: "Melbourne", postcode: "3000", state: "VIC", country: "AU", provider: "google_places_au" },
  insurance_uploaded: true, insurer: "Sample insurer", insurance_policy_number: "SAMPLE-001", public_liability_cover_amount: 5_000_000, public_liability_expiry: "2099-12-31",
  service_origin: "100 Sample Road, Melbourne VIC 3000", service_origin_details: { label: "100 Sample Road, Melbourne VIC 3000", suburb: "Melbourne", postcode: "3000", state: "VIC", country: "AU", provider: "google_places_au" }, travel_radius_km: 50, typical_days: ["Mon", "Tue", "Wed"], normal_attendance_speed: "3-5 business days", capacity_band: "6-10", accepting_jobs: true,
  gst_registered: true, assessment_rate: 330, installation_attendance_rate: 220, rectification_rates: { prohibited_luminaires: 55, circuit_protection: 110, rcd_installation: 220, tps_cable_replacement: 11, basic_protection: 165 }, coes_fee_choice: "included",
  bank_account_name: "Sample Electrical Pty Ltd", bank_bsb: "123-456", bank_account_number: "12345678", agreement_reviewed: false,
};
