import { createFileRoute } from "@tanstack/react-router";
import { AskToChange, BizPage, Rows } from "@/components/trade/business-pages";
import { FileRow } from "@/components/trade/business-kit";
import { usualElectricianLine } from "@/lib/trade-view.core";

export const Route = createFileRoute("/_authenticated/field/business_/details")({
  head: () => ({ meta: [{ title: "Business details – Home Insulation Victoria" }, { name: "description", content: "Your business details on file with Home Insulation Victoria." }, { property: "og:title", content: "Business details – Home Insulation Victoria" }, { property: "og:description", content: "Your business details on file with Home Insulation Victoria." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <BizPage title="Business details" intro="What we have on file. Ask us if anything needs changing.">
      {(d, refetch) => (<>
        <Rows rows={[["Business name", d.details.name], ["Legal name", d.details.legal], ["ABN", d.details.abn], ["Phone", d.details.phone], ["Email", d.details.email], ["Address", d.details.address], ["Where you work", d.details.area], ["Usual days", d.details.days], ["Lead time", d.details.leadTime]]} />
        <AskToChange kind="details" label="Ask us to change something" placeholder="e.g. New phone number 0400 000 000, or add Werribee to our area" open={d.openRequests} onSent={refetch} />
        {d.kind === "installer" && <FileRow to="/field/business/electrician" title="My usual electrician" sub={usualElectricianLine(d.usualElectrician)} testId="electrician" />}
      </>)}
    </BizPage>
  ),
});
