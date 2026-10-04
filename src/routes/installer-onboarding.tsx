import { BLUE, GREEN, NAVY, MUTED, btn, Check } from "@/components/rec/rec-ui";
import { WorkerStop } from "@/components/portal/worker-stop";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import logo from "@/assets/home-insulation-victoria-logo.png.asset.json";
import { uploadWithRevision, signWithRecovery, type RevisionRef } from "@/lib/installer-onboarding-flow.core";
import {
  ACKNOWLEDGEMENTS, CAPACITY_BANDS, DAYS, WORKER_CII, EXTRA_ITEMS, LEAD_TIMES, RADII, INSTALLER_AGREEMENT_VERSION,
  agreementText, applyMaterialReset, firstIncompleteStep, installerSignUiBlockers, pageErrors, pageFieldErrors, resolvedBusinessAddress, parseInstallerSampleStep, visiblePageForStep, visibleSteps,
  type InstData, type ResolvedAddress, type StepKey,
} from "@/lib/installer-onboarding.core";
import { isVictorianAddress, resumeFailureMode } from "@/lib/rec-onboarding.core";
import {
  confirmInstallerInsuranceUpload, getInstallerAgreement, installerInsuranceUploadUrl,
  loadInstallerOnboarding, saveInstallerOnboarding, signInstallerAgreement, startInstallerOnboarding,
} from "@/lib/installer-onboarding.functions";
import { newResumeToken, takeStaffLink } from "@/lib/onboarding-security.core";
import { prepareCertificate } from "@/lib/certificate-file";
import { VerifiedAddressInput } from "@/components/onboarding/VerifiedAddressInput";

// Public installer onboarding + partner agreement signing, in the same design system as REC onboarding.
// Progress is saved server-side (on "Save & continue") against an opaque resume token kept in this browser.
const TOKEN_KEY = "hivic_installer_onboarding_token";
const PINK = "#F4A9C7";
const BLUSH = "#FCE7F0";
const PINK_TEXT = "#7B3553";

export const Route = createFileRoute("/installer-onboarding")({
  ssr: false,
  headers: () => ({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" }),
  head: () => ({ meta: [
    { title: "Installer Partner Onboarding — Home Insulation Victoria" },
    { name: "description", content: "Join the Home Insulation Victoria installer network as a ceiling insulation installer." },
    { property: "og:title", content: "Installer Partner Onboarding — Home Insulation Victoria" },
    { property: "og:description", content: "Join the Home Insulation Victoria installer network as a ceiling insulation installer." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
    { name: "robots", content: "noindex, nofollow" },
  ] }),
  component: InstallerOnboarding,
});

const input: React.CSSProperties = { width: "100%", padding: "12px 14px", borderRadius: 12, border: "1px solid #D7DCE8", fontSize: 15, fontFamily: "inherit", color: NAVY, background: "#fff", boxSizing: "border-box", minHeight: 48 };
const card: React.CSSProperties = { background: "#fff", borderRadius: 18, padding: 24, border: "1px solid #E9ECF3", boxShadow: "0 6px 20px -18px rgba(34,55,107,.32)" };
const DISPLAY = "'Space Grotesk', system-ui, sans-serif";
const note: React.CSSProperties = { color: MUTED, fontSize: 13, lineHeight: 1.5, margin: "0 0 14px" };
const okLine: React.CSSProperties = { color: GREEN, fontWeight: 700, fontSize: 13, margin: "0 0 14px" };
const warn: React.CSSProperties = { background: "#FFF8E6", border: "1px solid #E0A100", borderRadius: 10, padding: "9px 12px", fontSize: 13.5, color: "#7A5A00", marginBottom: 12 };
const removeBtn: React.CSSProperties = { border: "none", background: "none", color: "#B3261E", cursor: "pointer", fontWeight: 700, fontFamily: "inherit" };

function Field({ label, required, hint, children, htmlFor, error }: { label: string; required?: boolean; hint?: string; children: React.ReactNode; htmlFor?: string; error?: string | null }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label htmlFor={htmlFor} style={{ display: "block", fontWeight: 700, fontSize: 14, color: NAVY, marginBottom: 6 }}>{label}{required && <span style={{ color: BLUE }}> *</span>}</label>
      {children}
      {hint && <div style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>{hint}</div>}
      {error && <div id={htmlFor ? `${htmlFor}-error` : undefined} role="alert" style={{ color: "#8C1D18", fontSize: 13, fontWeight: 700, marginTop: 5 }}>{error}</div>}
    </div>
  );
}
/** Understated sub-heading that separates related questions on one page. */
function Section({ title, first = false, children }: { title: string; first?: boolean; children: React.ReactNode }) {
  return (
    <section style={{ borderTop: first ? "none" : "1px solid #E4E8F0", paddingTop: first ? 0 : 16, marginTop: first ? 0 : 18 }}>
      <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 15, color: NAVY, marginBottom: 10 }}>{title}</div>
      {children}
    </section>
  );
}
function Tick() {
  return <span aria-hidden="true" style={{ flexShrink: 0, width: 22, height: 22, borderRadius: "50%", background: GREEN, color: "#fff", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", marginTop: 1 }}>✓</span>;
}
function TickList({ items }: { items: string[] }) {
  return (
    <div style={{ margin: "0 0 14px" }}>
      {items.map((line) => (
        <div key={line} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "6px 0", fontSize: 14, lineHeight: 1.45, color: NAVY }}><Tick /><span>{line}</span></div>
      ))}
    </div>
  );
}
function Money({ value, onChange, unit }: { value: number | null | undefined; onChange: (v: number | null) => void; unit?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontWeight: 700 }}>$</span>
      <input style={{ ...input, maxWidth: 150 }} type="number" inputMode="decimal" min="0" step="0.01" value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} />
      {unit && <span style={{ color: MUTED, fontSize: 14 }}>/ {unit}</span>}
    </div>
  );
}
/** One rate line: item on the left, amount on the right. */
function RateRow({ label, unit, value, onChange, required = false, last = false }: { label: string; unit: string; value: number | null | undefined; onChange: (v: number | null) => void; required?: boolean; last?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", padding: "10px 0", borderBottom: last ? "none" : "1px solid #EDF0F7" }}>
      <span style={{ fontWeight: 700, fontSize: 14, color: NAVY, minWidth: 0 }}>{label}{required && <span style={{ color: BLUE }}> *</span>}</span>
      <Money value={value} onChange={onChange} unit={unit} />
    </div>
  );
}

