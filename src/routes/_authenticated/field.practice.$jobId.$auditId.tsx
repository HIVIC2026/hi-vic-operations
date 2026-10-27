import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { readPracticeForm, completePracticeForm } from "@/lib/mitti-practice.functions";
import { PRACTICE_FIELDS } from "@/lib/mitti-practice.core";
import { Button } from "@/components/ui/button";
const options = (jobId: string, auditId: string) => queryOptions({ queryKey: ["practice-form", jobId, auditId], queryFn: () => readPracticeForm({ data: { jobId, auditId } }) });
export const Route = createFileRoute("/_authenticated/field/practice/$jobId/$auditId")({
  head: () => ({ meta: [{ title: "TEST Ready Check – Home Insulation Victoria" }, { name: "description", content: "Isolated TEST Ready Check form." }, { property: "og:title", content: "TEST Ready Check – Home Insulation Victoria" }, { property: "og:description", content: "Isolated TEST Ready Check form." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" }] }),
  loader: ({ params, context }) => context.queryClient.ensureQueryData(options(params.jobId, params.auditId)), component: Practice,
});
function Practice() {
  const { jobId, auditId } = Route.useParams();
  const { data } = useSuspenseQuery(options(jobId, auditId));
  const complete = useServerFn(completePracticeForm);
  const [values, setValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState<typeof data | null>(null);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const done = result?.completed ?? data.completed;
  return <main className="mx-auto max-w-lg p-5 space-y-5"><h1 className="text-2xl font-semibold">TEST Ready Check · {data.jobNumber}</h1>{done ? <><p>Complete</p>{result?.issues.map(issue => <p key={issue}>{issue}</p>)}<Link to="/field/$jobId" params={{ jobId }}>Back to job</Link></> : <form className="space-y-4" onSubmit={async e => { e.preventDefault(); setBusy(true); setError(""); try { setResult(await complete({ data: { jobId, auditId, values } })); } catch (err) { setError(err instanceof Error ? err.message : "The form wasn't saved."); } finally { setBusy(false); } }}>{PRACTICE_FIELDS.map(label => <label key={label} className="block text-sm">{label}<input required className="mt-1 block w-full rounded border border-input bg-background p-3 text-foreground" value={values[label] ?? ""} onChange={e => setValues(v => ({ ...v, [label]: e.target.value }))} /></label>)}{error && <p role="alert">{error}</p>}<Button type="submit" disabled={busy}>{busy ? "Saving…" : "Complete"}</Button></form>}</main>;
}