import { createFileRoute } from "@tanstack/react-router";
import { BizPage } from "@/components/trade/business-pages";
import { MyElectricians } from "@/components/trade/my-electricians";

export const Route = createFileRoute("/_authenticated/field/business_/electricians")({
  head: () => ({ meta: [{ title: "My electricians – Home Insulation Victoria" }, { name: "description", content: "The electricians you've added for your own jobs, and where each one stands." }, { property: "og:title", content: "My electricians – Home Insulation Victoria" }, { property: "og:description", content: "The electricians you've added for your own jobs, and where each one stands." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" }] }),
  component: Electricians,
});

/** Part 2b: an installer boss adds their own electricians for their own jobs. Home Insulation Victoria approves each one;
 *  the list shows where each stands. Boss-only on the server (`installerBoss`), so this page only renders what comes back. */
function Electricians() {
  return (
    <BizPage title="My electricians" intro="Electricians you add for your own jobs. Home Insulation Victoria checks their paperwork before they're approved.">
      {(d) => d.kind !== "installer" ? <p className="rounded-[18px] border border-line bg-paper p-[19px] shadow-card text-sm">Only installer businesses add their own electricians.</p> : <MyElectricians />}
    </BizPage>
  );
}
