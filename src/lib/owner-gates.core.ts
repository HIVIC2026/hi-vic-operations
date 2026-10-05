// Owner paperwork gates A–D. Pure: one catalogue + one evaluator shared by every journey (web, installer single, bulk J1, bulk J2).
// Wording that Jo has not approved is a clearly marked DRAFT slot: usable on TEST jobs only, blocks real jobs.

export type Gate = "A" | "B" | "C" | "D";
export const GATE_LABEL: Record<Gate, string> = {
  A: "Before any visit", B: "At quote acceptance", C: "Before install", D: "After install",
};

/** Documents the owner signs through this module (typed name + tick). Existing systems own agreement / ESC / VEEC assignment. */
export type GateDocKey =
  | "contact_privacy" | "trade_contact_share" | "details_confirmation" | "life_support_answer"
  | "tenancy_details" | "landlord_consent" | "visit_permission"
  | "cooling_off_notice" | "payment_terms"
  | "life_support_plan" | "piesa_owner_declaration";

export type GateDoc = { key: GateDocKey; gate: Gate; title: string; version: string; body: string; signer: "owner" | "office"; tick: string };

const DRAFT = "DRAFT — wording pending Jo's approval. Not for use on real jobs.";

/** Placeholder bodies are deliberately marked DRAFT; never present them as approved wording. {placeholders} are filled at signing. */
export const GATE_DOCS: GateDoc[] = [
  { key: "contact_privacy", gate: "A", title: "Contact and privacy consent", version: "draft-1", signer: "owner", tick: "I agree",
    body: `${DRAFT}\n\nI, {owner}, agree that Home Insulation Victoria may contact me about the insulation upgrade at {address} by phone, text and email, and may collect, store and use my personal information for this job.` },
  { key: "trade_contact_share", gate: "A", title: "Sharing your details with your trades", version: "draft-1", signer: "owner", tick: "I agree",
    body: `${DRAFT}\n\nI agree that Home Insulation Victoria may share my name, address and phone number with the installer and electrician assigned to my job, only so they can arrange and carry out visits.` },
  { key: "details_confirmation", gate: "A", title: "Confirm your details", version: "draft-1", signer: "owner", tick: "These details are correct",
    body: `${DRAFT}\n\nName: {owner}\nAddress: {address}\nMobile: {phone}\nEmail: {email}\nI am the: {role}` },
  { key: "life_support_answer", gate: "A", title: "Life support", version: "draft-1", signer: "owner", tick: "This answer is correct",
    body: `${DRAFT}\n\nDoes anyone at {address} rely on life support equipment that uses electricity? Answer: {life_support}` },
  { key: "tenancy_details", gate: "A", title: "Your landlord", version: "draft-1", signer: "owner", tick: "These details are correct",
    body: `${DRAFT}\n\nI rent {address}. My landlord is {landlord_name}, contact {landlord_contact}.` },
  { key: "landlord_consent", gate: "A", title: "Landlord consent", version: "draft-1", signer: "office", tick: "Landlord consent received",
    body: `${DRAFT}\n\nThe landlord {landlord_name} has given written consent for the insulation upgrade at {address}. Recorded by office.` },
  { key: "visit_permission", gate: "A", title: "Your installer's earlier visit", version: "draft-1", signer: "owner", tick: "I confirm",
    body: `${DRAFT}\n\nI confirm {installer} visited {address} with my permission.` },
  { key: "cooling_off_notice", gate: "B", title: "Cooling-off notice", version: "draft-1", signer: "owner", tick: "I have read this",
    body: `${DRAFT}\n\nCooling-off notice slot. Wording and rules pending legal advice.` },
  { key: "payment_terms", gate: "B", title: "Payment option and terms", version: "draft-1", signer: "owner", tick: "I agree",
    body: `${DRAFT}\n\nI agree to pay using: {payment_option}.` },
  { key: "life_support_plan", gate: "C", title: "Life support plan", version: "draft-1", signer: "owner", tick: "I agree",
    body: `${DRAFT}\n\nI agree to the plan for keeping life support equipment powered during electrical work at {address}.` },
  { key: "piesa_owner_declaration", gate: "C", title: "Safety check owner declaration (Mitti)", version: "draft-1", signer: "owner", tick: "I declare",
    body: `${DRAFT}\n\nCompleted in the Mitti PIESA form once the form mapping is approved.` },
];
export const gateDoc = (k: GateDocKey) => GATE_DOCS.find((d) => d.key === k)!;

