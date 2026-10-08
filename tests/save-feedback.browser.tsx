// Real form/query components, sealed asynchronous persistence. Never reaches a live service.
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MyIntakeDetailsCard, type IntakeJobFacts } from "../src/components/trade/intake-details-editor";
import { ReadyCheckDraft } from "../src/components/trade/ReadyCheckDraft";
import { InstallerProgressCard } from "../src/components/trade/intake-progress";
import { rcProgress, toObservations, type RcDraftValues } from "../src/lib/ready-check-draft.core";
import "../src/styles.css";
const g = globalThis as Record<string, unknown>;
const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const wait = () => new Promise((r) => setTimeout(r, 900));
const facts = () => ({ applies: true, businessId: "biz-test", areaM2: 112, insulation: "none", quoted: "yes", quoteAnswer: "have_quote", quoteIncGst: 3000, includes: "R5 supply and install", proposedR: 5, files: [{ path: "partners/biz-test/original.pdf", name: "original.pdf", type: "application/pdf" }], electricianChosen: true, quoteHeld: [], electricianPayer: "hivic", feeAwarenessCurrent: true, payerEditable: false, ...JSON.parse(localStorage.getItem("__saved_details") ?? "{}") });
const ready = () => { const values = JSON.parse(localStorage.getItem("__saved_ready") ?? "{}") as RcDraftValues; return { values, progress: rcProgress(toObservations(values).obs, []), status: "draft", prefilled: [], savedAt: null, coordination: "self_managed", commercial: { ready: false, blockers: ["Office review"], releaseBlockers: [] } }; };
g.__mockData = {
  getMyIntakeProgress: () => { if (g.__progressFails) throw new Error("TEST progress read failure"); return { applies: true, steps: [], next: { who: "Home Insulation Victoria", text: `Review current area ${facts().areaM2}; Ready Check ${ready().values["measure.eligible_area_m2"] ?? "not entered"}` } }; },
  getInstallerJourney: () => { throw new Error("Legacy tracker must not load for a failed current read"); },
  getMyIntakeJob: () => facts(),
  saveMyIntakeJob: async (a: { data: IntakeJobFacts & { quoteStatus: string } }) => { await wait(); localStorage.setItem("__saved_details", JSON.stringify({ ...a.data, quoteAnswer: a.data.quoteStatus, files: [...facts().files, ...a.data.files] })); return { quoteHeld: [] }; },
  bulkElectricianChoices: { approved: [], pending: [] },
  partnerUploadUrl: (a: { data: { fileName: string } }) => ({ path: `partners/biz-test/${a.data.fileName}`, token: "sealed" }),
  partnerFileUrl: { url: "data:application/pdf;base64,JVBERi0xLjQKJUVPRgo=" },
  getReadyCheckDraft: async () => { if (g.__loadFails) throw new Error("TEST load failure"); return ready(); },
  saveReadyCheckDraft: async (a: { data: { values: RcDraftValues } }) => { await wait(); if (g.__saveFails) throw new Error("TEST save failure"); localStorage.setItem("__saved_ready", JSON.stringify(a.data.values)); return ready(); },
};
g.__storageUpload = async () => { await wait(); return { error: null }; };
g.__refetchDetails = () => qc.setQueryData(["my-intake-job", "job-fix"], { ...facts(), areaM2: 119 });
g.__retryReady = () => qc.invalidateQueries({ queryKey: ["rc-draft", "job-fix"] });
g.__retryProgress = () => qc.invalidateQueries({ queryKey: ["intake-progress", "job-fix"] });
const root = document.getElementById("root");
if (root) createRoot(root).render(<QueryClientProvider client={qc}><main className="portal-theme min-h-screen space-y-5 bg-canvas px-4 pb-28 pt-4 text-ink"><InstallerProgressCard jobId="job-fix" /><MyIntakeDetailsCard jobId="job-fix" /><ReadyCheckDraft jobId="job-fix" evidence={false} /><nav aria-label="Trade menu" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper pb-[env(safe-area-inset-bottom)] md:hidden"><div className="flex min-h-14 items-center justify-center">My work · Add a job · Money · My business</div></nav></main></QueryClientProvider>);