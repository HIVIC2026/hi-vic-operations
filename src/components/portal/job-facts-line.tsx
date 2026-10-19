// Office card facts: enquiry date, age, insulation, ceiling size, media availability and the assigned trade.
// Every value is an existing record (jobs.created_at, indicative_estimates, intake media, job_assignments).
// Nothing is inferred: a missing value reads "not provided" rather than a guess, and age is NEVER called overdue.
import { fmtDate, fmtDateTime } from "@/lib/workflow";
import { ageDays, ageTone } from "@/lib/ageing.core";
import type { JobRow } from "./JobCard";

/** "12d" with a tooltip explaining the date it is measured from. Ageing only — there is no deadline here. */
export function AgeTag({ at, now }: { at: string | null | undefined; now?: number }) {
  const d = ageDays(at, now);
  if (d === null) return null;
  return (
    <span
      className={ageTone(d)}
      title={`Enquiry received ${fmtDate(at)} — ${d} day${d === 1 ? "" : "s"} ago`}
    >
      {d === 0 ? "today" : `${d}d`}
    </span>
  );
}

const INSULATION_LABEL: Record<"none" | "present" | "unknown", string> = {
  none: "No insulation",
  present: "Insulation present",
  unknown: "Insulation unknown",
};

const mediaLabel = (n: number | null) =>
  n === null ? "Media not checked" : n === 0 ? "No media" : `${n} media file${n === 1 ? "" : "s"}`;

/** One compact, wrap-friendly line. `compact` drops the enquiry date (the board card already shows the age). */
export function JobFactsLine({ job, compact = false }: { job: JobRow; compact?: boolean }) {
  const f = job.enquiry_facts ?? null;
  const ceiling =
    f?.ceilingM2 == null
      ? "Ceiling not provided"
      : `${Math.round(f.ceilingM2)} m²${f.ceilingAssumed ? " (typical)" : ""}`;
  const assigned = job.installer_name
    ? `Installer: ${job.installer_name}`
    : job.electrician_name
      ? `Electrician: ${job.electrician_name}`
      : "Not assigned";
  return (
    <div
      className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-muted-foreground"
      title={`Last activity ${fmtDateTime(job.last_activity_at)}`}
    >
      {!compact && <span>Enquiry {fmtDate(job.created_at)}</span>}
      {!compact && <span aria-hidden>·</span>}
      <AgeTag at={job.created_at} />
      <span aria-hidden>·</span>
      <span>{f?.insulation ? INSULATION_LABEL[f.insulation] : "Insulation not provided"}</span>
      <span aria-hidden>·</span>
      <span>{ceiling}</span>
      <span aria-hidden>·</span>
      <span className={f?.mediaCount ? "font-semibold text-foreground" : ""}>
        {mediaLabel(f?.mediaCount ?? null)}
      </span>
      <span aria-hidden>·</span>
      <span className={job.installer_name || job.electrician_name ? "" : "italic"}>{assigned}</span>
    </div>
  );
}
