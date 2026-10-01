// Official PIESA/PIISA filling is blocked server-side: the old PDF mapping is superseded and the new
// Word-form mapping isn't approved yet. Kept as the single entry point so the block can't be bypassed.
import { WorkflowError } from "./workflow.server";
import { officialFillBlocker, type OfficialFormKey } from "./official-pdf.core";

export async function fileOfficialPdf(_jobId: string, _actorId: string, key: OfficialFormKey, _answers: Record<string, unknown>): Promise<never> {
  throw new WorkflowError(officialFillBlocker(key));
}
