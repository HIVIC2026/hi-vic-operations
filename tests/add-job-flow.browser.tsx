// Isolated Add job fixture: every server call is a stub (no writes, sends, Mitti or address lookups).
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AddJobFlow } from "../src/components/trade/add-job-flow";
import "../src/styles.css";
const q = new URLSearchParams(location.search);
const scenario = q.get("s") ?? "open";
const state = scenario === "open" ? { kind: "open", url: "#mitti-stub" } : scenario === "preparing" ? { kind: "preparing", message: "Getting your form ready…" } : { kind: "retry", message: "Your Mitti login isn't linked yet. Home Insulation Victoria has been told — the job is saved." };
(globalThis as { __mockData?: Record<string, unknown> }).__mockData = {
  startOnsiteReadyCheck: scenario === "dup" ? { __throw: 'duplicate key value violates unique constraint "owners_email_uq"', __delay: 400 } : { __delay: 600, value: { jobId: "job-1", jobNumber: "HV-TEST", booking: scenario === "blocked" ? "blocked" : scenario === "visit" ? "confirmed" : "none", formCreation: "scheduled", state } },
  onsiteFormStatus: state,
  // Decision 289: the fixture business has a usual electrician, so "My usual electrician (Sam Lee)" is offered and preselected.
  addJobOptions: { usualElectrician: scenario === "nousual" ? null : { name: "Sam Lee", onboarded: true } },
};
try { localStorage.removeItem("hiv-onsite-draft"); } catch { /* */ }
const root = document.getElementById("root");
if (root) createRoot(root).render(<QueryClientProvider client={new QueryClient()}><div className="portal-theme min-h-screen bg-canvas p-4 text-ink"><div className="mx-auto max-w-lg"><AddJobFlow businessId="biz-test" onExit={() => { (globalThis as { __exited?: boolean }).__exited = true; }} /></div></div></QueryClientProvider>);
