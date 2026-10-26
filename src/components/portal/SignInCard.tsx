import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { greenBtn, ghostBtn, inputCls } from "@/components/trade/TradeShell";
import { LINK_SENT_SAFE, badLinkMessage, linkErrorMessage, normaliseLoginEmail, safeNextPath, signInErrorMessage } from "@/lib/login.core";
import { cn } from "@/lib/utils";
import logo from "@/assets/home-insulation-victoria-logo.png.asset.json";


/** Shared staff/trade sign-in card used by /auth and /portal. After sign-in everyone goes to /portal, which routes by role. */
export function SignInCard() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Which button is working, so it can say so ("Signing in…") and every other button waits.
  const [busy, setBusy] = useState<null | "signin" | "reset" | "link" | "google">(null);
  const [sent, setSent] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // The box the error is about (our own checks only; a wrong email/password pair never says which one).
  const [errField, setErrField] = useState<null | "email" | "password">(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const fail = (message: string, field: "email" | "password" | null = null) => {
    setErr(message); setErrField(field);
    (field === "email" ? emailRef : field === "password" ? passwordRef : null)?.current?.focus();
  };
  const next = () => safeNextPath(new URLSearchParams(window.location.search).get("next"));
  const goOn = () => { const n = next(); navigate({ to: "/portal", search: (n ? { next: n } : {}) as never, replace: true }); };

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const th = q.get("token_hash");
    if (th && q.get("type") === "magiclink") {
      void supabase.auth.verifyOtp({ token_hash: th, type: "magiclink" }).then(({ error }) => {
        q.delete("token_hash"); q.delete("type");
        window.history.replaceState(null, "", `${window.location.pathname}${q.toString() ? `?${q}` : ""}`);
        if (error) fail(`${badLinkMessage(error)} Type your email and tap "Email me a sign-in link" for a new one.`);
      });
    }
    supabase.auth.getSession().then(({ data }) => { if (data.session) goOn(); });
    const { data } = supabase.auth.onAuthStateChange((e, s) => { if (s && e === "SIGNED_IN") goOn(); });
    return () => data.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checked = () => {
    setErr(null); setErrField(null); setSent(null);
    const c = normaliseLoginEmail(email);
    if (!c.ok) { fail(c.message, "email"); return null; }
    if (c.email !== email) setEmail(c.email);
    return c.email;
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const em = checked(); if (!em) return;
    if (!password) { fail("Type your password, or use \"Email me a sign-in link\".", "password"); return; }
    setBusy("signin");
    const res = await supabase.auth.signInWithPassword({ email: em, password });
    setBusy(null);
    if (res.error) fail(signInErrorMessage(res.error));
  };
  const back = () => { const n = next(); return `${window.location.origin}/portal${n ? `?next=${encodeURIComponent(n)}` : ""}`; };
  const forgot = async () => {
    const em = checked(); if (!em) return;
    setBusy("reset");
    const { error } = await supabase.auth.resetPasswordForEmail(em, { redirectTo: `${window.location.origin}/reset-password?next=/portal` });
    setBusy(null);
    const m = error ? linkErrorMessage(error) : null;
    if (m) fail(m); else setSent(LINK_SENT_SAFE);
  };
  const magic = async () => {
    const em = checked(); if (!em) return;
    setBusy("link");
    const { error } = await supabase.auth.signInWithOtp({ email: em, options: { shouldCreateUser: false, emailRedirectTo: back() } });
    setBusy(null);
    const m = error ? linkErrorMessage(error) : null;
    if (m) fail(m); else setSent(LINK_SENT_SAFE);
  };

  const google = async () => {
    setErr(null); setErrField(null); setSent(null); setBusy("google");
    const r = await lovable.auth.signInWithOAuth("google", { redirect_uri: back() });
    setBusy(null); // on success the browser has already left for Google
    if (r.error) fail("Google sign-in didn't work. Try your email and password instead.");
  };

  return (
    <main className="estimate-brand portal-theme grid min-h-screen place-items-center bg-canvas px-4 py-10 text-ink">
      <div className="w-full max-w-[420px] rounded-[18px] border border-line bg-paper p-6 shadow-card md:p-8" data-signin>
        <img src={logo.url} alt="Home Insulation Victoria" className="h-10 w-auto" />
        <p className="mt-6 text-xs font-bold uppercase tracking-wide text-hiv-blue">Staff & trade portal</p>
        <h1 className="mt-1 font-display text-[28px] font-bold leading-tight">Welcome back.</h1>
        <p className="text-sm text-sub">Your jobs, next steps and business records.</p>
        {err && <p id="signin-error" role="alert" data-login-error className="mt-4 rounded-[12px] border border-rose bg-pink p-3 text-sm font-semibold text-ink">{err}</p>}
        {sent && <p role="status" className="mt-4 rounded-[12px] bg-mint p-3 text-sm font-semibold text-ink">{sent}</p>}
        <form onSubmit={submit} className="mt-5 space-y-3">
          <div><label htmlFor="e" className="mb-1 block text-sm font-bold">Email</label><input ref={emailRef} id="e" type="text" inputMode="email" autoCapitalize="none" spellCheck={false} autoComplete="email" aria-invalid={errField === "email" || undefined} aria-describedby={errField === "email" ? "signin-error" : undefined} className={cn(inputCls, errField === "email" && "border-rose")} value={email} onChange={(e) => { setEmail(e.target.value); if (errField === "email") setErrField(null); }} /></div>
          <div><label htmlFor="p" className="mb-1 block text-sm font-bold">Password</label><input ref={passwordRef} id="p" type="password" autoComplete="current-password" aria-invalid={errField === "password" || undefined} aria-describedby={errField === "password" ? "signin-error" : undefined} className={cn(inputCls, errField === "password" && "border-rose")} value={password} onChange={(e) => { setPassword(e.target.value); if (errField === "password") setErrField(null); }} /></div>
          <button type="submit" className={cn(greenBtn, "md:w-full")} disabled={!!busy}>{busy === "signin" ? "Signing in…" : "Sign in"}</button>
        </form>
        <button type="button" onClick={forgot} disabled={!!busy} className="mt-1 min-h-11 w-full text-center text-sm font-bold text-estimate-blue disabled:opacity-45">{busy === "reset" ? "Sending…" : "Forgot password?"}</button>
        <div className="mt-1 space-y-2">
          <button type="button" className={cn(ghostBtn, "md:w-full disabled:cursor-not-allowed disabled:opacity-45")} onClick={magic} disabled={!!busy}>{busy === "link" ? "Sending…" : "Email me a sign-in link"}</button>
          <button type="button" className={cn(ghostBtn, "md:w-full disabled:cursor-not-allowed disabled:opacity-45")} onClick={google} disabled={!!busy}>{busy === "google" ? "Opening Google…" : "Continue with Google"}</button>
        </div>
        <p className="mt-5 border-t border-line pt-4 text-xs text-sub">For the office, installers and electricians. Portal access is provided by Home Insulation Victoria.</p>
      </div>
    </main>
  );
}
