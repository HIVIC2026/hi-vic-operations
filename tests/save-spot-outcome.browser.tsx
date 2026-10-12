// STEP 56 isolated browser fixture: the REAL Office "Resolve email outcome" control on a TEST lead, with a sealed server
// answer. Never reaches a live service and never sends anything.
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SaveSpotOutcomeResolve } from "../src/components/portal/save-spot-outcome";
import "../src/styles.css";

const g = globalThis as Record<string, unknown>;
g.__resolveArgs = [];
g.__done = 0;
g.__mockData = {
  resolveSaveSpotOutcome: (a: { data: { jobId: string; resolution: string; note: string } }) => {
    (g.__resolveArgs as unknown[]).push(a.data);
    if (a.data.note.includes("race")) throw new Error("This email record changed while you were checking it. Reload and check again.");
    return { ok: true, status: a.data.resolution === "delivered" ? "sent" : "failed" };
  },
};
const unknown = { sendId: "00000000-0000-4000-8000-0000000005e1", kind: "save_my_spot" as const, at: "2026-10-12T00:41:00Z", detail: "sent_unknown: No clear answer from the email service (timed out). https://estimate.homeinsulationvictoria.com.au/api/public/unsubscribe?t=" + "U".repeat(43) };
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={new QueryClient()}>
    <table className="w-full text-sm"><tbody><tr data-lead="u"><td className="p-3">Testy Owner<div className="text-xs">HV-TEST-56</div></td>
      <td className="p-3">Save my spot email outcome unknown – check the email service (Resend) for this address, then resolve it here. Nothing is resent automatically.
        <SaveSpotOutcomeResolve jobId="lead-u" jobNumber="HV-TEST-56" unknown={unknown} onDone={() => { g.__done = (g.__done as number) + 1; }} /></td></tr></tbody></table>
  </QueryClientProvider>,
);
