// Shared "before you start" section for all three trade days (Jo-approved 5 Oct). Ticks remembered per job.
import { useEffect, useState } from "react";
import { Check, Zap } from "lucide-react";
import { PRESTART_CHECKS, START_LABEL, prestartReady, type DayKind } from "@/lib/trade-view.core";
import { greenBtn } from "./TradeShell";
import { Checkbox } from "@/components/ui/checkbox";
import { HIVIC_READY_CHECK_PRICING_TICK } from "@/lib/owner-confirm.core";

export function TradePrestart({ jobId, kind, channel, onStart, disabledReason }: { jobId: string; kind: DayKind; channel?: string | null; onStart: () => void | Promise<void>; disabledReason?: string | null }) {
  const key = `hiv-prestart-${jobId}`;
  const [ticks, setTicks] = useState<boolean[]>([false, false, false]);
  const [pricingConfirmed, setPricingConfirmed] = useState(false);
  useEffect(() => { try { const v = JSON.parse(localStorage.getItem(key) ?? "null"); if (Array.isArray(v)) setTicks(v); } catch { /* ignore */ } }, [key]);
  const flip = (i: number) => { const n = ticks.map((t, j) => (j === i ? !t : t)); setTicks(n); localStorage.setItem(key, JSON.stringify(n)); };
  const ready = prestartReady(ticks);
  const needsPricingConfirmation = kind === "ready_check" && channel === "hivic_sourced";
  const canStart = ready && (!needsPricingConfirmation || pricingConfirmed);
  const n = ticks.filter(Boolean).length;
  const tips = ["Wipe the lens", "Torch on, not flash", "Hold still, tap to focus", "Move slowly in videos"];
  return (
    <>
      <section className="rounded-[19px] border border-mist-line bg-mist p-5 text-ink md:p-[23px]">
        <h2 className="font-display text-xl font-bold">Sharp photos and videos, every time</h2>
        <p className="mt-1 text-sm text-sub">The onsite form tells you exactly what to shoot. We just need every one crystal clear.</p>
        <p className="mt-3 rounded-2xl bg-owner-house-pink p-3 text-sm text-estimate-navy"><strong>Why it matters:</strong> Please ensure the evidence is clear and shows all required details. Unclear or incomplete evidence may result in the Essential Services Commission (ESC) rejecting the VEEC submission.</p>
        <div className="mt-3 grid grid-cols-2 gap-2">{tips.map((t) => <div key={t} className="rounded-2xl bg-paper border border-line p-3 text-sm font-bold">{t}</div>)}</div>
        <p className="mt-3 text-sm font-bold text-owner-house-pink">Check each one before you move on. Blurry? Retake it on the spot.</p>
      </section>
      {needsPricingConfirmation && <label className="flex min-h-14 items-start gap-3 rounded-[18px] border border-line bg-paper p-4 text-sm" data-hivic-pricing-confirmation><Checkbox className="mt-0.5" checked={pricingConfirmed} onCheckedChange={(c) => setPricingConfirmed(c === true)} aria-label={HIVIC_READY_CHECK_PRICING_TICK} /><span>{HIVIC_READY_CHECK_PRICING_TICK}</span></label>}
      <section className="rounded-[18px] border border-line bg-paper p-[19px] shadow-card">
        <h2 className="font-display text-lg font-bold">Phone check ({n}/3)</h2>
        <div className="mt-3 space-y-2">{PRESTART_CHECKS.map((c, i) => (
          <button key={c.title} type="button" onClick={() => flip(i)} aria-pressed={!!ticks[i]} className="flex min-h-14 w-full items-center gap-3 rounded-[10px] bg-estimate-mist px-3 text-left">
            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 ${ticks[i] ? "border-estimate-green bg-estimate-green text-white" : "border-estimate-line bg-paper"}`}>{ticks[i] && <Check className="h-4 w-4" />}</span>
            <span><span className="block text-sm font-bold">{c.title}</span>{c.sub && <span className="block text-xs text-sub">{c.sub}</span>}</span>
          </button>))}</div>
      </section>
      <section className="space-y-3">
        <h2 className="font-display text-lg font-bold">How to turn on location for your camera</h2>
        {[{ t: "iPhone", s: ["Open Settings", "Tap Privacy & Security", "Tap Location Services and make sure it's on", "Scroll down and tap Camera", "Choose While Using the App", "Turn Precise Location on"] },
          { t: "Android", s: ["Open Settings", "Tap Apps, then Camera", "Tap Permissions, then Location", "Choose Allow only while using the app", "Turn Use precise location on"] }].map((x) => (
          <div key={x.t} className="rounded-[18px] border border-line bg-paper p-[19px] shadow-card"><p className="font-bold">{x.t}</p><ol className="mt-2 space-y-1 text-sm">{x.s.map((s, i) => <li key={s}><span className="font-bold text-estimate-blue">{i + 1}</span>&nbsp; {s}</li>)}</ol></div>
        ))}
        <p className="text-center text-xs text-sub">You only need to do this once per phone.</p>
      </section>
      <div className="fixed inset-x-0 bottom-16 z-30 px-4 pb-[env(safe-area-inset-bottom)]"><div className="mx-auto max-w-md">
        <button type="button" className={greenBtn} disabled={!canStart || !!disabledReason} onClick={onStart}><Zap className="h-5 w-5" />{!ready ? "Tick all 3 to start" : needsPricingConfirmation && !pricingConfirmed ? "Confirm pricing rule to start" : START_LABEL[kind]}</button>
        {canStart && disabledReason && <p className="mt-1 rounded-xl bg-paper p-2 text-center text-xs shadow-sm">{disabledReason}</p>}
      </div></div>
    </>
  );
}
