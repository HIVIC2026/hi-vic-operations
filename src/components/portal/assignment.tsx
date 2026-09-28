import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, FileText, ShieldAlert } from "lucide-react";
import { useAction } from "@/hooks/use-me";
import {
  getAcceptancePackage, getAssignment, getAssignmentDocUrl, raiseAssignmentVariation, reconfirmAssignmentVariation, respondToQuote, sendMessage, signApDeclarationFn, signInstallerDeclaration,
} from "@/lib/portal.functions";
import { ASSIGNMENT_LABEL, formFieldBlockers, type AssignmentStatus, type FieldValue, type FormField } from "@/lib/assignment.core";
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

/** One mobile-friendly customer flow: review quote -> VEU info & rights -> confirm details + declarations + ESC consent -> sign.
 *  Everything already known is shown prefilled; the customer only confirms, ticks and signs. */
export function AcceptanceFlow({ quoteId, jobId, onClose }: { quoteId: string; jobId?: string; onClose: () => void }) {
  const load = useServerFn(getAcceptancePackage);
  const { data } = useQuery({ queryKey: ["acceptance", quoteId], queryFn: () => load({ data: { quoteId } }) });
  const respond = useAction(respondToQuote);
  const message = useAction(sendMessage);
  const [step, setStep] = useState(0);
  const [authorityType, setAuthorityType] = useState<"owner" | "authorised_representative">("owner");
  const [repName, setRepName] = useState("");
  const [over18, setOver18] = useState(false);
  const [readInfo, setReadInfo] = useState(false);
  const [decl, setDecl] = useState(false);
  const [assign, setAssign] = useState(false);
  const [escOk, setEscOk] = useState(false);
  const [assist, setAssist] = useState<keyof typeof ASSISTANCE_LABEL>("none");
  const [change, setChange] = useState("");
  const [changeOpen, setChangeOpen] = useState(false);
  const [sig, setSig] = useState("");
  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const { pkg } = data;
  // Never show a broken form: if HI VIC hasn't finished setup, the customer sees a friendly holding message only.
  if (data.blockers.length > 0) return (
    <section className="rounded-xl border bg-card p-4 text-sm">
      <div className="mb-2 flex items-center justify-between"><h2 className="text-lg font-bold">Accept your quote</h2><Button variant="ghost" size="sm" onClick={onClose}>Close</Button></div>
      <p>We're just finalising your acceptance paperwork. HI VIC will let you know as soon as you can accept and sign online – there's nothing you need to do right now.</p>
    </section>
  );
  const signatory = authorityType === "owner" ? pkg.consumer.name : repName.trim();
  const steps = ["Review quote", "VEU info & rights", "Confirm & consent", "Sign"];
  const canContinue = step === 0 || (step === 1 && readInfo) || (step === 2 && over18 && decl && assign && escOk && signatory.length >= 2);
  const Tick = ({ v, set, children }: { v: boolean; set: (b: boolean) => void; children: React.ReactNode }) => (
    <label className="flex min-h-12 items-start gap-3 rounded-lg border p-3"><Checkbox className="mt-0.5 h-5 w-5" checked={v} onCheckedChange={(x) => set(!!x)} /><span>{children}</span></label>
  );
  const Official = ({ title, body }: { title: string; body: string }) => (
    <details className="rounded-lg border p-3" open><summary className="cursor-pointer font-medium">{title}</summary><div className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap leading-relaxed">{body}</div></details>
  );
  return (
    <section className="rounded-xl border-2 border-primary bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-bold">Accept your quote</h2><Button variant="ghost" size="sm" onClick={onClose}>Close</Button></div>
      <ol className="mb-4 grid grid-cols-4 gap-1 text-xs">{steps.map((s, i) => <li key={s} className={`rounded px-2 py-1 text-center ${i === step ? "bg-primary text-primary-foreground" : i < step ? "bg-accent" : "bg-muted text-muted-foreground"}`}>{i + 1}. {s}</li>)}</ol>
      {step === 0 && (
        <div className="space-y-3 text-sm">
          <div className="font-medium">{pkg.quote.option_label} · version {pkg.quote.version}</div>
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
          <p className="text-muted-foreground">Please read this official information. Tap a heading to collapse it.</p>
          {data.consumerRights && <Official title={`VEU information & your consumer rights (${data.consumerRights.version})`} body={data.consumerRights.body} />}
          <Tick v={readInfo} set={setReadInfo}>I have read the VEU consumer information and my consumer rights, including any cooling-off rights.</Tick>
        </div>
      )}
      {step === 2 && (
        <div className="space-y-3 text-sm">
          <div className="rounded-lg bg-muted p-3">
            <div className="mb-2 font-medium">Your details (already on file – please check)</div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt className="text-muted-foreground">Name</dt><dd>{pkg.consumer.name}</dd>
              <dt className="text-muted-foreground">Email</dt><dd>{pkg.consumer.email ?? "—"}</dd>
              <dt className="text-muted-foreground">Phone</dt><dd>{pkg.consumer.phone ?? "—"}</dd>
              <dt className="text-muted-foreground">Property</dt><dd>{pkg.property_address}</dd>
              <dt className="text-muted-foreground">Product</dt><dd>{pkg.quoted_product}</dd>
              <dt className="text-muted-foreground">Area</dt><dd>{pkg.quoted_area_m2 != null ? `${pkg.quoted_area_m2} m²` : "Confirmed at installation"}</dd>
              <dt className="text-muted-foreground">Installer</dt><dd>{pkg.installer.business ?? pkg.installer.name ?? "Assigned by HI VIC"}</dd>
              <dt className="text-muted-foreground">Your price</dt><dd>{aud(pkg.final_customer_price_inc_gst)} inc GST</dd>
            </dl>
            {jobId && (!changeOpen
              ? <Button variant="link" className="h-auto px-0" onClick={() => setChangeOpen(true)}>Something wrong? Ask HI VIC to correct it</Button>
              : <div className="mt-2 space-y-2"><Textarea placeholder="Tell us what needs correcting" value={change} onChange={(e) => setChange(e.target.value)} />
                  <Button size="field" variant="outline" className="w-full" disabled={change.trim().length < 3} onClick={async () => { await message({ jobId, body: `Customer requested a correction before signing: ${change}`, channel: "portal" }, "Sent – HI VIC will update your details"); setChange(""); setChangeOpen(false); }}>Send correction request</Button></div>)}
          </div>
          <div className="grid grid-cols-2 gap-2">{(["owner", "authorised_representative"] as const).map((k) => <Button key={k} size="field" variant={authorityType === k ? "default" : "outline"} onClick={() => setAuthorityType(k)}>{k === "owner" ? "I am the owner" : "I'm signing for the owner"}</Button>)}</div>
          {authorityType === "authorised_representative" && <Input className="h-12" placeholder="Your full name (authorised representative)" value={repName} onChange={(e) => setRepName(e.target.value)} />}
          {data.consumerDeclaration && <Official title={`Declarations (${data.consumerDeclaration.version})`} body={data.consumerDeclaration.body} />}
          <Tick v={over18} set={setOver18}>I am 18 years of age or older.</Tick>
          <Tick v={decl} set={setDecl}>I make the declarations above.</Tick>
          <Tick v={assign} set={setAssign}>I assign all rights to create VEECs from this Activity 48 job to {pkg.ap_legal_entity}. I understand this takes effect only once the installation has been completed.</Tick>
          {data.escConsent && <Official title={`Information sharing with the ESC (${data.escConsent.version})`} body={data.escConsent.body} />}
          <Tick v={escOk} set={setEscOk}>I consent to the information sharing described above.</Tick>
          <div><div className="mb-1 font-medium">Do you need any assistance?</div><div className="grid gap-2 sm:grid-cols-2">{(Object.keys(ASSISTANCE_LABEL) as (keyof typeof ASSISTANCE_LABEL)[]).map((k) => <Button key={k} size="field" variant={assist === k ? "default" : "outline"} className="h-auto min-h-12 whitespace-normal" onClick={() => setAssist(k)}>{ASSISTANCE_LABEL[k]}</Button>)}</div></div>
        </div>
      )}
      {step === 3 && (
        <div className="space-y-3 text-sm">
          <p>Signing as <b>{signatory}</b>. Type your full name as your electronic signature. A copy of everything you signed appears in your Documents straight away.</p>
          <Input className="h-12" value={sig} placeholder={signatory} onChange={(e) => setSig(e.target.value)} autoComplete="name" />
          <Button size="field" className="w-full" disabled={sig.trim().length < 2}
            onClick={async () => { await respond({ quoteId, accept: true, consent: true, signing: { signatoryName: signatory, authorityType, over18, readConsumerInfo: readInfo, acceptDeclaration: decl, acceptAssignment: assign, acceptEscConsent: escOk, signatureName: sig, assistance: assist } }, "Signed – your copy is in Documents and your deposit invoice is next"); onClose(); }}>
            Accept quote & sign
          </Button>
        </div>
      )}
      <div className="mt-4 flex gap-2">
        {step > 0 && <Button variant="outline" size="field" className="flex-1" onClick={() => setStep(step - 1)}>Back</Button>}
        {step < 3 && <Button size="field" className="flex-1" disabled={!canContinue} onClick={() => setStep(step + 1)}>Continue</Button>}
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
      {(data?.finalBlockers.length ?? 0) > 0 && <div className="mb-3 flex gap-2 rounded border border-warning bg-warning-soft p-3 text-sm"><ShieldAlert className="h-4 w-4 shrink-0" /><div>{data!.finalBlockers.map((b) => <div key={b}>{b}</div>)}<a className="underline" href="/admin/compliance">Open Compliance Setup</a></div></div>}
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
          {data?.apTemplate && <ApDeclarationAction jobId={jobId} a={a} template={data.apTemplate} />}
          {a.status !== "effective_complete" && (
            <div className="space-y-2 border-t pt-3"><Textarea placeholder="Describe another material change (scope, price…)" value={reason} onChange={(e) => setReason(e.target.value)} />
              <Button variant="outline" disabled={reason.trim().length < 5} onClick={async () => { await raise({ jobId, reason }, "Variation raised – customer must reconfirm"); setReason(""); }}>Raise variation</Button></div>
          )}
        </div>
      )}
    </Section>
  );
}

