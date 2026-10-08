import { useState } from "react";
import { createRoot } from "react-dom/client";
import { CustomerFields } from "../src/components/trade/customer-fields";
import { FileViewerHost, openFileViewer } from "../src/components/portal/file-viewer";
import { Button } from "../src/components/trade/trade-ui";
import { onsiteProblems, type OnsiteInput } from "../src/lib/onsite-ready-check.core";
import { ElectricianPicker } from "../src/components/trade/job-intake";
import type { ElectricianPlan } from "../src/lib/job-electrician.core";
import "../src/styles.css";
function Fixture() {
  const [plan, setPlan] = useState<ElectricianPlan>({ mode: "hivic" });
  const [value, setValue] = useState<OnsiteInput>({ full_name: "TEST Owner", address_line: "", suburb: "", postcode: "2604", phone: "0412345678", email: "test@example.test", contact_permission: false, consent_by: null });
  return <div className="portal-theme min-h-screen bg-canvas p-4 text-ink"><div className="mx-auto max-w-lg space-y-4"><CustomerFields value={value} onChange={setValue} /><output className="block">{onsiteProblems(value).length ? "Needs details" : "Ready to start"}</output><ElectricianPicker value={plan} onChange={setPlan} approved={[]} pending={[]} onAdd={async () => ({ message: "TEST sample only; no invite sent" })} /><Button onClick={() => openFileViewer("/test-insurance.svg", "TEST insurance")}>View insurance</Button></div><FileViewerHost /></div>;
}
const root = document.getElementById("root");
if (root) createRoot(root).render(<Fixture />);