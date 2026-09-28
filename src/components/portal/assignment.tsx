import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, FileText, ShieldAlert } from "lucide-react";
import { useAction } from "@/hooks/use-me";
import {
  getAcceptancePackage, getAssignment, getAssignmentDocUrl, raiseAssignmentVariation, reconfirmAssignmentVariation, respondToQuote, signInstallerDeclaration,
} from "@/lib/portal.functions";
import { ASSIGNMENT_LABEL, type AssignmentStatus } from "@/lib/assignment.core";
import { ASSISTANCE_LABEL } from "@/lib/authority";
import { aud, fmtDateTime } from "@/lib/workflow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Pill } from "./badges";
import { Section } from "./panels";

export function useAssignment(jobId: string) {
  const fn = useServerFn(getAssignment);
  return useQuery({ queryKey: ["assignment", jobId], queryFn: () => fn({ data: { jobId } }) });
}

function StatusPill({ s }: { s: string }) {
  const t = s === "effective_complete" ? "good" : s === "variation_required" ? "bad" : s === "cancelled" ? "neutral" : "info";
  return <Pill t={t}>{ASSIGNMENT_LABEL[s as AssignmentStatus] ?? s}</Pill>;
}

function CopyLink({ id, which, label }: { id: string; which: "consumer" | "final"; label: string }) {
  const fn = useServerFn(getAssignmentDocUrl);
  return <Button variant="outline" size="sm" onClick={async () => { const r = await fn({ data: { assignmentId: id, which } }); window.open(r.url, "_blank"); }}><FileText className="h-4 w-4" /> {label}</Button>;
}

