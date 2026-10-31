// Owner paperwork gates A–D. Pure: one catalogue + one evaluator shared by every journey (web, installer single, bulk J1, bulk J2).
// Wording that Jo has not approved is a clearly marked DRAFT slot: usable on TEST jobs only, blocks real jobs.

export type Gate = "A" | "B" | "C" | "D";
export const GATE_LABEL: Record<Gate, string> = {
  A: "Before any visit",
  B: "At quote acceptance",
  C: "Before install",
  D: "After install",
};

/** Documents the owner signs through this module (typed name + tick). Existing systems own agreement / ESC / VEEC assignment. */
export type GateDocKey =
  | "contact_privacy"
  | "trade_contact_share"
  | "details_confirmation"
  | "life_support_answer"
  | "tenancy_details"
  | "landlord_consent"
  | "visit_permission"
  | "cooling_off_notice"
  | "payment_terms"
  | "veec_assignment_consent"
  | "quote_acceptance"
  | "life_support_plan"
  | "piesa_copy_receipt"
  | "piesa_owner_declaration";

export type GateDoc = {
  key: GateDocKey;
  gate: Gate;
  title: string;
  version: string;
  body: string;
  signer: "owner" | "office";
  tick: string;
  draftNote?: string;
  approvalNote?: string;
};

const DRAFT = "DRAFT — wording pending Jo's approval. Not for use on real jobs.";

/** Decision 365: the payment steps exactly as `paymentPlan()` charges them (payments.core, decisions 139/140/141/302).
 *  {fee} = the quote's PIESA line, {deposit} = 10% of {remaining} (= total − fee), {balance} = the rest, {total} = quote
 *  total after the VEU discount. Amounts always come from the server, never from owner answers. */
export const PAYMENT_TERMS_VERSION = "steps-2026-11-01";
export const PAYMENT_TERMS_BODY = [
  "How I'll pay for this job. My install invoice is {total} inc GST, and there is no card fee.",
  "1. Safety check: {fee} for the Pre Insulation Electrical Safety Assessment (PIESA), now that I accept, by card or bank transfer. I understand it's non-refundable once the PIESA is done, even if it finds the job can't go ahead.",
  "2. Electrical upgrades, only if the electrician finds they're needed: I'll see the price first, and if I approve them I pay for the electrical upgrades in full then, on their own invoice, by card or bank transfer.",
  "3. Install deposit: {deposit} (10% of the remaining {remaining}) to book my install day, by card, bank transfer or PayID.",
  "4. Balance: {balance} on install day, by bank transfer or PayID.",
  "I can pay whatever is left at any time by bank transfer or PayID.",
].join("\n\n");

/** Placeholder bodies are deliberately marked DRAFT; never present them as approved wording. {placeholders} are filled at signing. */
export const PAPERWORK_V = "2026-10-06-v1";
export const PAPERWORK_APPROVAL_NOTE = "Approved by Jo, 6 Oct 2026";
const L = { version: PAPERWORK_V, approvalNote: PAPERWORK_APPROVAL_NOTE } as const;

