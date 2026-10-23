import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { EstimateHeader } from "@/components/portal/EstimateHeader";
import { finishCaptureUpload, getCaptureStatus, startCaptureUpload } from "@/lib/owner-capture.functions";
import { CaptureUploads } from "@/components/owner/CaptureUploads";
import { type InsulationReviewOption } from "@/lib/insulation-review.core";
import { submitInsulationTapAnswers } from "@/lib/insulation-details.functions";
import { INSULATION_DETAIL_QUESTIONS, type InsulationTapAnswers } from "@/lib/insulation-details.core";
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
  const status = useServerFn(getCaptureStatus);
  const start = useServerFn(startCaptureUpload);
  const finish = useServerFn(finishCaptureUpload);
  const declare = useServerFn(submitInsulationTapAnswers);
  const [mode,setMode]=useState<"upload"|"questions"|null>(null);
  const [answers,setAnswers]=useState<Partial<InsulationTapAnswers>>({});
  const [option, setOption] = useState<InsulationReviewOption | null>(null);
  const [declaring, setDeclaring] = useState(false);
  const [declared, setDeclared] = useState(false);
  const [savedRoute,setSavedRoute]=useState<string|null>(null);
  const [declarationError, setDeclarationError] = useState<string | null>(null);
  const submitDeclaration = async () => {
    if (declaring || !answers.insulation_type || !answers.insulation_thickness || !answers.house_built_period) return;
    setDeclaring(true); setDeclarationError(null);
    try { const result=await declare({ data: { token, answers: answers as InsulationTapAnswers } }); setSavedRoute(result.route);setDeclared(true); }
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
        ) : data.morePhotosUploadAllowed ? (
          <section className="mt-6 space-y-4 rounded-2xl border bg-card p-6">
            <h1 className="font-display text-3xl font-bold">Add the photos or video we requested</h1>
            <p>Our office needs clearer photos or video to continue reviewing your enquiry. Final eligibility is confirmed at your free Ready Check.</p>
            <div className="flex gap-2">
              <Button variant={option === 'photos' ? 'default' : 'outline'} disabled={uploading} onClick={() => setOption('photos')}>Photos</Button>
              <Button variant={option === 'video' ? 'default' : 'outline'} disabled={uploading} onClick={() => setOption('video')}>Video</Button>
            </div>
            {(option === 'photos' || option === 'video') && <CaptureUploads kind={option} remaining={data.remaining} received={data.received} uploadFile={upload} onSaved={refetch} onBusyChange={setUploading} />}
            <p className="text-sm text-muted-foreground">Do not enter the roof space. If you cannot check safely, contact us.</p>
            {!uploading && <Button asChild variant="link"><Link to="/estimate/$token/campaign" params={{ token }}>Return to my savings</Link></Button>}
          </section>
        ) : data.originalMedia?.excluded && mode !== "questions" && !declared && !data.detailsRoute ? (
          <section className="mt-6 p-6" role="status">
            <h1 className="font-display text-3xl font-bold">{data.originalMedia.received ? "We've received your insulation photos/video" : "We're checking your enquiry uploads"}</h1>
            <p className="mt-3">{data.mediaReview === "below_r2" ? "Your evidence has been reviewed. Return to your savings to see your next step." : data.mediaReview === "over_r2" ? "Our office has assessed your existing insulation as not eligible. Please contact us with any questions." : data.mediaReview === "unclear" ? "Your evidence has been reviewed. Our office will help with the next check." : data.originalMedia.received ? "Your existing evidence is with our office for review. You do not need to upload it again." : "You do not need to answer these questions or upload again while we check your original enquiry."}</p>
            {data.originalMedia.received && !data.mediaReview && <Button className="mt-3 h-12 w-full" variant="outline" onClick={() => setMode("questions")}>Answer three quick questions</Button>}
            <Button asChild variant="link" className="mt-3"><Link to="/estimate/$token/campaign" params={{ token }}>Return to my savings</Link></Button>
          </section>
        ) : (data.detailsRoute === "needs_onsite_assessment" || savedRoute === "needs_onsite_assessment") ? <section className="mt-6 space-y-3"><h1 className="font-display text-3xl font-bold">Answers received</h1><p>Your insulation needs an onsite assessment. We’re not offering a spot yet.</p></section> : declared || data.detailsRoute === 'thin_patchy' ? <section className="mt-6 space-y-3" role="status"><h1 className="font-display text-3xl font-bold">Answers received</h1><p>Thank you — your answers are saved. Final eligibility is confirmed at your free Ready Check.</p></section> : data.resume === "spot_saved" || data.resume === "declared" ? (
          <section className="mt-6 p-6" role="status">
            <h1 className="font-display text-3xl font-bold">{data.resume === "spot_saved" ? "Your spot is saved" : "Answer received"}</h1>
            <p className="mt-3">{data.resume === "spot_saved" ? "You don't need to answer these questions again." : "Your Yes is recorded as a owner declaration, not verified insulation. You can now save your spot."}</p>
            <Button asChild className="mt-4 h-12"><Link to="/estimate/$token/campaign" params={{ token }}>{data.resume === "spot_saved" ? "Return to my savings" : "Continue to Save my spot"}</Link></Button>
          </section>
        ) : (
          <div className="mt-6 space-y-5">
            <h1 className="font-display text-3xl font-bold">Tell us about your insulation</h1>
            <div className="grid gap-3"><Button className="h-14 whitespace-normal" variant={mode==="upload"?"default":"outline"} onClick={()=>setMode("upload")}>Upload photos or a video</Button><Button className="h-14" variant={mode==="questions"?"default":"outline"} onClick={()=>setMode("questions")}>Answer three quick questions</Button></div>
            {mode==="upload" && <><div className="flex gap-2"><Button className="h-12" variant={option==="photos"?"default":"outline"} onClick={()=>setOption("photos")}>Photos</Button><Button className="h-12" variant={option==="video"?"default":"outline"} onClick={()=>setOption("video")}>Video</Button></div>{(option==="photos"||option==="video")&&<CaptureUploads kind={option} remaining={data.remaining} received={data.received} uploadFile={upload} onSaved={refetch} onBusyChange={setUploading}/>}<p className="text-sm text-muted-foreground">Only if you can do it safely. Please don’t enter the roof space.</p></>}
            {mode==="questions" && <>{INSULATION_DETAIL_QUESTIONS.map(q=><fieldset key={q.key} className="space-y-2"><legend className="mb-2 font-semibold">{q.label}</legend>{q.options.map(o=><Button key={o.value} className="h-auto min-h-12 w-full justify-start whitespace-normal text-left" role="radio" aria-checked={answers[q.key]===o.value} variant={answers[q.key]===o.value?"default":"outline"} disabled={declaring||declared} onClick={()=>setAnswers(a=>({...a,[q.key]:o.value}))}>{o.label}</Button>)}</fieldset>)}<Button className="h-12 w-full" disabled={declaring||declared||!answers.insulation_type||!answers.insulation_thickness||!answers.house_built_period} onClick={()=>void submitDeclaration()}>{declaring?"Saving…":"Save my answers"}</Button>{declared&&<p role="status">Thank you — your answers are saved. Your free Ready Check will confirm the insulation on site.</p>}{declarationError&&<p role="alert" className="text-sm text-destructive">{declarationError}</p>}</>}
          </div>
        )}
      </main>
    </div>
  );
}
