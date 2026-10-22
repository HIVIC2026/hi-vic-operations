import { createFileRoute } from "@tanstack/react-router";
import { CampaignDesign } from "./estimate_.$token.campaign";
export const Route = createFileRoute("/zz-removal-preview")({ component: P });
function P() {
  const withIns = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("ins") === "present";
  const p = { gross: 4998, discount: 1050, total: 3948, areaM2: 120, assessmentFee: 349, apFee: 349, ratePerM2: 30, installation: 3600, veecs: 15, veecValue: 70, address: "1 Test Street, Mulgrave VIC 3170", insulation: (withIns ? "present" : "none") as never, removal: { kind: "unknown" } as never, removalUpTo: withIns ? 1800 : null };
  return <CampaignDesign saveAllowed ownerQualified={false} reviewStatus={null} group="likely" token={"T".repeat(43)} name="Jo" suburb="Mulgrave" p={p} busy={null} error={null} onSave={() => {}} onOptOut={() => {}} />;
}