/** Approved wording is loaded verbatim (Jo, 6 Oct 2026). {placeholders} are filled at signing; [brackets] are links. */
export const GATE_DOCS: GateDoc[] = [
  {
    key: "contact_privacy",
    gate: "A",
    title: "Contact and privacy",
    ...L,
    signer: "owner",
    tick: "I agree",
    body: "I agree to Home Insulation Victoria (DC Construction Solutions Pty Ltd) contacting me by phone, text and email about my ceiling insulation upgrade. I have read the [Privacy Notice] and the [VEU Scheme Participant Privacy Collection Notice].",
  },
  {
    key: "trade_contact_share",
    gate: "A",
    title: "Sharing with your tradies",
    ...L,
    signer: "owner",
    tick: "I agree",
    body: "I agree to Home Insulation Victoria sharing my name, address, phone and email with the installer and licensed electrician assigned to my job, for this job only.",
  },
  {
    key: "details_confirmation",
    gate: "A",
    title: "Who owns the home",
    ...L,
    signer: "owner",
    tick: "That's right",
    body: "Who owns the home?\nI own it / I'm a tenant / I'm buying it / Other\nAnswer: {role}",
  },
  {
    key: "life_support_answer",
    gate: "A",
    title: "Life support",
    ...L,
    signer: "owner",
    tick: "That's right",
    body: "Does anyone at the property rely on life support equipment that needs electricity? Yes / No\nAnswer: {life_support}",
  },
  {
    key: "tenancy_details",
    gate: "B",
    title: "Your landlord or agent",
    ...L,
    signer: "owner",
    tick: "That's right",
    body: "Landlord or agent's name: {landlord_name}\nPhone: {landlord_phone}\nEmail: {landlord_email}\nWe'll ask your landlord to agree before any work is booked.",
  },
  {
    key: "landlord_consent",
    gate: "B",
    title: "Landlord consent",
    ...L,
    signer: "office",
    tick: "Landlord consent received",
    body: "I am the owner (or authorised agent) of {address}. I agree to ceiling insulation being installed under the Victorian Energy Upgrades program, arranged by Home Insulation Victoria, and to the electrical safety check and installation visits needed.",
  },
  {
    key: "visit_permission",
    gate: "B",
    title: "Earlier visit",
    ...L,
    signer: "owner",
    tick: "I confirm",
    body: "I confirm {installer} visited my home on or around {visit_date} with my permission, and I'm happy for Home Insulation Victoria to use what they measured.",
  },
  {
    key: "quote_acceptance",
    gate: "B",
    title: "The agreement",
    ...L,
    signer: "owner",
    tick: "I accept",
    body: "I accept this quote (version {quote_version}, {total} inc GST after the VEU discount) and the [Customer Agreement] with DC Construction Solutions Pty Ltd trading as Home Insulation Victoria.\n\nI am the owner of the property, or I have the owner's authority to sign. I am 18 or older.",
  },
  {
    key: "veec_assignment_consent",
    gate: "B",
    title: "Your rebate (VEEC assignment)",
    ...L,
    signer: "owner",
    tick: "I assign my VEECs",
    body: "I assign to DC Construction Solutions Pty Ltd trading as Home Insulation Victoria the right to create all Victorian energy efficiency certificates (VEECs) for this Activity 48 ceiling insulation upgrade at {address}. I understand this assignment takes effect only once the work has been done. If the installer, product, installed area, VEU discount, scope or price changes, I'll be asked to reconfirm. I'll receive a copy of the completed form after install.",
  },
  // PENDING: two cooling-off variants await Jo's answer. Stays DRAFT and blocks real jobs.
  {
    key: "cooling_off_notice",
    gate: "B",
    title: "Cooling-off",
    version: "pending-jo-variants",
    draftNote: "Pending — awaiting Jo's choice of variant",
    signer: "owner",
    tick: "I have read this",
    body: `${DRAFT}\n\nCooling-off wording pending Jo's choice between two variants.`,
  },
  // Decision 365 (Jo 25 Oct 2026, "Yes, replace it"): ONE plain statement of the real payment steps (paymentPlan) replaces
  // the retired 50/50 instalment choice of "jo-2026-10-21" (signed copies keep their stored text as history). No option is
  // chosen. New wording = NEW version, so it stays unapproved (DRAFT: TEST jobs only) until Jo approves it in Settings ›
  // Owner paperwork (owner_paperwork_approvals row for this exact version + body). Draft copy:
  // docs/templates/owner/owner-payment-terms-steps-2026-10-29b.md.
  {
    key: "payment_terms",
    gate: "B",
    title: "Payment",
    version: PAYMENT_TERMS_VERSION,
    signer: "owner",
    tick: "I agree",
    body: PAYMENT_TERMS_BODY,
  },
  {
    key: "piesa_copy_receipt",
    gate: "C",
    title: "Your safety check copy",
    ...L,
    signer: "owner",
    tick: "I have received it",
    body: "I have received a copy of the signed electrical safety check (PIESA) for my home. [View my copy]",
  },
  {
    key: "life_support_plan",
    gate: "C",
    title: "Life support plan",
    ...L,
    signer: "owner",
    tick: "I have uploaded it",
    body: "I have uploaded my medical or life support plan, or written consent for the power to be switched off during work. [Upload]",
  },
  {
    key: "piesa_owner_declaration",
    gate: "C",
    title: "Safety check owner declaration (Mitti)",
    version: "draft-1",
    signer: "owner",
    tick: "I declare",
    body: `${DRAFT}\n\nCompleted in the Mitti PIESA form once the form mapping is approved.`,
  },
];