/** Installer: mobile-first finalisation. Known facts are prefilled; only genuinely new facts are entered. */
export function InstallerFinalDeclaration({ jobId }: { jobId: string }) {
  const { data } = useAssignment(jobId);
  const sign = useAction(signInstallerDeclaration);
  const cur = data?.current as { quoted_product?: string | null; quoted_area_m2?: number | null; installer_signed_at?: string | null; installed_product?: string | null; installed_area_m2?: number | null; status: string } | null | undefined;
  const [asQuoted, setAsQuoted] = useState(true);
  const [product, setProduct] = useState("");
  const [area, setArea] = useState<string | null>(null);
  const [vals, setVals] = useState<Record<string, FieldValue>>({});
  const [sig, setSig] = useState("");
  const [ok, setOk] = useState(false);
  if (!cur) return <p className="text-sm text-muted-foreground">The customer hasn't accepted yet – nothing to do here.</p>;
  if (cur.installer_signed_at) return <p className="flex items-center gap-2 text-sm text-success"><CheckCircle2 className="h-4 w-4" /> Signed – {cur.installed_product}, {cur.installed_area_m2} m²</p>;
  if (data!.finalBlockers.length) return <p className="text-sm text-muted-foreground">Final sign-off isn't open yet – HI VIC is finishing setup. You'll be able to sign here shortly.</p>;
  const areaVal = area ?? (cur.quoted_area_m2 != null ? String(cur.quoted_area_m2) : "");
  const fields = data!.installerFields;
  const blockers = formFieldBlockers(fields, vals);
  const ready = ok && sig.trim().length >= 2 && Number(areaVal) > 0 && (asQuoted ? !!cur.quoted_product : product.trim().length >= 2) && !blockers.length;
  return (
    <div className="space-y-4 text-sm">
      <details className="rounded-lg bg-muted p-3"><summary className="cursor-pointer font-medium">Job details (already on file)</summary>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">{data!.prefill.map((r) => <Fragment key={r.label}><dt className="text-muted-foreground">{r.label}</dt><dd>{r.value}</dd></Fragment>)}</dl>
      </details>
      <div className="space-y-2">
        <div className="font-medium">Installed product</div>
        <div className="grid grid-cols-2 gap-2">
          <Button size="field" variant={asQuoted ? "default" : "outline"} className="h-auto min-h-12 whitespace-normal" onClick={() => setAsQuoted(true)}>As quoted: {cur.quoted_product ?? "—"}</Button>
          <Button size="field" variant={!asQuoted ? "default" : "outline"} onClick={() => setAsQuoted(false)}>Different product</Button>
        </div>
        {!asQuoted && <Input className="h-12" placeholder="Installed product (brand, model, R-value)" value={product} onChange={(e) => setProduct(e.target.value)} />}
      </div>
      <div><div className="mb-1 font-medium">Actual installed area (m²)</div><Input className="h-12" inputMode="decimal" value={areaVal} onChange={(e) => setArea(e.target.value)} /><p className="mt-1 text-xs text-muted-foreground">Prefilled from the quote – change it if the installed area differs.</p></div>
      {fields.map((f) => <FieldInput key={f.key} f={f} v={vals[f.key] ?? null} set={(v) => setVals({ ...vals, [f.key]: v })} />)}
      {data!.installerDeclaration && <details className="rounded-lg border p-3" open><summary className="cursor-pointer font-medium">Installer declaration ({data!.installerDeclaration.version})</summary><div className="mt-2 max-h-60 overflow-y-auto whitespace-pre-wrap">{data!.installerDeclaration.body}</div></details>}
      <label className="flex min-h-12 items-start gap-3 rounded-lg border p-3"><Checkbox className="mt-0.5 h-5 w-5" checked={ok} onCheckedChange={(v) => setOk(!!v)} /> I make the declaration above.</label>
      <Input className="h-12" placeholder="Type your full name to sign" value={sig} onChange={(e) => setSig(e.target.value)} autoComplete="name" />
      <Button size="field" className="w-full" disabled={!ready} onClick={() => sign({ jobId, asQuotedProduct: asQuoted, installedProduct: asQuoted ? null : product, installedArea: Number(areaVal), fieldValues: vals, signatureName: sig }, "Signed – thanks")}>Sign & finalise</Button>
    </div>
  );
}

