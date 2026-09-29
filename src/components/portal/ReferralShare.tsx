import { useEffect, useState } from "react";
import { Share2, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Customer referral share. Uses the device share sheet or copies the link — HI VIC never emails the friend. */
export function ReferralShare({ url }: { url: string }) {
  const [canShare, setCanShare] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => { setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function"); }, []);
  const copy = async () => { await navigator.clipboard.writeText(url); setCopied(true); };
  const share = async () => {
    try { await navigator.share({ title: "Home Insulation Victoria", text: "Check whether your home may qualify for a VEU insulation discount.", url }); }
    catch (e) { if ((e as Error).name !== "AbortError") await copy(); }
  };
  return (
    <section className="estimate-brand mt-8 border-t border-estimate-blue-soft px-1 py-8 text-estimate-navy" aria-labelledby="referral-heading" data-testid="referral-share">
      <h2 id="referral-heading" className="text-xl font-bold text-estimate-navy">Know someone who could benefit too?</h2>
      <p className="mt-2 text-sm leading-relaxed">Share HI VIC with a friend or family member. They can check whether their home may qualify in just a few minutes.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {canShare && <Button type="button" size="field" className="rounded-lg bg-estimate-blue font-semibold text-estimate-white hover:bg-estimate-blue/90" onClick={share}><Share2 aria-hidden="true" /> Share with a friend</Button>}
        <Button type="button" size="field" variant="outline" className="rounded-lg border border-estimate-blue-soft bg-estimate-white font-semibold text-estimate-navy hover:bg-estimate-blue-pale hover:text-estimate-navy" onClick={copy}><Link2 aria-hidden="true" /> {copied ? "Link copied" : "Copy referral link"}</Button>
      </div>
      <p className="sr-only" role="status">{copied ? "Referral link copied" : ""}</p>
    </section>
  );
}
