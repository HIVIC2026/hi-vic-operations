// Pure hazard → rectification linkage for PIESA Part 7. No I/O.
// An unresolved hazard (Part 7 action not effective) blocks PIESA completion and installation. Only a current,
// verified rectification record on the SAME job, the SAME signed PIESA and the SAME hazard can clear it. An attempted
// action never clears it. A changed or superseded rectification reopens the blocker automatically.
// Whether the electrical work needs a Certificate of Electrical Safety is recorded explicitly by the verifier
// (never defaulted); when it does, the CES number and the CES evidence are required before clearance.
import { piesaHazards, type HazardResolution, type OfficialAnswers, type PiesaHazard } from "./official-forms.core";

export type RectItem = { id: string; jobId: string; status: string; description: string; quantity: number | string; rateCode: string | null };
export type HazardVerification = {
  id: string; jobId: string; piesaCopyId: string; hazardKey: string; status: "current" | "superseded";
  rectificationItemId: string; rectificationFingerprint: string;
  verifiedBy: string | null; verifiedAt: string | null; evidenceFileIds: string[];
  cesRequired: boolean | null; cesNumber: string | null; cesEvidenceFileId: string | null;
};
export type HazardStatus = { key: string; text: string; resolved: boolean; reason: string; nextAction: string; verificationId: string | null };

/** What the verifier saw. Any later change to the rectification item reopens the hazard. */
export function rectFingerprint(i: Pick<RectItem, "status" | "description" | "quantity" | "rateCode">): string {
  return [i.status, i.description.trim(), Number(i.quantity).toFixed(2), i.rateCode ?? ""].join("|");
}

function check(v: HazardVerification, items: Map<string, RectItem>, jobId: string): string | null {
  const item = items.get(v.rectificationItemId);
  if (!item) return "The linked electrical fixes item no longer exists.";
  if (item.jobId !== jobId) return "The linked electrical fixes item belongs to a different job.";
  if (item.status !== "completed") return "The linked electrical fixes item isn't marked completed.";
  if (rectFingerprint(item) !== v.rectificationFingerprint) return "The electrical fixes item changed after it was verified.";
  if (!v.verifiedBy || !v.verifiedAt) return "The electrical fixes hasn't been verified (who and when).";
  if (v.evidenceFileIds.length === 0) return "No supporting evidence is attached to the verification.";
  if (v.cesRequired === null) return "The verifier hasn't recorded whether a Certificate of Electrical Safety is required.";
  if (v.cesRequired && (!v.cesNumber?.trim() || !v.cesEvidenceFileId)) return "A Certificate of Electrical Safety is required: its number and a copy must be recorded.";
  return null;
}

export function evaluateHazardRectifications(i: {
  jobId: string; piesaCopyId: string; answers: OfficialAnswers; verifications: HazardVerification[]; items: RectItem[];
}): { hazards: HazardStatus[]; resolution: HazardResolution } {
  const items = new Map(i.items.map((x) => [x.id, x]));
  const hazards = piesaHazards(i.answers).map((h: PiesaHazard): HazardStatus => {
    // Only records for this job, this signed PIESA and this hazard count; wrong-job/stale/superseded are ignored.
    const mine = i.verifications.filter((v) => v.status === "current" && v.jobId === i.jobId && v.piesaCopyId === i.piesaCopyId && v.hazardKey === h.key);
    const none = { key: h.key, text: h.text, resolved: false, verificationId: null };
    if (mine.length === 0) return { ...none, reason: "No verified electrical fixes are recorded for this hazard.", nextAction: "Electrician completes the electrical fixes; office verifies it with evidence and links it to this hazard." };
    if (mine.length > 1) return { ...none, reason: "More than one current verification is linked to this hazard.", nextAction: "Office supersedes the duplicate verification." };
    const v = mine[0]!;
    const problem = check(v, items, i.jobId);
    if (problem) return { ...none, verificationId: v.id, reason: problem, nextAction: "Office re-verifies the electrical fixes against the current record and evidence." };
    return { key: h.key, text: h.text, resolved: true, verificationId: v.id, reason: "Verified electrical fixes on record.", nextAction: "None." };
  });
  return { hazards, resolution: { kind: "verified_rectification", resolvedHazards: hazards.filter((h) => h.resolved).map((h) => h.key) } };
}