/** Approved screen copy (version PAPERWORK_V). Presentation only. */
export const PAPERWORK_SCREENS = {
  A: {
    heading: "Before we book anyone in",
    button: "Confirm and continue",
    tenantNote: "We'll ask your landlord to agree before any work is booked.",
    lifeSupportYes:
      "We'll need to plan around power being switched off during the safety check. We'll contact you before booking.",
    ownership: [
      ["owner", "I own it"],
      ["tenant", "I'm a tenant"],
      ["buying", "I'm buying it"],
      ["other", "Other"],
    ] as [string, string][],
  },
  B: {
    heading: "Ready to go ahead?",
    button: "Sign and accept",
    rights:
      "I have read the [ESC Consumer Statement of Rights for the Victorian Energy Upgrades program]. I understand I can take time to read this agreement and ask questions, and I have not been pressured to sign.",
    next: [
      "We'll book a licensed electrician for the safety check. If they find anything that must be fixed, we'll show you the price and wait for your OK. Nothing extra happens without your approval.",
      "Before your install day we'll ask you to sign a short consent to share details with the Essential Services Commission. After your install, we'll send you a copy of your completed rebate form.",
    ],
  },
  C: {
    heading: "One last thing before install day",
    button: "Sign",
    esc: [
      "I give written consent to DC Construction Solutions Pty Ltd trading as Home Insulation Victoria, as the Accredited Person for my ceiling insulation upgrade, to send the Essential Services Commission my install day(s) ({dates}), my property address, my contact details and any other details the Commission requires.",
      "I also consent to the Commission sharing that information with WorkSafe Victoria and Energy Safe Victoria for safety and compliance checks.",
    ],
    remember: [
      "Please don't go into the roof space before install day. It can affect the safety check.",
      "Make sure we can get to your manhole.",
    ],
  },
  D: {
    done: "All done! Here's a copy of your completed rebate form. Keep it with your home records.",
    changed: "Something changed after you agreed: {list}. Please check and reconfirm.",
    button: "Reconfirm",
  },
  sign: {
    heading: "Let's check it's you",
    sent: "We've texted a 6-digit code to {masked}.",
    codeLabel: "Enter code",
    email: "Didn't get it? Send to my email instead",
    name: "Type your full name to sign",
    signed: "Signed. We've emailed you a copy.",
  },
} as const;

export const gateDoc = (k: GateDocKey) => GATE_DOCS.find((d) => d.key === k)!;

