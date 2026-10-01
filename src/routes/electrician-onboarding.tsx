import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import logo from "@/assets/home-insulation-victoria-logo.png.asset.json";
import {
  ACKNOWLEDGEMENTS, CAPACITY_BANDS, DAYS, LEAD_TIMES, RADII, RECT_ITEMS, REC_AGREEMENT_VERSION,
  firstName, stepErrors, firstIncompleteStep, validAbn, visibleSteps, type RecData, type StepKey,
} from "@/lib/rec-onboarding.core";
import {
  confirmInsuranceUpload, getRecAgreement, insuranceUploadUrl, loadRecOnboarding, saveRecOnboarding, signRecAgreement, startRecOnboarding,
} from "@/lib/rec-onboarding.functions";
import { loadTeamInvite, respondTeamInvite } from "@/lib/teaming.functions";
import { HowItWorksElectrician } from "@/components/portal/how-it-works";
import { defaultAddressProvider } from "@/lib/address-provider";
import type { AddressSuggestion } from "@/lib/whatif-location";

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
const DISPLAY = "'Outfit', 'Figtree', system-ui, sans-serif";
const ACCENTS: Array<{ bg: string; fg: string }> = [
  { bg: "oklch(0.93 0.06 345)", fg: "oklch(0.43 0.13 345)" },
  { bg: "oklch(0.92 0.055 250)", fg: "oklch(0.4 0.14 255)" },
  { bg: "oklch(0.93 0.07 145)", fg: "oklch(0.38 0.1 150)" },
  { bg: "oklch(0.94 0.075 85)", fg: "oklch(0.42 0.1 70)" },
];
const infoCard: React.CSSProperties = { background: "#EAF8F0", border: `1px solid ${GREEN}55`, borderRadius: 14, padding: "12px 14px", fontSize: 14, color: NAVY, lineHeight: 1.5, marginBottom: 18 };
const btn = (primary: boolean, disabled = false): React.CSSProperties => ({ minHeight: 48, padding: "0 20px", borderRadius: 12, border: primary ? "none" : `1px solid #D7DCE8`, background: primary ? (disabled ? "#9AA6D8" : BLUE) : "#fff", color: primary ? "#fff" : NAVY, fontWeight: 800, fontSize: 14, letterSpacing: 0.6, textTransform: "uppercase", cursor: disabled ? "default" : "pointer", fontFamily: "inherit" });

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

  const [invite, setInvite] = useState<string | null>(null);
  const [inviteInfo, setInviteInfo] = useState<Awaited<ReturnType<typeof loadTeamInvite>> | null>(null);
  useEffect(() => {
    const i = new URLSearchParams(window.location.search).get("invite");
    if (!i) return;
    setInvite(i);
    loadTeamInvite({ data: { invite: i } }).then(setInviteInfo).catch((e) => setError(e instanceof Error ? e.message : "Invitation not found."));
  }, []);
  async function answerInvite(accept: boolean) {
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
    const t = localStorage.getItem(TOKEN_KEY);
    if (!t) { setLoaded(true); return; }
    loadRecOnboarding({ data: { token: t } }).then((r) => {
      setToken(t); setD(r.data as RecData); setStatus(r.status as "draft" | "submitted"); setStarted(true);
      if (r.test_mode) setTestMode(true);
      const first = firstIncompleteStep(r.data as RecData);
      setStep(r.status === "submitted" ? "sign" : ((first ?? r.step_key ?? "about") as StepKey));
    }).catch(() => localStorage.removeItem(TOKEN_KEY)).finally(() => setLoaded(true));
  }, []);

  const steps = useMemo(() => visibleSteps(d), [d]);
  const idx = Math.max(0, steps.findIndex((s) => s.key === step));
  const errs = stepErrors(step, d);
  const up = (patch: Partial<RecData>) => setD((x) => ({ ...x, ...patch }));

  async function begin() {
    setBusy(true); setError(null);
    try {
      const { token: t } = await startRecOnboarding({ data: { test: testMode } });
      localStorage.setItem(TOKEN_KEY, t); setToken(t); setStarted(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not start."); } finally { setBusy(false); }
  }
  async function persist(nextStep: StepKey) {
    if (!token) return;
    const { insurance_uploaded: _u, ...data } = d;
    const r = await saveRecOnboarding({ data: { token, step_key: nextStep, data: data as never } });
    setD(r.data as RecData);
  }
  async function go(delta: 1 | -1) {
    setError(null);
    if (delta === 1 && errs.length && !testMode) { setShowErrors(true); return; }
    setShowErrors(false);
    const target = steps[Math.min(steps.length - 1, Math.max(0, idx + delta))]?.key ?? "about";
    setBusy(true);
    try { await persist(target); setStep(target); window.scrollTo({ top: 0 }); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not save."); } finally { setBusy(false); }
  }

  const shell = (children: React.ReactNode, footer?: React.ReactNode) => (
    <div style={{ minHeight: "100vh", background: "radial-gradient(circle at top, #fff 0%, #f5f8f5 45%, #eef2f0 100%)", fontFamily: "'Figtree', system-ui, sans-serif", color: NAVY }}>
      <style>{`h1,h2,h3{font-family:${DISPLAY}}`}</style>
      <header style={{ position: "sticky", top: 0, zIndex: 10, background: "rgba(255,255,255,.92)", backdropFilter: "blur(8px)", borderBottom: `1px solid ${BLUE}14` }}>
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
      <div style={{ padding: 24 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: GREEN, textTransform: "uppercase", letterSpacing: 0.8, fontFamily: DISPLAY }}>Home Insulation Victoria</div>
        <h1 style={{ fontSize: 28, fontWeight: 800, margin: "8px 0 10px", color: NAVY }}>Welcome to our Trade Partner Network</h1>
        <p style={{ fontSize: 15, lineHeight: 1.6, color: MUTED }}>We're really pleased to have you here and can't wait to work with you. Home Insulation Victoria keeps jobs, communication and assessments simple — all in one place.</p>
        <div style={{ fontWeight: 700, margin: "18px 0 10px", fontFamily: DISPLAY }}>Have these handy</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, marginBottom: 22 }}>
          {["REC + ABN details (only if you run your own REC)", "Public liability insurance (only for your own REC)", "Electrician details + licence numbers", "Your proposed rates"].map((t, i) => (
            <div key={t} style={{ background: ACCENTS[i % 4]!.bg, color: ACCENTS[i % 4]!.fg, borderRadius: 14, padding: "12px 14px", fontSize: 14, fontWeight: 600 }}><span style={{ fontWeight: 800 }}>✓ </span>{t}</div>
          ))}
        </div>
        <p style={{ fontSize: 13, color: MUTED }}>Your progress saves as you go on this device.</p>
        {error && <p style={{ color: "#B3261E" }}>{error}</p>}
        <button style={{ ...btn(true, busy), width: "100%", minHeight: 52, borderRadius: 16 }} disabled={busy} onClick={begin}>{busy ? "Starting…" : "Get started →"}</button>
      </div>
    </div>,
  );

  if (status === "submitted") return shell(
    <div style={{ ...card, textAlign: "center" }}>
      <div style={{ width: 56, height: 56, borderRadius: "50%", background: GREEN, color: "#fff", fontSize: 28, lineHeight: "56px", margin: "0 auto 16px" }}>✓</div>
      <h1 style={{ fontSize: 24, fontWeight: 800, margin: "0 0 8px" }}>Thanks, {d.primary_contact_name?.split(" ")[0] || "partner"} — we've got everything.</h1>
      <p style={{ color: MUTED, lineHeight: 1.6 }}>Your application and signed agreement are now with the Home Insulation Victoria team. We'll review your details, check your REC registration, licences and insurance, and be in touch if we need anything else.</p>
      <p style={{ color: MUTED, lineHeight: 1.6 }}>Once you're approved and your rates are agreed, you'll start receiving job offers through the portal. {d.works_under_rec ? <>Your work is paid through {d.host_rec_name || "the business you work under"} — nothing more to set up.</> : <>Your payment details are already on file — you're paid once each job's invoice is paid in full.</>}</p>
      <div style={{ ...infoCard, textAlign: "left", marginTop: 8 }}><strong>What happens next:</strong> review and verification → rates confirmed → welcome aboard. Keep an eye on {d.business_email || "your email"} — that's where we'll contact you.</div>
      <p style={{ color: MUTED, fontSize: 13 }}>Agreement version {REC_AGREEMENT_VERSION} · A copy of everything you've submitted is kept on your file.</p>
    </div>,
  );

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
      {testMode && <div style={{ background: "#FFF8E6", border: "1px solid #E0A100", borderRadius: 12, padding: "10px 14px", fontSize: 13, fontWeight: 700, color: "#7A5A00", marginBottom: 14 }}>TEST MODE — nothing is mandatory, so you can click straight through. This application is marked as a test and won't count as a real applicant.</div>}
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 4px", color: BLUE }}>{steps[idx]?.title}</h1>
      {firstName(d) && step !== "about" && <div style={{ fontSize: 14, color: MUTED, marginBottom: 12 }}>Nice one, {firstName(d)} — next up: {steps[idx]?.title?.toLowerCase()}.</div>}
      {!firstName(d) && <div style={{ marginBottom: 12 }} />}
      <StepBody step={step} d={d} up={up} token={token!} setError={setError} />
      {step === "sign" && <SignStep d={d} token={token!} onSigned={() => setStatus("submitted")} />}
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

function StepBody({ step, d, up, token, setError }: { step: StepKey; d: RecData; up: (p: Partial<RecData>) => void; token: string; setError: (s: string | null) => void }) {
  const t = (k: keyof RecData, upper = false) => ({ value: (d[k] as string) ?? "", onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => up({ [k]: upper ? e.target.value.toUpperCase() : e.target.value } as Partial<RecData>) });
  switch (step) {
    case "about":
      return <>
        <div style={infoCard}>First things first — so we know who we're talking to. We'll use your name throughout.</div>
        <Field label="Your name" required><input style={input} autoFocus placeholder="e.g. Sam Taylor" {...t("primary_contact_name")} /></Field>
        <Field label="Your mobile" required><input style={input} type="tel" {...t("business_phone")} /></Field>
        <Field label="Your email" required><input style={input} type="email" {...t("business_email")} /></Field>
      </>;
    case "howitworks":
      return <>
        <HowItWorksElectrician />
        <div style={{ marginTop: 16 }}>
          <Check checked={d.how_it_works_acknowledged === true} onChange={(v) => up({ how_it_works_acknowledged: v })}>I've read how jobs work, the same-day rule and the payment terms.</Check>
        </div>
      </>;
    case "business":
      return <>
        <Field label="Do you run your own REC business, or work under another REC?" required>
          <Choice options={[{ v: false as boolean, l: "I run my own REC business" }, { v: true as boolean, l: "I work under another REC" }]} value={d.works_under_rec ?? null} onChange={(v) => up({ works_under_rec: v })} />
        </Field>
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
        <Check checked={d.authorised_to_register === true} onChange={(v) => up({ authorised_to_register: v })}>I'm authorised to set up this REC.</Check>
      </>;
    case "insurance":
      return <InsuranceStep d={d} up={up} token={token} setError={setError} />;
    case "electricians": {
      const list = d.electricians ?? [];
      const set = (i: number, p: Partial<NonNullable<RecData["electricians"]>[number]>) => up({ electricians: list.map((x, j) => (j === i ? { ...x, ...p } : x)) });
      return <>
        <div style={infoCard}>You only need to add ONE electrician to continue. Add more only if they may attend Home Insulation Victoria jobs.</div>
        {list.map((x, i) => (
          <div key={i} style={{ border: "1px solid #E4E8F0", borderRadius: 14, padding: 14, marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}><strong>Electrician {i + 1}</strong>
              <button type="button" onClick={() => up({ electricians: list.filter((_, j) => j !== i) })} style={{ border: "none", background: "none", color: "#B3261E", cursor: "pointer", fontWeight: 700 }}>Remove</button></div>
            <Field label="Full legal name" required><input style={input} value={x.full_legal_name ?? ""} onChange={(e) => set(i, { full_legal_name: e.target.value })} /></Field>
            <Field label="Victorian licence number" required><input style={input} value={x.licence_number ?? ""} onChange={(e) => set(i, { licence_number: e.target.value.toUpperCase() })} /></Field>
            <Field label="Mobile" required><input style={input} type="tel" value={x.mobile ?? ""} onChange={(e) => set(i, { mobile: e.target.value })} /></Field>
            <Field label="Email" required><input style={input} type="email" value={x.email ?? ""} onChange={(e) => set(i, { email: e.target.value })} /></Field>
          </div>
        ))}
        <button type="button" style={btn(false)} onClick={() => up({ electricians: [...list, {}] })}>+ Add electrician</button>
      </>;
    }
    case "services":
      return <>
        <div style={infoCard}><strong>Included for all electrical partners:</strong> Initial onsite assessment + ceiling measure-up + PIESA</div>
        <Check checked={d.service_rectification === true} onChange={(v) => up({ service_rectification: v })}>Electrical rectification work</Check>
        <Check checked={d.service_installation_isolation === true} onChange={(v) => up({ service_installation_isolation: v })}>Installation-day electrical attendance</Check>
        <p style={{ fontSize: 13, color: MUTED }}>Optional. Leave either service off if you don't want that type of work.</p>
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
        <div style={infoCard}>{d.gst_registered === false ? "Not GST registered: enter your total rate." : "GST registered: enter rates including GST."} These are proposed supplier rates — Home Insulation Victoria reviews them before they apply.</div>
        <Field label={`Pre-Insulation Electrical Safety Assessment (PIESA) visit (${unit})`} required hint="Formal electrical safety assessment and PIESA only. The installer completes the separate eligibility measure-up."><Money value={d.assessment_rate} onChange={(v) => up({ assessment_rate: v })} unit="visit" /></Field>
        {d.service_installation_isolation && <Field label={`Installation-day attendance (${unit})`} required><Money value={d.installation_attendance_rate} onChange={(v) => up({ installation_attendance_rate: v })} unit="visit" /></Field>}
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
      return <ReviewStep d={d} up={up} token={token} />;
    default:
      return null;
  }
}

function InsuranceStep({ d, up, token, setError }: { d: RecData; up: (p: Partial<RecData>) => void; token: string; setError: (s: string | null) => void }) {
  const [uploading, setUploading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [found, setFound] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  async function onFile(f: File | undefined) {
    if (!f) return;
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
      ? <div style={{ ...infoCard }}>✓ Certificate uploaded. It's stored privately — only the Home Insulation Victoria office can view it. <label style={{ color: BLUE, fontWeight: 700, cursor: "pointer", marginLeft: 6 }}>Replace<input type="file" hidden accept="application/pdf,image/jpeg,image/png" onChange={(e) => onFile(e.target.files?.[0])} /></label></div>
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

function ReviewStep({ d, up, token }: { d: RecData; up: (p: Partial<RecData>) => void; token: string }) {
  const [text, setText] = useState<string | null>(null);
  const [version, setVersion] = useState("");
  useEffect(() => {
    // Save first so the schedules reflect the latest answers, then load the exact text.
    getRecAgreement({ data: { token } }).then((a) => { setText(a.text); setVersion(a.version); }).catch(() => setText("Could not load the agreement. Please go back and try again."));
  }, [token]);
  return <>
    <div style={{ fontSize: 12, fontWeight: 800, color: GREEN, textTransform: "uppercase", letterSpacing: 0.8 }}>Activity 48 · VEU</div>
    <div style={{ fontSize: 13, color: MUTED, marginBottom: 6 }}>Version {version}</div>
    <div style={{ fontSize: 14, marginBottom: 4 }}><strong>AP:</strong> DC Construction Solutions Pty Ltd trading as Home Insulation Victoria</div>
    <div style={{ fontSize: 14, marginBottom: 12 }}><strong>REC:</strong> {d.trading_name || d.legal_entity_name} · {d.rec_registration_number}</div>
    <div style={{ maxHeight: 420, overflowY: "auto", border: "1px solid #E4E8F0", borderRadius: 14, padding: 16, fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap", background: "#FBFCFA", marginBottom: 16 }}>{text ?? "Loading agreement…"}</div>
    <Check checked={d.agreement_reviewed === true} onChange={(v) => up({ agreement_reviewed: v })}>I've reviewed the REC partner agreement and the schedules above.</Check>
  </>;
}

function SignStep({ d, token, onSigned }: { d: RecData; token: string; onSigned: () => void }) {
  const [acks, setAcks] = useState<Record<string, boolean>>({});
  const [name, setName] = useState(d.primary_contact_name ?? "");
  const [position, setPosition] = useState("");
  const [email, setEmail] = useState(d.business_email ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ready = ACKNOWLEDGEMENTS.every((a) => acks[a.key]) && name.trim().length > 1 && position.trim().length > 1 && email.includes("@");
  async function sign() {
    setBusy(true); setErr(null);
    try {
      await signRecAgreement({ data: { token, signer_name: name, signer_position: position, signer_email: email, acknowledgements: acks, agreement_version: REC_AGREEMENT_VERSION } });
      onSigned(); window.scrollTo({ top: 0 });
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not sign."); } finally { setBusy(false); }
  }
  return <>
    <div style={infoCard}>🛡 You're signing electronically. We store the exact wording you signed, its version, your details and the time, so both parties have the same record.</div>
    {ACKNOWLEDGEMENTS.map((a) => <Check key={a.key} checked={!!acks[a.key]} onChange={(v) => setAcks((x) => ({ ...x, [a.key]: v }))}>{a.text}</Check>)}
    <Field label="Signer full legal name" required><input style={input} value={name} onChange={(e) => setName(e.target.value)} /></Field>
    <Field label="Position / title" required><input style={input} placeholder="e.g. Director" value={position} onChange={(e) => setPosition(e.target.value)} /></Field>
    <Field label="Signer email" required><input style={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
    {err && <p style={{ color: "#B3261E", fontSize: 14 }}>{err}</p>}
    <button style={{ ...btn(true, !ready || busy), width: "100%" }} disabled={!ready || busy} onClick={sign}>{busy ? "Signing…" : "Sign agreement & submit"}</button>
  </>;
}
