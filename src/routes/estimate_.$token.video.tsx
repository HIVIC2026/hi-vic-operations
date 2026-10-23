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
import { getLaunchCampaignPage, saveMySpot, takeMeOffList } from "@/lib/launch-campaign.functions";
import { REMOVAL_UPTO_NOTE, priceRangeLine, removalUpToLine } from "@/lib/estimate-removal-upto.core";
import { NOT_INTERESTED_REASONS, NOT_INTERESTED_THANKS, type NotInterestedReason } from "@/lib/not-interested.core";

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
  const [answers,setAnswers]=useState<Partial<InsulationTapAnswers>>({});
  const [option, setOption] = useState<InsulationReviewOption | null>(null);
  const [declaring, setDeclaring] = useState(false);
  const [declared, setDeclared] = useState(false);
  const [savedRoute,setSavedRoute]=useState<string|null>(null);
  const [declarationError, setDeclarationError] = useState<string | null>(null);
  const getPage = useServerFn(getLaunchCampaignPage);
  const saveSpot = useServerFn(saveMySpot);
  const notInterested = useServerFn(takeMeOffList);
  const quote = useQuery({ queryKey: ["capture-quote", token], queryFn: () => getPage({ data: { token } }), retry: false, refetchOnWindowFocus: false });
  const [leaving, setLeaving] = useState(false);
  const [reason, setReason] = useState<NotInterestedReason | null>(null);
  const [note, setNote] = useState("");
  const [closed, setClosed] = useState(false);
  const submitDeclaration = async () => {
    if (declaring || !answers.insulation_type || !answers.insulation_thickness || !answers.house_built_period) return;
    setDeclaring(true); setDeclarationError(null);
    // Jo 23 Oct 08:36 UTC: SAVE MY SPOT saves answers and the spot together; the normal Spot saved confirmation follows.
    try { const result=await declare({ data: { token, answers: answers as InsulationTapAnswers } }); if(result.route !== "ineligible") await saveSpot({ data: { token } }); setSavedRoute(result.route);setDeclared(true); }
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
        ) : data.originalMedia?.excluded && !!data.mediaReview && !declared && !data.detailsRoute ? (
          <section className="mt-6 p-6" role="status">
            <h1 className="font-display text-3xl font-bold">{data.originalMedia.received ? "We've received your insulation photos/video" : "We're checking your enquiry uploads"}</h1>
            <p className="mt-3">{data.mediaReview === "below_r2" ? "Your evidence has been reviewed. Return to your savings to see your next step." : data.mediaReview === "over_r2" ? "Our office has assessed your existing insulation as not eligible. Please contact us with any questions." : data.mediaReview === "unclear" ? "Your evidence has been reviewed. Our office will help with the next check." : data.originalMedia.received ? "Your existing evidence is with our office for review. You do not need to upload it again." : "You do not need to answer these questions or upload again while we check your original enquiry."}</p>
            <Button asChild variant="link" className="mt-3"><Link to="/estimate/$token/campaign" params={{ token }}>Return to my savings</Link></Button>
          </section>
        ) : savedRoute === "ineligible" || data.detailsRoute === "ineligible" ? <section className="mt-6 space-y-3" role="status"><h1 className="font-display text-3xl font-bold">Your home is not eligible</h1><p>Homes built in the last 5 years do not qualify under the five-year rule. Your answers are recorded, but no spot has been saved.</p></section> : declared || !!savedRoute || data.detailsRoute === 'thin_patchy' || data.detailsRoute === 'existing_save_spot' ? <section className="mt-6 space-y-3" role="status"><h1 className="font-display text-3xl font-bold">Your spot is saved</h1><p>Thank you — your no-obligation place in the queue is saved. We've emailed your confirmation. Final eligibility is confirmed at your free Ready Check.</p></section> : data.resume === "spot_saved" || data.resume === "declared" ? (
          <section className="mt-6 p-6" role="status">
            <h1 className="font-display text-3xl font-bold">{data.resume === "spot_saved" ? "Your spot is saved" : "Answer received"}</h1>
            <p className="mt-3">{data.resume === "spot_saved" ? "You don't need to answer these questions again." : "Your Yes is recorded as a owner declaration, not verified insulation. You can now save your spot."}</p>
            <Button asChild className="mt-4 h-12"><Link to="/estimate/$token/campaign" params={{ token }}>{data.resume === "spot_saved" ? "Return to my savings" : "Continue to Save my spot"}</Link></Button>
          </section>
        ) : closed ? (
          <section className="mt-6 space-y-3 rounded-2xl border bg-card p-6" role="status"><h1 className="font-display text-3xl font-bold">Thank you</h1><p>{NOT_INTERESTED_THANKS}</p></section>
        ) : (
          <div className="mt-6 space-y-5">
            <QuoteBox p={(quote.data as { pricing?: QuotePricing } | undefined)?.pricing ?? null} name={(quote.data as { owner?: { firstName: string | null } } | undefined)?.owner?.firstName ?? null} />
            {/* Jo 23 Oct 08:36 UTC final design: quote, 3 required questions, optional photos, SAVE MY SPOT. */}
            <h2 className="font-display text-2xl font-bold">To get your free Ready Check, we need you to answer 3 quick questions:</h2>
            {INSULATION_DETAIL_QUESTIONS.map(q=><fieldset key={q.key} className="space-y-2"><legend className="mb-2 font-semibold">{q.label}</legend>{q.options.map(o=><Button key={o.value} className="h-auto min-h-12 w-full justify-start whitespace-normal text-left" role="radio" aria-checked={answers[q.key]===o.value} variant={answers[q.key]===o.value?"default":"outline"} disabled={declaring||declared} onClick={()=>setAnswers(a=>({...a,[q.key]:o.value}))}>{o.label}</Button>)}</fieldset>)}
            <section className="space-y-3 rounded-2xl border bg-card p-4">
              <h2 className="font-semibold">Got photos? Add them here — it helps</h2>
              <p className="text-sm text-muted-foreground">Optional. Only if you can do it safely. Please don’t enter the roof space.</p>
              <div className="flex gap-2"><Button className="h-12" variant={option==="photos"?"default":"outline"} disabled={uploading} onClick={()=>setOption("photos")}>Photos</Button><Button className="h-12" variant={option==="video"?"default":"outline"} disabled={uploading} onClick={()=>setOption("video")}>Video</Button></div>
              {(option==="photos"||option==="video")&&<CaptureUploads kind={option} remaining={data.remaining} received={data.received} uploadFile={upload} onSaved={refetch} onBusyChange={setUploading}/>}
            </section>
            <Button className="h-12 w-full" disabled={uploading||declaring||declared||!answers.insulation_type||!answers.insulation_thickness||!answers.house_built_period} onClick={()=>void submitDeclaration()}>{declaring?"Saving…":"SAVE MY SPOT"}</Button>
            {declarationError&&<p role="alert" className="text-sm text-destructive">{declarationError}</p>}
            <div className="text-center">{!leaving ? <Button variant="link" className="h-12 text-sm text-muted-foreground" onClick={()=>setLeaving(true)}>No longer interested</Button> : (
              <fieldset className="space-y-2 rounded-2xl border bg-card p-4 text-left"><legend className="mb-2 font-semibold">Sorry to see you go. What's the main reason?</legend>
                {NOT_INTERESTED_REASONS.map(r=><Button key={r.value} role="radio" aria-checked={reason===r.value} variant={reason===r.value?"default":"outline"} className="h-12 w-full justify-start" onClick={()=>setReason(r.value)}>{r.label}</Button>)}
                <textarea aria-label="Anything else? (optional)" placeholder="Anything else? (optional)" maxLength={500} value={note} onChange={e=>setNote(e.target.value)} className="min-h-20 w-full rounded-md border bg-background p-3 text-sm" />
                <Button className="h-12 w-full" variant="secondary" disabled={!reason||declaring} onClick={async()=>{ if(!reason) return; setDeclaring(true); setDeclarationError(null); try { await notInterested({ data: { token, reason, note: note.trim()||undefined } }); setClosed(true); } catch(e){ setDeclarationError(e instanceof Error?e.message:"Please try again."); } finally { setDeclaring(false); } }}>Close my enquiry</Button>
              </fieldset>)}</div>
          </div>
        )}
      </main>
    </div>
  );
}