function FieldInput({ f, v, set }: { f: FormField; v: FieldValue; set: (v: FieldValue) => void }) {
  const label = <div className="mb-1 font-medium">{f.label}{f.required ? "" : " (optional)"}</div>;
  if (f.type === "checkbox") return <label className="flex min-h-12 items-start gap-3 rounded-lg border p-3"><Checkbox className="mt-0.5 h-5 w-5" checked={v === true} onCheckedChange={(x) => set(!!x)} /> {f.label}</label>;
  if (f.type === "select") return <div>{label}<select className="h-12 w-full rounded-md border bg-background px-2" value={String(v ?? "")} onChange={(e) => set(e.target.value || null)}><option value="">Choose…</option>{(f.options ?? []).map((o) => <option key={o}>{o}</option>)}</select>{f.help && <p className="mt-1 text-xs text-muted-foreground">{f.help}</p>}</div>;
  return <div>{label}<Input className="h-12" type={f.type === "date" ? "date" : "text"} inputMode={f.type === "number" ? "decimal" : undefined} value={String(v ?? "")} onChange={(e) => set(f.type === "number" && e.target.value !== "" ? Number(e.target.value) : e.target.value)} />{f.help && <p className="mt-1 text-xs text-muted-foreground">{f.help}</p>}</div>;
}

