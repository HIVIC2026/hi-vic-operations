// Sealed Ready Check draft fixture: real ReadyCheckDraft component + the real pure progress rules; the "server" draft
// lives in localStorage so Save -> reload proves resume. No network, writes, Mitti or sends.
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReadyCheckDraft } from "../src/components/trade/ReadyCheckDraft";
import { fromObservations, knownPrefill, rcProgress, toObservations, type RcDraftValues } from "../src/lib/ready-check-draft.core";
import "../src/styles.css";
const K = "__fixture_rc";
const evidence = [
  { label: "Ceiling measurement evidence", gate: "assessment", required: true, status: "rejected" },
  { label: "Existing insulation / R-value evidence", gate: "assessment", required: true, status: "uploaded" },
  { label: "Before: ceiling space", gate: "installation", required: true, status: "outstanding" }, // later list — must NOT count
  { label: "PIESA / electrical safety sign-off", gate: "electrical", required: true, status: "outstanding" },
];
const view = () => {
  const saved = JSON.parse(localStorage.getItem(K) ?? "null") as { values: RcDraftValues; at: string } | null;
  const obs = saved ? toObservations(saved.values).obs : {};
  const values = fromObservations(obs); const pre = knownPrefill({ insulation: "unknown" }); const prefilled: string[] = [];
  for (const [k, v] of Object.entries(pre)) if (!values[k]) { values[k] = v; prefilled.push(k); }
  return { readyCheckId: saved ? "rc-1" : null, status: saved ? "draft" : "none", savedAt: saved?.at ?? null, values, prefilled, suppliedAreaHint: 120, progress: rcProgress(obs, evidence), coordination: "self_managed",
    commercial: { ready: false, blockers: ["Existing insulation not confirmed (must be none or below R2.0)"], releaseBlockers: [] } };
};
const g = globalThis as Record<string, unknown>;
g.__mockData = {
  getReadyCheckDraft: () => view(),
  saveReadyCheckDraft: (a: { data: { values: RcDraftValues } }) => { const { problems } = toObservations(a.data.values); if (problems.length) throw new Error(problems.join(" • ")); localStorage.setItem(K, JSON.stringify({ values: a.data.values, at: new Date().toISOString() })); (g.__saves = ((g.__saves as number) ?? 0) + 1); return view(); },
};
const root = document.getElementById("root");
if (root) createRoot(root).render(<QueryClientProvider client={new QueryClient()}><div className="portal-theme min-h-screen bg-canvas p-4 text-ink"><div className="mx-auto max-w-lg"><ReadyCheckDraft jobId="job-fix" evidence={false} /></div></div></QueryClientProvider>);
