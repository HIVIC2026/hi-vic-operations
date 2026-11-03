// Part 4 Task 11 (Jo 2 Nov 2026): the ONE sign-and-pay page (?screen=finish). Signs the owner's Section 4 Part B of the official VEEC
// form through the existing signFinalAssignment (the acceptance consent is never the signature, the order guard is the existing one),
// starts the signed-copy email (due within 10 business days; the 15-minute tick retries), then returns the card checkout or the bank
// lines for the BALANCE through the existing invoice/payment guards (createStepCheckout / bankDetailLines). No receipt is made here:
// nothing is marked paid until the money lands. Every dependency is injectable so the orchestration is tested without a database.
import { WorkflowError } from "./workflow.server";
import { signAndPayBlockers, consumerSignBlocker, type SignAndPayState } from "./sign-and-pay.core";
import type { OwnerSessionLike } from "./confirm-sign-pay.server";

export type SignAndPayInput = { tick: boolean; over18: boolean; typedName: string; method: "card" | "bank"; authority?: "owner" | "authorised_representative"; returnUrl?: string; ip?: string | null; userAgent?: string | null };
export type SignAndPayResult = { checkoutUrl: string } | { bank: string[] } | { done: true };

export type SignAndPayDeps = {
  loadState: (jobId: string) => Promise<SignAndPayState>;
  signVeec: (p: { jobId: string; userId: string; signatureName: string; signatoryName: string; authorityType: "owner" | "authorised_representative"; over18: boolean; confirmsSection2: boolean; ip: string | null; userAgent: string | null }) => Promise<void>;
  /** After the signature is saved: advance the job and email the signed copy (best-effort; the tick retries). */
  afterSigned: (jobId: string, userId: string) => Promise<void>;
  cardCheckout: (jobId: string, returnUrl: string, actorId: string | null) => Promise<{ url: string } | { blocker: string }>;
  bankLines: (jobId: string) => Promise<string[]>;
};

export async function signAndPay(jobId: string, session: OwnerSessionLike, i: SignAndPayInput, deps: SignAndPayDeps = realDeps()): Promise<SignAndPayResult> {
  // Same 6-digit code session as every other owner signing, and only for this token's own job.
  if (!session?.codeId) throw new WorkflowError("Please verify with a code first.");
  if (session.jobId !== jobId) throw new WorkflowError("This isn't your job.");
  const state = await deps.loadState(jobId);
  if (!state.sign.done) {
    if (state.sign.blocker) throw new WorkflowError(state.sign.blocker);
    const errs = signAndPayBlockers({ tick: i.tick, over18: i.over18, typedName: i.typedName, state });
    if (errs.length) throw new WorkflowError(errs.join(" "));
    const name = i.typedName.trim().replace(/\s+/g, " ");
    // Two ticks, both required above: the read-and-assign tick (Section 2 confirmation) and P2.tick3 (18 or over, owner or authorised).
    // Each flag is recorded from its own tick, never assumed.
    await deps.signVeec({ jobId, userId: session.userId, signatureName: name, signatoryName: name, authorityType: i.authority ?? "owner", over18: i.over18, confirmsSection2: i.tick, ip: i.ip ?? null, userAgent: i.userAgent ?? null });
    try { await deps.afterSigned(jobId, session.userId); } catch (e) { console.error("after VEEC signing failed", jobId, e instanceof Error ? e.message : e); }
  }
  if (state.balance.paid || !state.balance.payable) return { done: true };
  if (i.method === "bank") return { bank: await deps.bankLines(jobId) };
  const r = await deps.cardCheckout(jobId, i.returnUrl ?? "", session.userId);
  if ("blocker" in r) throw new WorkflowError(`${r.blocker} Your signature is saved — you can pay by bank transfer instead.`);
  return { checkoutUrl: r.url };
}

