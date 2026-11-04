// RETIRED for go-live (Jo 4 Nov 2026 21:45, G8 (3)): NO worker logins or worker pages — Team is a list of people; only the
// boss and Office people log in. Nothing texts a /w/ link any more (crew links were minted at booking but never sent; the
// Lead Installer signs the SWMS on the /sp/ link and electricians use the /e/ link — both untouched). This page no longer
// reads a job: an old link shows the short notice below. The server functions (worker-links.functions getWorkerJobView /
// postWorkerMessage) stay for history and the QA launcher's TEST persona only; nothing in the portal links here.
import { createFileRoute } from "@tanstack/react-router";
import { TradePublicShell, card } from "@/components/trade/TradeShell";

export const Route = createFileRoute("/w/$token")({
  ssr: false,
  head: () => ({ meta: [{ title: "Your job – Home Insulation Victoria" }, { name: "description", content: "Your private job page from Home Insulation Victoria." }, { name: "robots", content: "noindex" }] }),
  component: WorkerJobRetired,
});

/** DRAFT wording (listed on JO-APPROVAL-LIST): the retired staff job link. */
export const WORKER_LINK_RETIRED = {
  title: "This link isn't used any more",
  body: "Your boss has the job details and your onsite form is in Mitti. If you need anything, ask your boss.",
} as const;

function WorkerJobRetired() {
  return (
    <TradePublicShell>
      <section className={card} data-worker-link-retired>
        <h1 className="font-display text-2xl font-bold">{WORKER_LINK_RETIRED.title}</h1>
        <p className="mt-2 text-sm text-sub">{WORKER_LINK_RETIRED.body}</p>
      </section>
    </TradePublicShell>
  );
}
