import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LINK_SENT_SAFE, linkErrorMessage, normaliseLoginEmail, safeNextPath, signInErrorMessage } from "@/lib/login.core";
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
    <main className="portal-theme relative grid min-h-screen place-items-center overflow-hidden bg-background px-4 py-12 text-foreground">
      <div className="w-full max-w-sm rounded-[18px] border bg-card p-6 shadow-sm">
        <div className="mb-6 border-b pb-5 text-center">
          <img src={logo.url} alt="Home Insulation Victoria" className="mx-auto h-14 w-auto" />
          <h1 className="mt-4 font-display text-xl font-bold">Home Insulation Victoria</h1>
          <div className="text-sm text-muted-foreground">Office, installers, electricians and owners</div>
        </div>
        {err && <p role="alert" data-login-error className="mb-3 rounded-xl bg-destructive/10 p-3 text-sm font-medium text-destructive">{err}</p>}
        {sent && <p role="status" className="mb-3 rounded-xl bg-success-soft p-3 text-sm font-medium text-success">{sent}</p>}
        <form onSubmit={submit} className="space-y-3">
          <div><Label htmlFor="e">Email</Label><Input id="e" type="text" inputMode="email" autoCapitalize="none" spellCheck={false} autoComplete="email" className="h-12" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div><Label htmlFor="p">Password</Label><Input id="p" type="password" autoComplete="current-password" className="h-12" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
          <Button type="submit" size="field" className="w-full" disabled={busy}>Sign in</Button>
        </form>
        <button type="button" onClick={forgot} disabled={busy} className="mt-3 w-full text-center text-sm font-semibold text-primary underline">Forgot password?</button>
        <Button variant="outline" size="field" className="mt-3 w-full" onClick={magic} disabled={busy}>Email me a sign-in link</Button>
        <Button variant="ghost" size="field" className="mt-2 w-full" onClick={google}>Continue with Google</Button>
        <p className="mt-4 text-center text-xs text-muted-foreground">Portal access is provided by Home Insulation Victoria.</p>
      </div>
    </main>
  );
}
