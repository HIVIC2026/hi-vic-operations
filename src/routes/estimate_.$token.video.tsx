import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { EstimateHeader } from "@/components/portal/EstimateHeader";
import { finishCaptureUpload, getCaptureStatus, startCaptureUpload } from "@/lib/owner-capture.functions";
import { CaptureUploads } from "@/components/owner/CaptureUploads";
import { INSULATION_REVIEW_OPTIONS, type InsulationReviewOption } from "@/lib/insulation-review.core";
import { submitInsulationDeclaration } from "@/lib/launch-campaign.functions";
import { Button } from "@/components/ui/button";

// Public no-login optional homeowner video. The token is the only credential; nothing is fetched during SSR.
export const Route = createFileRoute("/estimate_/$token/video")({
  ssr: false,
  headers: () => ({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" }),
  head: () => ({
    meta: [
      { title: "Existing insulation review — Home Insulation Victoria" },
      { name: "description", content: "Answer existing insulation questions or submit photos and video for review." },
      { property: "og:title", content: "Existing insulation review — Home Insulation Victoria" },
      { property: "og:description", content: "Answer existing insulation questions or submit evidence for office review." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: VideoPage,
});

function VideoPage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const status = useServerFn(getCaptureStatus);
  const start = useServerFn(startCaptureUpload);
  const finish = useServerFn(finishCaptureUpload);
  const declare = useServerFn(submitInsulationDeclaration);
  const [option, setOption] = useState<InsulationReviewOption | null>(null);
  const [declaring, setDeclaring] = useState(false);
  const [declared, setDeclared] = useState(false);
  const [declarationError, setDeclarationError] = useState<string | null>(null);
  const submitDeclaration = async () => {
    if (declaring || (option !== "loose_fill_only" && option !== "below_r2")) return;
    setDeclaring(true); setDeclarationError(null);
    try { await declare({ data: { token, confirmed: true, declaration: option } }); setDeclared(true); await navigate({ to: "/estimate/$token/campaign", params: { token } }); }
    catch (e) { setDeclarationError(e instanceof Error ? e.message : "Please try again."); }
    finally { setDeclaring(false); }
  };
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["capture", token], queryFn: () => status({ data: { token } }), retry: false, refetchOnWindowFocus: false });
  const [uploading, setUploading] = useState(false);
  const stored = useRef(new Map<File, string>());
  const upload = async (file: File) => {
    let path = stored.current.get(file);
    if (!path) {
      const slot = await start({ data: { token, fileName: file.name, mime: file.type, size: file.size } });
      const result = await supabase.storage.from("job-files").uploadToSignedUrl(slot.path, slot.uploadToken, file, { contentType: slot.mime });
      if (result.error) throw new Error("The upload was interrupted. Please check your connection and try again.");
      path = slot.path;
      stored.current.set(file, path);
    }
    const result = await finish({ data: { token, path, fileName: file.name, deviceModifiedAt: file.lastModified || null } });
    if (!result?.recorded) throw new Error("Your file could not be confirmed. Please try again.");
  };

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
        ) : data.originalMedia?.excluded ? (
          <section className="mt-6 p-6" role="status">
            <h1 className="font-display text-3xl font-bold">{data.originalMedia.received ? "We've received your insulation photos/video" : "We're checking your enquiry uploads"}</h1>
            <p className="mt-3">{data.mediaReview === "below_r2" ? "Your evidence has been reviewed. Return to your savings to see your next step." : data.mediaReview === "over_r2" ? "Our office has assessed your existing insulation as not eligible. Please contact us with any questions." : data.mediaReview === "unclear" ? "Your evidence has been reviewed. Our office will help with the next check." : data.originalMedia.received ? "Your existing evidence is with our office for review. You do not need to upload it again." : "You do not need to answer these questions or upload again while we check your original enquiry."}</p>
            <Button asChild variant="link" className="mt-3"><Link to="/estimate/$token/campaign" params={{ token }}>Return to my savings</Link></Button>
          </section>
        ) : data.resume === "spot_saved" || data.resume === "declared" ? (
          <section className="mt-6 p-6" role="status">
            <h1 className="font-display text-3xl font-bold">{data.resume === "spot_saved" ? "Your spot is saved" : "Answer received"}</h1>
            <p className="mt-3">{data.resume === "spot_saved" ? "You don't need to answer these questions again." : "Your Yes is recorded as a homeowner declaration, not verified insulation. You can now save your spot."}</p>
            <Button asChild className="mt-4 h-12"><Link to="/estimate/$token/campaign" params={{ token }}>{data.resume === "spot_saved" ? "Return to my savings" : "Continue to Save my spot"}</Link></Button>
          </section>
        ) : (
          <div className="mt-6 space-y-4">
            <section className="rounded-2xl border bg-card p-6">
               <p className="text-xs font-bold uppercase tracking-wide text-primary">Jump the queue · {data.reference}{data.suburb ? ` · ${data.suburb}` : ""}</p>
                <h1 className="mt-1 font-display text-3xl font-bold leading-tight">Help us check your existing insulation</h1>
                <p className="mt-3 text-[15px]">Choose one option below.</p>
                <div className="mt-4 space-y-2" role="radiogroup" aria-label="Existing insulation check">
                  {INSULATION_REVIEW_OPTIONS.map((item) => <Button key={item.id} role="radio" aria-checked={option === item.id} variant={option === item.id ? "default" : "outline"} disabled={declaring || uploading} className="h-auto min-h-12 w-full whitespace-normal text-left justify-start" onClick={() => { if (option === item.id) return; setOption(item.id); setDeclared(false); setDeclarationError(null); }}>{item.label}</Button>)}
                </div>
                {option === "loose_fill_only" && <p className="mt-3 text-sm">Loose material, with no insulation batts.</p>}
                <p className="mt-3 text-sm text-muted-foreground">Not sure? You can upload photos or a video, or we can check onsite.</p>
            </section>
            {(option === "photos" || option === "video") &&
            <section className="rounded-2xl border bg-card p-6" aria-live="polite">
              <CaptureUploads kind={option} remaining={data.remaining} received={data.received} uploadFile={upload} onSaved={refetch} onBusyChange={setUploading} />
              <Button asChild variant="link" className="mt-2"><Link to="/estimate/$token/campaign" params={{ token }}>Return to my savings</Link></Button>
            </section>}
            {(option === "loose_fill_only" || option === "below_r2") && <section className="rounded-2xl border bg-card p-6 text-sm">
              <h2 className="font-display text-lg font-bold">Your answer</h2>
              <p className="mt-2">Your Yes is recorded as a homeowner declaration, not verified insulation. Final onsite checks still apply.</p>
              {declared ? <p role="status" className="mt-3">Answer received. You can now save your spot.</p> : <>
                <div className="mt-4 flex gap-2"><Button className="h-12 flex-1" disabled={declaring} onClick={() => void submitDeclaration()}>{declaring ? "Saving answer…" : "Yes"}</Button><Button variant="outline" className="h-12 flex-1" disabled={declaring} onClick={() => setDeclarationError("Please upload photos or a video, or we can check onsite.")}>No</Button><Button variant="outline" className="h-12 flex-1" disabled={declaring} onClick={() => setDeclarationError("Please upload photos or a video, or we can check onsite.")}>Not sure</Button></div>
                {declarationError && <p role="status" className="mt-2">{declarationError}</p>}
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
