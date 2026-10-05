import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import logo from "@/assets/home-insulation-victoria-logo.png.asset.json";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in – Home Insulation Victoria" },
      { name: "description", content: "Sign in to Home Insulation Victoria." },
      { property: "og:title", content: "Sign in – Home Insulation Victoria" },
      { property: "og:description", content: "Sign in to Home Insulation Victoria." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { if (data.session) navigate({ to: "/home" }); });
    const { data } = supabase.auth.onAuthStateChange((e, s) => { if (s && e !== "PASSWORD_RECOVERY") navigate({ to: "/home" }); });
    return () => data.subscription.unsubscribe();
  }, [navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const res = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (res.error) { toast.error("That email and password don't match. Try again, or use a sign-in link below."); return; }
  };

  const needEmail = () => { if (!email.trim()) { toast.error("Type your email first."); return false; } return true; };
  const forgot = async () => {
    if (!needEmail()) return;
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/reset-password` });
    setBusy(false);
    if (error) toast.error("We couldn't send the reset email. Please try again."); else setSent("We've emailed you a link to set a new password.");
  };
  const magic = async () => {
    if (!needEmail()) return;
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/auth` } });
    setBusy(false);
    if (error) toast.error("We couldn't send a sign-in link to that email. Check it's the email Home Insulation Victoria has for you."); else setSent("Check your email — tap the link to sign in.");
  };

  const google = async () => {
    const r = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin + "/auth" });
    if (r.error) toast.error(String(r.error.message ?? r.error));
  };

  return (
    <main className="portal-theme relative grid min-h-screen place-items-center overflow-hidden bg-background px-4 py-12 text-foreground">
      <div className="w-full max-w-sm rounded-[22px] border bg-card p-6 shadow-sm">
        <div className="mb-6 border-b pb-5 text-center">
          <img src={logo.url} alt="Home Insulation Victoria" className="mx-auto h-14 w-auto" />
          <h1 className="mt-4 font-display text-xl font-bold">Home Insulation Victoria</h1>
          <div className="text-sm text-muted-foreground">Sign in to continue</div>
        </div>
        {sent && <p role="status" className="mb-3 rounded-xl bg-success-soft p-3 text-sm font-medium text-success">{sent}</p>}
        <form onSubmit={submit} className="space-y-3">
          <div><Label htmlFor="e">Email</Label><Input id="e" type="email" autoComplete="email" className="h-12" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
          <div><Label htmlFor="p">Password</Label><Input id="p" type="password" autoComplete="current-password" className="h-12" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required /></div>
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
