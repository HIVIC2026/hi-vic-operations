// Part 4 Task 5 (Jo 2 Nov 2026, answers 10 and 21): the ONE confirm-sign-and-pay page. Signs only the steps not yet signed
// with the ONE typed name (reusing signOwnerPiesaConfirmation / signOwnerConsent, never duplicating them), sends the signed
// ESC consent copy to the owner AT ONCE when this call signed it (answer 10 — never held for a bank transfer), then returns
// the card checkout or the bank lines. Every dependency is injectable so the orchestration is tested without a database.
import { WorkflowError } from "./workflow.server";
import { confirmSignPayBlockers, piesaResultLabel, type ConfirmSignPayState, clearScreenOpen, clearAction, stepsUnsigned, consentOnlyOpen, withNoDeposit, hasDepositStep, consentOnlyPiesa } from "./confirm-sign-pay.core";
import type { OwnerDeclarations } from "./consent.core";

export type OwnerSessionLike = { jobId: string; userId: string; codeId: string };
export type ConfirmSignPayInput = {
  piesaTick: boolean; consentTicks: [boolean, boolean, boolean, boolean]; typedName: string; method: "card" | "bank";
  authority?: "owner" | "authorised_representative"; returnUrl?: string; ip?: string | null; userAgent?: string | null;
};
export type ConfirmSignPayResult = { checkoutUrl: string } | { bank: string[] } | { paid: true } | { signed: true };

type Who = { jobId: string; userId: string; codeId: string; name: string; authority: "owner" | "authorised_representative"; ip: string | null; userAgent: string | null };
export type ConfirmSignPayDeps = {
  loadState: (jobId: string) => Promise<ConfirmSignPayState>;
  /** Runs the consent blockers + prepares the record BEFORE anything is signed, so a consent problem never leaves a half-signed page. */
  prepareConsent?: (p: Who & { declarations: Required<OwnerDeclarations> }) => Promise<void>;
  signPiesa: (p: { jobId: string; userId: string; codeId: string; fullName: string; signatureName: string; authority: "owner" | "authorised_representative"; confirmed: boolean; ip: string | null; userAgent: string | null }) => Promise<void>;
  signConsent: (p: { jobId: string; userId: string; signatoryName: string; signatureName: string; authorityType: "owner" | "authorised_representative"; declarations: Required<OwnerDeclarations>; ip: string | null; userAgent: string | null }) => Promise<void>;
  /** True when an esc_consent_copy send already exists for the job's current consent. */
  consentCopySent: (jobId: string) => Promise<boolean>;
  sendConsentCopy: (jobId: string) => Promise<void>;
  cardCheckout: (jobId: string, returnUrl: string, actorId: string | null) => Promise<{ url: string } | { blocker: string }>;
  bankLines: (jobId: string) => Promise<string[]>;
};

const DECLARATION_KEYS = ["owner_or_authorised", "details_accurate", "consent_ap_sends", "consent_commission_shares"] as const;

