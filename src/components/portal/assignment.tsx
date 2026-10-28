import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, FileText, ShieldAlert } from "lucide-react";
import { useAction } from "@/hooks/use-me";
import {
  confirmApConsentFn, getAcceptancePackage, getAssignment, getAssignmentDocUrl, prepareFinalAssignmentFn, raiseAssignmentVariation, reconfirmAssignmentVariation, recordVeecPrerequisiteFn,
  respondToQuote, sendMessage, signFinalAssignmentFn, signOwnerConsentFn,
} from "@/lib/portal.functions";
import { ASSIGNMENT_LABEL, INSTALLER_DECLARATION_SUPERSEDED, formFieldBlockers, type AssignmentStatus, type FieldValue, type FormField } from "@/lib/assignment.core";
import { AP_DECLARATION, INSTALLER_DECLARATION, SECTION_1_CONSUMER_RIGHTS } from "@/lib/veec-assignment-form.core";
import { ASSISTANCE_LABEL } from "@/lib/authority";
import { aud, fmtDateTime } from "@/lib/workflow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Pill } from "./badges";
import { Section } from "./panels";
import { openFileViewer } from "@/components/portal/file-viewer";

export function useAssignment(jobId: string) {
  const fn = useServerFn(getAssignment);
  return useQuery({ queryKey: ["assignment", jobId], queryFn: () => fn({ data: { jobId } }) });
}

function StatusPill({ s }: { s: string }) {
  const t = s === "effective_complete" || s === "valid" || s === "signed" ? "good" : s === "variation_required" || s === "stale" ? "bad" : s === "cancelled" ? "neutral" : "info";
  const label = ASSIGNMENT_LABEL[s as AssignmentStatus] ?? ({ valid: "Consent valid", awaiting_owner: "Awaiting owner signature", awaiting_ap: "Awaiting AP confirmation", configuration_required: "Consent form not approved", stale: "Stale – new consent needed", signed: "Signed" } as Record<string, string>)[s] ?? s;
  return <Pill t={t}>{label}</Pill>;
}

function CopyLink({ id, which, label }: { id: string; which: "agreement" | "consent" | "final"; label: string }) {
  const fn = useServerFn(getAssignmentDocUrl);
  return <Button variant="outline" size="sm" onClick={async () => { const r = await fn({ data: { id, which } }); openFileViewer(r.url); }}><FileText className="h-4 w-4" /> {label}</Button>;
}

const Tick = ({ v, set, children }: { v: boolean; set: (b: boolean) => void; children: React.ReactNode }) => (
  <label className="flex min-h-12 items-start gap-3 rounded-lg border p-3"><Checkbox className="mt-0.5 h-5 w-5" checked={v} onCheckedChange={(x) => set(!!x)} /><span>{children}</span></label>
);
const Official = ({ title, body }: { title: string; body: string }) => (
  <details className="rounded-lg border p-3" open><summary className="cursor-pointer font-medium">{title}</summary><div className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap leading-relaxed">{body}</div></details>
);