type QuotePricing = { gross: number; discount: number; total: number; areaM2: number; removalUpTo?: number | null } | null;
function QuoteBox({ p, name }: { p: QuotePricing; name: string | null }) {
  if (!p) return null;
  const $ = (n: number) => `$${Math.floor(Number(n)).toLocaleString("en-AU")}`;
  // Jo 23 Oct 08:40 UTC: lead with THEIR rebate (same hero as Save my spot), price box underneath.
  return <div className="text-estimate-navy">
    <p className="text-[11px] font-extrabold uppercase tracking-[0.13em] text-estimate-logo-green">🎉 Your rebate is waiting</p>
    <h1 className="mt-2 font-display text-[32px] font-extrabold leading-[1.15]">{name ? `${name}, you` : "You"} could save <span className="text-estimate-logo-green">{$(p.discount)}</span> on ceiling insulation</h1>
    <section aria-label="Your preliminary quote" className="mt-5 rounded-[22px] bg-estimate-mist p-5">
      <div className="rounded-[18px] border-2 border-estimate-green bg-estimate-mint px-3 py-[18px] text-center">
        <p className="text-[10px] font-extrabold uppercase tracking-[0.13em]">Your estimated VEU rebate</p>
        <p className="mt-1 font-display text-[38px] font-extrabold leading-[42px] text-estimate-green">You could save {$(p.discount)}</p>
      </div>
      <div className="pb-2 pt-[18px] text-center">
        <p className="text-[10px] font-extrabold uppercase tracking-[0.13em]">Your estimated cost after rebate</p>
        <p className="mt-1 font-display text-[46px] font-extrabold leading-[50px] text-estimate-blue">{$(p.total)}</p>
        <p className="text-sm">Before rebate: {$(p.gross)} including GST · {Math.round(p.areaM2)} m²</p>
      </div>
      {p.removalUpTo != null && p.removalUpTo > 0 && <p className="rounded-xl bg-card p-3 text-sm">{removalUpToLine(p.removalUpTo, p.areaM2)}<br /><span className="mt-1 block text-[13px]">{REMOVAL_UPTO_NOTE}</span><strong className="mt-2 block text-[15px]">{priceRangeLine(p.total, p.removalUpTo)}</strong></p>}
      <p className="mt-3 text-center text-sm font-extrabold">No payment · no obligation</p>
    </section>
  </div>;
}
