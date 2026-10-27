// O2 Job page (approved mock-up + states, decisions 216, 218, 223, 227, 230, 233, 240). Header → one Next panel →
// six stage cards (open one for its tools) → Money → Contact history → File. Old fold-outs, the three status boxes,
// office booking forms, the intake review panel, instalments, invoice-route select, partner & relationship panel,
// expected install week, the second ESC panel and the internal pricing table are gone (audit Part 6 removals).
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/portal/AppShell";
import { getOfficeJobPage } from "@/lib/office-screens.functions";
import { AiReplyDrafts } from "@/components/portal/AiReplyDrafts";
import { parseJobSection } from "@/lib/job-section.core";
import type { CardKey } from "@/lib/office-stage-cards.core";
import { ContactHistory, FileList, JobHeader, JobMoreMenu, LogNoteDialog, MoneyCard, NextPanel, StageCards, StageWorkspace } from "@/components/portal/office-job";

const CARD_KEYS: CardKey[] = ["enquiry", "ready-check", "quote", "piesa", "install", "final-check"];
/** Old ?section= deep links (record groups) open the matching stage card. */
const LEGACY_SECTION: Record<string, CardKey> = { enquiry: "enquiry", ready_check: "ready-check", quote: "quote", piesa: "piesa", installation: "install", ap_veec: "final-check" };

export const Route = createFileRoute("/_authenticated/admin/jobs/$jobId")({
  head: () => ({ meta: [{ title: "Job – Home Insulation Victoria Office" }, { name: "description", content: "One job: next step, six stages, money, contact history and file." }, { property: "og:title", content: "Job – Home Insulation Victoria Office" }, { property: "og:description", content: "One job: next step, six stages, money, contact history and file." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex, nofollow" }] }),
  validateSearch: (s: Record<string, unknown>): { section?: string; act?: "cancel" } => {
    const legacy = parseJobSection(s["section"]);
    return { ...(legacy ? { section: legacy } : typeof s["section"] === "string" && CARD_KEYS.includes(s["section"] as CardKey) ? { section: s["section"] } : {}), ...(s["act"] === "cancel" ? { act: "cancel" as const } : {}) };
  },
  component: JobPageRoute,
});

function JobPageRoute() {
  const { qaOffice } = Route.useRouteContext();
  const { jobId } = Route.useParams();
  const { section, act } = Route.useSearch();
  const navigate = Route.useNavigate();
  const load = useServerFn(getOfficeJobPage);
  const { data, error, refetch } = useQuery({ queryKey: ["office-job-page", jobId], queryFn: () => load({ data: { jobId } }), staleTime: 15_000 });
  const [open, setOpen] = useState<CardKey | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(act === "cancel");
  const go = (k: CardKey | "money" | "contact") => {
    if (k === "money" || k === "contact") { document.getElementById(`stage-${k}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    setOpen(k);
    window.setTimeout(() => document.getElementById("stage-workspace")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  };
  // Needs me buttons and old links land on the right card: #stage-<key> or ?section=.
  useEffect(() => {
    if (!data) return;
    const hash = window.location.hash.replace(/^#stage-/, "");
    const want = (CARD_KEYS as string[]).includes(hash) ? (hash as CardKey) : hash === "money" || hash === "contact" ? hash : section ? (LEGACY_SECTION[section] ?? (CARD_KEYS.includes(section as CardKey) ? (section as CardKey) : null)) : null;
    if (want) go(want as CardKey | "money" | "contact");
  }, [!!data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (error) return <AppShell><div role="alert" className="rounded-[14px] border border-danger bg-danger-soft p-4 text-sm text-danger">This job could not be loaded. Its records have not been deleted. {(error as Error).message} <button type="button" className="ml-2 font-semibold underline" onClick={() => void refetch()}>Try again</button></div></AppShell>;
  if (!data) return <AppShell><p role="status" className="text-sub">Loading…</p></AppShell>;
  const h = data.header;
  return (
    <AppShell>
      <JobHeader h={h} more={<JobMoreMenu h={h} cancelOpen={cancelOpen} setCancelOpen={setCancelOpen} onDeleted={() => void navigate({ to: "/admin/jobs/active" })} />} />
      <NextPanel next={data.next} onGo={(k) => go(k)} />
      <StageCards cards={data.cards} open={open} onOpen={(k) => (open === k ? setOpen(null) : go(k))} />
      {open && <div id="stage-workspace" className="scroll-mt-24"><StageWorkspace jobId={jobId} k={open} page={data} onGo={go} /></div>}
      <MoneyCard jobId={jobId} />
      {!qaOffice && <AiReplyDrafts jobId={jobId} />}
      <ContactHistory jobId={jobId} rows={data.contacts} waitingFor={data.waitingFor} onLog={() => setLogOpen(true)} />
      {qaOffice ? <p className="text-sm text-sub">Not available for the TEST office login</p> : <FileList jobId={jobId} />}
      <LogNoteDialog h={h} open={logOpen} onOpenChange={setLogOpen} />
    </AppShell>
  );
}
