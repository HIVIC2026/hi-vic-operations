import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { EstimateHeader } from "@/components/portal/EstimateHeader";
import { finishCaptureUpload, getCaptureStatus, startCaptureUpload } from "@/lib/owner-capture.functions";
import { validateCaptureFile } from "@/lib/owner-capture.core";
import { PUBLIC_CALCULATOR_URL } from "@/lib/estimate-email";

// Public no-login optional homeowner video. The token is the only credential; nothing is fetched during SSR.
export const Route = createFileRoute("/estimate_/$token/video")({
  ssr: false,
  headers: () => ({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" }),
  head: () => ({
    meta: [
      { title: "Send us a short ceiling video — Home Insulation Victoria" },
      { name: "description", content: "Optionally send Home Insulation Victoria a short phone video of your existing ceiling insulation." },
      { property: "og:title", content: "Send us a short ceiling video — Home Insulation Victoria" },
      { property: "og:description", content: "Optional phone video for your insulation enquiry." },
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
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["capture", token], queryFn: () => status({ data: { token } }), retry: false, refetchOnWindowFocus: false });
  const [phase, setPhase] = useState<Phase>({ k: "idle" });
  const last = useRef<File | null>(null);
  const cam = useRef<HTMLInputElement>(null);
  const pick = useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    last.current = file;
    const v = validateCaptureFile({ mime: file.type, fileName: file.name, size: file.size });
    if (!v.ok) return setPhase({ k: "error", msg: v.error });
    setPhase({ k: "uploading", name: file.name });
    try {
      const s = await start({ data: { token, fileName: file.name, mime: file.type, size: file.size } });
      const up = await supabase.storage.from("job-files").uploadToSignedUrl(s.path, s.uploadToken, file, { contentType: s.mime });
      if (up.error) throw new Error("The upload was interrupted. Please check your connection and try again.");
      const r = await finish({ data: { token, path: s.path, fileName: file.name, deviceModifiedAt: file.lastModified || null } });
      setPhase({ k: "done", duplicate: r.duplicate });
      void refetch();
    } catch (e) {
      setPhase({ k: "error", msg: e instanceof Error ? e.message : "Upload failed. Please try again." });
    }
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
            <p className="mt-2 text-sm text-muted-foreground">Please contact Home Insulation Victoria and we'll help.</p>
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            <section className="rounded-2xl border bg-card p-6">
              <p className="text-xs font-bold uppercase tracking-wide text-primary">Optional · {data.reference}{data.suburb ? ` · ${data.suburb}` : ""}</p>
               <h1 className="mt-1 font-display text-3xl font-bold leading-tight">Send a short video from the manhole</h1>
               <p className="mt-3 text-[15px]">A short phone video helps our office check the insulation level from the desk. You can also send photos.</p>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
                <li>Only record if you can do it safely — for example, holding your phone up through the ceiling hatch while standing on a stable ladder.</li>
                <li><strong>Please don't climb into or walk through the roof space.</strong></li>
                 <li>Slowly pan across the insulation for 20–60 seconds. You can also add clear photos. Up to five files.</li>
              </ul>
            </section>
            <section className="rounded-2xl border bg-card p-6" aria-live="polite">
              <input ref={cam} type="file" accept="video/*" capture="environment" className="hidden" onChange={onFile} data-testid="camera-input" />
               <input ref={pick} type="file" accept="video/*,image/*,.mov,.mp4,.m4v,.heic,.heif" className="hidden" onChange={onFile} data-testid="upload-input" />
              {phase.k === "done" ? (
                <div role="status" className="text-center">
                   <h2 className="font-display text-xl font-bold">Thanks — we've got your file</h2>
                   <p className="mt-2 text-sm text-muted-foreground">Our office will review it. Your answer stays declared and this desk check does not confirm final eligibility.</p>
                </div>
              ) : data.remaining <= 0 ? (
                 <p role="status" className="text-center text-sm">We've already received your files. Thank you!</p>
              ) : (
                <div className="space-y-3">
                  <button disabled={phase.k === "uploading"} onClick={() => cam.current?.click()} className="h-12 w-full rounded-xl bg-primary font-bold text-primary-foreground disabled:opacity-60">Record a video</button>
                   <button disabled={phase.k === "uploading"} onClick={() => pick.current?.click()} className="h-12 w-full rounded-xl border font-bold disabled:opacity-60">Choose a video or photo</button>
                  {phase.k === "uploading" && <p role="status" className="text-center text-sm">Uploading {phase.name}… please keep this page open.</p>}
                  {phase.k === "error" && <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">{phase.msg}{last.current && <button className="ml-2 font-semibold underline" onClick={() => last.current && upload(last.current)}>Try again</button>}</div>}
                   <p className="text-xs text-muted-foreground">You can return to this page to add more files.</p>
                </div>
              )}
            </section>
            <section className="rounded-2xl border bg-card p-6 text-sm">
              <h2 className="font-display text-lg font-bold">Can't record safely?</h2>
              <p className="mt-1">That's completely fine — skip this step. We'll check your existing insulation at the free onsite visit.</p>
              <p className="mt-3"><a href={PUBLIC_CALCULATOR_URL} className="font-semibold text-primary underline">Check your estimate with our calculator</a></p>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
