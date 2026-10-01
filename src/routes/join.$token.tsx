import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getWorkerInvite, submitWorkerInvite } from "@/lib/worker-invite.functions";
import { Check } from "lucide-react";
import { TradeOnboardingFooter, TradeOnboardingShell } from "@/components/portal/trade-onboarding-shell";
import { workerDeclarations } from "@/lib/worker-invite.core";

export const Route = createFileRoute("/join/$token")({
  head: () => ({ meta: [
    { title: "Join your team – Home Insulation Victoria" },
    { name: "description", content: "Register as a worker under your business with Home Insulation Victoria." },
    { property: "og:title", content: "Join your team – Home Insulation Victoria" },
    { property: "og:description", content: "Register as a worker under your business with Home Insulation Victoria." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
    { name: "robots", content: "noindex" },
  ] }),
  component: Join,
});

type Invite = Awaited<ReturnType<typeof getWorkerInvite>>;

function Join() {
  const { token } = Route.useParams();
  const load = useServerFn(getWorkerInvite);
  const submit = useServerFn(submitWorkerInvite);
  const [inv, setInv] = useState<Invite | null>(null);
  const [f, setF] = useState({ full_legal_name: "", mobile: "", email: "", licence_number: "", qualification: "", signed_name: "" });
  const [ticks, setTicks] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const previewTrade = token === "sample-electrician" ? "electrician" as const : token === "sample-installer" ? "installer" as const : null;
  const preview = previewTrade !== null;
  const [done, setDone] = useState(() => preview && typeof window !== "undefined" && new URLSearchParams(window.location.search).get("receipt") === "1");
  useEffect(() => {
    if (previewTrade) {
      const businessName = previewTrade === "electrician" ? "Sample Electrical" : "Sample Insulation";
      const sample = { ok: true as const, inviteeName: previewTrade === "electrician" ? "Sample electrician" : "Sample installer", trade: previewTrade, businessName, declarations: workerDeclarations(previewTrade, businessName) };
      setInv(sample); setF((x) => ({ ...x, full_legal_name: sample.inviteeName, mobile: "0400 000 000", email: "sample@example.com", licence_number: previewTrade === "electrician" ? "ESV SAMPLE" : "", qualification: previewTrade === "installer" ? "Sample insulation qualification" : "" })); return;
    }
    load({ data: { token } }).then((r) => { setInv(r); if (r.ok) setF((x) => ({ ...x, full_legal_name: r.inviteeName })); }).catch(() => setInv({ ok: false, message: "We couldn't open this invite. Please try again." }));
  }, [load, previewTrade, token]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const wrap = (c: React.ReactNode) => <TradeOnboardingShell footer={<TradeOnboardingFooter />}><main className="overflow-hidden rounded-[24px] border border-estimate-line bg-estimate-white p-5 shadow-[0_30px_70px_-45px_rgba(34,55,107,.45)] sm:p-8"><p className="text-xs font-extrabold uppercase tracking-[1.2px] text-estimate-green">Personal staff invitation</p>{c}</main></TradeOnboardingShell>;
  if (!inv) return wrap(<><h1 className="mt-2 text-2xl">Opening your invitation</h1><p className="mt-2 text-sm text-estimate-navy/75">Checking the link…</p></>);
  if (!inv.ok) return wrap(<><h1 className="mt-2 text-2xl">This invitation can't be used</h1><p className="mt-3 text-sm leading-relaxed text-estimate-navy/75">{inv.message}</p><p className="mt-4 rounded-xl bg-estimate-blush p-4 text-sm font-bold">Ask your business administrator to create and copy a new invitation link.</p></>);
  if (done) return wrap(<>{preview && <div role="status" className="mt-4 rounded-xl bg-estimate-mist p-3 text-sm font-bold">Sample preview only — no details were submitted.</div>}<div className="mt-4 grid size-12 place-items-center rounded-full bg-estimate-green text-estimate-navy"><Check className="size-6" strokeWidth={3} /></div><h1 className="mt-4 text-2xl">Thanks, {f.full_legal_name.split(" ")[0]} — your details are submitted</h1><p className="mt-3 text-sm leading-relaxed">{inv.businessName} and the Home Insulation Victoria office will review your details. You need office approval before you can access assigned jobs.</p><div className="mt-5 rounded-[18px] bg-estimate-mist p-4 text-sm leading-relaxed"><strong>What happens next</strong><br />Once approved, your business administrator can create a private link for each assigned job. You do not need a separate business account or a shared company password.</div></>);

  return wrap(<form onSubmit={async (e) => {
    e.preventDefault(); setBusy(true); setErrors([]);
    try {
      if (preview) { setErrors(["Sample preview only — no worker details were submitted."]); return; }
      const r = await submit({ data: { token, ...f, accepted: ticks } });
      if (r.ok) setDone(true); else { setErrors(r.errors); window.scrollTo({ top: 0 }); }
    } catch { setErrors(["Something went wrong. Please try again."]); } finally { setBusy(false); }
  }}>
    {preview && <div role="status" className="mt-3 rounded-xl bg-estimate-mist p-3 text-sm font-bold">Sample preview only — no data is saved and this invitation cannot be submitted.</div>}
    <h1 className="mt-2 text-[28px] leading-tight text-estimate-navy sm:text-[34px]">Join {inv.businessName}</h1>
    <p className="mt-3 text-sm leading-relaxed">{inv.trade === "electrician" ? "Your REC business holds its registration, ABN, insurance, supplier rates and payment details. We only need your own contact details, Victorian electrical licence and declarations." : "Your insulation business holds its company, insurance, rates and payment details. We only need your own contact details, training or qualification and declarations."}</p>
    <div className="my-5 rounded-[18px] bg-estimate-mint p-4 text-sm leading-relaxed"><strong>Your access stays personal.</strong> Once approved, you receive private links only for jobs assigned to you. You won't see the business's rates or bank details.</div>
    {errors.length > 0 && <div className="mb-4 rounded-xl border border-danger bg-danger-soft p-3 text-sm text-danger">{errors.map((x) => <div key={x}>• {x}</div>)}</div>}
    <div className="grid gap-3">
      <label className="text-sm font-medium">Your full legal name<Input value={f.full_legal_name} onChange={set("full_legal_name")} className="mt-1 h-12" /></label>
      <label className="text-sm font-medium">Your mobile<Input inputMode="tel" value={f.mobile} onChange={set("mobile")} className="mt-1 h-12" /></label>
      <label className="text-sm font-medium">Your email<Input type="email" value={f.email} onChange={set("email")} className="mt-1 h-12" /></label>
      {inv.trade === "electrician"
        ? <label className="text-sm font-medium">Your Victorian electrician licence number (ESV)<Input value={f.licence_number} onChange={(e) => setF({ ...f, licence_number: e.target.value.toUpperCase() })} className="mt-1 h-12" /></label>
        : <label className="text-sm font-medium">Your training or qualification<Input placeholder="e.g. Cert III, or Experienced installer" value={f.qualification} onChange={set("qualification")} className="mt-1 h-12" /></label>}
    </div>
    <h2 className="mb-2 mt-6 text-lg font-bold">Your declarations</h2>
    <div className="grid gap-2">
      {inv.declarations.map((d) => (
        <label key={d.key} className="flex min-h-12 cursor-pointer gap-3 rounded-xl border p-3 text-sm">
          <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0" checked={ticks.includes(d.key)} onChange={(e) => setTicks(e.target.checked ? [...ticks, d.key] : ticks.filter((k) => k !== d.key))} />
          <span>{d.text}</span>
        </label>
      ))}
    </div>
    <label className="mt-5 block text-sm font-medium">Type your full name to sign<Input value={f.signed_name} onChange={set("signed_name")} className="mt-1 h-12" /></label>
    <Button type="submit" size="field" className="mt-5 w-full bg-success text-brand-dark hover:bg-success/90" disabled={busy}>{busy ? "Saving…" : "Sign and submit for approval →"}</Button>
  </form>);
}
