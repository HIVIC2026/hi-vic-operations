import { createFileRoute } from "@tanstack/react-router";
import logo from "@/assets/home-insulation-victoria-logo.png.asset.json";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Button } from "@/components/trade/trade-ui";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { prepareCertificate } from "@/lib/certificate-file";
import { getWorkerInvite, submitWorkerInvite, workerInviteCertSlot } from "@/lib/worker-invite.functions";
import { workerDeclarations } from "@/lib/worker-invite.core";

export const Route = createFileRoute("/join/$token")({
  head: () => ({ meta: [
    { title: "Join your team – Home Insulation Victoria" },
    { name: "description", content: "Register as a staff member under your business with Home Insulation Victoria." },
    { property: "og:title", content: "Join your team – Home Insulation Victoria" },
    { property: "og:description", content: "Register as a staff member under your business with Home Insulation Victoria." },
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
  const slot = useServerFn(workerInviteCertSlot);
  const [inv, setInv] = useState<Invite | null>(null);
  const [f, setF] = useState({ full_legal_name: "", mobile: "", email: "", licence_number: "", qualification: "", certificate_number: "", signed_name: "" });
  const [cert, setCert] = useState<File | null>(null);
  const [ticks, setTicks] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const previewTrade = token === "sample-electrician" ? "electrician" as const : token === "sample-installer" ? "installer" as const : null;
  const preview = previewTrade !== null;
  const [done, setDone] = useState(() => preview && typeof window !== "undefined" && new URLSearchParams(window.location.search).get("receipt") === "1");
  useEffect(() => {
    if (previewTrade) {
      const businessName = previewTrade === "electrician" ? "Sample Electrical" : "Sample Insulation";
      const sample = { ok: true as const, mode: "registration" as const, inviteeName: previewTrade === "electrician" ? "Sample electrician" : "Sample installer", trade: previewTrade, businessName, declarations: workerDeclarations(previewTrade, businessName), needsCert: previewTrade === "installer" };
      setInv(sample); setF((x) => ({ ...x, full_legal_name: sample.inviteeName, mobile: "0400 000 000", email: "sample@example.com", licence_number: previewTrade === "electrician" ? "ESV SAMPLE" : "", qualification: previewTrade === "installer" ? "Sample insulation qualification" : "" })); return;
    }
    load({ data: { token } }).then((r) => { setInv(r); if (r.ok) setF((x) => ({ ...x, full_legal_name: r.inviteeName })); }).catch(() => setInv({ ok: false, message: "We couldn't open this invite. Please try again." }));
  }, [load, previewTrade, token]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const wrap = (c: React.ReactNode) => <div className="estimate-brand min-h-screen bg-estimate-canvas px-4 py-8 text-estimate-navy"><main className="mx-auto max-w-xl rounded-[22px] border bg-white p-6 shadow-sm"><img src={logo.url} alt="Home Insulation Victoria" className="mb-4 h-10 w-auto" />{c}</main></div>;
  if (!inv) return wrap(<p className="text-sub">Loading…</p>);
  if (!inv.ok) return wrap(<><h1 className="mb-2 font-display text-2xl font-extrabold">Invite link problem</h1><p className="text-sub">{inv.message}</p></>);
  const completion = inv.mode === "completion";
  // People added on Team sign the worker declarations through their completion link (Jo 29 Oct 2026).
  const signing = completion && inv.declarations.length > 0;
  if (done) return wrap(signing
    ? <><h1 className="mb-2 text-2xl font-bold">Thanks — you've signed.</h1><p className="text-sub">{inv.businessName} can now send you to jobs once our office has checked your details.</p></>
    : completion
    ? <><h1 className="mb-2 text-2xl font-bold">Thanks — your certificate is uploaded.</h1><p className="text-sub">{inv.businessName} and Home Insulation Victoria will check it. You'll be able to take jobs once it's verified.</p></>
    : <><h1 className="mb-2 text-2xl font-bold">Thanks, {f.full_legal_name.split(" ")[0]} — you're registered.</h1><p className="text-sub">{inv.businessName} and Home Insulation Victoria will check your details. Once you're approved, the business owner can send you to jobs — you'll get a private link for each job.</p></>);

  // Upload the certificate to private storage via a token-gated signed slot; returns the stored path.
  const uploadCert = async (): Promise<string> => {
    if (!cert) throw new Error("Upload the EEC / Certified Insulation Installer certificate.");
    const { file, mime } = await prepareCertificate(cert);
    const s = await slot({ data: { token, contentType: mime, size: file.size } });
    const { error } = await supabase.storage.from("partner-files").uploadToSignedUrl(s.path, s.token, file, { contentType: mime });
    if (error) throw new Error("Upload failed. Please try again.");
    return s.path;
  };

  return wrap(<form onSubmit={async (e) => {
    e.preventDefault(); setBusy(true); setErrors([]);
    try {
      if (preview) { setErrors(["Sample preview only — no staff details were submitted."]); return; }
      if (signing) {
        const certificate_path = inv.needsCert ? await uploadCert() : undefined;
        const r = await submit({ data: { token, full_legal_name: inv.inviteeName, mobile: "", email: "", accepted: ticks, signed_name: f.signed_name, certificate_path, certificate_number: f.certificate_number } });
        if (r.ok) setDone(true); else { setErrors(r.errors); window.scrollTo({ top: 0 }); }
        return;
      }
      if (completion) {
        const certificate_path = await uploadCert();
        const r = await submit({ data: { token, full_legal_name: inv.inviteeName, mobile: "", email: "", accepted: [], signed_name: "", certificate_path, certificate_number: f.certificate_number } });
        if (r.ok) setDone(true); else { setErrors(r.errors); window.scrollTo({ top: 0 }); }
        return;
      }
      const certificate_path = inv.trade === "installer" ? await uploadCert() : undefined;
      const r = await submit({ data: { token, ...f, certificate_path, accepted: ticks } });
      if (r.ok) setDone(true); else { setErrors(r.errors); window.scrollTo({ top: 0 }); }
    } catch (er) { setErrors([er instanceof Error ? er.message : "Something went wrong. Please try again."]); window.scrollTo({ top: 0 }); } finally { setBusy(false); }
  }}>
    {preview && <div role="status" className="mb-3 rounded-xl bg-secondary p-3 text-sm font-bold">Sample preview only — no data is saved and this invitation cannot be submitted.</div>}
    {signing ? (<>
      <h1 className="mb-1 text-2xl font-bold">Sign your declarations</h1>
      <p className="mb-5 text-sm text-sub">{`You're on ${inv.businessName}'s team as ${inv.inviteeName}. Read and tick each one, then sign. You can't be sent to jobs until you do.`}</p>
      {errors.length > 0 && <div className="mb-4 rounded-xl border border-danger bg-danger-soft p-3 text-sm text-danger">{errors.map((x) => <div key={x}>• {x}</div>)}</div>}
      {inv.needsCert && <div className="mb-4 grid gap-3">
        <label className="text-sm font-medium">EEC / Certified Insulation Installer certificate (PDF, JPG or PNG, up to 10 MB)<Input type="file" accept="application/pdf,image/jpeg,image/png,image/heic,image/heif,image/webp" className="mt-1 h-12" onChange={(e) => setCert(e.target.files?.[0] ?? null)} /></label>
        <label className="text-sm font-medium">Certificate number (if it's on the certificate)<Input value={f.certificate_number} onChange={set("certificate_number")} className="mt-1 h-12" /></label>
      </div>}
      <div className="grid gap-2">
        {inv.declarations.map((d) => (
          <label key={d.key} className="flex min-h-12 cursor-pointer gap-3 rounded-xl border p-3 text-sm">
            <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0" checked={ticks.includes(d.key)} onChange={(e) => setTicks(e.target.checked ? [...ticks, d.key] : ticks.filter((k) => k !== d.key))} />
            <span>{d.text}</span>
          </label>
        ))}
      </div>
      <label className="mt-5 block text-sm font-medium">Type your full name to sign<Input value={f.signed_name} onChange={set("signed_name")} className="mt-1 h-12" /></label>
      <Button type="submit" size="field" className="mt-5 w-full" disabled={busy || preview}>{busy ? "Saving…" : "Sign"}</Button>
    </>) : completion ? (<>
      <h1 className="mb-1 text-2xl font-bold">Upload your certificate</h1>
      <p className="mb-5 text-sm text-sub">You're on {inv.businessName}'s team as <strong>{inv.inviteeName}</strong>. One thing is still missing before you can take Home Insulation Victoria jobs — your EEC / Certified Insulation Installer certificate. Upload it here and our office will check it.</p>
      {errors.length > 0 && <div className="mb-4 rounded-xl border border-danger bg-danger-soft p-3 text-sm text-danger">{errors.map((x) => <div key={x}>• {x}</div>)}</div>}
      <div className="grid gap-3">
        <label className="text-sm font-medium">EEC / Certified Insulation Installer certificate (PDF, JPG or PNG, up to 10 MB)<Input type="file" accept="application/pdf,image/jpeg,image/png,image/heic,image/heif,image/webp" className="mt-1 h-12" onChange={(e) => setCert(e.target.files?.[0] ?? null)} /></label>
        <label className="text-sm font-medium">Certificate number (if it's on the certificate)<Input value={f.certificate_number} onChange={set("certificate_number")} className="mt-1 h-12" /></label>
      </div>
      <Button type="submit" size="field" className="mt-5 w-full" disabled={busy || preview}>{preview ? "Preview only — submission disabled" : busy ? "Uploading…" : "Upload certificate"}</Button>
    </>) : (<>
      <h1 className="mb-1 text-2xl font-bold">You're joining {inv.businessName}</h1>
      <p className="mb-5 text-sm text-sub">The business has already been set up with Home Insulation Victoria. We just need your own details and your sign-off — no ABN, insurance, rates or bank details.</p>
      {errors.length > 0 && <div className="mb-4 rounded-xl border border-danger bg-danger-soft p-3 text-sm text-danger">{errors.map((x) => <div key={x}>• {x}</div>)}</div>}
      <div className="grid gap-3">
        <label className="text-sm font-medium">Your full legal name<Input value={f.full_legal_name} onChange={set("full_legal_name")} className="mt-1 h-12" /></label>
        <label className="text-sm font-medium">Your mobile<Input inputMode="tel" value={f.mobile} onChange={set("mobile")} className="mt-1 h-12" /></label>
        <label className="text-sm font-medium">Your email<Input type="email" value={f.email} onChange={set("email")} className="mt-1 h-12" /></label>
        {inv.trade === "electrician"
          ? <label className="text-sm font-medium">Your Victorian electrician licence number (ESV)<Input value={f.licence_number} onChange={(e) => setF({ ...f, licence_number: e.target.value.toUpperCase() })} className="mt-1 h-12" /></label>
          : (<>
              <label className="text-sm font-medium">Your training or qualification<Input placeholder="e.g. Cert III, or Experienced installer" value={f.qualification} onChange={set("qualification")} className="mt-1 h-12" /></label>
              <label className="text-sm font-medium">EEC / Certified Insulation Installer certificate (required — PDF, JPG or PNG, up to 10 MB)<Input type="file" accept="application/pdf,image/jpeg,image/png,image/heic,image/heif,image/webp" className="mt-1 h-12" onChange={(e) => setCert(e.target.files?.[0] ?? null)} /></label>
              <label className="text-sm font-medium">Certificate number (if it's on the certificate)<Input value={f.certificate_number} onChange={set("certificate_number")} className="mt-1 h-12" /></label>
            </>)}
      </div>
      <h2 className="mb-2 mt-6 text-lg font-bold">Please read and tick each one</h2>
      <div className="grid gap-2">
        {inv.declarations.map((d) => (
          <label key={d.key} className="flex min-h-12 cursor-pointer gap-3 rounded-xl border p-3 text-sm">
            <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0" checked={ticks.includes(d.key)} onChange={(e) => setTicks(e.target.checked ? [...ticks, d.key] : ticks.filter((k) => k !== d.key))} />
            <span>{d.text}</span>
          </label>
        ))}
      </div>
      <label className="mt-5 block text-sm font-medium">Type your full name to sign<Input value={f.signed_name} onChange={set("signed_name")} className="mt-1 h-12" /></label>
      <Button type="submit" size="field" className="mt-5 w-full" disabled={busy || preview}>{preview ? "Preview only — submission disabled" : busy ? "Saving…" : "Sign and register"}</Button>
    </>)}
  </form>);
}