/** Money for the payment statement (decision 365), formatted from `paymentPlan()` cents. */
export type PaymentMoney = {
  fee: string;
  deposit: string;
  remaining: string;
  balance: string;
  total: string;
};
const MONEY_KEYS = ["fee", "deposit", "remaining", "balance", "total", "half", "half2"] as const;
const audC = (c: number) =>
  `$${(c / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export function paymentTermsMoney(plan: {
  quoteTotalCents: number;
  safetyCheckCents: number;
  installDepositCents: number;
  balanceCents: number;
}): PaymentMoney {
  return {
    fee: audC(plan.safetyCheckCents),
    deposit: audC(plan.installDepositCents),
    remaining: audC(plan.quoteTotalCents - plan.safetyCheckCents),
    balance: audC(plan.balanceCents),
    total: audC(plan.quoteTotalCents),
  };
}
/** The exact payment statement the owner signs (no choice to make). */
export const paymentTermsText = (m: PaymentMoney) => fillTemplate(PAYMENT_TERMS_BODY, m);
/** Human labels for the owner's answers, merged into the signed text. Money placeholders are server-only: an answer can
 *  never set them (the server's figures are applied last). */
export function answerVars(
  a: Record<string, string>,
  money?: PaymentMoney,
): Record<string, string> {
  const own = Object.fromEntries(PAPERWORK_SCREENS.A.ownership);
  const out: Record<string, string> = { ...a };
  if (a["role"]) out["role"] = own[a["role"]] ?? a["role"];
  if (a["life_support"]) out["life_support"] = a["life_support"] === "yes" ? "Yes" : "No";
  for (const k of MONEY_KEYS) delete out[k];
  delete out["payment_option"]; // decision 365: no option is chosen any more
  if (money) Object.assign(out, money);
  return out;
}

export function fillTemplate(
  body: string,
  vars: Record<string, string | null | undefined>,
): string {
  return body.replace(/\{(\w+)\}/g, (_, k: string) => (vars[k] ?? "").toString().trim() || "—");
}

/** The quote acceptance line may only be shown when both the real quote version and inc-GST total are known. */
export function quoteAcceptanceReady(vars: Record<string, string | null | undefined>): boolean {
  return !!String(vars["quote_version"] ?? "").trim() && /\$\d/.test(String(vars["total"] ?? ""));
}

export type Signed = { key: string; version: string; draft: boolean };
/** Only the saved attendance answer describes an earlier visit. Unknown stays unknown. */
export function installerVisitFromSiteCheck(siteCheck: unknown): boolean | null {
  return siteCheck === "yes" ? true : siteCheck === "no" ? false : null;
}

export type GateFacts = {
  isTest: boolean;
  signed: Signed[];
  /** Approved catalogue versions (key -> version). */
  approved: Record<string, string>;
  tenant: boolean;
  lifeSupport: boolean;
  visitedByInstaller: boolean | null; // null is an unanswered visit, never inferred from quote/files
  hasQuote: boolean;
  /** Existing systems. */
  agreementSigned: boolean;
  agreementWordingApproved: boolean;
  escConsentSigned: boolean;
  piesaCopyDelivered: boolean;
  piesaDeclarationMappingApproved: boolean;
  assignmentEffective: boolean;
  /** Jo 8 Oct: on-site consent (owner ticked on the installer's phone, or installer confirmed) clears Gate A. */
  onsiteConsent?: boolean;
  /** A48 batch 1 final fix (Jo 29 Oct): the life support consent / plan is on file — the owner's upload on My job or the
   *  office record. Replaces the owner's "I have uploaded it" tick. */
  lifeSupportPlanOnFile?: boolean;
};

export type GateItem = {
  key: string;
  label: string;
  done: boolean;
  draft: boolean;
  note?: string | undefined;
};
export type GateResult = {
  gate: Gate;
  label: string;
  items: GateItem[];
  complete: boolean;
  blockers: string[];
};

function docItem(f: GateFacts, k: GateDocKey): GateItem {
  const d = gateDoc(k);
  const s = f.signed.filter((x) => x.key === k).at(-1);
  const approvedNow = f.approved[k] === d.version;
  return {
    key: k,
    label: d.title,
    done: !!s,
    draft: s ? s.draft : !approvedNow,
    note: d.signer === "office" ? "Office records" : undefined,
  };
}

/** Retired 21 Oct (Jo): hidden everywhere; signed copies stay as history. Retired 29 Oct (Jo, A48 batch 1 final fix): the
 *  life support plan "I have uploaded it" tick — the owner uploads the file on My job instead. */
export const RETIRED_DOC_KEYS: ReadonlySet<string> = new Set([
  "contact_privacy",
  "trade_contact_share",
  "details_confirmation",
  "life_support_answer",
  "cooling_off_notice",
  "life_support_plan",
]);

export function evaluateOwnerGates(f: GateFacts): GateResult[] {
  // Jo 21 Oct: Gate A is no longer required before any visit (contact consent and life support come from the enquiry form,
  // ownership is in Gate B). Its tenancy and earlier-visit items moved to Gate B; stored Gate A signatures are kept as history.
  const A: GateItem[] = [];

  const B: GateItem[] = [
    {
      key: "customer_agreement",
      label: "Customer agreement + consumer rights",
      done: f.agreementSigned,
      draft: !f.agreementWordingApproved,
    },
    docItem(f, "quote_acceptance"),
    docItem(f, "veec_assignment_consent"),
    docItem(f, "payment_terms"),
  ];
  // Jo 6 Oct: no cooling-off period (all customers come through the website) — cooling_off_notice is not required.
  if (f.tenant) B.push(docItem(f, "tenancy_details"), docItem(f, "landlord_consent"));
  if (f.visitedByInstaller) B.push(docItem(f, "visit_permission"));
  const C: GateItem[] = [
    {
      key: "esc_consent",
      label: "ESC information-sharing consent (Reg 23A)",
      done: f.escConsentSigned,
      draft: false,
    },
    { key: "piesa_copy", label: "PIESA copy delivered", done: f.piesaCopyDelivered, draft: false },
    docItem(f, "piesa_copy_receipt"),
  ];
  // A48 batch 1 final fix (Jo 29 Oct): done by the owner's upload or the office record — the tick no longer counts.
  if (f.lifeSupport)
    C.push({
      key: "life_support_plan",
      label: gateDoc("life_support_plan").title,
      done: !!f.lifeSupportPlanOnFile,
      draft: false,
      note: "Owner upload or office record",
    });
  if (f.piesaDeclarationMappingApproved) C.push(docItem(f, "piesa_owner_declaration"));
  // Gate D: the completed official form, made effective from the Gate B assignment (owner re-signs only on material change or if the setting requires it).
  const D: GateItem[] = [
    {
      key: "veec_assignment",
      label: "Completed VEEC assignment form (effective after install)",
      done: f.assignmentEffective,
      draft: false,
    },
  ];

  return (
    [
      ["A", A],
      ["B", B],
      ["C", C],
      ["D", D],
    ] as [Gate, GateItem[]][]
  ).map(([gate, items]) => {
    const blockers: string[] = [];
    for (const i of items) {
      const b = gateItemBlocker(gate, i, !!f.isTest);
      if (b) blockers.push(b);
    }
    return { gate, label: GATE_LABEL[gate], items, complete: blockers.length === 0, blockers };
  });
}

/** One gate item's blocker (null = done). The rule evaluateOwnerGates applies to every item. */
export function gateItemBlocker(gate: Gate, i: GateItem, isTest: boolean): string | null {
  if (!i.done)
    return `Owner paperwork ${gate}: ${i.label} not ${i.note ? "recorded" : "signed"} yet.`;
  if (i.draft && !isTest)
    return `Owner paperwork ${gate}: ${i.label} was signed on DRAFT wording — real jobs need Jo-approved wording.`;
  return null;
}

/** Decision 395: the owner's Gate C "Your safety check copy" receipt ("I have received it") — the same item and wording
 *  Installation complete checks (Gate C), now also part of the day-before pre-start check. */
export const piesaCopyReceiptBlocker = (f: GateFacts): string | null =>
  gateItemBlocker("C", docItem(f, "piesa_copy_receipt"), !!f.isTest);

/** Which gates must be complete before entering a stage. */
const ACCEPTED = [
  "awaiting_deposit_payment",
  "rectification_scheduling",
  "rectification_booked",
  "installation_scheduling",
  "installation_booked",
  "piesa_and_install_window_pending",
  "piesa_scheduled",
  "evidence_outstanding",
];
export function gatesForStage(to: string): Gate[] {
  const g: Gate[] = [];
  if (ACCEPTED.includes(to)) g.push("B");
  if (to === "evidence_outstanding") g.push("C");
  if (["ready_for_veec", "complete"].includes(to)) g.push("B", "C", "D");
  return g;
}

export function ownerGateBlockers(results: GateResult[], to: string): string[] {
  const need = new Set(gatesForStage(to));
  return results.filter((r) => need.has(r.gate)).flatMap((r) => r.blockers);
}

/** Gates the job's current stage already depends on and that are not complete — Needs me shows these. */
export function blockedGateNow(results: GateResult[], stage: string): GateResult | null {
  const need = new Set(gatesForStage(stage));
  return results.find((r) => need.has(r.gate) && !r.complete) ?? null;
}

/** Gates the owner can sign right now (unsigned owner docs, in gate order, only up to the first incomplete gate that has owner docs). */
export function ownerToSign(results: GateResult[]): { gate: Gate; key: GateDocKey }[] {
  const keys = new Set(
    GATE_DOCS.filter((d) => d.signer === "owner" && !RETIRED_DOC_KEYS.has(d.key)).map(
      (d) => d.key as string,
    ),
  );
  return results
    .flatMap((r) =>
      r.items
        .filter((i) => !i.done && keys.has(i.key) && i.key !== "piesa_owner_declaration")
        .map((i) => ({ gate: r.gate, key: i.key as GateDocKey })),
    )
    .filter((x) => x.gate === "A" || x.gate === "B" || x.gate === "C");
}
