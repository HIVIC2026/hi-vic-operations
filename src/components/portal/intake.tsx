import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getIntakeSummary } from "@/lib/portal.functions";
import { Pill } from "./badges";
import { openFileViewer } from "@/components/portal/file-viewer";

const yn = (v: string | null | undefined) => (v ? v.charAt(0).toUpperCase() + v.slice(1).replace(/_/g, " ") : "Not answered");
const shortWhen = (s: string) => new Date(s).toLocaleString("en-AU", { timeZone: "Australia/Melbourne", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const when = (s: string | null | undefined) => (s ? new Date(s).toLocaleString("en-AU", { timeZone: "Australia/Melbourne" }) : "—");

/** Read-only website intake summary. Declarations are labelled as owner-declared, never verified. */
export function IntakeSummary({ jobId }: { jobId: string }) {
  const fn = useServerFn(getIntakeSummary);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["intake_summary", jobId], queryFn: () => fn({ data: { jobId } }) });
  if (isLoading) return <div className="rounded-md border p-4 text-sm text-muted-foreground">Loading intake and consent evidence…</div>;
  if (error || !data) return <section id="target-intake-consent" data-portal-focus="target" tabIndex={-1} className="scroll-mt-4 rounded-md border border-danger bg-danger-soft p-4 text-sm text-danger outline-none"><h3 className="font-semibold">Consent evidence unavailable</h3><p>Consent evidence could not be loaded. Treat consent as missing until it is checked.</p><button type="button" className="mt-2 font-semibold underline" onClick={() => void refetch()}>Try again</button></section>;
  const c = data.consent;
  // Jo 27 Oct 2026: one or two lines, not a box of "Not answered" rows. Unanswered extras are left out.
  if (data.source !== "base44") {
    const given = c?.consent_status === "granted";
    const extras = [c?.age_confirmed == null ? null : `Over 18: ${c.age_confirmed ? "yes" : "no"}`, c?.contact_preference ? `Prefers ${c.contact_preference}` : null].filter(Boolean);
    return (
      <section id="target-intake-consent" data-portal-focus="target" tabIndex={-1} className="scroll-mt-4 flex flex-col gap-1 text-sm outline-none">
        <div className="flex flex-wrap items-center gap-2">
          {given ? <Pill t="good">Owner agreed to be contacted</Pill> : <Pill t="bad">No contact consent — don't contact the owner</Pill>}
          {given && c?.consented_at && <span className="text-muted-foreground">{shortWhen(c.consented_at)}{data.source ? ` · ${yn(data.source)}` : ""}</span>}
        </div>
        {extras.length > 0 && <p className="text-muted-foreground">{extras.join(" · ")}</p>}
      </section>
    );
  }
  return (
    <section id="target-intake-consent" data-portal-focus="target" tabIndex={-1} className="scroll-mt-4 rounded-md border bg-card p-4 outline-none">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">Contact and photos</h3>
        {data.reference && <span className="text-xs text-muted-foreground">Ref {data.reference}</span>}
        {c?.consent_status === "granted"
          ? <Pill t="good">Contact consent granted</Pill>
          : <Pill t="bad">Contact consent missing — no external contact</Pill>}
        {data.postIntake && data.postIntake.status !== "complete" && (
          <Pill t={data.postIntake.status === "failed" ? "bad" : "warn"}>
            {data.postIntake.status === "failed" ? "Initial eligibility checks failed" : "Initial eligibility checks processing"} · {data.postIntake.status}
            {data.postIntake.attempts ? ` · attempt ${data.postIntake.attempts}` : ""}
          </Pill>
        )}
      </div>
      {data.postIntake?.last_error && data.postIntake.status !== "complete" && (
        <p className="mb-2 text-xs text-muted-foreground">Last error: {data.postIntake.last_error} · next try {when(data.postIntake.available_at)}</p>
      )}
      {data.postIntake?.status === "complete" && <p className="mb-2 text-xs text-muted-foreground">Initial eligibility checks complete {when(data.postIntake.completed_at)}</p>}
      {data.buildDecade && <p className="mb-2 text-sm"><span className="font-semibold">Home built:</span> {data.buildDecade} (owner declared on website)</p>}
      {data.insulationTap && <div className="mb-4 text-sm"><p className="font-semibold">Owner-declared insulation details</p><p>{yn(data.insulationTap.answers.insulation_type)} · {yn(data.insulationTap.answers.insulation_thickness)}</p><p>House built: {yn(data.insulationTap.answers.house_built_period)} (owner declared)</p></div>}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1 text-sm">
          <div className="text-xs font-medium uppercase text-muted-foreground">Contact</div>
          <div>Consent: {c ? `${yn(c.consent_status)}${c.consent_version ? ` · version ${c.consent_version}` : ""} · ${when(c.consented_at)}` : "No record"}</div>
          <div>Age confirmed: {c?.age_confirmed == null ? "Not answered" : c.age_confirmed ? "Yes" : "No"}</div>
          <div>Assistance: {yn(c?.assistance)}</div>
          <div>Preferred contact: {c?.contact_preference ?? "Not given"}</div>
        </div>
        <div className="space-y-1 text-sm">
          <div className="text-xs font-medium uppercase text-muted-foreground">Photos & videos ({data.media.length})</div>
          {data.media.map((m) => (
            <div key={m.id}>{m.url ? <button type="button" className="text-primary underline" onClick={() => openFileViewer(m.url, m.name)}>{m.name}</button> : m.name}</div>
          ))}
          {data.lastMediaFailure && <div className="text-destructive">{data.lastMediaFailure.summary} ({when(data.lastMediaFailure.created_at)})</div>}
          {/* Decision 238: office photo review dropped — photos stay on the job for the installer and the file. */}
        </div>
      </div>
    </section>
  );
}
