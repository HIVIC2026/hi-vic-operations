// Isolated Add job fixture: every server call is a stub (no writes, sends, Mitti or address lookups).
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AddJobFlow } from "../src/components/trade/add-job-flow";
import "../src/styles.css";
const q = new URLSearchParams(location.search);
const mode = (q.get("mode") ?? "onsite") as "onsite" | "later" | "existing";
const scenario = q.get("s") ?? "open";
const state = scenario === "open" ? { kind: "open", url: "#mitti-stub" } : scenario === "preparing" ? { kind: "preparing", message: "Getting your form ready…" } : { kind: "retry", message: "Your Mitti login isn't linked yet. Home Insulation Victoria has been told — the job is saved." };
(globalThis as { __mockData?: Record<string, unknown> }).__mockData = {
  bulkElectricianChoices: { approved: [{ businessId: "el-1", name: "TEST Sparky", status: "approved", primary: true }], pending: [] },
  startOnsiteReadyCheck: scenario === "dup" ? { __throw: 'duplicate key value violates unique constraint "owners_email_uq"', __delay: 400 } : { __delay: 600, value: { jobId: "job-1", jobNumber: "HV-TEST", booking: scenario === "blocked" ? "blocked" : "confirmed", state } },
  createImport: { __delay: 300, value: { id: "imp-1", extracted: { removal_m2: { value: 20, confidence: "uncertain", source: "file" } } } },
  confirmImport: { __delay: 500, value: { jobId: "job-2", jobNumber: "HV-TEST2" } },
  onsiteFormStatus: state,
};
try { localStorage.removeItem("hiv-onsite-draft"); } catch { /* */ }
const root = document.getElementById("root");
if (root) createRoot(root).render(<QueryClientProvider client={new QueryClient()}><div className="portal-theme min-h-screen bg-canvas p-4 text-ink"><div className="mx-auto max-w-lg"><AddJobFlow businessId="biz-test" initialMode={mode} onExit={() => { (globalThis as { __exited?: boolean }).__exited = true; }} /></div></div></QueryClientProvider>);
