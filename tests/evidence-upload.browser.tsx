import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EvidencePanel } from "../src/components/portal/panels";
import { FileViewerHost } from "../src/components/portal/file-viewer";
import "../src/styles.css";
const g = globalThis as any;
const req = { id: "req", label: "TEST ceiling measurement", category: "measurement", status: "outstanding", required: true, notes: null, responsible_role: "electrician", verified_at: null, gate: "assessment", evidence_files: [] as any[] };
g.__queryFails = false; g.__storageFails = false; g.__confirmFails = false; g.__openFails = false; g.__storageCalls = 0; g.__confirmCalls = 0; g.__requestCalls = 0;
g.__evidenceRead = () => g.__queryFails ? { data: null, error: { message: "TEST evidence read unavailable" } } : { data: [req] };
g.__storageUpload = async () => { g.__storageCalls++; if (g.__storageFails) throw new Error("Storage size limit exceeded. Choose a smaller file."); return { error: null }; };
g.__mockData = {
  requestEvidenceUpload: ({ data }: any) => { g.__requestCalls++; if (data.mimeType.startsWith("image/") && !data.fix) throw new Error("Allow location access on your phone and try again at the property."); return { path: "job/measurement/test.pdf", token: "sealed" }; },
  confirmEvidenceUpload: () => { g.__confirmCalls++; if (g.__confirmFails) return undefined; req.status = "uploaded"; req.evidence_files = [{ id: "file", file_name: "evidence.pdf", uploaded_at: new Date().toISOString() }]; return { ok: true }; },
  getEvidenceUrl: async () => { await new Promise((r) => setTimeout(r, 200)); if (g.__openFails) throw new Error("TEST file read unavailable"); return { url: "/tests/evidence.pdf" }; },
};
const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
g.__refresh = () => qc.invalidateQueries();
const root = document.getElementById("root");
if (root) createRoot(root).render(<QueryClientProvider client={qc}><main className="portal-theme min-h-screen bg-canvas p-4 text-ink"><EvidencePanel jobId="job" role="measure" gates={["assessment"]} /><FileViewerHost /></main></QueryClientProvider>);