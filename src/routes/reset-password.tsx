import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { afterPasswordPath, partnerLinkMessage } from "@/lib/set-password-link.core";
import { redeemPartnerLink } from "@/lib/partner-login-link.functions";
import { LINK_SENT_SAFE, badLinkMessage, linkErrorMessage, normaliseLoginEmail } from "@/lib/login.core";
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
  const [failed, setFailed] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const th = q.get("token_hash");
    const h = new URLSearchParams(window.location.hash.slice(1));
    if (h.get("error") || q.get("error")) { setFailed(badLinkMessage({ code: h.get("error_code") ?? q.get("error_code") ?? "", message: h.get("error_description") ?? q.get("error_description") ?? "" })); return; }
    const t = window.setTimeout(() => { void supabase.auth.getSession().then(({ data: d }) => { if (!d.session) setFailed((f) => f ?? "This link has expired or was already used."); }); }, 4000);
    const kind = q.get("type");
    const partnerLink = q.get("link");
    const verify = (hash: string, type: "recovery" | "invite") => supabase.auth.verifyOtp({ token_hash: hash, type }).then(({ data: v, error }) => {
        if (error || !v.session) { setFailed(badLinkMessage(error)); return; }
        q.delete("token_hash"); q.delete("type"); q.delete("link");
        window.history.replaceState(null, "", `${window.location.pathname}?${q.toString()}`);
        setReady(true);
      });
    if (partnerLink) {
      // 24-hour partner link: claim it once, then sign in with the fresh one-time token.
      void redeemPartnerLink({ data: { token: partnerLink } }).then((r) => {
        if (r.outcome !== "ok" || !r.tokenHash) { setFailed(partnerLinkMessage(r.outcome === "ok" ? "invalid" : r.outcome)); return; }
        void verify(r.tokenHash, "recovery");
      }, () => setFailed(partnerLinkMessage("invalid")));
    } else if (th && (kind === "recovery" || kind === "invite")) {
      void supabase.auth.verifyOtp({ token_hash: th, type: kind }).then(({ data: v, error }) => {
        if (error || !v.session) { setFailed(badLinkMessage(error)); return; }
        q.delete("token_hash"); q.delete("type");
        window.history.replaceState(null, "", `${window.location.pathname}?${q.toString()}`);
        setReady(true);
      });
    }
    const { data } = supabase.auth.onAuthStateChange((e, s) => { if (s && (e === "PASSWORD_RECOVERY" || e === "SIGNED_IN")) setReady(true); });
    supabase.auth.getSession().then(({ data: d }) => { if (d.session) setReady(true); });
    return () => { window.clearTimeout(t); data.subscription.unsubscribe(); };
  }, []);
  const resend = async (e: React.FormEvent) => {
    e.preventDefault();
    const c = normaliseLoginEmail(email);
    if (!c.ok) { setNote({ ok: false, text: c.message }); return; }
    setEmail(c.email); setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(c.email, { redirectTo: `${window.location.origin}/reset-password?next=/portal` });
    setBusy(false);
    const m = error ? linkErrorMessage(error) : null;
    setNote(m ? { ok: false, text: m } : { ok: true, text: LINK_SENT_SAFE });
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.length < 8) { toast.error("Use at least 8 characters."); return; }
    if (pw !== pw2) { toast.error("The two passwords don't match."); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) { toast.error("We couldn't save that password. Try a different one."); return; }
    toast.success("Password set — you're signed in.");
    navigate({ to: afterPasswordPath(new URLSearchParams(window.location.search).get("next")), replace: true });
  };
  return (
    <TradePublicShell>
      <div><p className="text-xs font-bold uppercase tracking-wide text-hiv-blue">Staff & trade portal</p><h1 className="font-display text-[26px] font-bold leading-tight">{failed ? "This password link is no longer valid." : "Set your password"}</h1><p className="text-sm text-sub">{failed ? "Request a fresh link for the email on your portal account." : "Secure your approved portal access."}</p></div>
      {failed ? (
        <form onSubmit={resend} className="space-y-3 rounded-[18px] border border-rose bg-pink p-5 text-ink">
          <p role="alert" data-link-error className="font-bold">{failed}</p>
          <p>Type your email and we'll send you a new link.</p>
          <label htmlFor="em" className="block font-bold">Email</label>
          <input id="em" type="text" inputMode="email" autoCapitalize="none" autoComplete="email" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} />
          <button type="submit" className={greenBtn} disabled={busy}>Send me a new link</button>
          {note && <p role="status" className={note.ok ? "font-semibold text-hiv-green" : "font-semibold text-rose"}>{note.text}</p>}
          <a href="/portal" className="block text-center text-sm font-bold text-estimate-blue">Back to sign in</a>
        </form>
      ) : !ready ? <p className={card}>Opening your secure link…</p> : (
        <form onSubmit={save} className={`${card} space-y-3`}>
          <p>Choose a password of at least 8 characters. You'll use it with your email to sign in.</p>
          <label htmlFor="p1" className="block font-bold">New password</label>
          <input id="p1" type="password" autoComplete="new-password" className={inputCls} value={pw} onChange={(e) => setPw(e.target.value)} />
          <label htmlFor="p2" className="block font-bold">Confirm password</label>
          <input id="p2" type="password" autoComplete="new-password" className={inputCls} value={pw2} onChange={(e) => setPw2(e.target.value)} />
          <button type="submit" className={greenBtn} disabled={busy}>Save password & continue</button>
        </form>
      )}
    </TradePublicShell>
  );
}
