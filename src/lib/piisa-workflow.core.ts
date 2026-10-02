// Pure PIISA installation-day gate. No I/O. Used by stageEntryBlockers("evidence_outstanding") and the office panel.
// PIISA is due on installation day immediately before work starts; work progression is blocked until the current
// signed PIISA passes every printed rule, matches current material job facts and the forms are approved for use.
import {
  answersFromDocument, evaluatePiesa, evaluatePiisa, officialFormUseBlocker, snapshotProblems,
  type HazardResolution, type SignedSnapshot,
} from "./official-forms.core";

export type StoredCopy = { id: string; status: "current" | "superseded" | "invalidated"; signatureDate: string; snapshot: SignedSnapshot };

/** Facts whose change makes a signed PIISA stale (legally material to the installer assessment). */
export const PIISA_MATERIAL_FACTS = ["installDate", "lifeSupport", "leadInstallerId", "piesaCopyId", "piesaCompletionDate", "existingInsulation"] as const;
export type MaterialFacts = Partial<Record<(typeof PIISA_MATERIAL_FACTS)[number], string>>;

export type PiisaGateInput = {
  today: string; // YYYY-MM-DD (Melbourne)
  installDate: string | null;
  piisa: StoredCopy | null;
  piesa: StoredCopy | null;
  facts: MaterialFacts;
  piesaReceivedAt: string | null;
  conductiveExistingInsulation: boolean | null;
  conductivityEvidence: string | null;
  hazardResolution: HazardResolution;
  /** Override for tests only; defaults to the real fail-closed form-use check. */
  formUse?: { piesa: string | null; piisa: string | null };
  storageUnavailable?: boolean;
};
export type PiisaPanel = {
  responsible: "installer" | "electrician" | "office";
  due: "not_scheduled" | "due_on_installation_day" | "due_today" | "overdue" | "passed" | "stale" | "blocked";
  nextAction: string;
  blockers: string[];
  confirmations: string[];
};

export function staleFacts(signed: Record<string, string>, current: MaterialFacts): string[] {
  return PIISA_MATERIAL_FACTS.filter((k) => (current[k] ?? "") !== (signed[k] ?? ""));
}

export function piisaGate(i: PiisaGateInput): PiisaPanel {
  const blockers: string[] = [], confirmations: string[] = [];
  const formUse = i.formUse ?? { piesa: officialFormUseBlocker("piesa"), piisa: officialFormUseBlocker("piisa") };
  if (i.storageUnavailable) return { responsible: "office", due: "blocked", nextAction: "Signed-copy storage isn't set up yet, so installation can't be recorded.", blockers: ["PIISA: signed-copy storage is not available."], confirmations };
  if (formUse.piisa) blockers.push(`PIISA: ${formUse.piisa}`);
  if (!i.installDate) return { responsible: "office", due: "not_scheduled", nextAction: "Confirm the installation date.", blockers: [...blockers, "PIISA: no confirmed installation date."], confirmations };

  // PIESA hazard state flows through to installation (rule A).
  if (i.piesa?.status === "current") {
    const pe = evaluatePiesa(answersFromDocument(i.piesa.snapshot.document), { hazardResolution: i.hazardResolution });
    const h = pe.blockers.find((b) => b.rule === "P7-NOT-EFFECTIVE");
    if (h) { blockers.push(h.message); confirmations.push("P7-NOT-EFFECTIVE"); }
  }

  const due = (): PiisaPanel["due"] => (i.today < i.installDate! ? "due_on_installation_day" : i.today === i.installDate ? "due_today" : "overdue");
  if (!i.piisa || i.piisa.status !== "current") {
    blockers.push("PIISA: no current signed installer safety assessment for this installation.");
    return { responsible: "installer", due: due(), nextAction: "Lead installer completes and signs the PIISA on installation day, immediately before work starts.", blockers, confirmations };
  }

  const snapIssues = snapshotProblems(i.piisa.snapshot);
  const stale = staleFacts(i.piisa.snapshot.jobFacts, i.facts);
  if (snapIssues.length || stale.length) {
    blockers.push(...snapIssues.map((p) => `PIISA: ${p}`), ...stale.map((k) => `PIISA is stale: ${k} changed after signing.`));
    return { responsible: "installer", due: "stale", nextAction: "Signed PIISA no longer matches the job. Office invalidates it; lead installer completes a new PIISA before work starts.", blockers, confirmations };
  }
  if (i.piisa.signatureDate !== i.installDate) blockers.push(`PIISA: signed ${i.piisa.signatureDate}, but it must be completed on the installation day (${i.installDate}).`);

  const ev = evaluatePiisa(answersFromDocument(i.piisa.snapshot.document), {
    piesaCompletionDate: i.facts.piesaCompletionDate ?? null,
    piesaReceivedAt: i.piesaReceivedAt,
    electricianRequiredAtStart: electricianRequired(i.piesa),
    conductiveExistingInsulation: i.conductiveExistingInsulation,
    conductivityEvidence: i.conductivityEvidence,
  });
  for (const b of ev.blockers) { blockers.push(`PIISA: ${b.message}`); if (b.confirmation) confirmations.push(b.rule); }
  const electrician = ev.blockers.some((b) => b.rule === "ELECTRICIAN-AT-START") || ev.nextActions.some((n) => n.rule === "P4-ELECTRICIAN");
  if (blockers.length) {
    return {
      responsible: electrician ? "electrician" : confirmations.length ? "office" : "installer", due: "blocked", blockers, confirmations,
      nextAction: electrician ? "Arrange an electrician to be present at the start of the installation, then the installer records it on the PIISA." : confirmations.length ? "Office/electrical review required before work can start." : "Lead installer corrects the PIISA before work starts.",
    };
  }
  return { responsible: "installer", due: "passed", nextAction: "PIISA passed — work may start.", blockers: [], confirmations };
}

/** PIESA B1 "not possible" requires an electrician present at the start. */
function electricianRequired(piesa: StoredCopy | null): boolean {
  if (!piesa || piesa.status !== "current") return false;
  return evaluatePiesa(answersFromDocument(piesa.snapshot.document)).nextActions.some((n) => n.rule === "B1-ELECTRICIAN-AT-START");
}
