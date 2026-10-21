import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/portal/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getCampaignEmailReview, saveCampaignEmailDraft } from "@/lib/campaign-emails.functions";
import { renderLaunchGroupEmail, type LaunchCopyField } from "@/lib/estimate-email";
import { cn } from "@/lib/utils";

const title = "Campaign emails – Home Insulation Victoria Operations";
const description = "Review and refine the hot-lead campaign emails exactly as owners will see them. Preview only — nothing sends.";
// P1-S77: retired. The Group A/B campaign copy edited here was superseded by Jo's approved templates (15 Oct 2026)
// and was never used by any sender. Office manages homeowner emails only in Templates › Email.
export const Route = createFileRoute("/_authenticated/admin/campaign-emails")({
  beforeLoad: () => { throw redirect({ to: "/admin/templates", search: { cat: "email" }, replace: true }); },
  head: () => ({ meta: [{ title }, { name: "description", content: description }, { property: "og:title", content: title }, { property: "og:description", content: description }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: CampaignEmailsPage,
});

type Group = "likely" | "onsite";
type Copy = Partial<Record<LaunchCopyField, string>>;
type Lead = { id: string; jobNumber: string | null; name: string | null; suburb: string | null; address: string | null; area: number; price: number | null; discount: number | null };

const SAMPLE_URL = "https://estimate.homeinsulationvictoria.com.au/estimate/PREVIEWonlyPREVIEWonlyPREVIEWonlyPREVIEWonl/campaign";
/** Office preview only: sample buttons open the sample owner pages in a new tab. The email itself is unchanged. */
function previewClickable(html: string) {
  const base = SAMPLE_URL.replace(/\/campaign$/, "");
  const target = typeof window === "undefined" ? "/campaign-preview" : `${window.location.origin}/campaign-preview`;
  return html.replace(/<head>/i, `<head><base target="_blank">`).split(`href="${base}`).join(`data-sample="1" href="${target}#`);
}
const SAMPLE: Lead = { id: "sample", jobNumber: "HV-SAMPLE", name: "Sarah Mitchell", suburb: "Frankston", address: "14 Banksia Street, Frankston VIC 3199", area: 120, price: 1188, discount: 1890 };
const GROUP_LABEL: Record<Group, string> = { likely: "Group A — no insulation (Save my spot)", onsite: "Group B — has insulation (video check)" };
const FIELDS: { key: LaunchCopyField; label: string; long?: boolean; onsiteOnly?: boolean }[] = [
  { key: "subject", label: "Subject line" }, { key: "previewText", label: "Preview text" },
  { key: "headline", label: "Headline" }, { key: "intro", label: "Main paragraph", long: true },
  { key: "video", label: "Video paragraph", long: true, onsiteOnly: true }, { key: "nextTitle", label: "Next-step heading" },
  { key: "urgency", label: "Demand paragraph", long: true }, { key: "button", label: "Button text" },
];

function CampaignEmailsPage() {
  const load = useServerFn(getCampaignEmailReview);
  const save = useServerFn(saveCampaignEmailDraft);
  const qc = useQueryClient();
  const { data, isPending, error } = useQuery({ queryKey: ["campaign-email-review"], queryFn: () => load() });
  const [group, setGroup] = useState<Group>("likely");
  const [device, setDevice] = useState<"phone" | "desktop">("phone");
  const [leadId, setLeadId] = useState<string>("");
  const [copy, setCopy] = useState<Record<Group, Copy>>({ likely: {}, onsite: {} });
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (data) setCopy({ likely: data.likely.draft.copy, onsite: data.onsite.draft.copy }); }, [data]);
  useEffect(() => { setLeadId(""); }, [group]);

  const leads: Lead[] = data?.[group].leads ?? [];
  const lead = leads.find((l) => l.id === leadId) ?? leads[0] ?? SAMPLE;
  const defaults = useMemo(() => render(group, lead, {}), [group, lead]);
  const email = useMemo(() => render(group, lead, copy[group]), [group, lead, copy]);

  const doSave = async () => {
    setSaving(true);
    try { await save({ data: { group, copy: copy[group] } }); toast.success("Draft saved — nothing sent"); void qc.invalidateQueries({ queryKey: ["campaign-email-review"] }); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't save the draft"); }
    finally { setSaving(false); }
  };

  return (
    <AppShell wide>
      <div className="space-y-4">
        <div>
          <h1 className="font-display text-2xl font-bold">Campaign emails (legacy drafts)</h1>
          <p className="text-sm text-muted-foreground">Preview only — there is no send button and nothing is sent from this page.</p>
          <p className="mt-1 text-sm font-semibold text-warning">
            These drafts are NOT used by any email. The owner emails that actually send are Jo's approved T1–T8 in{" "}
            <Link to="/admin/templates" className="underline">Templates</Link>.
          </p>
        </div>
        {isPending && <p>Loading leads…</p>}
        {error && <p className="text-danger">{(error as Error).message}</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          {(["likely", "onsite"] as Group[]).map((g) => (
            <button key={g} type="button" onClick={() => setGroup(g)} className={cn("rounded-[22px] border bg-card p-4 text-left shadow-sm", group === g && "ring-2 ring-primary")}>
              <div className="text-sm font-semibold">{GROUP_LABEL[g]}</div>
              <div className="font-display text-3xl font-extrabold">{data ? data[g].leads.length : "—"}</div>
              <div className="text-xs text-muted-foreground">leads in this group</div>
            </button>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
          <section className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-sm font-semibold" htmlFor="lead">Lead</label>
              <select id="lead" className="h-10 min-w-0 flex-1 rounded-md border bg-card px-2 text-sm" value={lead.id} onChange={(e) => setLeadId(e.target.value)}>
                {leads.length === 0 && <option value="sample">Sample lead — {SAMPLE.name}, {SAMPLE.suburb}</option>}
                {leads.map((l) => <option key={l.id} value={l.id}>{l.name} · {l.suburb ?? "—"} · {l.area} m² · rebate ${Math.round(l.discount ?? 0).toLocaleString("en-AU")}</option>)}
              </select>
              <div className="flex rounded-full border p-0.5" role="group" aria-label="View size">
                {(["phone", "desktop"] as const).map((d) => <Button key={d} size="sm" variant={device === d ? "default" : "ghost"} className="rounded-full capitalize" onClick={() => setDevice(d)}>{d}</Button>)}
              </div>
            </div>
            {"error" in email ? <p className="text-danger">{email.error}</p> : (
              <>
                <div className="rounded-[22px] border bg-card p-4 text-sm shadow-sm">
                  <div><span className="text-muted-foreground">Subject: </span><strong>{email.subject}</strong></div>
                  <div className="mt-1"><span className="text-muted-foreground">Preview text: </span>{email.previewText}</div>
                </div>
                <div className="flex justify-center rounded-[22px] border bg-muted/40 p-3">
                  <iframe title="Email preview" srcDoc={previewClickable(email.html)} sandbox="allow-popups allow-popups-to-escape-sandbox" className="rounded-xl border bg-card" style={{ width: device === "phone" ? 390 : 680, height: 1500, maxWidth: "100%" }} />
                </div>
              </>
            )}
          </section>

          {group === "likely" ? (
          <aside className="space-y-2 rounded-[22px] border bg-card p-4 text-sm shadow-sm lg:sticky lg:top-24 lg:self-start">
            <h2 className="font-display text-lg font-bold">Wording locked</h2>
            <p className="text-muted-foreground">This is the Jo-approved Save my spot email from the Step 3 email preview. It can't be edited here.</p>
            <a className="font-semibold text-primary underline" href="/step3-email-preview">Open Step 3 email preview</a>
          </aside>
          ) : (
          <aside className="space-y-3 rounded-[22px] border bg-card p-4 shadow-sm lg:sticky lg:top-24 lg:self-start">
            <h2 className="font-display text-lg font-bold">Edit wording</h2>
            <p className="text-xs text-muted-foreground">Blank uses the current wording. Type {"{name}"} for the owner's first name. Saving keeps a draft only.</p>
            {FIELDS.filter((f) => !f.onsiteOnly || group === "onsite").map((f) => {
              const v = copy[group][f.key] ?? "";
              const ph = "error" in defaults ? "" : placeholderFor(f.key, defaults);
              const set = (val: string) => setCopy((c) => ({ ...c, [group]: { ...c[group], [f.key]: val } }));
              return (
                <div key={f.key} className="space-y-1">
                  <label className="text-sm font-semibold" htmlFor={`f-${f.key}`}>{f.label}</label>
                  {f.long ? <Textarea id={`f-${f.key}`} rows={3} value={v} placeholder={ph} onChange={(e) => set(e.target.value)} /> : <Input id={`f-${f.key}`} value={v} placeholder={ph} onChange={(e) => set(e.target.value)} />}
                </div>
              );
            })}
            <div className="flex gap-2">
              <Button className="flex-1" disabled={saving} onClick={() => void doSave()}>{saving ? "Saving…" : "Save draft"}</Button>
              <Button variant="outline" onClick={() => setCopy((c) => ({ ...c, [group]: {} }))}>Reset</Button>
            </div>
            {data?.[group].draft.savedAt && <p className="text-xs text-muted-foreground">Last saved {new Date(data[group].draft.savedAt).toLocaleString("en-AU")}</p>}
          </aside>
          )}
        </div>
      </div>
    </AppShell>
  );
}

const firstName = (n: string | null) => n?.trim().split(/\s+/)[0] ?? null;

function render(group: Group, l: Lead, copy: Copy): { subject: string; previewText: string; html: string; defaults?: never } | { error: string } {
  try {
    const discount = Math.round(l.discount ?? 0), total = Math.round(l.price ?? 0);
    return renderLaunchGroupEmail({ group, campaignUrl: SAMPLE_URL, unsubscribeUrl: `https://estimate.homeinsulationvictoria.com.au/api/public/unsubscribe?t=${"U".repeat(43)}`, firstName: firstName(l.name), estimatedTotal: total, veuDiscount: discount, grossTotal: total + discount, areaM2: l.area, address: l.address, reference: l.jobNumber, copy });
  } catch (e) { return { error: e instanceof Error ? e.message : "This lead can't be previewed" }; }
}

const DEFAULT_TEXT: Partial<Record<LaunchCopyField, string>> = {
  nextTitle: "Save your spot / Want to jump the queue?", urgency: "Demand is high — hundreds of enquiries since 1 October, installers are limited, first come first served.",
  video: "Send one short manhole video so we can check the existing insulation…", button: "Save my spot → / Send my video →",
  headline: "Great news, {name}! / Good news, {name}!", intro: "Your home appears eligible… / could be eligible…",
};
function placeholderFor(k: LaunchCopyField, d: { subject: string; previewText: string }) {
  return k === "subject" ? d.subject : k === "previewText" ? d.previewText : DEFAULT_TEXT[k] ?? "";
}
