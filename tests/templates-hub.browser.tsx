import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TemplatesHub } from "../src/components/portal/template-hub";
import { parseTemplateSearch, type TemplateSection } from "../src/lib/template-hub.core";
import "../src/styles.css";

const g = globalThis as Record<string, unknown>;
g.__mockData = {
  getMittiForms: { ready_check: "template_" + "a".repeat(32), ready_check_priced: null, piesa: null, piisa: null, fixes: null },
  getOfficeSwitches: { switches: [{ key: "customer_comms", on: false }, { key: "sms:quote_ready", on: true }], named: 1 },
  paperworkCatalogueFn: { docs: [{ key: "contact_privacy", gate: "A", title: "Contact and privacy", version: "TEST-1", status: "Draft", approvedBy: null, approvedAt: null, managedIn: "Owner paperwork", templateId: null }, { key: "consumer_declaration", gate: "D", title: "Official assignment", version: "TEST-2", status: "Approved", approvedBy: "TEST Admin", approvedAt: "2026-10-01T00:00:00Z", managedIn: "Templates", templateId: "x" }], bodies: { contact_privacy: "TEST wording" } },
  listComplianceTemplates: [{ id: "c1", template_key: "esc_consent", version: "TEST-esc-1", is_active: true, approved: true, body: "TEST official wording", source_note: null, form_fields: [] }],
};
let setSearch: (v: ReturnType<typeof parseTemplateSearch>) => void = () => {};
g.__stubNavigate = (o: { search?: Record<string, unknown> }) => { const next = parseTemplateSearch(o.search ?? {}); setSearch(next); history.replaceState(null, "", `?${new URLSearchParams(next as Record<string, string>)}`); };
function App() {
  const [s, setS] = useState(() => parseTemplateSearch(Object.fromEntries(new URLSearchParams(location.search))));
  useEffect(() => { setSearch = setS; }, []);
  return <div className="portal-theme min-h-screen bg-canvas px-4 py-6 sm:px-[26px]"><div className="mx-auto max-w-[1180px]"><TemplatesHub cat={s.cat as TemplateSection} {...(s.t ? { t: s.t } : {})} /></div></div>;
}
createRoot(document.getElementById("root")!).render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><App /></QueryClientProvider>);
