import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { getOwnerEligibilityForm, submitOwnerEligibility } from "@/lib/owner-eligibility.functions";
import { OWNER_QUESTIONS } from "@/lib/owner-eligibility.core";
import logo from "@/assets/home-insulation-victoria-logo.png.asset.json";

const TITLE = "Quick eligibility questions – Home Insulation Victoria";
const DESC = "A few quick questions to check whether your home may be eligible for the ceiling insulation discount.";

export const Route = createFileRoute("/eligibility/$token")({
  ssr: false,
  head: () => ({ meta: [{ title: TITLE }, { name: "description", content: DESC }, { name: "robots", content: "noindex, nofollow" }, { name: "referrer", content: "no-referrer" }, { property: "og:title", content: TITLE }, { property: "og:description", content: DESC }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: OwnerEligibility,
});

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="estimate-brand mx-auto min-h-screen max-w-lg bg-estimate-canvas px-4 py-6 text-estimate-navy"><img src={logo.url} alt="Home Insulation Victoria" className="mb-6 h-10" />{children}</main>;
}

function OwnerEligibility() {
  const { token } = Route.useParams();
  const load = useServerFn(getOwnerEligibilityForm);
  const submit = useServerFn(submitOwnerEligibility);
  const { data, error } = useQuery({ queryKey: ["owner-elig", token], queryFn: () => load({ data: { token } }), retry: false });
  const [a, setA] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (error) return <Shell><div className="rounded-xl border bg-card p-6 text-center font-semibold">{error.message}</div></Shell>;
  if (!data) return <Shell><p className="text-muted-foreground">Loading…</p></Shell>;
  const done = result ?? data.done?.label ?? null;
  if (done) return <Shell><div className="rounded-xl border bg-card p-6"><h1 className="font-display text-xl font-bold">Thank you</h1><p className="mt-2">Your answers have been saved. Result: <strong>{done}</strong>.</p><p className="mt-2 text-sm text-muted-foreground">{data.installer ? `${data.installer} will` : "We will"} be in touch about the next step.</p></div></Shell>;
  const qs = Object.entries(OWNER_QUESTIONS).filter(([k]) => k !== "top_floor" || a["property_type"] === "unit");
  return (
    <Shell>
      <h1 className="font-display text-2xl font-bold">A few quick questions</h1>
      <p className="mt-1 text-muted-foreground">About your home{data.suburb ? ` in ${data.suburb}` : ""}{data.installer ? `, for ${data.installer}` : ""}. It takes under a minute. Nothing to sign.</p>
      <form className="mt-6 space-y-6" onSubmit={async (e) => {
        e.preventDefault(); setErr(""); setBusy(true);
        try { const r = await submit({ data: { token, answers: a } }); setResult(r.label); } catch (x) { setErr(x instanceof Error ? x.message : "Please try again."); } finally { setBusy(false); }
      }}>
        {qs.map(([k, q]) => (
          <fieldset key={k}>
            <legend className="mb-2 font-semibold">{q.label}</legend>
            <div className="grid gap-2">
              {q.options.map(([v, label]) => (
                <label key={v} className={`flex h-12 cursor-pointer items-center gap-3 rounded-lg border px-3 ${a[k] === v ? "border-primary bg-accent" : "bg-card"}`}>
                  <input type="radio" name={k} value={v} checked={a[k] === v} onChange={() => setA({ ...a, [k]: v })} />{label}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        {err && <p role="alert" className="text-sm font-medium text-destructive">{err}</p>}
        <Button type="submit" className="h-12 w-full" disabled={busy}>{busy ? "Saving…" : "Submit answers"}</Button>
      </form>
    </Shell>
  );
}