/** Customer Agreement / Quote Acceptance: review quote -> VEU info & rights -> confirm & agree -> sign.
 *  Commercial only. ESC consent and the VEEC assignment are separate later forms. */
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
  const [agree, setAgree] = useState(false);
  const [assist, setAssist] = useState<keyof typeof ASSISTANCE_LABEL>("none");
  const [change, setChange] = useState("");
  const [changeOpen, setChangeOpen] = useState(false);
  const [sig, setSig] = useState("");
  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const { pkg } = data;
  if (data.blockers.length > 0) return (
    <section className="rounded-xl border bg-card p-4 text-sm">
      <div className="mb-2 flex items-center justify-between"><h2 className="text-lg font-bold">Accept your quote</h2><Button variant="ghost" size="sm" onClick={onClose}>Close</Button></div>
      <p>We're just finalising your acceptance paperwork. Home Insulation Victoria will let you know as soon as you can accept online – there's nothing you need to do right now.</p>
    </section>
  );
  const signatory = authorityType === "owner" ? pkg.consumer.name : repName.trim();
  const steps = ["Review quote", "VEU info & rights", "Confirm & agree", "Sign"];
  const canContinue = step === 0 || (step === 1 && readInfo) || (step === 2 && over18 && agree && signatory.length >= 2);
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
              <dt className="text-muted-foreground">Property</dt><dd>{pkg.property_address}</dd>
              <dt className="text-muted-foreground">Product</dt><dd>{pkg.quoted_product}</dd>
              <dt className="text-muted-foreground">Area</dt><dd>{pkg.quoted_area_m2 != null ? `${pkg.quoted_area_m2} m²` : "Confirmed at installation"}</dd>
              <dt className="text-muted-foreground">Installer</dt><dd>{pkg.installer.business ?? pkg.installer.name ?? "Assigned by Home Insulation Victoria"}</dd>
              <dt className="text-muted-foreground">Your price</dt><dd>{aud(pkg.final_customer_price_inc_gst)} inc GST</dd>
            </dl>
            {jobId && (!changeOpen
              ? <Button variant="link" className="h-auto px-0" onClick={() => setChangeOpen(true)}>Something wrong? Ask Home Insulation Victoria to correct it</Button>
              : <div className="mt-2 space-y-2"><Textarea placeholder="Tell us what needs correcting" value={change} onChange={(e) => setChange(e.target.value)} />
                  <Button size="field" variant="outline" className="w-full" disabled={change.trim().length < 3} onClick={async () => { await message({ jobId, body: `Customer requested a correction before signing: ${change}`, channel: "portal" }, "Sent – Home Insulation Victoria will update your details"); setChange(""); setChangeOpen(false); }}>Send correction request</Button></div>)}
          </div>
          <div className="grid grid-cols-2 gap-2">{(["owner", "authorised_representative"] as const).map((k) => <Button key={k} size="field" variant={authorityType === k ? "default" : "outline"} onClick={() => setAuthorityType(k)}>{k === "owner" ? "I am the owner" : "I'm signing for the owner"}</Button>)}</div>
          {authorityType === "authorised_representative" && <Input className="h-12" placeholder="Your full name (authorised representative)" value={repName} onChange={(e) => setRepName(e.target.value)} />}
          {data.agreementWording && <Official title={`Agreement (${data.agreementWording.version})`} body={data.agreementWording.body} />}
          <Tick v={over18} set={setOver18}>I am 18 years of age or older.</Tick>
          <Tick v={agree} set={setAgree}>I accept this quote and its payment terms with {pkg.ap_legal_entity}.</Tick>
          <p className="rounded bg-muted p-2 text-xs text-muted-foreground">After booking, you’ll receive a separate information-sharing consent. After installation, you’ll review and sign the completed official VEEC assignment form.</p>
          <div><div className="mb-1 font-medium">Do you need any assistance?</div><div className="grid gap-2 sm:grid-cols-2">{(Object.keys(ASSISTANCE_LABEL) as (keyof typeof ASSISTANCE_LABEL)[]).map((k) => <Button key={k} size="field" variant={assist === k ? "default" : "outline"} className="h-auto min-h-12 whitespace-normal" onClick={() => setAssist(k)}>{ASSISTANCE_LABEL[k]}</Button>)}</div></div>
        </div>
      )}
      {step === 3 && (
        <div className="space-y-3 text-sm">
          <p>Signing as <b>{signatory}</b>. Type your full name as your electronic signature.</p>
          <Input className="h-12" value={sig} placeholder={signatory} onChange={(e) => setSig(e.target.value)} autoComplete="name" />
          <Button size="field" className="w-full" disabled={sig.trim().length < 2}
            onClick={async () => { await respond({ quoteId, accept: true, consent: true, signing: { signatoryName: signatory, authorityType, over18, readConsumerInfo: readInfo, acceptAgreement: agree, signatureName: sig, assistance: assist } }, "Accepted – your deposit invoice is next"); onClose(); }}>
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

/** Owner: agreement copy, ESC consent to sign, final VEEC assignment to sign, variations. */
export function OwnerAssignmentCard({ jobId }: { jobId: string }) {
  const { data } = useAssignment(jobId);
  const reconfirm = useAction(reconfirmAssignmentVariation);
  const signConsent = useAction(signOwnerConsentFn);
  const signFinal = useAction(signFinalAssignmentFn);
  const [sig, setSig] = useState("");
  const [cSig, setCSig] = useState("");
  const [cOk, setCOk] = useState(false);
  const [decl, setDecl] = useState<Record<string, boolean>>({});
  const [fSig, setFSig] = useState("");
  const [f18, setF18] = useState(false);
  if (!data) return null;
  const ag = data.agreement as Any, c = data.consent as Any, a = data.current as Any;
  if (!ag && !c && !a) return null;
  const pending = (data.variations ?? []).find((v) => v.status === "pending");
  const form = data.consentForm;
  const escForm = !!form?.esc;
  const allDecl = escForm && (form?.declarations ?? []).every((d) => decl[d.key] === true);
  const consentReady = escForm ? allDecl : cOk;
  return (
    <Section title="Your agreement & forms">
      <div className="space-y-4 text-sm">
        {ag && <div className="flex flex-wrap items-center gap-2"><b>Quote acceptance</b><StatusPill s="signed" />{ag.copy_path && <CopyLink id={ag.id} which="agreement" label="Signed copy" />}</div>}
        {c && (
          <div className="space-y-2 rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-2"><b>Information-sharing consent (ESC)</b><StatusPill s={c.status} /></div>
            <p className="text-muted-foreground">Installation: {(c.installation_days as string[]).join(", ")} · {c.premises_address}</p>
            {c.status === "awaiting_owner" && data.escConsentTemplate && escForm && form && <>
              {/* ESC Owner's Consent Form Template v1 (decision 123): Section 1 prefilled, Section 2 = four ticks, then sign. */}
              <div className="rounded-lg border p-3">
                <div className="font-medium">Section 1: Information to be shared</div>
                <div className="text-muted-foreground">Owner details</div>
                <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">{form.section1.map((r) => <Fragment key={r.label}><dt className="text-muted-foreground">{r.label}:</dt><dd>{r.value}</dd></Fragment>)}</dl>
              </div>
              <div className="font-medium">Section 2: Declaration by owner</div>
              <p>I declare that:</p>
              {form.declarations.map((d) => <Tick key={d.key} v={decl[d.key] === true} set={(v) => setDecl({ ...decl, [d.key]: v })}>{d.text}</Tick>)}
              <Input className="h-12" placeholder="Owner signature: type your full name" value={cSig} onChange={(e) => setCSig(e.target.value)} />
              <Button size="field" className="w-full" disabled={!consentReady || cSig.trim().length < 2}
                onClick={() => signConsent({ jobId, signatoryName: cSig, authorityType: "owner", accept: allDecl, signatureName: cSig, declarations: { owner_or_authorised: decl["owner_or_authorised"] === true, details_accurate: decl["details_accurate"] === true, consent_ap_sends: decl["consent_ap_sends"] === true, consent_commission_shares: decl["consent_commission_shares"] === true } }, "Consent signed")}>Sign consent</Button>
              <Official title={`Full form (${form.version})`} body={data.escConsentTemplate.body} />
            </>}
            {c.status === "awaiting_owner" && data.escConsentTemplate && !escForm && <>
              <Official title={`Consent (${data.escConsentTemplate.version})`} body={data.escConsentTemplate.body} />
              <Tick v={cOk} set={setCOk}>I consent to {c.ap_legal_entity} sharing the information described above with the Essential Services Commission.</Tick>
              <Input className="h-12" placeholder="Type your full name to sign" value={cSig} onChange={(e) => setCSig(e.target.value)} />
              <Button size="field" className="w-full" disabled={!cOk || cSig.trim().length < 2} onClick={() => signConsent({ jobId, signatoryName: cSig, authorityType: "owner", accept: cOk, signatureName: cSig }, "Consent signed")}>Sign consent</Button>
            </>}
            {c.status === "awaiting_ap" && <p>Signed – Home Insulation Victoria will countersign.</p>}
            {c.status === "valid" && <p className="text-success">Complete. {c.delivery_status === "pending_comms_lock" ? "Your copy is stored and will be sent to you shortly." : ""}</p>}
          </div>
        )}
        {a && (
          <div className="space-y-2 rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-2"><b>Activity 48 VEEC assignment</b><StatusPill s={a.status} />{a.final_copy_path && a.delivery_status !== "pending_comms_lock" && <CopyLink id={a.id} which="final" label="Final copy" />}</div>
            {a.status === "awaiting_consumer_signature" && <p>Please review and sign the completed installation details below.</p>}
            {a.status === "awaiting_consumer_signature" && data.officialForm && <>
              <Official title={`Official form (${data.officialForm.version})`} body={data.officialForm.body} />
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded bg-muted p-2">{(a.final_facts?.installed ?? []).map((x: Any, i: number) => <Fragment key={i}><dt className="text-muted-foreground">Installed</dt><dd>{x.product}{x.r_value ? ` (${x.r_value})` : ""} · {x.area_m2} m²</dd></Fragment>)}<dt className="text-muted-foreground">Completed</dt><dd>{a.final_facts?.completed_date}</dd></dl>
              <Tick v={f18} set={setF18}>I am 18 or older and I sign this assignment form.</Tick>
              <Input className="h-12" placeholder="Type your full name to sign" value={fSig} onChange={(e) => setFSig(e.target.value)} />
              <Button size="field" className="w-full" disabled={!f18 || fSig.trim().length < 2} onClick={() => signFinal({ jobId, party: "consumer", signatureName: fSig, signatoryName: fSig, authorityType: "owner", over18: f18 }, "Signed")}>Sign assignment</Button>
            </>}
            {a.status === "effective_complete" && a.delivery_status === "pending_comms_lock" && <p className="text-muted-foreground">Signed copy stored – it will be sent to you shortly.</p>}
          </div>
        )}
        {pending && (
          <div className="space-y-2 rounded border border-danger/30 bg-danger-soft p-3">
            <div className="font-medium text-danger">Something changed after you agreed – please review and reconfirm:</div>
            <ul className="list-disc pl-5">{(pending.reasons as string[]).map((r) => <li key={r}>{r}</li>)}</ul>
            <Input className="h-12" placeholder="Type your full name to reconfirm" value={sig} onChange={(e) => setSig(e.target.value)} />
            <Button size="field" className="w-full" disabled={sig.trim().length < 2} onClick={() => reconfirm({ variationId: pending.id, signatureName: sig }, "Reconfirmed")}>Reconfirm</Button>
          </div>
        )}
      </div>
    </Section>
  );
}

/** Admin: the four separate records in sequence. */
/** Office signing. The Job page shows each part on its own stage card (decision 223): 1 acceptance on Quote, 2 ESC owner
 *  consent on Install, 4 the official VEEC form on Final check. The separate installer declaration (old section 3) was
 *  dropped by decision 118a — the PIISA from Mitti shows under Install. */
export function AdminAssignmentPanel({ jobId, sections = [1, 2, 4] }: { jobId: string; sections?: (1 | 2 | 4)[] }) {
  const { data } = useAssignment(jobId);
  const raise = useAction(raiseAssignmentVariation);
  const prepare = useAction(prepareFinalAssignmentFn);
  const confirm = useAction(confirmApConsentFn);
  const signFinal = useAction(signFinalAssignmentFn);
  const [reason, setReason] = useState("");
  const [apName, setApName] = useState("");
  const [explained, setExplained] = useState(false);
  const [apSig, setApSig] = useState("");
  const [apRepEdit, setApRepEdit] = useState<{ first_name: string; last_name: string; role: string; phone: string | null; email: string | null } | null>(null);
  if (!data) return null;
  const ag = data.agreement as Any, c = data.consent as Any, a = data.current as Any;
  const form = data.consentForm;
  // Section 3 Part A: prefilled from the signing office user's profile, editable before signing.
  const apRep = apRepEdit ?? form?.apPrefill ?? { first_name: "", last_name: "", role: "", phone: null, email: null };
  const apRepName = `${apRep.first_name.trim()} ${apRep.last_name.trim()}`.trim();
  const apRepOk = apRep.first_name.trim().length > 0 && apRep.last_name.trim().length > 0 && apRep.role.trim().length >= 2;
  return (
    <div className="space-y-4">
      {sections.includes(1) && <Section title="Customer agreement (quote acceptance)">
        {!ag ? <p className="text-sm text-muted-foreground">Not signed – the customer signs when accepting the installation quote. Unlocks invoice/deposit only.</p> : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Signed</dt><dd>{ag.signatory_name} ({ag.signatory_authority_type}) · {fmtDateTime(ag.signed_at)} · IP {ag.ip ?? "—"} {ag.copy_path && <CopyLink id={ag.id} which="agreement" label="Copy" />}</dd>
            <dt className="text-muted-foreground">Quote</dt><dd>v{ag.quote_version} · {ag.quoted_product} · {ag.quoted_area_m2 ?? "—"} m²</dd>
            <dt className="text-muted-foreground">Prices</dt><dd>Before {aud(Number(ag.price_before_benefit_inc_gst))} · VEU {aud(Number(ag.veu_benefit_inc_gst))} · Final {aud(Number(ag.final_customer_price_inc_gst))}</dd>
            <dt className="text-muted-foreground">Wording</dt><dd>Rights {ag.consumer_rights_version} · Agreement {ag.agreement_wording_version ?? "not configured"} · origin {ag.record_origin}</dd>
          </dl>)}
      </Section>}
      {sections.includes(2) && <Section title="ESC owner consent (after booking, ≥24h before work)">
        {!c ? <p className="text-sm text-muted-foreground">Generated automatically once an exact installation date is booked.</p> : (
          <div className="space-y-2 text-sm">
            <div className="flex flex-wrap items-center gap-2"><StatusPill s={c.status} /> v{c.version} · {(c.installation_days as string[]).join(", ")} {c.copy_path && <CopyLink id={c.id} which="consent" label="Signed copy" />}</div>
            {c.blockers.length > 0 && <ul className="list-disc pl-5 text-warning">{c.blockers.map((b: string) => <li key={b}>{b}</li>)}</ul>}
            {c.status === "awaiting_ap" && form?.esc && <div className="space-y-2 rounded border p-2">
              {/* ESC template Section 3 (decision 123): Part A details prefilled from your profile, Part B declaration tick, then sign. */}
              <div className="font-medium">Section 3 – Accredited person details and declaration</div>
              <p className="text-xs text-muted-foreground" data-why="decision 370">Normally this signs itself as the AP representative as soon as the owner has signed and every check passes. Sign here only if it is held.</p>
              <div className="text-muted-foreground">Part A: Accredited person name: DC Construction Solutions Pty Ltd trading as Home Insulation Victoria (VEU Accredited Person A003654)</div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Input placeholder="First name" value={apRep.first_name} onChange={(e) => setApRepEdit({ ...apRep, first_name: e.target.value })} />
                <Input placeholder="Last name" value={apRep.last_name} onChange={(e) => setApRepEdit({ ...apRep, last_name: e.target.value })} />
                <Input placeholder="Role (e.g. Office manager)" value={apRep.role} onChange={(e) => setApRepEdit({ ...apRep, role: e.target.value })} />
                <Input placeholder="Phone number" value={apRep.phone ?? ""} onChange={(e) => setApRepEdit({ ...apRep, phone: e.target.value || null })} />
                <Input placeholder="Email address" value={apRep.email ?? ""} onChange={(e) => setApRepEdit({ ...apRep, email: e.target.value || null })} />
              </div>
              <div className="font-medium">Part B: Declaration by accredited person</div>
              <label className="flex items-start gap-2"><Checkbox checked={explained} onCheckedChange={(v) => setExplained(!!v)} /> <span>I {apRepName || "<insert name>"}, am the authorised representative of DC Construction Solutions Pty Ltd trading as Home Insulation Victoria (VEU Accredited Person A003654) and declare that I have explained to the property owner the purpose for which this written consent is being obtained.</span></label>
              <Button disabled={!explained || !apRepOk} onClick={() => confirm({ jobId, apRep, purposeExplained: explained }, "Consent confirmed")}>Sign as accredited person representative</Button>
            </div>}
            {c.status === "awaiting_ap" && !form?.esc && <div className="space-y-2 rounded border p-2">
              <Input placeholder="AP representative full name" value={apName} onChange={(e) => setApName(e.target.value)} />
              <label className="flex items-start gap-2"><Checkbox checked={explained} onCheckedChange={(v) => setExplained(!!v)} /> I explained the purpose of the information sharing to the owner.</label>
              <Button disabled={!explained || apName.trim().length < 2} onClick={() => confirm({ jobId, apRepName: apName, purposeExplained: explained }, "Consent confirmed")}>Confirm as AP representative</Button>
            </div>}
            {c.status === "valid" && <p>AP: {c.ap_rep_name} · {fmtDateTime(c.ap_signed_at)} · delivery {String(c.delivery_status).replace(/_/g, " ")}</p>}
          </div>)}
      </Section>}
      {sections.includes(4) && <Section title="Official ESC VEEC assignment form v1.1 (post-install: installer → AP → owner)">
        {data.finalBlockers.length > 0 && <div className="mb-3 flex gap-2 rounded border border-warning bg-warning-soft p-3 text-sm"><ShieldAlert className="h-4 w-4 shrink-0" /><div>{data.finalBlockers.map((b) => <div key={b}>{b}</div>)}<a className="underline" href="/admin/compliance">Open Compliance Setup</a></div></div>}
        <VeecPreparation jobId={jobId} prep={data.veecPrep as Any} prepare={(fieldValues) => prepare({ jobId, fieldValues }, "Form details saved")} canPrepare={data.installationCompleted && a?.status !== "effective_complete"} />
        <ApPrerequisites jobId={jobId} items={data.apPrerequisites ?? []} signed={!!a?.ap_signed_at} />
        {!a ? (
          <div className="space-y-2 text-sm"><p className="text-muted-foreground">Prepared from job facts once the install is recorded complete. The lead installer's signature from their job screen prepares it too.</p>
            <Button disabled={!data.installationCompleted} onClick={() => prepare({ jobId, fieldValues: {} }, "VEEC assignment form prepared")}>Prepare the form</Button></div>
        ) : (
          <div className="space-y-2 text-sm">
            <div className="flex flex-wrap items-center gap-2"><StatusPill s={a.status} />{a.final_copy_path && <CopyLink id={a.id} which="final" label="Final copy" />}{a.delivery_status === "pending_comms_lock" && <Pill t="warn">Delivery pending – communications locked</Pill>}</div>
            <ol className="list-decimal pl-5">
              <li>Lead installer (Section 3 Part B, from their job screen): {a.installer_signed_at ? `${a.installer_signature_name} · ${fmtDateTime(a.installer_signed_at)}` : "pending"}</li>
              <li>AP representative (Section 3 Part A, signs itself once the prerequisites above are recorded — decision 271): {a.ap_signed_at ? `${a.ap_signature_name} · ${fmtDateTime(a.ap_signed_at)}${data.apAuto?.method === "automatic" ? " · applied automatically" : ""}` : "pending"}</li>
              <li>Owner (Section 4 Part B, via their secure My job link; asked by email + text, reminders days 1/3/7, office alert day 10): {a.consumer_signed_at ? `${a.consumer_signature_name} · ${fmtDateTime(a.consumer_signed_at)}` : "pending"}</li>
            </ol>
            {a.status === "awaiting_ap_signature" && !a.ap_signed_at && <div className="space-y-2 rounded border p-2">
              {/* Decision 271: Part A is applied by the portal (installer-sign hook + 15-minute tick) once every prerequisite is recorded. */}
              {(data.apAuto?.heldReasons ?? []).length > 0
                ? <div><p className="font-medium">Part A signs itself once these are recorded:</p><ul className="list-disc pl-5 text-warning">{(data.apAuto?.heldReasons ?? []).map((b) => <li key={b}>{b}</li>)}</ul></div>
                : <p className="text-muted-foreground">Everything is recorded — Part A will be signed automatically within 15 minutes as the AP representative.</p>}
              <details>
                <summary className="cursor-pointer text-muted-foreground">Sign by hand instead (fallback, same prerequisites)</summary>
                <Official title="Section 3 Part A – Accredited person declaration (signing this asserts every line)" body={AP_DECLARATION} />
                <div className="flex gap-2"><Input placeholder="Type your full name to sign as AP representative" value={apSig} onChange={(e) => setApSig(e.target.value)} /><Button disabled={apSig.trim().length < 2 || (data.apPrerequisites ?? []).length > 0} onClick={() => signFinal({ jobId, party: "ap", signatureName: apSig }, "Signed")}>Sign</Button></div>
              </details>
            </div>}
            <Button variant="outline" size="sm" disabled={a.status === "effective_complete"} onClick={() => prepare({ jobId, fieldValues: {} }, "Rechecked final facts")}>Recheck final facts</Button>
            {(data.variations ?? []).length > 0 && <ul className="space-y-1">{data.variations.map((v) => <li key={v.id} className="rounded border p-2">{(v.reasons as string[]).join(", ")} · <b>{v.status}</b> · {fmtDateTime(v.raised_at)}</li>)}</ul>}
            {a.status !== "effective_complete" && <div className="space-y-2 border-t pt-3"><Textarea placeholder="Describe another material change (scope, price…)" value={reason} onChange={(e) => setReason(e.target.value)} />
              <Button variant="outline" disabled={reason.trim().length < 5} onClick={async () => { await raise({ jobId, reason }, "Variation raised – customer must reconfirm"); setReason(""); }}>Raise variation</Button></div>}
          </div>
        )}
      </Section>}
    </div>
  );
}

/** Installer (decision 119): after "Installation complete", the lead installer signs Section 3 Part B of the official
 *  VEEC assignment form from this screen. The first signature prepares the form from job facts; missing facts block it. */
export function InstallerFinalDeclaration({ jobId }: { jobId: string }) {
  const { data } = useAssignment(jobId);
  const signFinal = useAction(signFinalAssignmentFn);
  const [sig, setSig] = useState("");
  const [ok, setOk] = useState(false);
  if (!data) return null;
  const a = data.current as Any;
  if (a?.installer_signed_at) return <p className="flex items-center gap-2 text-sm text-success"><CheckCircle2 className="h-4 w-4" /> Your part of the rebate form is signed · {ASSIGNMENT_LABEL[a.status as AssignmentStatus] ?? a.status}</p>;
  if (!data.installationCompleted) return <p className="text-sm text-muted-foreground">Once you mark the installation complete, sign your part of the rebate form (Section 3 Part B) here.</p>;
  // Jo 28 Oct 2026: crew get no price lines; `formPending` keeps Sign off while the office is still finishing the form.
  const prep = data.veecPrep as { blockers: string[]; formPending?: boolean } | null;
  const notReady = a ? null : prep?.blockers?.length || prep?.formPending ? prep.blockers : data.finalBlockers.length ? data.finalBlockers : null;
  return (
    <div className="space-y-3 text-sm">
      <p className="font-medium">Sign your part of the rebate form (Section 3 Part B – declaration by lead installer)</p>
      <Official title="Part B: Declaration by lead installer" body={INSTALLER_DECLARATION} />
      {a && <p>Installed: {a.installed_product} · {a.installed_area_m2} m²</p>}
      {notReady ? <div className="rounded border border-warning bg-warning-soft p-3"><p className="font-medium">Home Insulation Victoria is finishing the form details first{notReady.length ? ":" : "."}</p>{notReady.length > 0 && <ul className="list-disc pl-5">{notReady.map((b) => <li key={b}>{b}</li>)}</ul>}</div> : <>
        <label className="flex min-h-12 items-start gap-3"><Checkbox className="mt-0.5 h-5 w-5" checked={ok} onCheckedChange={(x) => setOk(!!x)} /> I make the declaration above.</label>
        <Input className="h-12" placeholder="Type your full name to sign" value={sig} onChange={(e) => setSig(e.target.value)} />
        <Button size="field" className="w-full" disabled={!ok || sig.trim().length < 2} onClick={() => signFinal({ jobId, party: "installer", signatureName: sig }, "Signed")}>Sign as lead installer</Button>
      </>}
    </div>
  );
}

/** Office: the prefilled Section 2, what is still missing, and an editor for the gaps (saved by re-preparing the form). */
function VeecPreparation({ jobId, prep, prepare, canPrepare }: { jobId: string; prep: { blockers: string[]; missing: string[]; values: Record<string, FieldValue>; fields: FormField[] } | null; prepare: (v: Record<string, FieldValue>) => Promise<unknown>; canPrepare: boolean }) {
  const [vals, setVals] = useState<Record<string, FieldValue>>({});
  if (!prep) return null;
  const gaps = prep.fields.filter((f) => prep.missing.includes(f.label));
  const filled = prep.fields.filter((f) => prep.values[f.key] != null && String(prep.values[f.key]).trim() !== "");
  return (
    <div className="mb-3 space-y-2 text-sm" data-job={jobId}>
      <details className="rounded border p-2"><summary className="cursor-pointer font-medium">Section 2 from the job record ({filled.length} of {prep.fields.length} fields)</summary>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">{filled.map((f) => <Fragment key={f.key}><dt className="text-muted-foreground">{f.label}</dt><dd>{f.type === "checkbox" ? (prep.values[f.key] === true ? "Confirmed" : "—") : String(prep.values[f.key])}</dd></Fragment>)}</dl></details>
      {gaps.length > 0 && <div className="space-y-2 rounded border border-warning bg-warning-soft p-3">
        <p className="font-medium">Still missing (not found in the job record – enter from the paperwork):</p>
        {gaps.map((f) => <FieldInput key={f.key} f={f} v={vals[f.key] ?? null} set={(v) => setVals({ ...vals, [f.key]: v })} />)}
        <Button disabled={!canPrepare || formFieldBlockers(gaps, vals).length > 0} onClick={async () => { await prepare(vals); setVals({}); }}>Save and prepare the form</Button>
      </div>}
      {prep.blockers.length > 0 && gaps.length === 0 && <ul className="list-disc pl-5 text-warning">{prep.blockers.map((b) => <li key={b}>{b}</li>)}</ul>}
    </div>
  );
}

/** Office: the four AP-declaration prerequisites. Two are read from existing records (PIESA copies, ESC notice);
 *  two are recorded here (warranty copy to the consumer; ESC collection notice to each installer). */
function ApPrerequisites({ jobId, items, signed }: { jobId: string; items: string[]; signed: boolean }) {
  const record = useAction(recordVeecPrerequisiteFn);
  const [note, setNote] = useState("");
  if (signed) return null;
  return (
    <div className="mb-3 space-y-2 rounded border p-3 text-sm">
      <p className="font-medium">Before Part A signs itself (decisions 119/271) {items.length === 0 ? <span className="text-success">— all four prerequisites recorded</span> : null}</p>
      {items.length > 0 && <ul className="list-disc pl-5 text-warning">{items.map((b) => <li key={b}>{b}</li>)}</ul>}
      <Input placeholder="Note (how / when it was given)" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => record({ jobId, kind: "warranty_copy_provided", note, workerId: null }, "Warranty copy recorded")}>Record: warranty copy given to the consumer</Button>
        <Button variant="outline" size="sm" onClick={() => record({ jobId, kind: "esc_collection_notice_provided", note, workerId: null }, "Collection notice recorded")}>Record: ESC collection notice given to the installer business</Button>
      </div>
      <details><summary className="cursor-pointer text-muted-foreground">Section 1 wording the owner sees</summary><Official title="Section 1: Consumer rights information" body={SECTION_1_CONSUMER_RIGHTS} /></details>
    </div>
  );
}