/** One streamlined customer flow: review quote -> VEU/consumer info -> declarations -> sign -> pay deposit. */
export function AcceptanceFlow({ quoteId, onClose }: { quoteId: string; onClose: () => void }) {
  const load = useServerFn(getAcceptancePackage);
  const { data } = useQuery({ queryKey: ["acceptance", quoteId], queryFn: () => load({ data: { quoteId } }) });
  const respond = useAction(respondToQuote);
  const [step, setStep] = useState(0);
  const [authorityType, setAuthorityType] = useState<"owner" | "authorised_representative">("owner");
  const [over18, setOver18] = useState(false);
  const [readInfo, setReadInfo] = useState(false);
  const [decl, setDecl] = useState(false);
  const [assign, setAssign] = useState(false);
  const [assist, setAssist] = useState<keyof typeof ASSISTANCE_LABEL>("none");
  const [sig, setSig] = useState("");
  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const { pkg } = data;
  const steps = ["Review quote", "VEU & your rights", "Declarations", "Sign"];
  return (
    <section className="rounded-xl border-2 border-primary bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-bold">Accept your quote</h2><Button variant="ghost" size="sm" onClick={onClose}>Close</Button></div>
      <ol className="mb-4 grid grid-cols-4 gap-1 text-xs">{steps.map((s, i) => <li key={s} className={`rounded px-2 py-1 text-center ${i === step ? "bg-primary text-primary-foreground" : i < step ? "bg-accent" : "bg-muted text-muted-foreground"}`}>{s}</li>)}</ol>
      {data.blockers.length > 0 && <div className="mb-3 rounded border border-danger/30 bg-danger-soft p-3 text-sm text-danger">This acceptance can't be signed yet – HI VIC is finalising the official consumer information. We'll let you know.</div>}
      {step === 0 && (
        <div className="space-y-3 text-sm">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded bg-muted p-3">
            <dt className="text-muted-foreground">Name</dt><dd>{pkg.consumer.name}</dd>
            <dt className="text-muted-foreground">Contact</dt><dd>{[pkg.consumer.email, pkg.consumer.phone].filter(Boolean).join(" · ")}</dd>
            <dt className="text-muted-foreground">Property</dt><dd>{pkg.property_address}</dd>
            <dt className="text-muted-foreground">Product</dt><dd>{pkg.quoted_product}</dd>
            <dt className="text-muted-foreground">Area</dt><dd>{pkg.quoted_area_m2 != null ? `${pkg.quoted_area_m2} m²` : "To be confirmed"}</dd>
            <dt className="text-muted-foreground">Installer</dt><dd>{pkg.installer.business ?? pkg.installer.name ?? "To be confirmed by HI VIC"}</dd>
            <dt className="text-muted-foreground">Quote</dt><dd>{pkg.quote.option_label} · version {pkg.quote.version}</dd>
          </dl>
          <ul className="space-y-1">{pkg.quote.items.map((i, k) => <li key={k} className="flex justify-between gap-2"><span>{i.description} × {Number(i.quantity)}</span><span>{aud(i.line_total_inc_gst)}</span></li>)}</ul>
          <div className="space-y-1 border-t pt-2">
            <div className="flex justify-between"><span>Price before VEU benefit</span><span>{aud(pkg.price_before_benefit_inc_gst)}</span></div>
            <div className="flex justify-between text-success"><span>VEU benefit</span><span>−{aud(pkg.veu_benefit_inc_gst)}</span></div>
            <div className="flex justify-between text-lg font-bold"><span>Your price (inc GST)</span><span>{aud(pkg.final_customer_price_inc_gst)}</span></div>
          </div>
          <p className="rounded bg-accent p-2 text-accent-foreground">{pkg.payment_terms}</p>
        </div>
      )}
      {step === 1 && (
        <div className="space-y-3 text-sm">
          {data.consumerRights ? <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded border p-3 leading-relaxed">{data.consumerRights.body}</pre> : <p className="text-danger">Consumer information not yet configured.</p>}
          <label className="flex items-start gap-3"><Checkbox className="mt-0.5 h-5 w-5" checked={readInfo} onCheckedChange={(v) => setReadInfo(!!v)} /> I have read the VEU consumer information and my consumer rights, including any cooling-off rights.</label>
        </div>
      )}
      {step === 2 && (
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-2">{(["owner", "authorised_representative"] as const).map((k) => <Button key={k} size="field" variant={authorityType === k ? "default" : "outline"} onClick={() => setAuthorityType(k)}>{k === "owner" ? "I am the owner" : "I am authorised to sign"}</Button>)}</div>
          {data.consumerDeclaration ? <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded border p-3 leading-relaxed">{data.consumerDeclaration.body}</pre> : <p className="text-danger">Declaration wording not yet configured.</p>}
          <label className="flex items-start gap-3"><Checkbox className="mt-0.5 h-5 w-5" checked={over18} onCheckedChange={(v) => setOver18(!!v)} /> I am 18 years of age or older.</label>
          <label className="flex items-start gap-3"><Checkbox className="mt-0.5 h-5 w-5" checked={decl} onCheckedChange={(v) => setDecl(!!v)} /> I make the declarations above.</label>
          <label className="flex items-start gap-3"><Checkbox className="mt-0.5 h-5 w-5" checked={assign} onCheckedChange={(v) => setAssign(!!v)} /> I assign all rights to create VEECs from this Activity 48 job to {pkg.ap_legal_entity}. I understand this takes effect only once the installation has been completed.</label>
          <div><div className="mb-1 font-medium">Do you need any assistance?</div><div className="grid gap-2 sm:grid-cols-2">{(Object.keys(ASSISTANCE_LABEL) as (keyof typeof ASSISTANCE_LABEL)[]).map((k) => <Button key={k} size="field" variant={assist === k ? "default" : "outline"} className="h-auto min-h-12 whitespace-normal" onClick={() => setAssist(k)}>{ASSISTANCE_LABEL[k]}</Button>)}</div></div>
        </div>
      )}
      {step === 3 && (
        <div className="space-y-3 text-sm">
          <p>Type your full name to sign. You'll get a signed copy straight away in Documents.</p>
          <Input className="h-12" value={sig} placeholder={pkg.consumer.name} onChange={(e) => setSig(e.target.value)} />
          <Button size="field" className="w-full" disabled={data.blockers.length > 0 || sig.trim().length < 2 || !over18 || !decl || !assign || !readInfo}
            onClick={async () => { await respond({ quoteId, accept: true, consent: true, signing: { signatoryName: authorityType === "owner" ? pkg.consumer.name : sig, authorityType, over18, readConsumerInfo: readInfo, acceptDeclaration: decl, acceptAssignment: assign, signatureName: sig, assistance: assist } }, "Signed – your deposit invoice is on its way"); onClose(); }}>
            Sign and accept – pay 50% deposit next
          </Button>
        </div>
      )}
      <div className="mt-4 flex gap-2">
        {step > 0 && <Button variant="outline" size="field" className="flex-1" onClick={() => setStep(step - 1)}>Back</Button>}
        {step < 3 && <Button size="field" className="flex-1" disabled={(step === 1 && !readInfo) || (step === 2 && (!over18 || !decl || !assign))} onClick={() => setStep(step + 1)}>Continue</Button>}
      </div>
    </section>
  );
}

/** Owner: signed status, copies and any variation to reconfirm. */
export function OwnerAssignmentCard({ jobId }: { jobId: string }) {
  const { data } = useAssignment(jobId);
  const reconfirm = useAction(reconfirmAssignmentVariation);
  const [sig, setSig] = useState("");
  const a = data?.current as { id: string; status: string; consumer_copy_path?: string | null; final_copy_path?: string | null } | null | undefined;
  if (!a) return null;
  const pending = (data?.variations ?? []).find((v) => v.status === "pending");
  return (
    <Section title="Your acceptance & VEEC assignment">
      <div className="flex flex-wrap items-center gap-2"><StatusPill s={a.status} />{a.consumer_copy_path && <CopyLink id={a.id} which="consumer" label="Signed copy" />}{a.final_copy_path && <CopyLink id={a.id} which="final" label="Final copy" />}</div>
      {pending && (
        <div className="mt-3 space-y-2 rounded border border-danger/30 bg-danger-soft p-3 text-sm">
          <div className="font-medium text-danger">Something changed after you signed – please review and reconfirm:</div>
          <ul className="list-disc pl-5">{(pending.reasons as string[]).map((r) => <li key={r}>{r}</li>)}</ul>
          <Input className="h-12" placeholder="Type your full name to reconfirm" value={sig} onChange={(e) => setSig(e.target.value)} />
          <Button size="field" className="w-full" disabled={sig.trim().length < 2} onClick={() => reconfirm({ variationId: pending.id, signatureName: sig }, "Reconfirmed")}>Reconfirm</Button>
        </div>
      )}
    </Section>
  );
}

/** Admin: full staged status, evidence, copies, variations. */
export function AdminAssignmentPanel({ jobId }: { jobId: string }) {
  const { data } = useAssignment(jobId);
  const raise = useAction(raiseAssignmentVariation);
  const [reason, setReason] = useState("");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const a = data?.current as any;
  return (
    <Section title="Customer Acceptance & VEEC Assignment">
      {(data?.finalBlockers.length ?? 0) > 0 && <div className="mb-3 flex gap-2 rounded border border-warning bg-warning-soft p-3 text-sm"><ShieldAlert className="h-4 w-4 shrink-0" /><div>{data!.finalBlockers.map((b) => <div key={b}>{b}</div>)}<a className="underline" href="/admin/compliance">Configure wording</a></div></div>}
      {!a ? <p className="text-sm text-muted-foreground">Not signed yet – the customer signs when accepting the installation quote.</p> : (
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2"><StatusPill s={String(a.status)} />{!!a.consumer_copy_path && <CopyLink id={String(a.id)} which="consumer" label="Consumer copy" />}{!!a.final_copy_path && <CopyLink id={String(a.id)} which="final" label="Final copy" />}</div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-muted-foreground">Quote version</dt><dd>v{String(a.quote_version)}</dd>
            <dt className="text-muted-foreground">Signatory</dt><dd>{String(a.signatory_name)} ({String(a.signatory_authority_type)}) · signed {fmtDateTime(a.consumer_signed_at as string)} · IP {String(a.consumer_ip ?? "—")}</dd>
            <dt className="text-muted-foreground">Wording</dt><dd>Declaration {String(a.consumer_declaration_version)} · Rights {String(a.consumer_rights_version)}{a.installer_declaration_version ? ` · Installer ${String(a.installer_declaration_version)}` : ""}</dd>
            <dt className="text-muted-foreground">Quoted</dt><dd>{String(a.quoted_product)} · {String(a.quoted_area_m2 ?? "—")} m²</dd>
            <dt className="text-muted-foreground">Prices</dt><dd>Before {aud(Number(a.price_before_benefit_inc_gst))} · VEU {aud(Number(a.veu_benefit_inc_gst))} · Final {aud(Number(a.final_customer_price_inc_gst))}</dd>
            <dt className="text-muted-foreground">Installer</dt><dd>{String(a.installer_name ?? "—")} {a.installer_business_name ? `(${String(a.installer_business_name)})` : ""} · licence {String(a.installer_licence ?? "—")}</dd>
            <dt className="text-muted-foreground">Installed</dt><dd>{a.installer_signed_at ? `${String(a.installed_product)} · ${String(a.installed_area_m2)} m² · signed ${fmtDateTime(a.installer_signed_at as string)}` : "Pending"}</dd>
            <dt className="text-muted-foreground">Effective</dt><dd>{a.effective_at ? fmtDateTime(a.effective_at as string) : "Not yet"}</dd>
            <dt className="text-muted-foreground">Copy provided</dt><dd>{a.copy_sent_at ? fmtDateTime(a.copy_sent_at as string) : "—"} · retain until {String(a.retain_until ?? "—")}</dd>
          </dl>
          {(data?.variations ?? []).length > 0 && <div><div className="font-medium">Variations</div><ul className="space-y-1">{data!.variations.map((v) => <li key={v.id} className="rounded border p-2">{(v.reasons as string[]).join(", ")} · <b>{v.status}</b> · {fmtDateTime(v.raised_at)}</li>)}</ul></div>}
          {a.status !== "effective_complete" && (
            <div className="space-y-2 border-t pt-3"><Textarea placeholder="Describe another material change (scope, price…)" value={reason} onChange={(e) => setReason(e.target.value)} />
              <Button variant="outline" disabled={reason.trim().length < 5} onClick={async () => { await raise({ jobId, reason }, "Variation raised – customer must reconfirm"); setReason(""); }}>Raise variation</Button></div>
          )}
        </div>
      )}
    </Section>
  );
}

/** Installer: final installed details + declaration (approved wording only). */
export function InstallerFinalDeclaration({ jobId }: { jobId: string }) {
  const { data } = useAssignment(jobId);
  const sign = useAction(signInstallerDeclaration);
  const cur = data?.current as { quoted_product?: string | null; quoted_area_m2?: number | null; installer_signed_at?: string | null; installed_product?: string | null; installed_area_m2?: number | null; status: string } | null | undefined;
  const [product, setProduct] = useState("");
  const [area, setArea] = useState("");
  const [sig, setSig] = useState("");
  const [ok, setOk] = useState(false);
  if (!cur) return <p className="text-sm text-muted-foreground">Customer acceptance not signed yet.</p>;
  if (cur.installer_signed_at) return <p className="flex items-center gap-2 text-sm text-success"><CheckCircle2 className="h-4 w-4" /> Declaration signed – {cur.installed_product}, {cur.installed_area_m2} m²</p>;
  if (data!.finalBlockers.length) return <p className="text-sm text-danger">Installer declaration wording not yet configured by HI VIC – you can't sign yet.</p>;
  return (
    <div className="space-y-3 text-sm">
      <div><div className="mb-1 font-medium">Installed product (brand, model, R-value)</div><Input className="h-12" placeholder={cur.quoted_product ?? ""} value={product} onChange={(e) => setProduct(e.target.value)} /></div>
      <div><div className="mb-1 font-medium">Actual installed area (m²)</div><Input className="h-12" inputMode="decimal" placeholder={cur.quoted_area_m2 != null ? String(cur.quoted_area_m2) : ""} value={area} onChange={(e) => setArea(e.target.value)} /></div>
      {data!.installerDeclaration && <pre className="max-h-60 overflow-y-auto whitespace-pre-wrap rounded border p-3">{data!.installerDeclaration.body}</pre>}
      <label className="flex items-start gap-3"><Checkbox className="mt-0.5 h-5 w-5" checked={ok} onCheckedChange={(v) => setOk(!!v)} /> I make the declaration above.</label>
      <Input className="h-12" placeholder="Type your full name to sign" value={sig} onChange={(e) => setSig(e.target.value)} />
      <Button size="field" className="w-full" disabled={!ok || product.trim().length < 2 || !(Number(area) > 0) || sig.trim().length < 2} onClick={() => sign({ jobId, installedProduct: product, installedArea: Number(area), signatureName: sig }, "Declaration signed")}>Sign installer declaration</Button>
    </div>
  );
}

export function AssignmentStatusInline({ jobId }: { jobId: string }) {
  const { data } = useAssignment(jobId);
  const a = data?.current as { status: string } | null | undefined;
  return a ? <StatusPill s={a.status} /> : <span className="text-xs text-muted-foreground">Not signed</span>;
}
