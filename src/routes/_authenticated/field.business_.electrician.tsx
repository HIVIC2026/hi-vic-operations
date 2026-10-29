import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { BizPage } from "@/components/trade/business-pages";
import { UsualElectricianSettings } from "@/components/trade/usual-electrician";
import { usualElectricianLine } from "@/lib/trade-view.core";

export const Route = createFileRoute("/_authenticated/field/business_/electrician")({
  head: () => ({ meta: [{ title: "My usual electrician – Home Insulation Victoria" }, { name: "description", content: "The electrician you usually work with, for the safety check on your jobs." }, { property: "og:title", content: "My usual electrician – Home Insulation Victoria" }, { property: "og:description", content: "The electrician you usually work with, for the safety check on your jobs." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" }] }),
  component: Electrician,
});

/** Decisions 27/157/173/369: one declared nomination (name, licence number), saved as a business-scoped config event.
 *  Used on the installer's jobs only when that electrician is onboarded with us as an approved electrician; otherwise our electrician. */
function Electrician() {
  const qc = useQueryClient();
  return (
    <BizPage title="My usual electrician" intro="The electrician who usually does the safety check on your jobs. We use them once they're an approved electrician with us; otherwise we send our own.">
      {(d, refetch) => d.kind !== "installer" ? <p className="rounded-[18px] border border-line bg-paper p-[19px] shadow-card text-sm">Only installer businesses nominate a usual electrician.</p> : (<>
        <p className="rounded-[18px] bg-estimate-panel p-4 text-sm text-estimate-navy"><span className="block text-[11px] font-bold uppercase tracking-[1.3px] text-estimate-blue">On file</span><span className="mt-1 block">{usualElectricianLine(d.usualElectrician)}</span></p>
        <UsualElectricianSettings key={`${d.businessId}:${d.usualElectrician?.name ?? ""}:${d.usualElectrician?.licence ?? ""}`} saved={d.usualElectrician} onSaved={() => { refetch(); void qc.invalidateQueries({ queryKey: ["trade-business"] }); }} />
        <p className="text-[13px] leading-relaxed text-estimate-sub">Declared by you, not checked by us.</p>
      </>)}
    </BizPage>
  );
}
