import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { OwnerPageHeader, LockedButton, LockHint, SmallNote } from "@/components/owner/OwnerPageKit";
import { P1, shortAud } from "@/lib/owner-pages.core";
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
    <div className="estimate-brand min-h-screen bg-estimate-canvas text-estimate-navy">
      <OwnerPageHeader />
      <main className="mx-auto max-w-[560px] px-4 pb-10 sm:px-5">
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
          <div className="mt-5">
            {/* Jo 24 Oct (decision 84 + approved P1 page): opens straight on the 3 questions; Save stays locked until all are answered. */}
            <QuestionsIntro p={(quote.data as { pricing?: QuotePricing } | undefined)?.pricing ?? null} name={(quote.data as { owner?: { firstName: string | null } } | undefined)?.owner?.firstName ?? null} />
            {INSULATION_DETAIL_QUESTIONS.map((q,i)=><fieldset key={q.key} className="mt-[22px]"><legend className="mb-2.5"><span className="block text-[13px] font-bold tracking-[0.07em] text-estimate-blue">{P1.question(i+1)}</span><span className="mt-1 block text-lg font-bold">{P1.labels[q.key] ?? q.label}</span></legend><div className={q.key==="house_built_period"?"grid grid-cols-2 gap-x-2":""}>{q.options.map(o=>{const on=answers[q.key]===o.value;return <button key={o.value} type="button" role="radio" aria-checked={on} disabled={declaring||declared} onClick={()=>setAnswers(a=>({...a,[q.key]:o.value}))} className={`mb-2 flex min-h-[50px] w-full items-center gap-2 rounded-[12px] px-3.5 py-3 text-left text-[15px] leading-snug ${on?"border-2 border-estimate-blue bg-estimate-selected font-bold":"border border-estimate-field-line bg-card"}`}><span aria-hidden className="shrink-0">{on?"◉":"○"}</span><span className="min-w-0">{o.label}</span></button>;})}</div></fieldset>)}
            <section className="mt-5 rounded-[14px] border border-dashed border-estimate-field-line bg-card px-4 py-3.5">
              <h2 className="text-[15px] font-bold">{P1.photosTitle}</h2>
              <p className="mt-1 mb-2.5 text-[13px] leading-relaxed text-estimate-sub">{P1.photosSub}</p>
              <div className="flex flex-wrap gap-2"><button type="button" aria-pressed={option==="photos"} disabled={uploading} onClick={()=>setOption("photos")} className={`min-h-11 rounded-[10px] border px-4 text-sm font-bold ${option==="photos"?"border-estimate-blue bg-estimate-selected text-estimate-blue":"border-estimate-blue text-estimate-blue"}`}>{P1.addPhotos}</button><button type="button" aria-pressed={option==="video"} disabled={uploading} onClick={()=>setOption("video")} className={`min-h-11 rounded-[10px] border px-4 text-sm font-bold ${option==="video"?"border-estimate-blue bg-estimate-selected text-estimate-blue":"border-estimate-blue text-estimate-blue"}`}>{P1.addVideo}</button></div>
              {(option==="photos"||option==="video")&&<div className="mt-3"><CaptureUploads kind={option} remaining={data.remaining} received={data.received} uploadFile={upload} onSaved={refetch} onBusyChange={setUploading}/></div>}
            </section>
            <LockedButton ready={!uploading&&!declared&&!!answers.insulation_type&&!!answers.insulation_thickness&&!!answers.house_built_period} busy={declaring} busyLabel={P1.saving} onClick={()=>void submitDeclaration()}>{P1.save}</LockedButton>
            {!declaring&&!declared&&unanswered(answers)&&<LockHint>{P1.lockHint(unanswered(answers)!)}</LockHint>}
            <SmallNote className="mt-1"><span className="text-[13px]">{P1.noObligation}</span></SmallNote>
            {declarationError&&<p role="alert" className="mt-2 text-sm text-destructive">{declarationError}</p>}
            <div className="mt-[22px] text-center">{!leaving ? <button type="button" className="min-h-11 text-[13px] text-estimate-sub underline" onClick={()=>setLeaving(true)}>{P1.notInterested}</button> : (
              <fieldset className="space-y-2 rounded-[14px] border border-estimate-line bg-card p-4 text-left"><legend className="mb-2 font-semibold">Sorry to see you go. What's the main reason?</legend>
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

/** First unanswered question, e.g. "question 3" (null when all 3 are answered). */
function unanswered(a: Partial<InsulationTapAnswers>): string | null {
  const i = INSULATION_DETAIL_QUESTIONS.findIndex((q) => !a[q.key]);
  if (i < 0) return null;
  return INSULATION_DETAIL_QUESTIONS.every((q) => !a[q.key]) ? "all 3 questions" : `question ${i + 1}`;
}
function QuestionsIntro({ p, name }: { p: QuotePricing; name: string | null }) {
  const rebate = p ? shortAud(Math.floor(Number(p.discount))) : null;
  return <div className="text-estimate-navy">
    <p className="text-xs font-bold tracking-[0.1em] text-estimate-logo-green">{P1.kicker(name)}</p>
    <h1 className="mt-1.5 mb-2 font-display text-[26px] font-extrabold leading-[1.2]">{P1.title}</h1>
    <p className="text-[15px] leading-[1.55] text-estimate-sub">{P1.sub(rebate)}</p>
  </div>;
}

type QuotePricing = { gross: number; discount: number; total: number; areaM2: number; removalUpTo?: number | null } | null;
