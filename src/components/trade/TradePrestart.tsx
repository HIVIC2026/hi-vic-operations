// The three phone checks before the Mitti form opens (mock-up M4, decision 199; geotagged photos decision 178).
// Ticks are remembered per job on the phone. On an our-lead Ready Check the pricing tick (decision 28) must also be on.
import { useEffect, useState } from "react";
import { prestartReady, type DayKind } from "@/lib/trade-view.core";
import { DAY_CHECKS } from "@/lib/installer-screens.core";
import { CheckLine, PrimaryButton } from "@/components/trade/installer-kit";
import { Checkbox } from "@/components/ui/checkbox";
import { HIVIC_READY_CHECK_PRICING_TICK } from "@/lib/owner-confirm.core";

export function TradePrestart({ jobId, kind, channel, label, onStart, disabledReason }: { jobId: string; kind: DayKind; channel?: string | null; label: string; onStart: () => void | Promise<void>; disabledReason?: string | null }) {
  const key = `hiv-prestart-${jobId}`;
  const [ticks, setTicks] = useState<boolean[]>([false, false, false]);
  const [pricingConfirmed, setPricingConfirmed] = useState(false);
  const [help, setHelp] = useState(false);
  useEffect(() => { try { const v = JSON.parse(localStorage.getItem(key) ?? "null"); if (Array.isArray(v)) setTicks(v); } catch { /* ignore */ } }, [key]);
  const flip = (i: number) => { const n = ticks.map((t, j) => (j === i ? !t : t)); setTicks(n); try { localStorage.setItem(key, JSON.stringify(n)); } catch { /* ignore */ } };
  const ready = prestartReady(ticks);
  const needsPricingConfirmation = kind === "ready_check" && channel === "hivic_sourced";
  const canStart = ready && (!needsPricingConfirmation || pricingConfirmed);
  return (
    <>
      <div className="mt-3" data-prestart-checks>
        {DAY_CHECKS.map((c, i) => <CheckLine key={c} on={!!ticks[i]} onClick={() => flip(i)}>{c}</CheckLine>)}
        <button type="button" className="min-h-9 text-[13px] text-hiv-blue" aria-expanded={help} onClick={() => setHelp((h) => !h)}>How do I turn location on?</button>
        {help && <div className="mb-2 grid gap-2 text-[13px] text-sub sm:grid-cols-2">
          <p><strong className="text-ink">iPhone:</strong> Settings → Privacy &amp; Security → Location Services on → Camera → While Using the App → Precise Location on.</p>
          <p><strong className="text-ink">Android:</strong> Settings → Apps → Camera → Permissions → Location → Allow only while using the app → Use precise location on.</p>
        </div>}
      </div>
      {needsPricingConfirmation && <label className="mt-2 flex min-h-11 items-start gap-3 text-sm" data-hivic-pricing-confirmation><Checkbox className="mt-0.5" checked={pricingConfirmed} onCheckedChange={(c) => setPricingConfirmed(c === true)} aria-label={HIVIC_READY_CHECK_PRICING_TICK} /><span>{HIVIC_READY_CHECK_PRICING_TICK}</span></label>}
      <PrimaryButton className="mt-2.5" disabled={!canStart || !!disabledReason} onClick={onStart}>{!ready ? "Tick all 3 to start" : needsPricingConfirmation && !pricingConfirmed ? "Confirm the pricing rule to start" : label}</PrimaryButton>
      {canStart && disabledReason && <p className="mt-2 text-center text-[13px] text-sub">{disabledReason}</p>}
    </>
  );
}