export async function confirmSignPay(jobId: string, session: OwnerSessionLike, i: ConfirmSignPayInput, deps: ConfirmSignPayDeps = realDeps()): Promise<ConfirmSignPayResult> {
  // Same 6-digit code session as every other owner signing, and only for this token's own job.
  if (!session?.codeId) throw new WorkflowError("Please verify with a code first.");
  if (session.jobId !== jobId) throw new WorkflowError("This isn't your job.");
  const state = await deps.loadState(jobId);
  const errs = confirmSignPayBlockers({ piesaTick: i.piesaTick, consentTicks: i.consentTicks, typedName: i.typedName, state });
  if (errs.length) throw new WorkflowError(errs.join(" "));
  const name = i.typedName.trim().replace(/\s+/g, " ");
  const authority = i.authority ?? "owner";
  const ip = i.ip ?? null, userAgent = i.userAgent ?? null;
  const declarations = Object.fromEntries(DECLARATION_KEYS.map((k, n) => [k, i.consentTicks[n] === true])) as Required<OwnerDeclarations>;
  const who: Who = { jobId, userId: session.userId, codeId: session.codeId, name, authority, ip, userAgent };

  if (!state.consent.done) await deps.prepareConsent?.({ ...who, declarations });
  if (!state.piesa.done) await deps.signPiesa({ jobId, userId: session.userId, codeId: session.codeId, fullName: name, signatureName: name, authority, confirmed: true, ip, userAgent });
  if (!state.consent.done) await deps.signConsent({ jobId, userId: session.userId, signatoryName: name, signatureName: name, authorityType: authority, declarations, ip, userAgent });
  // Answer 10: the signed copy goes now, on its own, whenever the consent is signed and no copy has gone yet (the send key dedupes),
  // not only in the call that signed it. Best-effort: the signature is already saved and the executed copy follows later.
  try {
    if (!(await deps.consentCopySent(jobId))) await deps.sendConsentCopy(jobId);
  } catch (e) { console.error("consent copy at signing failed", jobId, e instanceof Error ? e.message : e); }

  if (state.deposit.paid) return { paid: true };
  if (!hasDepositStep(state)) return { signed: true }; // consent-only page: nothing to pay here
  if (i.method === "bank") return { bank: await deps.bankLines(jobId) };
  const r = await deps.cardCheckout(jobId, i.returnUrl ?? "", session.userId);
  if ("blocker" in r) throw new WorkflowError(`${r.blocker} Your signatures are saved — you can pay by bank transfer instead.`);
  return { checkoutUrl: r.url };
}

// ---------- the page's facts ----------
const MEL = "Australia/Melbourne";
const dayMonthOf = (ymd: string) => new Date(`${ymd}T12:00:00+10:00`).toLocaleDateString("en-AU", { day: "numeric", month: "long", timeZone: MEL });
const weekdayOf = (ymd: string) => new Date(`${ymd}T12:00:00+10:00`).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", timeZone: MEL });

export type ConfirmSignPayPage = { state: ConfirmSignPayState; footer: { installer: string; installBy: string } | null; piesaRecordId: string };

/** The clear page's mode for a job, from the My job facts (one rule for the My job read and the page itself):
 *  "clear" = the confirm-and-pay page with its loaded state; "consent_only" = the ESC consent is awaiting the owner but the pay
 *  page would not open (or its state failed to load) — the same page without the deposit step (and without the PIESA step when
 *  there is no PIESA yet); null = neither (the old pay / piesa screens). */
type ConsentRow = { status: string; owner_signed_at?: string | null; premises_address?: string | null; owner_contact?: unknown; snapshot?: unknown };
type PiesaFactsLike = { completedDate: string; electrician: { name: string | null; recName: string | null }; confirmation: unknown; outcome: string; rectificationRequired: boolean; electricianOnInstallDay: boolean };
export async function clearPageMode(jobId: string, facts: Parameters<typeof clearScreenOpen>[0], deps: { hasConfirmation: boolean; loadState?: (jobId: string) => Promise<ConfirmSignPayState>; consent?: (jobId: string) => Promise<ConsentRow | null>; piesaFacts?: (jobId: string) => Promise<PiesaFactsLike | null> } = { hasConfirmation: true }): Promise<{ mode: "clear" | "consent_only" | null; state: ConfirmSignPayState | null }> {
  const load = deps.loadState ?? realLoadState;
  let state: ConfirmSignPayState | null = null;
  let loadError: unknown = null;
  if (deps.hasConfirmation && clearScreenOpen({ ...facts, unsigned: true })) {
    try { state = await load(jobId); } catch (e) { loadError = e; console.error("owner confirm-sign-pay page unavailable, using the old screens", (e as Error).message); }
  }
  const clearOpen = clearAction(state !== null && clearScreenOpen({ ...facts, unsigned: stepsUnsigned(state!) }), state) === "clear";
  if (clearOpen) return { mode: "clear", state };
  const consent = await (deps.consent ?? (async (id: string) => (await import("./consent.server")).currentConsent(id)))(jobId).catch(() => null);
  if (!consentOnlyOpen({ clearOpen, consentAwaitingOwner: consent?.status === "awaiting_owner" })) return { mode: null, state: null };
  // Consent only: use the loaded state when we have it; otherwise load it tolerantly (no PIESA = no PIESA step).
  if (!state && !loadError) { try { state = await load(jobId); } catch (e) { loadError = e; } }
  if (!state) {
    try { state = await consentOnlyState(jobId, consent!, deps.piesaFacts); } catch (e) { console.error("owner consent-only page unavailable", (e as Error).message); return { mode: null, state: null }; }
  }
  return { mode: "consent_only", state: withNoDeposit(state) };
}

