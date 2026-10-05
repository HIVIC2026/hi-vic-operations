import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import logo from "@/assets/home-insulation-victoria-logo.png.asset.json";

export const Route = createFileRoute("/reset-password")({
  head: () => ({ meta: [
    { title: "Set your password – Home Insulation Victoria" },
    { name: "description", content: "Set a new password for your Home Insulation Victoria account." },
    { property: "og:title", content: "Set your password – Home Insulation Victoria" },
    { property: "og:description", content: "Set a new password for your Home Insulation Victoria account." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" },
  ] }),
  component: ResetPassword,
});

function ResetPassword() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((e, s) => { if (s && (e === "PASSWORD_RECOVERY" || e === "SIGNED_IN")) setReady(true); });
    supabase.auth.getSession().then(({ data: d }) => { if (d.session) setReady(true); });
    return () => data.subscription.unsubscribe();
  }, []);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.length < 8) { toast.error("Use at least 8 characters."); return; }
    if (pw !== pw2) { toast.error("The two passwords don't match."); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) { toast.error("We couldn't save that password. Try a different one."); return; }
    toast.success("Password set — you're signed in.");
    navigate({ to: "/home", replace: true });
  };
  return (
    <main className="portal-theme grid min-h-screen place-items-center bg-background px-4 py-12">
      <div className="w-full max-w-sm rounded-[22px] border bg-card p-6 shadow-sm">
        <img src={logo.url} alt="Home Insulation Victoria" className="mx-auto h-14 w-auto" />
        <h1 className="mt-4 text-center font-display text-xl font-bold">Set your password</h1>
        {!ready ? <p className="mt-4 text-center text-sm text-muted-foreground">Opening your secure link… If nothing happens, ask for a new link from the sign-in page.</p> : (
          <form onSubmit={save} className="mt-4 space-y-3">
            <div><Label htmlFor="p1">New password</Label><Input id="p1" type="password" autoComplete="new-password" className="h-12" value={pw} onChange={(e) => setPw(e.target.value)} /></div>
            <div><Label htmlFor="p2">Type it again</Label><Input id="p2" type="password" autoComplete="new-password" className="h-12" value={pw2} onChange={(e) => setPw2(e.target.value)} /></div>
            <Button type="submit" size="field" className="w-full" disabled={busy}>Save and sign in</Button>
          </form>
        )}
      </div>
    </main>
  );
}
