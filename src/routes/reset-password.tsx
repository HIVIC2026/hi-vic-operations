import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { TradePublicShell, card, greenBtn, inputCls } from "@/components/trade/TradeShell";

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
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const th = q.get("token_hash");
    if (th && q.get("type") === "recovery") {
      void supabase.auth.verifyOtp({ token_hash: th, type: "recovery" }).then(({ data: v, error }) => {
        if (error || !v.session) { setFailed(true); return; }
        q.delete("token_hash"); q.delete("type");
        window.history.replaceState(null, "", `${window.location.pathname}?${q.toString()}`);
        setReady(true);
      });
    }
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
    navigate({ to: (((n) => n === "/field/welcome" ? n : n === "/field/setup" || n === "/partner" ? "/field/welcome" : "/home")(new URLSearchParams(window.location.search).get("next"))) as never, replace: true });
  };
  return (
    <TradePublicShell>
      <h1 className="font-display text-3xl font-extrabold">Set your password</h1>
      {failed ? <p role="alert" className={card}>This link has expired or was already used. Ask Home Insulation Victoria for a new one.</p> : !ready ? <p className={card}>Opening your secure link…</p> : (
        <form onSubmit={save} className={`${card} space-y-3`}>
          <p>Choose a password of at least 8 characters. You'll use it with your email to sign in.</p>
          <label htmlFor="p1" className="block font-bold">New password</label>
          <input id="p1" type="password" autoComplete="new-password" className={inputCls} value={pw} onChange={(e) => setPw(e.target.value)} />
          <label htmlFor="p2" className="block font-bold">Type it again</label>
          <input id="p2" type="password" autoComplete="new-password" className={inputCls} value={pw2} onChange={(e) => setPw2(e.target.value)} />
          <button type="submit" className={greenBtn} disabled={busy}>Save and sign in</button>
        </form>
      )}
    </TradePublicShell>
  );
}
