// Job side panel shared by Needs me and Enquiries (moved out of the Needs me route, Jo 26 Oct 2026).
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { getOfficeJobPage } from "@/lib/office-screens.functions";
import type { JobSection } from "@/lib/office-needs.core";
import type { CardKey } from "@/lib/office-stage-cards.core";
import { ContactHistory, JobHeader, MoneyCard, NextPanel, StageWorkspace } from "@/components/portal/office-job";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { btnClass } from "@/components/portal/kit";

const btn = (tone: "primary" | "secondary") => btnClass(tone, "min-h-[46px] whitespace-nowrap md:min-h-[42px]");

export type Peek = { jobId: string; section?: JobSection };

/**
 * Desktop side panel (Jo 26 Oct 2026): the job's next step and the stage card a row points at, using the job page's
 * own pieces (same guards and actions), so the office can act without leaving Needs me or Enquiries. "Open the full
 * job" goes to the job page for anything else.
 */
export function JobPeek({ peek, onClose }: { peek: Peek | null; onClose: () => void }) {
  return (
    <Sheet open={!!peek} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="portal-theme w-full overflow-y-auto bg-background text-ink sm:max-w-[760px]">
        {peek && <PeekBody key={`${peek.jobId}:${peek.section ?? ""}`} peek={peek} />}
      </SheetContent>
    </Sheet>
  );
}

function PeekBody({ peek }: { peek: Peek }) {
  const load = useServerFn(getOfficeJobPage);
  const { data, error, refetch } = useQuery({ queryKey: ["office-job-page", peek.jobId], queryFn: () => load({ data: { jobId: peek.jobId } }), staleTime: 15_000 });
  const [k, setK] = useState<CardKey | "money" | "contact" | null>(peek.section ?? null);
  const navigate = useNavigate();
  return (
    <div className="grid gap-4 pt-6">
      <SheetTitle className="sr-only">Job</SheetTitle>
      <SheetDescription className="sr-only">The job's next step and the card this row is about.</SheetDescription>
      {error ? <div role="alert" className="rounded-[14px] border border-danger/40 bg-danger-soft p-4 text-sm text-danger">This job couldn't load here. <button type="button" className="font-semibold underline" onClick={() => void refetch()}>Try again</button> or <Link to="/admin/jobs/$jobId" params={{ jobId: peek.jobId }} className="font-semibold underline">open the full job</Link>.</div>
        : !data ? <p role="status" className="text-sub">Loading the job…</p> : (
        <>
          <JobHeader h={data.header} more={<Link to="/admin/jobs/$jobId" params={{ jobId: peek.jobId }} {...(peek.section ? { hash: `stage-${peek.section}` } : {})} className={btn("secondary")}>Open the full job</Link>} />
          <NextPanel next={data.next} onGo={(c) => setK(c)} />
          {k === "money" ? <MoneyCard jobId={peek.jobId} />
            : k === "contact" ? <ContactHistory jobId={peek.jobId} rows={data.contacts} waitingFor={data.waitingFor} onLog={() => void navigate({ to: "/admin/jobs/$jobId", params: { jobId: peek.jobId }, hash: "stage-contact" })} />
            : k ? <StageWorkspace jobId={peek.jobId} k={k} page={data} onGo={(c) => setK(c)} /> : null}
        </>
      )}
    </div>
  );
}
