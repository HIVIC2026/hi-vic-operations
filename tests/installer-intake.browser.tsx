// Sealed Add job (installer intake) fixture: real components/CSS; every server call is a stub whose "server" state
// lives in localStorage so a page refresh behaves like the real server draft. No network, writes or sends.
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { InstallerIntakeFlow } from "../src/components/trade/installer-intake-flow";
import "../src/styles.css";
type Srv = { imports: Record<string, { files: { path: string; name: string; type: string }[]; status: string; jobId: string | null }>; creates: number; confirms: number };
const K = "__fixture_srv";
const q = new URLSearchParams(location.search);
const srv = (): Srv => JSON.parse(localStorage.getItem(K) ?? '{"imports":{},"creates":0,"confirms":0}');
const put = (s: Srv) => localStorage.setItem(K, JSON.stringify(s));
const g = globalThis as Record<string, unknown>;
g.__stubUser = { id: q.get("user") ?? "user-a" };
g.__mockData = {
  bulkElectricianChoices: { approved: [{ businessId: "el-1", name: "TEST Sparky", status: "approved", primary: true }], pending: [] },
  partnerUploadUrl: (a: { data: { fileName: string } }) => ({ path: `partners/biz-test/imports/${a.data.fileName}`, token: "t" }),
  partnerFileUrl: { url: "" },
  readBulkFile: { text: "QUOTE Q-1\nCustomer: TEST Quote 1\nMeasured ceiling area: 112 m2\nR5.0 ceiling batts supply and install\nTOTAL inc GST: $3001.00" },
  createImport: (a: { data: { files: { path: string; name: string; type: string }[] } }) => { const s = srv(); s.creates++; const id = `imp-${s.creates}`; s.imports[id] = { files: a.data.files, status: "draft", jobId: null }; put(s); return { id, extracted: {} }; },
  addImportFiles: (a: { data: { importId: string; files: { path: string; name: string; type: string }[] } }) => { const s = srv(); const i = s.imports[a.data.importId]; if (!i) throw new Error("TEST draft missing"); i.files = [...i.files, ...a.data.files.filter((f) => !i.files.some((h) => h.path === f.path))]; put(s); return { files: i.files }; },
  removeImportFile: (a: { data: { importId: string; path: string } }) => { const s = srv(); const i = s.imports[a.data.importId]; if (!i) throw new Error("TEST draft missing"); i.files = i.files.filter((f) => f.path !== a.data.path); put(s); return { files: i.files }; },
  getImportDraft: (a: { data: { importId: string } }) => { const i = srv().imports[a.data.importId]; return i ? { status: i.status === "confirmed" ? "confirmed" : "draft", files: i.files, jobId: i.jobId, jobNumber: i.jobId ? "HV-FIX" : null } : { status: "gone", files: [], jobId: null, jobNumber: null }; },
  confirmImport: (a: { data: { importId: string } }) => { const s = srv(); s.confirms++; const i = s.imports[a.data.importId]; if (!i) throw new Error("TEST draft missing"); const first = i.status !== "confirmed"; i.status = "confirmed"; i.jobId = "job-fix"; put(s); (g.__confirmArgs as unknown[] ?? (g.__confirmArgs = [])).push(a.data); if (q.get("lose") === "1" && first) throw new Error("Failed to fetch"); return { jobId: "job-fix", jobNumber: "HV-FIX", reused: !first }; },
  getMyIntakeReadyCheck: { coordination: "self_managed", readyCheck: { outstandingCount: 11, outstanding: [] }, quoteHeldFor: [] },
};
// Fault controls for sealed regression runs only. No real service is reachable.
const wait = (n: number) => new Promise((r) => setTimeout(r, n));
g.__authDelay = Number(q.get("restoreDelay") ?? 0);
g.__uploads = [];
g.__storageUpload = async (path: string) => { (g.__uploads as string[]).push(path); await wait(Number(q.get("uploadDelay") ?? 0)); return { error: path.endsWith("bad.pdf") ? new Error("TEST upload failure") : null }; };
const mocks = g.__mockData as Record<string, unknown>;
const originalRead = mocks.readBulkFile;
mocks.readBulkFile = async (a: { data: { name: string } }) => { await wait(Number(q.get("readDelay") ?? 0)); if (q.has("readFail")) throw new Error("TEST optional read failure"); if (a.data.name === "multi.pdf") return { text: "Customer: TEST One\nCustomer: TEST Two\nTOTAL inc GST: $999.00" }; return originalRead; };
const originalRemove = mocks.removeImportFile as (a: unknown) => unknown;
g.__removes = 0;
mocks.removeImportFile = async (a: unknown) => { g.__removes = Number(g.__removes) + 1; await wait(Number(q.get("removeDelay") ?? 0)); if (q.has("removeFail")) throw new Error("TEST remove failure"); return originalRemove(a); };
const originalConfirm = mocks.confirmImport as (a: unknown) => unknown;
mocks.confirmImport = async (a: unknown) => { await wait(Number(q.get("submitDelay") ?? 0)); return originalConfirm(a); };
const root = document.getElementById("root");
if (root) createRoot(root).render(<QueryClientProvider client={new QueryClient()}><div className="portal-theme min-h-screen bg-canvas p-4 text-ink"><div className="mx-auto max-w-lg"><InstallerIntakeFlow businessId={q.get("biz") ?? "biz-test"} /></div></div></QueryClientProvider>);