function FieldInput({ f, v, set }: { f: FormField; v: FieldValue; set: (v: FieldValue) => void }) {
  const label = <div className="mb-1 font-medium">{f.label}{f.required ? "" : " (optional)"}</div>;
  if (f.type === "checkbox") return <label className="flex min-h-12 items-start gap-3 rounded-lg border p-3"><Checkbox className="mt-0.5 h-5 w-5" checked={v === true} onCheckedChange={(x) => set(!!x)} /> {f.label}</label>;
  if (f.type === "select") return <div>{label}<select className="h-12 w-full rounded-md border bg-background px-2" value={String(v ?? "")} onChange={(e) => set(e.target.value || null)}><option value="">Choose…</option>{(f.options ?? []).map((o) => <option key={o}>{o}</option>)}</select>{f.help && <p className="mt-1 text-xs text-muted-foreground">{f.help}</p>}</div>;
  return <div>{label}<Input className="h-12" type={f.type === "date" ? "date" : "text"} inputMode={f.type === "number" ? "decimal" : undefined} value={String(v ?? "")} onChange={(e) => set(f.type === "number" && e.target.value !== "" ? Number(e.target.value) : e.target.value)} />{f.help && <p className="mt-1 text-xs text-muted-foreground">{f.help}</p>}</div>;
}

export function AssignmentStatusInline({ jobId }: { jobId: string }) {
  const { data } = useAssignment(jobId);
  if (!data) return null;
  const a = data.current as { status: string } | null;
  return <span className="flex flex-wrap gap-1">{data.agreement ? <Pill t="good">Agreement signed</Pill> : <span className="text-xs text-muted-foreground">Agreement not signed</span>}{data.consent && <StatusPill s={(data.consent as Any).status} />}{a && <StatusPill s={a.status} />}</span>;
}
