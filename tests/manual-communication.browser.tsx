// STEP 17 isolated browser fixture: the REAL Office actions (prepare/copy + record outcome) on TEST leads, with sealed
// server answers. The email is the real approved Save your spot renderer fed TEST facts. Never reaches a live service.
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ManualCommunicationActions } from "../src/components/portal/manual-communication";
import { renderStep3SaveSpot } from "../src/lib/step3-emails";
import { GROUP_B_MANUAL_BLOCKED } from "../src/lib/manual-communication.core";
import "../src/styles.css";

const g = globalThis as Record<string, unknown>;
const TOKEN = "T".repeat(43);
const mail = renderStep3SaveSpot({
  estimateUrl: `https://estimate.homeinsulationvictoria.com.au/estimate/${TOKEN}`, campaignUrl: `https://estimate.homeinsulationvictoria.com.au/estimate/${TOKEN}/campaign`,
  unsubscribeUrl: `https://estimate.homeinsulationvictoria.com.au/api/public/unsubscribe?t=${"U".repeat(43)}`,
  estimatedTotal: 1890, veuDiscount: 2100, grossTotal: 3990, areaM2: 120, firstName: "Testy", address: "1 TEST Street, Testville VIC 3000", reference: "HV-TEST-1",
  existingInsulationPresent: false, referralUrl: null, installation: 3292,
});
type Hist = { id: string; at: string; recordedAt: string; direction: string; channel: string; subject: string | null; manual: boolean; originLabel: string; outcomeLabel: string | null; by: string | null; note: string | null };
const history: Record<string, Hist[]> = {
  "lead-a": [{ id: "sys-1", at: "2026-10-09T02:00:00Z", recordedAt: "2026-10-09T02:00:00Z", direction: "outbound", channel: "email", subject: "Earlier portal email (TEST)", manual: false, originLabel: "From the portal · Sent", outcomeLabel: null, by: null, note: null }],
  "lead-b": [],
};
const LABEL: Record<string, string> = { sent_manually: "Sent manually", phoned: "Customer contacted by phone", not_sent: "Not sent", followup_required: "Follow-up required" };
g.__recorded = [];
g.__mockData = {
  prepareManualEmail: (a: { data: { jobId: string } }) => a.data.jobId === "lead-a"
    ? { ok: true, jobId: "lead-a", jobNumber: "HV-TEST-1", template: "save_my_spot", templateLabel: "Save your spot – likely eligible (approved)", to: "testy.owner@example.test", subject: mail.subject, plainText: mail.plainText, html: mail.html, notices: [] }
    : { ok: false, jobId: "lead-b", jobNumber: "HV-TEST-2", reason: GROUP_B_MANUAL_BLOCKED },
  recordManualCommunication: (a: { data: { jobId: string; outcome: string; subject?: string; note?: string } }) => {
    (g.__recorded as unknown[]).push(a.data);
    const at = new Date().toISOString();
    history[a.data.jobId]!.unshift({ id: `m-${Date.now()}`, at, recordedAt: at, direction: a.data.outcome === "sent_manually" ? "outbound" : "internal", channel: a.data.outcome === "sent_manually" ? "email" : a.data.outcome === "phoned" ? "phone" : "note", subject: a.data.subject ?? `Office record: ${LABEL[a.data.outcome]}`, manual: true, originLabel: "Recorded by Office – not sent by the portal", outcomeLabel: LABEL[a.data.outcome] ?? null, by: "TEST office", note: a.data.note ?? null });
    return { id: "m", jobId: a.data.jobId, jobNumber: a.data.jobId === "lead-a" ? "HV-TEST-1" : "HV-TEST-2", outcome: a.data.outcome, label: LABEL[a.data.outcome], recordedAt: at, delivered: false, countsAsOwnerContact: a.data.outcome === "sent_manually" };
  },
  getManualCommunicationHistory: (a: { data: { jobId: string } }) => [...(history[a.data.jobId] ?? [])],
};
g.__expectedMail = { subject: mail.subject, plainText: mail.plainText };

const root = document.getElementById("root");
if (!root) throw new Error("Missing root");
createRoot(root).render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <div className="portal-theme min-h-screen bg-canvas p-4 text-ink">
      <h1 className="font-display text-2xl font-bold">Leads (TEST fixture)</h1>
      <table className="mt-3 w-full text-left text-sm"><tbody className="divide-y">
        <tr data-lead="a"><td className="p-3">TEST Owner A<div className="text-xs">HV-TEST-1 · likely eligible</div></td><td className="p-3">Save my spot email not sent yet<ManualCommunicationActions jobId="lead-a" jobNumber="HV-TEST-1" /></td></tr>
        <tr data-lead="b"><td className="p-3">TEST Owner B<div className="text-xs">HV-TEST-2 · Group B</div></td><td className="p-3">Insulation details email – waiting for Jo to approve its final look<ManualCommunicationActions jobId="lead-b" jobNumber="HV-TEST-2" /></td></tr>
      </tbody></table>
    </div>
  </QueryClientProvider>,
);