/** Australian address lookup (same interaction as REC onboarding): suggestions close after a pick and stay closed
 *  until the text is edited; slow or stale lookups never overwrite newer typing; keyboard and Escape work. */
function AddressInput({ value, resolved, onChange, onSelect, onPendingChange, victoriaOnly = false, id = "address" }: { value: string; resolved?: ResolvedAddress | null | undefined; onChange: (v: string) => void; onSelect: (v: ResolvedAddress | null) => void; onPendingChange?: (pending: boolean) => void; victoriaOnly?: boolean; id?: string }) {
  return <VerifiedAddressInput id={id} value={value} resolved={resolved} onChange={onChange} onSelect={onSelect} onPendingChange={onPendingChange} victoriaOnly={victoriaOnly} inputStyle={input} mutedColor={MUTED} />;

}

function Choice<T extends string | number | boolean>({ options, value, onChange }: { options: { v: T; l: string }[]; value: T | null | undefined; onChange: (v: T) => void }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {options.map((o) => {
        const on = value === o.v;
        return <button type="button" key={String(o.v)} aria-pressed={on} onClick={() => onChange(o.v)} style={{ minHeight: 44, padding: "0 16px", borderRadius: 12, border: `1px solid ${on ? BLUE : "#D7DCE8"}`, background: on ? BLUE : "#fff", color: on ? "#fff" : NAVY, fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit", maxWidth: "100%", whiteSpace: "normal", textAlign: "left" }}>{o.l}</button>;
      })}
    </div>
  );
}

type Reviewed = { version: string; sha256: string } | null;

function InstallerOnboarding() {
  const rawSample = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("sample") : null;
  const sampleStep = parseInstallerSampleStep(rawSample);
  const sampleMode = rawSample !== null;
  const invalidSample = sampleMode && sampleStep === null;
  const [token, setToken] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [started, setStarted] = useState(false);
  const [d, setD] = useState<InstData>({});
  const [step, setStep] = useState<StepKey>("about");
  const [status, setStatus] = useState<"draft" | "submitted">("draft");
  const [busy, setBusy] = useState(false);
  const [addressPending, setAddressPending] = useState(false);
  const navigationLock = useRef(false);
  const latestData = useRef(d);
  latestData.current = d;
  const [reviewed, setReviewed] = useState<Reviewed>(null);
  // Exact server revision this tab last loaded/saved; every save and the signature are checked against it.
  const revision = useRef<string | null>(null);
  const [resumeState, setResumeState] = useState<"ok" | "retry" | "invalid">("ok");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const resumeLoadFailed = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  // Test mode is decided by the server (staff-issued link only); `testMode` = relaxed required steps.
  const [testMode, setTestMode] = useState(false);
  const [isTest, setIsTest] = useState(false);
  const [staffLink] = useState(() => takeStaffLink());
  const unsaved = useRef(false);
  const startWith = async (t: string) => {
    const r = await startInstallerOnboarding({ data: { token: t, ...(staffLink ? { staff_link: staffLink } : {}) } });
    setIsTest(r.test_mode); setTestMode(r.relaxed);
    return r;
  };

  useEffect(() => {
    if (invalidSample) { setLoaded(true); return; }
    if (sampleStep) {
      setD(SAMPLE_INSTALLER_DATA); setToken("sample-preview-token"); setTestMode(false);
      if (sampleStep === "welcome") { setToken(null); setStarted(false); setStatus("draft"); }
      else if (sampleStep === "submitted") { setStarted(true); setStatus("submitted"); }
      else { setStarted(true); setStatus("draft"); setStep(visiblePageForStep(sampleStep)); }
      setLoaded(true); return;
    }
    if (new URLSearchParams(window.location.search).get("reset") === "1") { localStorage.removeItem(TOKEN_KEY); setLoaded(true); return; }
    const t = localStorage.getItem(TOKEN_KEY);
    if (!t) { setLoaded(true); return; }
    loadInstallerOnboarding({ data: { token: t } }).then((r) => {
      setResumeState("ok"); setError(null); resumeLoadFailed.current = false;
      revision.current = r.updated_at; setToken(t); setD(r.data as InstData); setStatus(r.status as "draft" | "submitted"); setStarted(true);
      setIsTest(!!r.test_mode); setTestMode(!!r.relaxed);
      const first = firstIncompleteStep(r.data as InstData);
      setStep(r.status === "submitted" ? "review" : (first ?? visiblePageForStep(r.step_key)));
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
    const onPop = (event: PopStateEvent) => { const c = visiblePageForStep(event.state?.instStep); if (visibleSteps(latestData.current).some((p) => p.key === c)) setStep(c); };
    window.addEventListener("popstate", onPop); return () => window.removeEventListener("popstate", onPop);
  }, [started, status]);

  const steps = useMemo(() => visibleSteps(d), [d]);
  const idx = Math.max(0, steps.findIndex((s) => s.key === step));
  const errs = pageErrors(step, d);
  const fieldErrs = pageFieldErrors(step, d);
  const errFor = (field: string) => (showErrors ? fieldErrs.find((e) => e.field === field)?.message ?? null : null);
  const up = (patch: Partial<InstData>) => setD((x) => applyMaterialReset(x, { ...x, ...patch }));

  async function begin() {
    if (resumeLoadFailed.current) {
      if (resumeState === "invalid") { localStorage.removeItem(TOKEN_KEY); resumeLoadFailed.current = false; setResumeState("ok"); setError(null); }
      else { setError(null); setLoadAttempt((x) => x + 1); return; }
    }
    if (token) { setStarted(true); setError(null); return; }
    if (sampleMode) { setD(SAMPLE_INSTALLER_DATA); setToken("sample-preview-token"); setStep("about"); setStarted(true); setError(null); return; }
    // Nothing is saved (or counted against start limits) until the first page is saved.
    unsaved.current = true; revision.current = null;
    setToken(newResumeToken()); setStarted(true); setError(null);
  }
  async function persist(nextStep: StepKey, data: InstData = d) {
    if (sampleMode || !token) return;
    const { insurance_uploaded: _u, ...body } = data;
    if (unsaved.current) {
      await startWith(token);
      const fresh = await loadInstallerOnboarding({ data: { token } });
      revision.current = fresh.updated_at; unsaved.current = false;
      localStorage.setItem(TOKEN_KEY, token);
    }
    if (!revision.current) throw new Error("Reload the page to continue your application.");
    const r = await saveInstallerOnboarding({ data: { token, step_key: nextStep, data: body as never, base_updated_at: revision.current } });
    revision.current = r.updated_at;
    setD((current) => {
      const server = r.data as InstData;
      const concurrent = Object.fromEntries(Object.keys(current).filter((k) => JSON.stringify(current[k as keyof InstData]) !== JSON.stringify(data[k as keyof InstData])).map((k) => [k, current[k as keyof InstData]])) as Partial<InstData>;
      return applyMaterialReset(server, { ...server, ...concurrent });
    });
  }
  async function go(delta: 1 | -1) {
    if (navigationLock.current || addressPending) return;
    navigationLock.current = true; setError(null);
    try {
      if (delta === 1 && d.works_for_business === true) return; // staff join through the business owner's invite
      if (delta === 1 && errs.length && !testMode && !sampleMode) {
        setShowErrors(true);
        // Focus the first invalid visible field so keyboard and screen-reader users land on it.
        const first = fieldErrs[0]?.field;
        requestAnimationFrame(() => { const el = first ? document.getElementById(first) : null; (el ?? document.getElementById("page-errors"))?.focus(); el?.scrollIntoView({ block: "center" }); });
        return;
      }
      setShowErrors(false);
      const target = steps[Math.min(steps.length - 1, Math.max(0, idx + delta))]?.key ?? "about";
      if (delta === -1) { setStep(target); window.history.pushState({ instStep: target }, ""); window.scrollTo({ top: 0 }); }
      setBusy(true);
      await persist(target);
      if (delta === 1) { setStep(target); window.history.pushState({ instStep: target }, ""); window.scrollTo({ top: 0 }); }
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save. Please try again."); }
    finally { navigationLock.current = false; setBusy(false); }
  }

  const shell = (children: React.ReactNode, footer?: React.ReactNode) => (
    <div style={{ minHeight: "100vh", background: "#fff", fontFamily: "'DM Sans', system-ui, sans-serif", color: NAVY, overflowX: "hidden" }}>
      <style>{`h1,h2,h3{font-family:${DISPLAY}}`}</style>
      <header style={{ position: "sticky", top: 0, zIndex: 10, background: "rgba(255,255,255,.96)", borderBottom: "1px solid #EEF0F5" }}>
        <div style={{ maxWidth: 672, margin: "0 auto", padding: "10px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <img src={logo.url} alt="Home Insulation Victoria" style={{ height: 40, width: "auto" }} />
          {started && status === "draft" && <span style={{ fontSize: 13, fontWeight: 700, color: MUTED, whiteSpace: "nowrap" }}>{idx + 1} of {steps.length}</span>}
        </div>
        {started && status === "draft" && (
          <div style={{ maxWidth: 672, margin: "0 auto", padding: "0 20px 10px" }}>
            <div style={{ height: 4, borderRadius: 99, background: "#EEF0F5", overflow: "hidden" }}>
              <div style={{ width: `${((idx + 1) / steps.length) * 100}%`, height: "100%", background: `linear-gradient(90deg, ${GREEN}, ${BLUE})`, transition: "width .3s" }} />
            </div>
          </div>
        )}
      </header>
      <main style={{ maxWidth: 672, margin: "0 auto", padding: "24px 20px 128px" }}>{children}</main>
      {footer}
    </div>
  );

  if (!loaded) return shell(<p>Loading…</p>);
  if (invalidSample) return shell(<div style={card}><h1 style={{ fontSize: 24, fontWeight: 800, color: BLUE }}>That sample page is not available</h1><p style={{ color: MUTED }}>No data has been loaded or saved.</p><a href="/installer-onboarding?sample=welcome" style={{ color: BLUE, fontWeight: 700 }}>Open the welcome sample →</a></div>);
  const previewBanner = sampleMode ? <div role="status" style={{ ...warn, fontWeight: 700 }}>SAMPLE PREVIEW — no data is saved and no application, invitation or signature is submitted.</div> : null;

  if (!started) return shell(
    <div style={{ ...card, padding: 0, overflow: "hidden" }}>
      <div style={{ height: 6, background: `linear-gradient(90deg, ${GREEN}, ${BLUE})` }} />
      <div style={{ padding: "28px 26px 26px" }}>
        {previewBanner}
        <div style={{ display: "inline-block", fontSize: 12, fontWeight: 800, color: PINK_TEXT, textTransform: "uppercase", letterSpacing: 1.2, fontFamily: DISPLAY, background: BLUSH, borderRadius: 999, padding: "5px 12px" }}>Installer partners</div>
        <h1 style={{ fontSize: 30, fontWeight: 800, margin: "14px 0 8px", color: NAVY, lineHeight: 1.2 }}>Join our <span style={{ textDecoration: "underline", textDecorationColor: PINK, textUnderlineOffset: 5 }}>installer</span> network</h1>
        <p style={{ fontSize: 15, lineHeight: 1.55, color: MUTED, margin: "0 0 22px" }}>Register your installation business with Home Insulation Victoria.</p>
        <div style={{ margin: "0 0 6px", fontFamily: DISPLAY, fontWeight: 800, fontSize: 13, color: NAVY }}>What you'll need</div>
        <div style={{ marginBottom: 20 }}>
          {["ABN and business details", "Public liability Certificate of Currency", "Each installer's CII certification details", "Your supplier rates + bank details"].map((t) => (
            <div key={t} style={{ display: "flex", gap: 10, alignItems: "center", padding: "7px 0", fontSize: 14, fontWeight: 600, color: NAVY }}>
              <span aria-hidden="true" style={{ flexShrink: 0, color: GREEN, fontSize: 17, fontWeight: 900 }}>✓</span>{t}
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
    <div style={card}>
      {previewBanner}
      <h1 style={{ fontSize: 24, fontWeight: 800, margin: "0 0 8px", color: NAVY }}>Thanks, {d.primary_contact_name?.split(" ")[0] || "partner"} — your application is in</h1>
      <p style={{ color: MUTED, lineHeight: 1.6 }}>Your signed agreement and business details are now with Home Insulation Victoria.</p>
      <Section title="What we're checking" first><TickList items={["Each installer's CII certification", "Your $5 million public liability insurance", "Your proposed supplier rates"]} /></Section>
      <Section title="What happens next"><TickList items={["We confirm your approval and agreed rates", "Your business gets access to the portal", `We contact you at ${d.business_email || "your email"} if we need anything else`]} /></Section>
      <p style={{ color: MUTED, fontSize: 13 }}>Agreement version {INSTALLER_AGREEMENT_VERSION} · A copy of everything you've submitted is kept on your file.</p>
    </div>,
  );

  const staffStop = step === "about" && d.works_for_business === true;
  const footer = (
    <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "#fff", borderTop: "1px solid #E4E8F0", padding: "12px 20px", zIndex: 10 }}>
      <div style={{ maxWidth: 672, margin: "0 auto", display: "flex", justifyContent: "space-between", gap: 12 }}>
        <button style={btn(false, busy || addressPending)} disabled={busy || addressPending} onClick={() => { if (idx === 0) { setStarted(false); window.scrollTo({ top: 0 }); } else void go(-1); }}>Back</button>
        {step !== "review" && !staffStop && <button style={btn(true, busy || addressPending)} disabled={busy || addressPending} onClick={() => go(1)}>{addressPending ? "Checking address…" : busy ? "Saving…" : "Save & continue"}</button>}
      </div>
    </div>
  );

  return shell(
    <div style={card}>
      {previewBanner}
      {isTest && !sampleMode && <div style={{ ...warn, fontWeight: 700 }}>TEST MODE — staff test link. This application is marked as a test and won't count as a real applicant.</div>}
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 4px", color: BLUE }}>{steps[idx]?.title}</h1>
      <div style={{ width: 34, height: 3, borderRadius: 99, background: PINK, margin: "10px 0 18px" }} />
      <StepBody step={step} d={d} up={up} token={token ?? ""} setError={setError} preview={sampleMode} onReviewReady={setReviewed} errFor={errFor} revision={revision} onUploadBusy={(b) => { navigationLock.current = b; setBusy(b); }} onAddressPending={setAddressPending} />
      {step === "review" && <SignStep d={d} token={token ?? ""} reviewed={reviewed} preview={sampleMode} relaxed={testMode} revision={() => revision.current}
        saveReviewed={async () => { const next = { ...d, agreement_reviewed: true }; await persist("review", next); }}
        onGoToPage={(page) => { setStep(page); window.history.pushState({ instStep: page }, ""); window.scrollTo({ top: 0 }); }}
        onSigned={() => setStatus("submitted")} />}
      {showErrors && errs.length > 0 && (
        <div id="page-errors" tabIndex={-1} role="alert" style={{ background: "#FDECEA", border: "1px solid #F5C2BE", borderRadius: 12, padding: "10px 14px", color: "#8C1D18", fontSize: 14, marginTop: 8 }}>
          {errs.map((e) => <div key={e}>• {e}</div>)}
        </div>
      )}
      {error && <p style={{ color: "#B3261E", fontSize: 14 }}>{error}</p>}
    </div>,
    footer,
  );
}

function StepBody({ step, d, up, token, setError, preview, onReviewReady, errFor, revision, onUploadBusy, onAddressPending }: { step: StepKey; d: InstData; up: (p: Partial<InstData>) => void; token: string; setError: (s: string | null) => void; preview: boolean; onReviewReady: (r: Reviewed) => void; errFor: (field: string) => string | null; revision: RevisionRef; onUploadBusy: (b: boolean) => void; onAddressPending: (pending: boolean) => void }) {
  const t = (k: keyof InstData) => ({ id: k as string, "aria-invalid": !!errFor(k as string) || undefined, value: (d[k] as string) ?? "", onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => up({ [k]: e.target.value } as Partial<InstData>) });
  switch (step) {
    case "about":
      return <>
        <Field label="What would you like to do?" required>
          <Choice options={[{ v: false as boolean, l: "Register my installation business" }, { v: true as boolean, l: "Join as staff" }]} value={d.works_for_business ?? null} onChange={(v) => up({ works_for_business: v })} />
        </Field>
        {d.works_for_business === true && <>
          <WorkerStop who="business" />
          <button type="button" style={{ ...btn(false), marginTop: 12 }} onClick={() => up({ works_for_business: false })}>Register my business instead</button>
        </>}
        {d.works_for_business === false && <>
          <Section title="Your contact details">
            <Field label="Your name" required htmlFor="primary_contact_name" error={errFor("primary_contact_name")}><input style={input} placeholder="e.g. Sam Taylor" autoComplete="name" {...t("primary_contact_name")} /></Field>
            <Field label="Your mobile" required htmlFor="business_phone" error={errFor("business_phone")}><input style={input} type="tel" autoComplete="tel" {...t("business_phone")} /></Field>
            <Field label="Your email" required htmlFor="business_email" error={errFor("business_email")}><input style={input} type="email" autoComplete="email" {...t("business_email")} /></Field>
          </Section>
          <Section title="Your business">
            <Field label="Legal entity name" required htmlFor="legal_entity_name" error={errFor("legal_entity_name")}><input style={input} {...t("legal_entity_name")} /></Field>
            <Field label="Trading name" htmlFor="trading_name" error={errFor("trading_name")}><input style={input} {...t("trading_name")} /></Field>
            <Field label="ABN" required hint="11 digits" htmlFor="abn" error={errFor("abn")}><input style={input} inputMode="numeric" {...t("abn")} /></Field>
            <Field label="Australian business address" required hint="Start typing and choose from the list" htmlFor="business-address" error={errFor("business-address")}><AddressInput id="business-address" value={d.business_address ?? ""} resolved={d.business_address_details} onChange={(v) => up({ business_address: v })} onSelect={(v) => up({ business_address_details: v })} onPendingChange={onAddressPending} /></Field>
          </Section>
        </>}
      </>;
    case "insurance":
      return <InsuranceStep d={d} up={up} token={token} setError={setError} preview={preview} revision={revision} onUploadBusy={onUploadBusy} />;
    case "installers": {
      const list = d.installers ?? [];
      const set = (i: number, p: Partial<NonNullable<InstData["installers"]>[number]>) => up({ installers: list.map((x, j) => (j === i ? { ...x, ...p } : x)) });
      return <>
        <p style={note}>Everyone who installs on Home Insulation Victoria jobs — including you, if you do the work. At least one. Our office checks each person's CII certification before they can be assigned.</p>
        {list.map((x, i) => (
          <Section key={i} title={`Installer ${i + 1}`} first={i === 0}>
            <Field label="Full legal name" required><input style={input} value={x.full_legal_name ?? ""} onChange={(e) => set(i, { full_legal_name: e.target.value })} /></Field>
            <Field label="EEC Certified Insulation Installer (CII) status" required error={errFor(`installer-${i}-cii`)}><Choice options={WORKER_CII.map((c) => ({ v: c.v as string, l: c.l }))} value={x.cii_holds ?? null} onChange={(v) => set(i, { cii_holds: v as "held" | "in_training" | "not_held" })} /></Field>
            {x.cii_holds === "held" && <>
              <Field label="Certificate or ID number" required htmlFor={`installer-${i}-cii-number`} error={errFor(`installer-${i}-cii-number`)}><input id={`installer-${i}-cii-number`} style={input} value={x.cii_certificate_number ?? ""} onChange={(e) => set(i, { cii_certificate_number: e.target.value })} /></Field>
              <Field label="Issued by" required htmlFor={`installer-${i}-cii-issuer`} error={errFor(`installer-${i}-cii-issuer`)}><input id={`installer-${i}-cii-issuer`} style={input} value={x.cii_issuer ?? ""} onChange={(e) => set(i, { cii_issuer: e.target.value })} /></Field>
              <Field label="Issue date" required htmlFor={`installer-${i}-cii-date`} error={errFor(`installer-${i}-cii-date`)}><input id={`installer-${i}-cii-date`} type="date" style={{ ...input, maxWidth: 220 }} value={x.cii_issue_date ?? ""} onChange={(e) => set(i, { cii_issue_date: e.target.value })} /></Field>
              <Field label="Certification level" required error={errFor(`installer-${i}-cii-level`)}><Choice options={[{ v: "full", l: "Full" }, { v: "provisional", l: "Provisional" }]} value={x.cii_level ?? null} onChange={(v) => set(i, { cii_level: v as "full" | "provisional" })} /></Field>
              {x.cii_level === "provisional" && <p style={warn}>Provisional: this person can't receive work until they hold a Full certification.</p>}
              <Field label="Expiry date" required htmlFor={`installer-${i}-cii-expiry`} error={errFor(`installer-${i}-cii-expiry`)}><input id={`installer-${i}-cii-expiry`} type="date" style={{ ...input, maxWidth: 220 }} value={x.cii_expiry ?? ""} onChange={(e) => set(i, { cii_expiry: e.target.value })} /></Field>
            </>}
            {(x.cii_holds === "in_training" || x.cii_holds === "not_held") && <p style={warn}>You can still register. This person can't be assigned to jobs until they hold a CII certification and our office has verified it.</p>}
            <Field label="Other relevant training (optional)"><input style={input} value={x.qualification ?? ""} onChange={(e) => set(i, { qualification: e.target.value })} /></Field>
            <Field label="Mobile" required><input style={input} type="tel" value={x.mobile ?? ""} onChange={(e) => set(i, { mobile: e.target.value })} /></Field>
            <Field label="Email" required><input style={input} type="email" value={x.email ?? ""} onChange={(e) => set(i, { email: e.target.value })} /></Field>
            <button type="button" style={removeBtn} onClick={() => up({ installers: list.filter((_, j) => j !== i) })}>Remove installer {i + 1}</button>
          </Section>
        ))}
        <div style={{ marginTop: 16 }}><button type="button" style={btn(false)} onClick={() => up({ installers: [...list, {}] })}>+ Add installer</button></div>
      </>;
    }
    case "electrician": {
      const list = d.preferred_electricians ?? [];
      const set = (i: number, p: Partial<NonNullable<InstData["preferred_electricians"]>[number]>) => up({ preferred_electricians: list.map((x, j) => (j === i ? { ...x, ...p } : p.is_primary ? { ...x, is_primary: false } : x)) });
      return <>
        <Field label="Do you work with an electrician?" required>
          <Choice options={[{ v: "have", l: "Yes — add them" }, { v: "match", l: "No — match me with one" }, { v: "later", l: "Not sure yet" }]} value={d.electrician_choice ?? null}
            onChange={(v) => up({ electrician_choice: v as "have" | "match" | "later", preferred_electricians: v === "have" && list.length === 0 ? [{ is_primary: true }] : list })} />
        </Field>
        {d.electrician_choice === "have" && <>
          <p style={note}>Nominate your preferred electrician for approval. We’ll confirm the next steps.</p>
          {list.map((x, i) => (
            <Section key={i} title={`Electrician ${i + 1} · ${x.is_primary ? "Main" : "Backup"}`}>
              <Field label="Name" required><input style={input} value={x.name ?? ""} onChange={(e) => set(i, { name: e.target.value })} /></Field>
              <Field label="Email" required><input style={input} type="email" value={x.email ?? ""} onChange={(e) => set(i, { email: e.target.value })} /></Field>
              <Field label="Mobile" required><input style={input} type="tel" value={x.mobile ?? ""} onChange={(e) => set(i, { mobile: e.target.value })} /></Field>
              <Field label="Business name"><input style={input} value={x.business_name ?? ""} onChange={(e) => set(i, { business_name: e.target.value })} /></Field>
              <Field label="Licence number (if known)"><input style={input} value={x.licence_number ?? ""} onChange={(e) => set(i, { licence_number: e.target.value })} /></Field>
              <Field label="REC number (if known)"><input style={input} value={x.rec_number ?? ""} onChange={(e) => set(i, { rec_number: e.target.value })} /></Field>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                {!x.is_primary && <button type="button" style={btn(false)} onClick={() => set(i, { is_primary: true })}>Make main</button>}
                <button type="button" style={removeBtn} onClick={() => up({ preferred_electricians: list.filter((_, j) => j !== i) })}>Remove electrician {i + 1}</button>
              </div>
            </Section>
          ))}
          {list.length < 5 && <div style={{ margin: "16px 0" }}><button type="button" style={btn(false)} onClick={() => up({ preferred_electricians: [...list, { is_primary: list.length === 0 }] })}>+ Add another electrician</button></div>}
          <Check required checked={!!d.electrician_contact_consent} onChange={(v) => up({ electrician_contact_consent: v })}>{list.length > 1 ? "These electricians have" : "This electrician has"} agreed to be contacted by Home Insulation Victoria.</Check>
        </>}
        {d.electrician_choice === "later" && <p style={note}>You can add one later. Until then we match each job with an approved local electrician.</p>}
      </>;
    }
    case "services":
      return <>
        <Section title="Two ways to work with us" first>
          <TickList items={[
            "Our leads: free Ready Check, then supply and install at agreed supplier rates.",
            "Your customers: bring the job to us for Accredited Person support.",
          ]} />
          <p style={note}>No lead fee — you are never charged for a lead.</p>
          <Field label="Do you want to receive our homeowner leads?" required><Choice options={[{ v: true, l: "Yes" }, { v: false, l: "No — my customers only" }]} value={d.wants_hivic_leads ?? null} onChange={(v) => up(v ? { wants_hivic_leads: v } : { wants_hivic_leads: v, free_measureups_for_hivic_quote_leads: null })} /></Field>
          {d.wants_hivic_leads === true && <>
            <p style={note}>A Ready Check is a free onsite measure-up: measure the ceiling, confirm what we couldn't verify from the office and collect site evidence. No electrical work. You receive the job if it proceeds, unless the owner specifies otherwise.</p>
            <Check required checked={d.free_measureups_for_hivic_quote_leads === true} onChange={(v) => up({ free_measureups_for_hivic_quote_leads: v })}>I'll provide free Home Insulation Ready Checks (measure-up) for Home Insulation Victoria leads.</Check>
          </>}
        </Section>
        <Section title="Where you work">
          <Field label="Victorian service starting location" required hint="Start typing and choose from the list" htmlFor="service-origin" error={errFor("service-origin")}><AddressInput id="service-origin" victoriaOnly value={d.service_origin ?? ""} resolved={d.service_origin_details} onChange={(v) => up({ service_origin: v })} onSelect={(v) => up({ service_origin_details: v })} onPendingChange={onAddressPending} /></Field>
          {resolvedBusinessAddress(d) && isVictorianAddress(d.business_address_details) && d.service_origin !== d.business_address && <button type="button" style={{ ...btn(false), marginBottom: 16 }} onClick={() => up({ service_origin: d.business_address ?? "", service_origin_details: d.business_address_details ?? null })}>Use business address</button>}
          <Field label="Travel radius" required><Choice options={RADII.map((r) => ({ v: r.v as number, l: r.l }))} value={d.travel_radius_km ?? null} onChange={(v) => up({ travel_radius_km: v })} /></Field>
          <Field label="Areas to exclude"><textarea style={{ ...input, minHeight: 70 }} {...t("excluded_areas")} /></Field>
        </Section>
      </>;
    case "availability": {
      const days = d.typical_days ?? [];
      return <>
        <Field label="Typical installation days" required>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{DAYS.map((x) => { const on = days.includes(x); return <button key={x} type="button" aria-pressed={on} onClick={() => up({ typical_days: on ? days.filter((y) => y !== x) : DAYS.filter((y) => days.includes(y) || y === x) })} style={{ minWidth: 56, minHeight: 44, borderRadius: 12, border: `1px solid ${on ? BLUE : "#D7DCE8"}`, background: on ? BLUE : "#fff", color: on ? "#fff" : NAVY, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>{x}</button>; })}</div>
        </Field>
        <Field label="Usual lead time" required><Choice options={LEAD_TIMES.map((l) => ({ v: l as string, l }))} value={d.normal_attendance_speed} onChange={(v) => up({ normal_attendance_speed: v })} /></Field>
        <Field label="Are you accepting new work now?" required error={errFor("accepting_jobs")}><Choice options={[{ v: "yes", l: "Yes" }, { v: "no", l: "No, not right now" }]} value={d.accepting_jobs === true ? "yes" : d.accepting_jobs === false ? "no" : null} onChange={(v) => up({ accepting_jobs: v === "yes" })} /></Field>
        <p style={{ margin: 0, fontSize: 13, color: "#5B6478" }}>You can change this later.</p>
      </>;
    }
    case "install_pricing": {
      const unit = d.gst_registered === false ? "total rate" : "inc GST";
      const r = d.extra_rates ?? {};
      return <>
        <p style={note}>Allocation also depends on location, availability and reliable service.</p>
        <Field label="GST registered?" required><Choice options={[{ v: true, l: "Yes" }, { v: false, l: "No" }]} value={d.gst_registered ?? null} onChange={(v) => up({ gst_registered: v })} /></Field>
        <p style={note}>{d.gst_registered === false ? "Enter total supplier rates." : "Enter supplier rates including GST."} Home Insulation Victoria reviews them before they apply.</p>
        <Section title={`Installation & removal (${unit})`}>
          <RateRow required label="R5.0 ceiling insulation supply & install" unit="m²" value={d.r5_rate} onChange={(v) => up({ r5_rate: v })} />
          <RateRow required label="Batts removal" unit="m²" value={d.batts_removal_rate} onChange={(v) => up({ batts_removal_rate: v })} />
          <RateRow required last label="Loose fill removal" unit="m²" value={d.loose_fill_removal_rate} onChange={(v) => up({ loose_fill_removal_rate: v })} />
          <p style={{ ...note, marginTop: 6 }}>Removal is required of all installer partners.</p>
        </Section>
        <Section title={`Access & extras — optional (${unit})`}>
          {EXTRA_ITEMS.map((it, i) => <RateRow key={it.key} label={it.label} unit={it.unit} value={r[it.key]} last={i === EXTRA_ITEMS.length - 1} onChange={(v) => up({ extra_rates: { ...r, [it.key]: v } })} />)}
          <p style={{ ...note, marginTop: 6 }}>Enter $0 if it's included at no extra charge. Leave blank to quote it separately on the job before owner approval.</p>
          <p style={{ background: BLUSH, color: PINK_TEXT, borderRadius: 8, padding: "9px 11px", fontSize: 13, fontWeight: 700, lineHeight: 1.45, margin: "0 0 6px" }}>Keeping access, call-out and other extra charges reasonable helps more homeowners proceed—and creates more opportunities for your business.</p>
        </Section>
      </>;
    }
    case "bank":
      return <>
        <p style={note}>Kept private and used only for approved Home Insulation Victoria payments.</p>
        <Field label="Account name" required htmlFor="bank_account_name" error={errFor("bank_account_name")}><input style={input} autoComplete="off" {...t("bank_account_name")} /></Field>
        <Field label="BSB" required hint="6 digits" htmlFor="bank_bsb" error={errFor("bank_bsb")}><input style={input} inputMode="numeric" autoComplete="off" {...t("bank_bsb")} /></Field>
        <Field label="Account number" required htmlFor="bank_account_number" error={errFor("bank_account_number")}><input style={input} inputMode="numeric" autoComplete="off" {...t("bank_account_number")} /></Field>
      </>;
    case "review":
      return <ReviewPanel d={d} up={up} preview={preview} load={() => getInstallerAgreement({ data: { token } })} onReady={onReviewReady} />;
    default:
      return null;
  }
}

/** Fail-closed agreement review: any data change or failed/pending load clears the review. */
function ReviewPanel({ d, up, preview, load, onReady }: { d: InstData; up: (p: Partial<InstData>) => void; preview: boolean; load: () => Promise<{ version: string; text: string; sha256: string }>; onReady: (r: Reviewed) => void }) {
  const [text, setText] = useState<string | null>(null);
  const [version, setVersion] = useState("");
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  const { agreement_reviewed: _r, ...scheduleData } = d;
  const signature = JSON.stringify(scheduleData);
  const upRef = useRef(up); upRef.current = up;
  const readyRef = useRef(onReady); readyRef.current = onReady;
  const loadRef = useRef(load); loadRef.current = load;
  useEffect(() => {
    const mine = ++generation.current;
    setText(null); setFailed(false);
    readyRef.current(null); upRef.current({ agreement_reviewed: false });
    if (preview) { setText(agreementText(d)); setVersion(INSTALLER_AGREEMENT_VERSION); readyRef.current({ version: INSTALLER_AGREEMENT_VERSION, sha256: "" }); return; }
    loadRef.current().then((a) => {
      if (mine !== generation.current) return;
      if (a.version !== INSTALLER_AGREEMENT_VERSION) { setFailed(true); return; }
      setText(a.text); setVersion(a.version); readyRef.current({ version: a.version, sha256: a.sha256 });
    }).catch(() => { if (mine === generation.current) setFailed(true); });
    return () => { generation.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, preview, attempt]);
  const loaded = text !== null && !failed;
  return <>
    <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 15, color: NAVY, marginBottom: 4 }}>1. Review the agreement</div>
    <div style={{ fontSize: 13, color: MUTED, marginBottom: 4 }}>Activity 48 · VEU · Version {version || "—"} · Installer: {d.trading_name || d.legal_entity_name} · ABN {d.abn}</div>
    <div style={{ fontSize: 14, fontWeight: 800, color: GREEN, marginBottom: 10 }}>AP accreditation number: A003654</div>
    {failed ? <div role="alert" style={{ border: "1px solid #F3B4AE", borderRadius: 12, padding: 14, fontSize: 14, color: "#8C1D18", background: "#FFF5F4", marginBottom: 14 }}>
      Could not load the agreement, so it can't be reviewed yet.{" "}
      <button type="button" onClick={() => setAttempt((x) => x + 1)} style={{ ...btn(false), minHeight: 40, marginTop: 8 }}>Try again</button>
    </div> : <div data-testid="agreement-text" style={{ maxHeight: 380, overflowY: "auto", border: "1px solid #E4E8F0", borderRadius: 12, padding: 14, fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap", overflowWrap: "anywhere", background: "#fff", marginBottom: 14 }}>{text ?? "Loading agreement…"}</div>}
    <div id="agreement-review" tabIndex={-1}><Check required disabled={!loaded} checked={loaded && d.agreement_reviewed === true} onChange={(v) => up({ agreement_reviewed: v })}>I've reviewed the installer partner agreement and the schedules above.</Check></div>
  </>;
}

function InsuranceStep({ d, up, token, setError, preview, revision, onUploadBusy }: { d: InstData; up: (p: Partial<InstData>) => void; token: string; setError: (s: string | null) => void; preview: boolean; revision: RevisionRef; onUploadBusy: (b: boolean) => void }) {
  const [uploading, setUploading] = useState(false);
  async function onFile(picked: File | undefined) {
    if (!picked) return;
    if (preview) { setError("Sample preview only — certificate upload is disabled."); return; }
    setError(null);
    let f: File; let mime: "application/pdf" | "image/jpeg" | "image/png";
    try { ({ file: f, mime } = await prepareCertificate(picked)); } catch (e) { setError(e instanceof Error ? e.message : "Upload a PDF, JPG or PNG."); return; }
    setUploading(true); onUploadBusy(true); // Back / Save & continue wait until the upload finishes.
    try {
      const u = await installerInsuranceUploadUrl({ data: { token, content_type: mime, size: f.size, filename: f.name } });
      const { error } = await supabase.storage.from("partner-files").uploadToSignedUrl(u.path, u.token, f, { contentType: mime });
      if (error) throw new Error("Upload failed. Please try again.");
      await uploadWithRevision(revision, (base) => confirmInstallerInsuranceUpload({ data: { token, path: u.path, content_type: mime, base_updated_at: base } }));
      up({ insurance_uploaded: true });
    } catch (e) { setError(e instanceof Error ? e.message : "Upload failed."); } finally { setUploading(false); onUploadBusy(false); }
  }
  return <>
    {d.insurance_uploaded
      ? <p style={okLine}>✓ Certificate uploaded — only the Home Insulation Victoria office can view it. {!preview && <label style={{ color: BLUE, fontWeight: 700, cursor: "pointer", marginLeft: 6 }}>Replace<input type="file" hidden accept="application/pdf,image/jpeg,image/png,image/heic,image/heif,.heic,.heif" onChange={(e) => onFile(e.target.files?.[0])} /></label>}</p>
      : <Field label="Certificate of Currency" required hint="PDF, JPG or PNG, up to 10 MB">
          <label style={{ ...btn(false, uploading), display: "inline-flex", alignItems: "center" }}>{uploading ? "Uploading…" : "Upload certificate"}<input type="file" hidden disabled={uploading} accept="application/pdf,image/jpeg,image/png,image/heic,image/heif,.heic,.heif" onChange={(e) => onFile(e.target.files?.[0])} /></label>
        </Field>}
    <Field label="Insurer" required><input style={input} value={d.insurer ?? ""} onChange={(e) => up({ insurer: e.target.value })} /></Field>
    <Field label="Policy number" required><input style={input} value={d.insurance_policy_number ?? ""} onChange={(e) => up({ insurance_policy_number: e.target.value })} /></Field>
    <Field label="Public liability cover" required hint="Minimum $5,000,000"><Money value={d.public_liability_cover_amount} onChange={(v) => up({ public_liability_cover_amount: v })} />
      {typeof d.public_liability_cover_amount === "number" && d.public_liability_cover_amount < 5_000_000 && <div role="alert" style={{ color: "#B42318", fontWeight: 700, fontSize: 14, marginTop: 6 }}>Cover must be at least $5,000,000. You can't continue with less.</div>}
    </Field>
    <Field label="Expiry date" required><input style={{ ...input, maxWidth: 220 }} type="date" value={d.public_liability_expiry ?? ""} onChange={(e) => up({ public_liability_expiry: e.target.value })} /></Field>
  </>;
}

function SignStep({ d, token, reviewed, preview, relaxed, revision, saveReviewed, onGoToPage, onSigned }: { d: InstData; token: string; reviewed: Reviewed; preview: boolean; relaxed: boolean; revision: () => string | null; saveReviewed: () => Promise<void>; onGoToPage: (page: StepKey) => void; onSigned: () => void }) {
  const [acks, setAcks] = useState<Record<string, boolean>>({});
  const [name, setName] = useState(d.primary_contact_name ?? "");
  const [position, setPosition] = useState("");
  const [email, setEmail] = useState(d.business_email ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const textRevision = `${INSTALLER_AGREEMENT_VERSION}:${agreementText(d)}`;
  useEffect(() => setAcks({}), [textRevision]);
  const reviewDone = !!reviewed && d.agreement_reviewed === true;
  const blockers = installerSignUiBlockers({ data: d, reviewed: reviewDone, acknowledgements: acks, signerName: name, signerPosition: position, signerEmail: email, relaxed, preview });
  const ready = blockers.length === 0;
  async function sign() {
    if (preview) { setErr("Sample preview only — no agreement was signed or submitted."); return; }
    setBusy(true); setErr(null);
    try {
      // Recovers a lost successful response: an already-submitted application replays the idempotent sign.
      await signWithRecovery(reviewed?.sha256 ?? null, {
        load: () => loadInstallerOnboarding({ data: { token } }),
        saveReviewed, agreement: () => getInstallerAgreement({ data: { token } }), revision,
        sign: (expected, sha) => signInstallerAgreement({ data: { token, signer_name: name, signer_position: position, signer_email: email, acknowledgements: acks, agreement_version: INSTALLER_AGREEMENT_VERSION, expected_updated_at: expected, agreement_sha256: sha } }),
      });
      onSigned(); window.scrollTo({ top: 0 });
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not sign. Please try again."); } finally { setBusy(false); }
  }
  return <section style={{ borderTop: "1px solid #E4E8F0", marginTop: 20, paddingTop: 18, opacity: reviewDone ? 1 : 0.6 }}>
    <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 15, color: NAVY, marginBottom: 4 }}>2. Sign</div>
    <p style={note}>{reviewDone ? "You're signing electronically. We store the exact wording, version, your details and the time." : "Tick the review box above to sign."}</p>
    <div id="signing-acknowledgements" tabIndex={-1}>{ACKNOWLEDGEMENTS.map((a) => <Check key={a.key} disabled={!reviewDone} checked={!!acks[a.key]} onChange={(v) => setAcks((x) => ({ ...x, [a.key]: v }))}>{a.text}</Check>)}</div>
    <Field label="Signer full legal name" required htmlFor="signer-name"><input id="signer-name" style={input} disabled={!reviewDone} value={name} onChange={(e) => setName(e.target.value)} /></Field>
    <Field label="Position / title" required htmlFor="signer-position"><input id="signer-position" style={input} disabled={!reviewDone} placeholder="e.g. Director" value={position} onChange={(e) => setPosition(e.target.value)} /></Field>
    <Field label="Signer email" required htmlFor="signer-email"><input id="signer-email" style={input} disabled={!reviewDone} type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
    {blockers.length > 0 && <div role="alert" aria-label="Items required before signing" style={{ background: "#FFF5F4", border: "1px solid #F3B4AE", borderRadius: 12, padding: "11px 13px", marginBottom: 14, color: "#8C1D18", fontSize: 14 }}>
      <div style={{ fontWeight: 800, marginBottom: 6 }}>Before you can sign:</div>
      {blockers.map((b) => <div key={b.key} style={{ marginTop: 5 }}>• <button type="button" onClick={() => { if (b.page && b.page !== "review") onGoToPage(b.page); else { const el = b.target ? document.getElementById(b.target) : null; el?.scrollIntoView({ block: "center" }); el?.focus(); } }} style={{ border: 0, padding: 0, background: "transparent", color: "inherit", textDecoration: "underline", font: "inherit", fontWeight: 700, cursor: "pointer", textAlign: "left" }}>{b.message}</button></div>)}
    </div>}
    {err && <p style={{ color: "#B3261E", fontSize: 14 }}>{err}</p>}
    <button style={{ ...btn(true, !ready || busy), width: "100%" }} disabled={!ready || busy || preview} onClick={sign}>{busy ? "Signing…" : preview ? "Preview only — signing disabled" : "Sign agreement & submit"}</button>
  </section>;
}

const SAMPLE_ADDRESS: ResolvedAddress = { label: "100 Sample Road, Melbourne VIC 3000", suburb: "Melbourne", postcode: "3000", state: "VIC", country: "AU", provider: "google_places_au" };
const SAMPLE_INSTALLER_DATA: InstData = {
  works_for_business: false, primary_contact_name: "Sample Installer representative", business_phone: "0400 000 000", business_email: "sample@example.com",
  legal_entity_name: "Sample Insulation Pty Ltd", trading_name: "Sample Insulation", abn: "51824753556", business_address: SAMPLE_ADDRESS.label, business_address_details: SAMPLE_ADDRESS,
  insurance_uploaded: true, insurer: "Sample insurer", insurance_policy_number: "SAMPLE-001", public_liability_cover_amount: 5_000_000, public_liability_expiry: "2099-12-31",
  installers: [{ full_legal_name: "Sample Installer One", mobile: "0400 000 001", email: "installer1@example.com", cii_holds: "held", cii_certificate_number: "CII-SAMPLE", cii_issuer: "Sample issuer", cii_issue_date: "2025-01-01" }],
  electrician_choice: "match", wants_hivic_leads: true, free_measureups_for_hivic_quote_leads: true,
  service_origin: SAMPLE_ADDRESS.label, service_origin_details: SAMPLE_ADDRESS, travel_radius_km: 50,
  typical_days: ["Mon", "Tue", "Wed"], normal_attendance_speed: "3-5 business days", capacity_band: "4-8", accepting_jobs: true,
  gst_registered: true, r5_rate: 20, batts_removal_rate: 8, loose_fill_removal_rate: 12, extra_rates: {},
  bank_account_name: "Sample Insulation Pty Ltd", bank_bsb: "123-456", bank_account_number: "12345678", agreement_reviewed: false,
};