/** The consent-only state built from the consent row (used when the full state cannot be loaded, e.g. no PIESA yet). */
async function consentOnlyState(jobId: string, c: ConsentRow, piesaFacts?: (jobId: string) => Promise<PiesaFactsLike | null>): Promise<ConfirmSignPayState> {
  const owner = (c.owner_contact ?? (c.snapshot as { owner?: unknown } | null)?.owner ?? {}) as { name?: string | null; email?: string | null; phone?: string | null };
  let piesa = consentOnlyPiesa();
  try {
    const facts = await (piesaFacts ?? (async (id: string) => (await import("./piesa-owner-confirm.server")).ownerPiesaConfirmFacts(id)))(jobId);
    const { piesaOutcomeKind } = await import("./piesa-owner-confirm.core");
    if (facts) piesa = { checkedOn: dayMonthOf(facts.completedDate), electrician: facts.electrician.name ?? facts.electrician.recName ?? "Your electrician", result: piesaResultLabel(piesaOutcomeKind(facts as never)), done: !!facts.confirmation };
  } catch { /* no PIESA step */ }
  return {
    piesa,
    consent: { name: owner.name ?? "", address: c.premises_address ?? "", phone: owner.phone ?? "", email: owner.email ?? "", done: !!c.owner_signed_at, signedOn: c.owner_signed_at ? new Date(c.owner_signed_at).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric", timeZone: MEL }) : null },
    deposit: { amountCents: 0, paid: false },
  };
}

/** What the page shows. Prepares the owner's ESC consent record (same prepare step as the clear-to-install email) so the form is ready to sign. */
export async function confirmSignPayPage(jobId: string): Promise<ConfirmSignPayPage> {
  const { ownerPiesaConfirmFacts } = await import("./piesa-owner-confirm.server");
  const facts = await ownerPiesaConfirmFacts(jobId).catch(() => null);
  // Fix round 1: the consent-only page (ESC consent awaiting the owner, pay page closed) — same page, no deposit step.
  const pageFacts = await clearPageFacts(jobId, facts);
  const page = await clearPageMode(jobId, pageFacts, { hasConfirmation: !!facts });
  if (page.mode === "consent_only" && page.state) return { state: page.state, footer: null, piesaRecordId: facts?.piesaRecordId ?? "" };
  const state = page.mode === "clear" && page.state ? page.state : await realLoadState(jobId);
  if (!facts) throw new WorkflowError("There's no electrical safety check to confirm yet.");
  const { installDeadline } = await import("./owner-myjob.core");
  const { businessContactForJob } = await import("./owner-contact.server");
  const inst = await businessContactForJob(jobId, "installer").catch(() => null);
  const installer = (inst?.tradingName || inst?.name || "").replace(/^\[TEST PARTNER\]\s*/, "").trim();
  return { state, footer: installer ? { installer, installBy: weekdayOf(installDeadline(facts.completedDate)) } : null, piesaRecordId: facts.piesaRecordId };
}

/** The My job facts the clear page rule needs, read here when the page loads on its own. */
export async function clearPageFacts(jobId: string, facts: Parameters<typeof import("./piesa-owner-confirm.core").piesaOutcomeKind>[0] | null): Promise<Parameters<typeof clearScreenOpen>[0]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: j } = await supabaseAdmin.from("jobs").select("stage").eq("id", jobId).maybeSingle();
  const { jobPaymentView } = await import("./payments.server");
  const { isStepCleared } = await import("./payments.core");
  const pay = await jobPaymentView(jobId).catch(() => null);
  const { piesaOutcomeKind } = await import("./piesa-owner-confirm.core");
  return {
    stage: String(j?.stage ?? ""),
    outcome: facts ? (piesaOutcomeKind(facts) === "all_clear" ? "all_clear" : "upgrades_needed") : null,
    safetyCleared: pay ? isStepCleared(pay.steps, "safety_check") : false,
    depositCleared: pay ? isStepCleared(pay.steps, "install_deposit") : false,
    depositCents: pay?.plan.installDepositCents ?? 0,
  };
}

