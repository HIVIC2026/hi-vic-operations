import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in – HI VIC Portal" },
      { name: "description", content: "Sign in to the HI VIC operating portal." },
      { property: "og:title", content: "Sign in – HI VIC Portal" },
      { property: "og:description", content: "Sign in to the HI VIC operating portal." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => data.session && navigate({ to: "/home" }));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => { if (s) navigate({ to: "/home" }); });
    return () => data.subscription.unsubscribe();
  }, [navigate]);

    supabase.auth.getSession().then(({ data }) => { if (data.session) navigate({ to: "/home" }); });
    e.preventDefault();
    setBusy(true);
    const res =
      mode === "in"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin + "/home", data: { full_name: name } } });
    setBusy(false);
    if (res.error) return toast.error(res.error.message);
    if (mode === "up" && !res.data.session) toast.success("Check your email to confirm your account.");
  };

  const google = async () => {
    const r = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin + "/auth" });
    if (r.error) toast.error(String(r.error.message ?? r.error));
  };

  return (
    <div className="grid min-h-screen place-items-center bg-background px-4">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-6 shadow-sm">
        <div className="mb-6 flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">HI</span>
          <div><div className="font-bold">HI VIC Portal</div><div className="text-xs text-muted-foreground">{mode === "in" ? "Sign in" : "Create account"}</div></div>
        </div>
        <form onSubmit={submit} className="space-y-3">
          {mode === "up" && <div><Label htmlFor="n">Full name</Label><Input id="n" className="h-12" value={name} onChange={(e) => setName(e.target.value)} required /></div>}
          <div><Label htmlFor="e">Email</Label><Input id="e" type="email" className="h-12" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
          <div><Label htmlFor="p">Password</Label><Input id="p" type="password" className="h-12" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required /></div>
          <Button type="submit" size="field" className="w-full" disabled={busy}>{mode === "in" ? "Sign in" : "Create account"}</Button>
        </form>
        <Button variant="outline" size="field" className="mt-3 w-full" onClick={google}>Continue with Google</Button>
        <button className="mt-4 w-full text-center text-sm text-primary" onClick={() => setMode(mode === "in" ? "up" : "in")}>
          {mode === "in" ? "New here? Create an account" : "Have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}
