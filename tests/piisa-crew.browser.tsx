// Sealed PIISA crew picker fixture: the REAL PiisaCrewPicker; server calls stubbed (no network, writes or sends).
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PiisaCrewPicker } from "../src/components/trade/PiisaCrewPicker";
import "../src/styles.css";
const g = globalThis as Record<string, unknown>;
g.__mockData = {
  getPiisaCrew: { selection: null, staff: [
    { workerId: "w-ok", name: "TEST Lead Verified", eec: "EEC-1234", eecVerified: true, approved: true },
    { workerId: "w-2", name: "TEST Helper Verified", eec: "EEC-5678", eecVerified: true, approved: true },
    { workerId: "w-pend", name: "TEST Pending", eec: "EEC-9", eecVerified: true, approved: false },
  ] },
  savePiisaCrew: (a: { data: unknown }) => { (g.__saved as unknown[] ?? (g.__saved = [])).push(a.data); return { needsVerification: [] }; },
};
const root = document.getElementById("root");
if (root) createRoot(root).render(<QueryClientProvider client={new QueryClient()}><div className="portal-theme min-h-screen bg-canvas p-4 text-ink"><div className="mx-auto max-w-lg"><PiisaCrewPicker jobId="00000000-0000-0000-0000-000000000001" /></div></div></QueryClientProvider>);