export async function realLoadState(jobId: string): Promise<ConfirmSignPayState> {
  const { ownerPiesaConfirmFacts } = await import("./piesa-owner-confirm.server");
  const { piesaOutcomeKind } = await import("./piesa-owner-confirm.core");
  const facts = await ownerPiesaConfirmFacts(jobId);
  if (!facts) throw new WorkflowError("There's no electrical safety check to confirm yet.");
  const cs = await import("./consent.server");
  await cs.syncOwnerConsent(jobId, null);
  const c = await cs.currentConsent(jobId);
  if (!c) throw new WorkflowError("Owner and property details are needed to prepare consent.");
  const owner = (c.owner_contact ?? (c.snapshot as { owner?: unknown } | null)?.owner ?? {}) as { name?: string | null; email?: string | null; phone?: string | null };
  const { jobPaymentView } = await import("./payments.server");
  const { isStepCleared } = await import("./payments.core");
  const pay = await jobPaymentView(jobId);
  return {
    piesa: { checkedOn: dayMonthOf(facts.completedDate), electrician: facts.electrician.name ?? facts.electrician.recName ?? "Your electrician", result: piesaResultLabel(piesaOutcomeKind(facts)), done: !!facts.confirmation },
    consent: { name: owner.name ?? "", address: c.premises_address, phone: owner.phone ?? "", email: owner.email ?? "", done: !!c.owner_signed_at, signedOn: c.owner_signed_at ? new Date(c.owner_signed_at).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric", timeZone: MEL }) : null },
    deposit: { amountCents: pay?.plan.installDepositCents ?? 0, paid: pay ? isStepCleared(pay.steps, "install_deposit") : false },
  };
}

/** "View the full form ›": the electrician's filled DEECA PIESA, or the pre-filled consent form. Null = not ready. */
export async function confirmSignPayForm(jobId: string, doc: "piesa" | "consent"): Promise<{ filename: string; base64: string } | null> {
  if (doc === "consent") {
    const f = await (await import("./consent.server")).prefilledEscConsentPdf(jobId);
    return f ? { filename: f.filename, base64: f.content } : null;
  }
  const { data } = await (await import("@/integrations/supabase/client.server")).supabaseAdmin.from("jobs").select("job_number").eq("id", jobId).maybeSingle();
  const { officialPiesaPdf, pdfAttachment } = await import("./official-piesa-pdf.server");
  const p = await officialPiesaPdf(jobId, data?.job_number ?? "");
  if (!p) return null;
  const a = pdfAttachment(p);
  return { filename: a.filename, base64: a.content };
}

function realDeps(): ConfirmSignPayDeps {
  return {
    loadState: realLoadState,
    prepareConsent: async (p) => {
      const { prepareQuoteConsent } = await import("./consent.server");
      await prepareQuoteConsent({ jobId: p.jobId, actorId: p.userId, input: { signatoryName: p.name, authorityType: p.authority, accept: true, signatureName: p.name, declarations: p.declarations } });
    },
    signPiesa: async (p) => { await (await import("./piesa-owner-confirm.server")).signOwnerPiesaConfirmation({ ...p, userId: p.userId, codeId: p.codeId }); },
    signConsent: async (p) => {
      await (await import("./consent.server")).signOwnerConsent({ jobId: p.jobId, actorId: p.userId, input: { signatoryName: p.signatoryName, authorityType: p.authorityType, accept: true, signatureName: p.signatureName, declarations: p.declarations }, ip: p.ip, userAgent: p.userAgent });
    },
    consentCopySent: async (jobId) => {
      const { currentConsent } = await import("./consent.server");
      const c = await currentConsent(jobId);
      if (!c) return false;
      const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
      const { count, error } = await admin.from("customer_email_sends").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("purpose", "esc_consent_copy").like("idempotency_key", `esc-consent-copy:v1:${c.id}:%`);
      if (error) throw new Error(error.message);
      return (count ?? 0) > 0;
    },
    sendConsentCopy: realSendConsentCopy,
    cardCheckout: async (jobId, returnUrl, actorId) => {
      const { jobPaymentView } = await import("./payments.server");
      const v = await jobPaymentView(jobId);
      if (v?.due.step?.key !== "install_deposit") return { blocker: "The deposit isn't ready to pay by card yet." };
      return (await import("./stripe.server")).createStepCheckout(jobId, returnUrl, actorId);
    },
    bankLines: async (jobId) => {
      const { jobPaymentView } = await import("./payments.server");
      const { bankDetailLines } = await import("./payments.core");
      const v = await jobPaymentView(jobId);
      if (!v) throw new WorkflowError("Your deposit invoice isn't ready yet. Please reply to our email.");
      return bankDetailLines(v.bank, v.references.install);
    },
  };
}

/** The owner-signed ESC consent (AP part still to come) emailed through the one guarded path (O63, purpose esc_consent_copy). */
async function realSendConsentCopy(jobId: string) {
  const { currentConsent } = await import("./consent.server");
  const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
  const c = await currentConsent(jobId);
  if (!c?.owner_signed_at || !c.owner_signature_name) return;
  const { renderConsentBody } = await import("./consent.core");
  const { sha256Hex, stableJson } = await import("./assignment.core");
  const { data: tpl } = await admin.from("compliance_templates").select("version, body").eq("template_key", "esc_consent").eq("version", c.template_version ?? "").maybeSingle();
  const facts = c.snapshot as unknown as import("./consent.core").ConsentFacts;
  const declarations = (c.owner_declarations ?? null) as OwnerDeclarations | null;
  const formText = renderConsentBody({ version: c.template_version, body: tpl?.body ?? "", facts: { owner: facts.owner, premises_address: c.premises_address, installation_days: [] }, owner: { signatureName: c.owner_signature_name, signedAt: c.owner_signed_at, declarations }, ap: null });
  const sha = await sha256Hex(stableJson({ consent: c.id, owner: { name: c.owner_signature_name, at: c.owner_signed_at, declarations } }));
  let pdf: Uint8Array | null = null;
  const { PDF_LOOK_APPROVED } = await import("./pdf-approvals.core");
  if (PDF_LOOK_APPROVED.escConsent) {
    try {
      const { escConsentPdf } = await import("./consent-pdf.server");
      const r = await escConsentPdf({ ...facts, premises_address: c.premises_address }, { owner: { name: c.owner_signature_name, at: c.owner_signed_at } }, {});
      if (!r.layout.split.length) pdf = r.bytes;
    } catch { /* the form text in the email body still goes */ }
  }
  const { emailOwnerConsentCopy } = await import("./consent-copy-email.server");
  const result = await emailOwnerConsentCopy({ jobId, consentId: c.id, sha256: sha, templateVersion: c.template_version ?? "", installationDays: [], address: c.premises_address, formText, copyPath: null, pdf });
  const { logEvent } = await import("./workflow.server");
  await logEvent(jobId, null, "esc_consent_copy_email", `Owner ESC consent copy email (sent when the owner signed): ${result}`, { consent_id: c.id }, { internal: true });
}
