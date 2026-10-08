import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { EstimateHeader } from "@/components/portal/EstimateHeader";
import { finishCaptureUpload, getCaptureStatus, startCaptureUpload } from "@/lib/owner-capture.functions";
import { validateCaptureFile } from "@/lib/owner-capture.core";
import { INSULATION_REVIEW_OPTIONS, type InsulationReviewOption } from "@/lib/insulation-review.core";
import { submitInsulationDeclaration } from "@/lib/launch-campaign.functions";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";

// Public no-login optional homeowner video. The token is the only credential; nothing is fetched during SSR.
export const Route = createFileRoute("/estimate_/$token/video")({
  ssr: false,
  headers: () => ({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" }),
  head: () => ({
    meta: [
      { title: "Existing insulation review — Home Insulation Victoria" },
      { name: "description", content: "Submit ceiling insulation video, photos or a below-R2 declaration for office review." },
      { property: "og:title", content: "Existing insulation review — Home Insulation Victoria" },
      { property: "og:description", content: "Submit existing ceiling insulation details for office review." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: VideoPage,
});

type Phase = { k: "idle" } | { k: "uploading"; name: string } | { k: "done"; duplicate: boolean } | { k: "error"; msg: string };

function VideoPage() {
  const { token } = Route.useParams();
  const status = useServerFn(getCaptureStatus);
  const start = useServerFn(startCaptureUpload);
  const finish = useServerFn(finishCaptureUpload);
  const declare = useServerFn(submitInsulationDeclaration);
  const [option, setOption] = useState<InsulationReviewOption | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [declaring, setDeclaring] = useState(false);
  const [declared, setDeclared] = useState(false);
  const [declarationError, setDeclarationError] = useState<string | null>(null);
  const submitDeclaration = async () => {
    if (!confirmed || declaring || (option !== "loose_fill_only" && option !== "below_r2")) return;
    setDeclaring(true); setDeclarationError(null);
    try { await declare({ data: { token, confirmed: true, declaration: option } }); setDeclared(true); }
    catch (e) { setDeclarationError(e instanceof Error ? e.message : "Please try again."); }
    finally { setDeclaring(false); }
  };
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["capture", token], queryFn: () => status({ data: { token } }), retry: false, refetchOnWindowFocus: false });
  const [phase, setPhase] = useState<Phase>({ k: "idle" });
  const last = useRef<File | null>(null);
  const cam = useRef<HTMLInputElement>(null);
  const pick = useRef<HTMLInputElement>(null);
  const uploadBusy = useRef(false);
  const stored = useRef<{ file: File; path: string } | null>(null);

  const upload = async (file: File) => {
    if (uploadBusy.current) return;
    last.current = file;
    const v = validateCaptureFile({ mime: file.type, fileName: file.name, size: file.size });
    if (!v.ok) return setPhase({ k: "error", msg: v.error });
    uploadBusy.current = true;
    setPhase({ k: "uploading", name: file.name });
    try {
      let path = stored.current?.file === file ? stored.current.path : null;
      if (!path) {
        const s = await start({ data: { token, fileName: file.name, mime: file.type, size: file.size } });
        const up = await supabase.storage.from("job-files").uploadToSignedUrl(s.path, s.uploadToken, file, { contentType: s.mime });
        if (up.error) throw new Error("The upload was interrupted. Please check your connection and try again.");
        path = s.path;
        stored.current = { file, path };
      }
      const r = await finish({ data: { token, path, fileName: file.name, deviceModifiedAt: file.lastModified || null } });
      setPhase({ k: "done", duplicate: r.duplicate });
      void refetch();
    } catch (e) {
      setPhase({ k: "error", msg: e instanceof Error ? e.message : "Upload failed. Please try again." });
    } finally { uploadBusy.current = false; }
  };
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); };

  return (
    <div className="estimate-brand min-h-screen bg-estimate-canvas">
      <EstimateHeader />
      <main className="mx-auto max-w-[620px] px-4 pb-14 sm:px-8">
        {isLoading ? <p role="status" className="py-16 text-center text-muted-foreground">Loading…</p>
        : isError || !data || data.state !== "ok" ? (
          <div role="alert" className="mt-8 rounded-2xl border bg-card p-6 text-center">
            <h1 className="font-display text-2xl font-bold">{data?.state === "closed" ? "This request has closed" : "This link isn't available"}</h1>
            <p className="mt-2 text-sm text-muted-foreground">Please contact Home Insulation Victoria and we'll help.</p>{isError && <Button className="mt-3" onClick={() => void refetch()}>Retry</Button>}
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            <section className="rounded-2xl border bg-card p-6">
               <p className="text-xs font-bold uppercase tracking-wide text-primary">Jump the queue · {data.reference}{data.suburb ? ` · ${data.suburb}` : ""}</p>
                <h1 className="mt-1 font-display text-3xl font-bold leading-tight">Help us check your existing insulation</h1>
                <p className="mt-3 text-[15px]">Choose one option below.</p>
                <div className="mt-4 space-y-2" role="radiogroup" aria-label="Existing insulation check">
                  {INSULATION_REVIEW_OPTIONS.map((item) => <Button key={item.id} role="radio" aria-checked={option === item.id} variant={option === item.id ? "default" : "outline"} disabled={declaring || phase.k === "uploading"} className="h-auto min-h-12 w-full whitespace-normal text-left justify-start" onClick={() => { if (option === item.id) return; setOption(item.id); setConfirmed(false); setDeclared(false); setDeclarationError(null); setPhase({ k: "idle" }); last.current = null; }}>{item.label}</Button>)}
                </div>
                {option === "loose_fill_only" && <p className="mt-3 text-sm">Loose material, with no insulation batts.</p>}
                <p className="mt-3 text-sm text-muted-foreground">Not sure? You can upload photos or a video, or we can check onsite.</p>
            </section>
            {(option === "photos" || option === "video") &&
            <section className="rounded-2xl border bg-card p-6" aria-live="polite">
              <input ref={cam} type="file" accept="video/*" capture="environment" className="hidden" onChange={onFile} data-testid="camera-input" />
               <input ref={pick} type="file" accept={option === "photos" ? "image/*,.heic,.heif" : "video/*,.mov,.mp4,.m4v"} className="hidden" onChange={onFile} data-testid="upload-input" />
              {phase.k === "done" ? (
                <div role="status" className="text-center">
                   <h2 className="font-display text-xl font-bold">Thanks — we've got your file</h2>
                    <p className="mt-2 text-sm text-muted-foreground">Your file is awaiting office review. If suitable, we will offer you Save my spot. Your spot is not saved yet.</p><Button asChild variant="link" className="mt-2"><Link to="/estimate/$token/campaign" params={{ token }}>Return to my savings</Link></Button>
                </div>
              ) : data.remaining <= 0 ? (
                 <p role="status" className="text-center text-sm">We've already received your files. Thank you!</p>
              ) : (
                <div className="space-y-3">
                  {option === "video" && <p className="text-sm">Record from the manhole opening. Please do not climb into the roof space. Show the existing insulation clearly.</p>}
                  {option === "photos" && <p className="text-sm">Upload clear photos showing your existing insulation. Please do not climb into the roof space.</p>}
                  {option === "video" && <Button disabled={phase.k === "uploading"} onClick={() => cam.current?.click()} className="h-12 w-full">Record a video</Button>}
                    <Button variant="outline" disabled={phase.k === "uploading"} onClick={() => pick.current?.click()} className="h-12 w-full">{option === "photos" ? "Choose photos" : "Choose a video"}</Button>
                  {phase.k === "uploading" && <p role="status" className="text-center text-sm">Uploading {phase.name}… please keep this page open.</p>}
                  {phase.k === "error" && <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">{phase.msg}{last.current && <Button variant="link" onClick={() => { if (last.current) void upload(last.current); }}>Try again</Button>}</div>}
                   <p className="text-xs text-muted-foreground">You can return to this page to add more files.</p>
                </div>
              )}
            </section>}
            {(option === "loose_fill_only" || option === "below_r2") && <section className="rounded-2xl border bg-card p-6 text-sm">
              <h2 className="font-display text-lg font-bold">Confirm your declaration</h2>
              {declared ? <p role="status" className="mt-3">Your confirmation has been submitted for office review. It does not confirm eligibility or save a spot.</p> : <>
                <label className="mt-3 flex items-center gap-3"><Checkbox checked={confirmed} onCheckedChange={(v) => setConfirmed(v === true)} disabled={declaring} />{option === "loose_fill_only" ? "I confirm it is loose-fill insulation only" : "I confirm my existing insulation is less than R2"}</label>
                <Button className="mt-4 h-12 w-full" disabled={!confirmed || declaring || phase.k === "uploading"} onClick={() => void submitDeclaration()}>{declaring ? "Submitting…" : "Submit for office review"}</Button>
                {declarationError && <p role="alert" className="mt-2 text-destructive">{declarationError}</p>}
              </>}
              <p className="mt-3 text-muted-foreground">Do not enter the roof space. If you cannot check safely or are unsure, contact us.</p>
               <p className="mt-3"><Link to="/estimate/$token/campaign" params={{ token }} className="font-semibold text-primary underline">Return to my savings</Link></p>
            </section>}
          </div>
        )}
      </main>
    </div>
  );
}
