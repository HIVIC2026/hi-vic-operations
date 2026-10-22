import { createFileRoute } from "@tanstack/react-router";
import { CampaignDesign } from "./estimate_.$token.campaign";
export const Route = createFileRoute("/zz-removal-preview")({ component: () => {
  const p = { gross: 4398, discount: 1050, total: 3348, areaM2: 120, assessmentFee: 349, apFee: 449, ratePerM2: 30, installation: 3600, veecs: 15, veecValue: 70, address: "1 Test Street, Mulgrave VIC 3170", insulation: "present" as const, removal: { kind: "unknown" as const }, removalUpTo: 1800 };
  return <div className="estimate-theme min-h-screen bg-estimate-white"><CampaignDesign saveAllowed ownerQualified={false} reviewStatus={null} group="likely" token="x" name="Jo" suburb="Mulgrave" p={p as never} busy={null} error={null} onSave={() => {}} onOptOut={() => {}} /></div>;
}});