/** HI VIC internal AP/assignee declaration: everything prefilled; admin reviews and signs electronically. */
function ApDeclarationAction({ jobId, a, template }: { jobId: string; a: Record<string, unknown>; template: { version: string; body: string } }) {
  const sign = useAction(signApDeclarationFn);
  const [ok, setOk] = useState(false);
  const [sig, setSig] = useState("");
  if (a["ap_signed_at"]) return <p className="flex items-center gap-2 text-success"><CheckCircle2 className="h-4 w-4" /> AP declaration {String(a["ap_declaration_version"])} signed by {String(a["ap_signature_name"])} · {fmtDateTime(a["ap_signed_at"] as string)}</p>;
  if (!a["installer_signed_at"]) return <p className="text-muted-foreground">AP declaration opens once the installer has signed.</p>;
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="font-medium">HI VIC AP declaration ({template.version})</div>
      <p className="text-muted-foreground">Prefilled: {String(a["ap_legal_entity"])} · {String(a["installed_product"])} · {String(a["installed_area_m2"])} m² · customer and installer records linked.</p>
      <details><summary className="cursor-pointer">Declaration wording</summary><div className="mt-2 max-h-60 overflow-y-auto whitespace-pre-wrap">{template.body}</div></details>
      <label className="flex items-start gap-3"><Checkbox className="mt-0.5 h-5 w-5" checked={ok} onCheckedChange={(v) => setOk(!!v)} /> I have reviewed the record and make this declaration for {String(a["ap_legal_entity"])}.</label>
      <Input placeholder="Type your full name to sign" value={sig} onChange={(e) => setSig(e.target.value)} />
      <Button disabled={!ok || sig.trim().length < 2} onClick={() => sign({ jobId, signatureName: sig }, "AP declaration signed")}>Sign AP declaration</Button>
    </div>
  );
}

export function AssignmentStatusInline({ jobId }: { jobId: string }) {
  const { data } = useAssignment(jobId);
  const a = data?.current as { status: string } | null | undefined;
  return a ? <StatusPill s={a.status} /> : <span className="text-xs text-muted-foreground">Not signed</span>;
}