export function fillTemplate(body: string, vars: Record<string, string | null | undefined>): string {
  return body.replace(/\{(\w+)\}/g, (_, k: string) => (vars[k] ?? "").toString().trim() || "—");
}

export type Signed = { key: string; version: string; draft: boolean };
export type GateFacts = {
  isTest: boolean;
  signed: Signed[];
  /** Approved catalogue versions (key -> version). */
  approved: Record<string, string>;
  tenant: boolean;
  lifeSupport: boolean;
  visitedByInstaller: boolean;
  hasQuote: boolean;
  /** Existing systems. */
  agreementSigned: boolean;
  agreementWordingApproved: boolean;
  escConsentSigned: boolean;
  piesaCopyDelivered: boolean;
  piesaDeclarationMappingApproved: boolean;
  assignmentEffective: boolean;
};

export type GateItem = { key: string; label: string; done: boolean; draft: boolean; note?: string | undefined };
export type GateResult = { gate: Gate; label: string; items: GateItem[]; complete: boolean; blockers: string[] };

function docItem(f: GateFacts, k: GateDocKey): GateItem {
  const d = gateDoc(k);
  const s = f.signed.filter((x) => x.key === k).at(-1);
  const approvedNow = f.approved[k] === d.version;
  return { key: k, label: d.title, done: !!s, draft: s ? s.draft : !approvedNow, note: d.signer === "office" ? "Office records" : undefined };
}

export function evaluateOwnerGates(f: GateFacts): GateResult[] {
  const A: GateItem[] = (["contact_privacy", "trade_contact_share", "details_confirmation", "life_support_answer"] as GateDocKey[]).map((k) => docItem(f, k));
  if (f.tenant) A.push(docItem(f, "tenancy_details"), docItem(f, "landlord_consent"));
  if (f.visitedByInstaller) A.push(docItem(f, "visit_permission"));

  const B: GateItem[] = [
    { key: "customer_agreement", label: "Customer agreement + consumer rights", done: f.agreementSigned, draft: !f.agreementWordingApproved },
    docItem(f, "cooling_off_notice"), docItem(f, "payment_terms"),
  ];
  const C: GateItem[] = [
    { key: "esc_consent", label: "ESC information-sharing consent (Reg 23A)", done: f.escConsentSigned, draft: false },
    { key: "piesa_copy", label: "Safety check (PIESA) copy delivered", done: f.piesaCopyDelivered, draft: false },
  ];
  if (f.lifeSupport) C.push(docItem(f, "life_support_plan"));
  if (f.piesaDeclarationMappingApproved) C.push(docItem(f, "piesa_owner_declaration"));
  const D: GateItem[] = [{ key: "veec_assignment", label: "Final VEEC assignment", done: f.assignmentEffective, draft: false }];

  return ([["A", A], ["B", B], ["C", C], ["D", D]] as [Gate, GateItem[]][]).map(([gate, items]) => {
    const blockers: string[] = [];
    for (const i of items) {
      if (!i.done) blockers.push(`Owner paperwork ${gate}: ${i.label} not ${i.note ? "recorded" : "signed"} yet.`);
      else if (i.draft && !f.isTest) blockers.push(`Owner paperwork ${gate}: ${i.label} was signed on DRAFT wording — real jobs need Jo-approved wording.`);
    }
    return { gate, label: GATE_LABEL[gate], items, complete: blockers.length === 0, blockers };
  });
}

/** Which gates must be complete before entering a stage. */
const VISIT = ["ready_check_scheduled", "assessment_booked", "piesa_scheduled", "rectification_booked", "installation_booked", "evidence_outstanding"];
const ACCEPTED = ["awaiting_deposit_payment", "rectification_scheduling", "rectification_booked", "installation_scheduling", "installation_booked", "piesa_and_install_window_pending", "piesa_scheduled", "evidence_outstanding"];
export function gatesForStage(to: string): Gate[] {
  const g: Gate[] = [];
  if (VISIT.includes(to) || ACCEPTED.includes(to)) g.push("A");
  if (ACCEPTED.includes(to)) g.push("B");
  if (to === "evidence_outstanding") g.push("C");
  if (["ready_for_veec", "complete"].includes(to)) g.push("A", "B", "C", "D");
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
  const keys = new Set(GATE_DOCS.filter((d) => d.signer === "owner").map((d) => d.key as string));
  return results.flatMap((r) => r.items.filter((i) => !i.done && keys.has(i.key) && i.key !== "piesa_owner_declaration").map((i) => ({ gate: r.gate, key: i.key as GateDocKey })))
    .filter((x) => x.gate === "A" || x.gate === "B" || x.gate === "C");
}
