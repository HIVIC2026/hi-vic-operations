import { createFileRoute } from "@tanstack/react-router";
import { CampaignDesign } from "./estimate_.$token.campaign";
export const Route = createFileRoute("/zz-removal-preview")({ component: P });
function P() {
  const p = { gross: 4998, discount: 1050, total: 3948, areaM2: 120, assessmentFee: 349, apFee: 349, ratePerM2: 30, installation: 3600, veecs: 15, veecValue: 70, address: "1 Test Street, Mulgrave VIC 3170", insulation: "present" as never, removal: { kind: "unknown" } as never, removalUpTo: 1800 };
  return <div className="estimate-brand min-h-screen bg-estimate-canvas"><main className="pb-14"><CampaignDesign saveAllowed ownerQualified={false} reviewStatus={null} group="likely" token={"T".repeat(43)} name="Jo" suburb="Mulgrave" p={p} busy={null} error={null} onSave={() => {}} onOptOut={() => {}} /></main></div>;
}
