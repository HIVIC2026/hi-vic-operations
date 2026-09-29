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
    <section className="estimate-brand mt-9 rounded-[1.3rem] bg-estimate-green-soft px-5 py-6 text-estimate-navy sm:px-7" aria-labelledby="referral-heading" data-testid="referral-share">
      <h2 id="referral-heading" className="text-xl font-extrabold text-estimate-blue">Know someone who could benefit too?</h2>
      <p className="mt-2 text-sm leading-relaxed">Share HI VIC with a friend or family member. They can check whether their home may qualify in just a few minutes.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {canShare && <Button type="button" size="field" className="bg-estimate-green font-bold text-estimate-white hover:bg-estimate-green/90" onClick={share}><Share2 aria-hidden="true" /> Share with a friend</Button>}
        <Button type="button" size="field" variant="outline" className="border-2 border-estimate-blue bg-estimate-white font-bold text-estimate-blue hover:bg-estimate-blue-soft hover:text-estimate-blue" onClick={copy}><Link2 aria-hidden="true" /> {copied ? "Link copied" : "Copy referral link"}</Button>
      </div>
      <p className="sr-only" role="status">{copied ? "Referral link copied" : ""}</p>
    </section>
  );
}
