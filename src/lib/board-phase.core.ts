// Jo 9 Oct: "the pipeline is still wrong and has people in ready check". The board column comes from the
// facts-based office classifier (officeStatus), never from the stored stage alone. Presentation only.
import type { OfficeStage } from "./office-status.core";
import { phaseForStage, type Phase } from "./workflow";

/** Board column for a job. `office` is the classifier's stage; undefined = facts not loaded yet (null = not shown yet). */
export function boardPhase(stored: string | null | undefined, office: OfficeStage | null | undefined): Phase | null {
  const legacy = phaseForStage(stored as Parameters<typeof phaseForStage>[0]);
  if (office === undefined) return legacy === "ready_check" ? null : legacy;
  switch (office) {
    case "waiting_list": case "enquiry": return "enquiries";
    case "ready_check": return "ready_check";
    case "quote": return legacy === "deposit" || legacy === "quote_approval" ? legacy : "quote_approval";
    case null: return legacy === "ready_check" ? "exceptions" : legacy;
    default: return legacy === "ready_check" || legacy === "enquiries" ? "exceptions" : legacy;
  }
}
