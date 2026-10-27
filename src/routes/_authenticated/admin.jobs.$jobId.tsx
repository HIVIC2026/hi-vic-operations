// O2 Job page (approved mock-up + states, decisions 216, 218, 223, 227, 230, 233, 240), redesigned 27 Oct 2026 "next step
// first" (docs/superpowers/specs/2026-10-27-office-job-page-design.md): short header (contact behind a tap) → Next box
// with what is blocking it → AI reply drafts → six stage rows (open one for its lines, then its full tools) → Money,
// Contact history and File folded. Old fold-outs, the three status boxes, office booking forms, the intake review panel,
// instalments, invoice-route select, partner & relationship panel, expected install week, the second ESC panel and the
// internal pricing table are gone (audit Part 6 removals).
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/portal/AppShell";
import { getOfficeJobPage } from "@/lib/office-screens.functions";
import { AiReplyDrafts } from "@/components/portal/AiReplyDrafts";
import { parseJobSection } from "@/lib/job-section.core";
import type { CardKey } from "@/lib/office-stage-cards.core";
import { CLOSED_VIEW, goTo, landingView, showFull, tapRow, toggleFold, type FoldKey, type JobView } from "@/lib/job-page-layout.core";
import { ContactHistory, FileList, JobMoreMenu, LogNoteDialog, MoneyCard, StageWorkspace } from "@/components/portal/office-job";
import { Fold, JobTop, NextBox, StageRows } from "@/components/portal/job-page-parts";

const CARD_KEYS: CardKey[] = ["enquiry", "ready-check", "quote", "piesa", "install", "final-check"];

export const Route = createFileRoute("/_authenticated/admin/jobs/$jobId")({
  head: () => ({ meta: [{ title: "Job – Home Insulation Victoria Office" }, { name: "description", content: "One job: next step, six stages, money, contact history and file." }, { property: "og:title", content: "Job – Home Insulation Victoria Office" }, { property: "og:description", content: "One job: next step, six stages, money, contact history and file." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex, nofollow" }] }),
  validateSearch: (s: Record<string, unknown>): { section?: string; act?: "cancel" } => {
    const legacy = parseJobSection(s["section"]);
    return { ...(legacy ? { section: legacy } : typeof s["section"] === "string" && CARD_KEYS.includes(s["section"] as CardKey) ? { section: s["section"] } : {}), ...(s["act"] === "cancel" ? { act: "cancel" as const } : {}) };
  },
  component: JobPageRoute,
});

function JobPageRoute() {
  const { jobId } = Route.useParams();
  const { section, act } = Route.useSearch();
  const navigate = Route.useNavigate();
  const load = useServerFn(getOfficeJobPage);
  const { data, error, refetch } = useQuery({ queryKey: ["office-job-page", jobId], queryFn: () => load({ data: { jobId } }), staleTime: 15_000 });
  const [view, setView] = useState<JobView>(CLOSED_VIEW);
  const [logOpen, setLogOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(act === "cancel");
  const scrollTo = (k: CardKey | FoldKey) => window.setTimeout(() => document.getElementById(`stage-${k}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  // Links (Next button, See installers, onGo from a stage's tools) open the stage WITH its full tools, or open the
  // fold, then scroll to its always-present header (#stage-<key>). A plain row tap shows only the row's lines.
  const go = (k: CardKey | FoldKey) => { setView((v) => goTo(v, k)); scrollTo(k); };
  // Needs me buttons and old links land the same way: #stage-<key> or ?section=.
  useEffect(() => {
    if (!data) return;
    const l = landingView(window.location.hash, section);
    if (l.scrollTo) { setView(l.view); scrollTo(l.scrollTo); }
  }, [!!data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (error) return <AppShell><div role="alert" className="rounded-[14px] border border-danger bg-danger-soft p-4 text-sm text-danger">This job could not be loaded. Its records have not been deleted. {(error as Error).message} <button type="button" className="ml-2 font-semibold underline" onClick={() => void refetch()}>Try again</button></div></AppShell>;
  if (!data) return <AppShell><p role="status" className="text-sub">Loading…</p></AppShell>;
  const h = data.header;
  return (
    <AppShell>
      <JobTop h={h} more={<JobMoreMenu h={h} cancelOpen={cancelOpen} setCancelOpen={setCancelOpen} onDeleted={() => void navigate({ to: "/admin/jobs/active" })} />} />
      <NextBox jobId={jobId} next={data.next} onGo={(k) => go(k)} />
      <AiReplyDrafts jobId={jobId} />
      <StageRows cards={data.cards} open={view.open} full={view.full} onToggle={(k) => setView((v) => tapRow(v, k))} onFull={() => setView(showFull)} workspace={(k) => <StageWorkspace jobId={jobId} k={k} page={data} onGo={go} />} />
      <Fold id="money" title="Money" open={view.folds.money} onToggle={() => setView((v) => toggleFold(v, "money"))}><MoneyCard jobId={jobId} anchor={false} /></Fold>
      <Fold id="contact" title="Contact history" hint={String(data.contacts.length)} open={view.folds.contact} onToggle={() => setView((v) => toggleFold(v, "contact"))}><ContactHistory jobId={jobId} rows={data.contacts} waitingFor={data.waitingFor} onLog={() => setLogOpen(true)} anchor={false} /></Fold>
      <Fold id="file" title="File" open={view.folds.file} onToggle={() => setView((v) => toggleFold(v, "file"))}><FileList jobId={jobId} /></Fold>
      <LogNoteDialog h={h} open={logOpen} onOpenChange={setLogOpen} />
    </AppShell>
  );
}
