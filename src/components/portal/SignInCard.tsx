import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { greenBtn, ghostBtn, inputCls } from "@/components/trade/TradeShell";
import { LINK_SENT_SAFE, badLinkMessage, linkErrorMessage, normaliseLoginEmail, safeNextPath, signInErrorMessage } from "@/lib/login.core";
import logo from "@/assets/home-insulation-victoria-logo.png.asset.json";


/** Shared staff/trade sign-in card used by /auth and /portal. After sign-in everyone goes to /portal, which routes by role. */
export function SignInCard() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const next = () => safeNextPath(new URLSearchParams(window.location.search).get("next"));
  const goOn = () => { const n = next(); navigate({ to: "/portal", search: (n ? { next: n } : {}) as never, replace: true }); };

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const th = q.get("token_hash");
    if (th && q.get("type") === "magiclink") {
      void supabase.auth.verifyOtp({ token_hash: th, type: "magiclink" }).then(({ error }) => {
        q.delete("token_hash"); q.delete("type");
        window.history.replaceState(null, "", `${window.location.pathname}${q.toString() ? `?${q}` : ""}`);
        if (error) setErr(`${badLinkMessage(error)} Type your email and tap "Email me a sign-in link" for a new one.`);
      });
    }
    supabase.auth.getSession().then(({ data }) => { if (data.session) goOn(); });
    const { data } = supabase.auth.onAuthStateChange((e, s) => { if (s && e === "SIGNED_IN") goOn(); });
    return () => data.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checked = () => {
    setErr(null); setSent(null);
    const c = normaliseLoginEmail(email);
    if (!c.ok) { setErr(c.message); return null; }
    if (c.email !== email) setEmail(c.email);
    return c.email;
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const em = checked(); if (!em) return;
    if (!password) { setErr("Type your password, or use \"Email me a sign-in link\"."); return; }
    setBusy(true);
    const res = await supabase.auth.signInWithPassword({ email: em, password });
    setBusy(false);
    if (res.error) setErr(signInErrorMessage(res.error));
  };
  const back = () => { const n = next(); return `${window.location.origin}/portal${n ? `?next=${encodeURIComponent(n)}` : ""}`; };
  const forgot = async () => {
    const em = checked(); if (!em) return;
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(em, { redirectTo: `${window.location.origin}/reset-password?next=/portal` });
    setBusy(false);
    const m = error ? linkErrorMessage(error) : null;
    if (m) setErr(m); else setSent(LINK_SENT_SAFE);
  };
  const magic = async () => {
    const em = checked(); if (!em) return;
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({ email: em, options: { shouldCreateUser: false, emailRedirectTo: back() } });
    setBusy(false);
    const m = error ? linkErrorMessage(error) : null;
    if (m) setErr(m); else setSent(LINK_SENT_SAFE);
  };

  const google = async () => {
    const r = await lovable.auth.signInWithOAuth("google", { redirect_uri: back() });
    if (r.error) setErr("Google sign-in didn't work. Try your email and password instead.");
  };

  return (
    <main className="estimate-brand portal-theme grid min-h-screen place-items-center bg-canvas px-4 py-10 text-ink">
      <div className="w-full max-w-[420px] rounded-[18px] border border-line bg-paper p-6 shadow-card md:p-8" data-signin>
        <img src={logo.url} alt="Home Insulation Victoria" className="h-10 w-auto" />
        <p className="mt-6 text-xs font-bold uppercase tracking-wide text-hiv-blue">Staff & trade portal</p>
        <h1 className="mt-1 font-display text-[28px] font-bold leading-tight">Welcome back.</h1>
        <p className="text-sm text-sub">Your jobs, next steps and business records.</p>
        {err && <p role="alert" data-login-error className="mt-4 rounded-[12px] border border-rose bg-pink p-3 text-sm font-semibold text-ink">{err}</p>}
        {sent && <p role="status" className="mt-4 rounded-[12px] bg-mint p-3 text-sm font-semibold text-ink">{sent}</p>}
        <form onSubmit={submit} className="mt-5 space-y-3">
          <div><label htmlFor="e" className="mb-1 block text-sm font-bold">Email</label><input id="e" type="text" inputMode="email" autoCapitalize="none" spellCheck={false} autoComplete="email" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div><label htmlFor="p" className="mb-1 block text-sm font-bold">Password</label><input id="p" type="password" autoComplete="current-password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} /></div>
          <button type="submit" className={greenBtn} disabled={busy}>Sign in</button>
        </form>
        <button type="button" onClick={forgot} disabled={busy} className="mt-3 w-full text-center text-sm font-bold text-estimate-blue">Forgot password?</button>
        <div className="mt-3 space-y-2">
          <button type="button" className={ghostBtn} onClick={magic} disabled={busy}>Email me a sign-in link</button>
          <button type="button" className={ghostBtn} onClick={google}>Continue with Google</button>
        </div>
        <p className="mt-5 border-t border-line pt-4 text-xs text-sub">For the office, installers, electricians and owners. Portal access is provided by Home Insulation Victoria.</p>
      </div>
    </main>
  );
}