// ---------- the page's facts ----------
const MEL = "Australia/Melbourne";
const longDate = (iso: string) => new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00+10:00` : iso).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric", timeZone: MEL });

export async function signAndPayState(jobId: string): Promise<SignAndPayState> {
  const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
  const { currentAssignment, veecPreparation } = await import("./assignment.server");
  const a = await currentAssignment(jobId);
  const { data: job } = await admin.from("jobs").select("installation_completed_at").eq("id", jobId).maybeSingle();
  if (!job?.installation_completed_at) throw new WorkflowError("Your install isn't marked complete yet.");
  const facts = (a?.final_facts ?? null) as { form_values?: Record<string, string | number | boolean | null> } | null;
  const v = facts?.form_values ?? (await veecPreparation(jobId)).values;
  const text = (k: string) => (v[k] == null ? "" : String(v[k]).trim());
  const product = [text("area_1_product_brand"), text("area_1_product_model"), text("area_1_product_r_value")].filter(Boolean).join(" ");
  const area = Array.from({ length: 6 }, (_, n) => Number(v[`area_${n + 1}_area_m2`])).filter((x) => Number.isFinite(x) && x > 0).reduce((s, x) => s + x, 0);
  const { data: quotes } = await admin.from("quotes").select("veec_discount_inc_gst").eq("job_id", jobId).eq("status", "accepted").order("created_at", { ascending: false }).limit(1);
  const rebate = Number((quotes?.[0] as { veec_discount_inc_gst?: number | string | null } | undefined)?.veec_discount_inc_gst ?? 0);
  const { count: openVariations } = a ? await admin.from("assignment_variations").select("id", { count: "exact", head: true }).eq("assignment_id", a.id).eq("status", "pending") : { count: 0 };
  const blocker = a?.consumer_signed_at ? null : consumerSignBlocker(a ? { status: a.status as never, installerSigned: !!a.installer_signed_at, apSigned: !!a.ap_signed_at, consumerSigned: !!a.consumer_signed_at, openVariation: (openVariations ?? 0) > 0 } : null);
  const { jobPaymentView } = await import("./payments.server");
  const { isStepCleared } = await import("./payments.core");
  const pay = await jobPaymentView(jobId);
  const balanceStep = pay?.steps.find((s) => s.key === "balance") ?? null;
  return {
    installedOn: text("date_completed") ? longDate(text("date_completed")) : longDate(job.installation_completed_at),
    product: product || "Ceiling insulation", areaM2: area > 0 ? area : null, address: text("installation_address"), rebateCents: Math.round(rebate * 100),
    sign: { done: !!a?.consumer_signed_at, signedOn: a?.consumer_signed_at ? longDate(a.consumer_signed_at) : null, blocker },
    balance: { amountCents: balanceStep?.outstandingCents || (pay?.plan.balanceCents ?? 0), paid: pay && balanceStep ? isStepCleared(pay.steps, "balance") : false, payable: pay?.due.step?.key === "balance" },
  };
}

/** `form` = the official wording as text, for "View the full form" while the new PDF look is not approved (PDF_LOOK_APPROVED.veecForm). */
export type SignAndPayPage = { state: SignAndPayState; form: { rights: string; rows: { label: string; value: string }[]; declarations: string[] } };
export async function signAndPayPage(jobId: string): Promise<SignAndPayPage> {
  const state = await signAndPayState(jobId);
  const F = await import("./veec-assignment-form.core");
  const { currentAssignment, veecPreparation } = await import("./assignment.server");
  const a = await currentAssignment(jobId);
  const facts = (a?.final_facts ?? null) as { form_values?: Record<string, string | number | boolean | null> } | null;
  const values = facts?.form_values ?? (await veecPreparation(jobId)).values;
  return { state, form: { rights: F.SECTION_1_CONSUMER_RIGHTS, rows: F.veecFormRows(values), declarations: [F.AP_DECLARATION, F.INSTALLER_DECLARATION, F.CONSUMER_DECLARATION] } };
}

/** "View the full form (PDF) ›": the official ESC VEEC form with what has been signed so far. Null = not ready (or the new PDF look is not approved yet). */
export async function signAndPayForm(jobId: string): Promise<{ filename: string; base64: string } | null> {
  const { PDF_LOOK_APPROVED } = await import("./pdf-approvals.core");
  if (!PDF_LOOK_APPROVED.veecForm) return null;
  const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
  const [{ currentAssignment, veecPreparation }, { veecFormPdf }, { data: job }] = await Promise.all([import("./assignment.server"), import("./veec-form-pdf.server"), admin.from("jobs").select("job_number").eq("id", jobId).maybeSingle()]);
  const a = await currentAssignment(jobId);
  const facts = (a?.final_facts ?? null) as { form_values?: Record<string, never> } | null;
  const values = facts?.form_values ?? (await veecPreparation(jobId)).values;
  const at = (name: string | null | undefined, when: string | null | undefined) => (name && when ? { name, at: when } : undefined);
  const installer = at(a?.installer_signature_name, a?.installer_signed_at), ap = at(a?.ap_signature_name, a?.ap_signed_at);
  const r = await veecFormPdf(values, a ? { ...(installer ? { installer } : {}), ...(ap ? { ap } : {}) } : null, { jobNumber: job?.job_number ?? null });
  const { bytesToBase64 } = await import("./veec-emails.core");
  return { filename: "Rebate-form-to-read.pdf", base64: bytesToBase64(r.bytes) };
}

function realDeps(): SignAndPayDeps {
  return {
    loadState: signAndPayState,
    signVeec: async (p) => {
      const { signFinalAssignment } = await import("./assignment.server");
      await signFinalAssignment({ jobId: p.jobId, actorId: p.userId, party: "consumer", signatureName: p.signatureName, signatoryName: p.signatoryName, authorityType: p.authorityType, over18: p.over18, confirmsSection2: p.confirmsSection2, ip: p.ip, userAgent: p.userAgent });
    },
    afterSigned: async (jobId, userId) => {
      const { autoAdvanceJob } = await import("./autoadvance.server");
      await autoAdvanceJob(jobId, userId, "owner signed the VEEC assignment form");
      // Executed copy to the owner (within 10 business days): the existing sender; the 15-minute tick retries until sent.
      await (await import("./veec-copy-email.server")).sendVeecCopyEmail(jobId);
    },
    cardCheckout: async (jobId, returnUrl, actorId) => {
      const { jobPaymentView } = await import("./payments.server");
      const v = await jobPaymentView(jobId);
      if (v?.due.step?.key !== "balance") return { blocker: "The balance isn't ready to pay by card yet." };
      return (await import("./stripe.server")).createStepCheckout(jobId, returnUrl, actorId);
    },
    bankLines: async (jobId) => {
      const { jobPaymentView } = await import("./payments.server");
      const { bankDetailLines } = await import("./payments.core");
      const v = await jobPaymentView(jobId);
      if (!v || v.due.step?.key !== "balance") throw new WorkflowError("Your balance invoice isn't ready yet. Please reply to our email.");
      return bankDetailLines(v.bank, v.references.install);
    },
  };
}
