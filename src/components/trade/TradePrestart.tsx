// The three phone checks before the Mitti form opens (mock-up M4, decision 199; geotagged photos decision 178).
// Ticks are remembered per job on the phone. The third check depends on the visit (pure `dayChecks`): install day →
// power off; our-lead Ready Check → "I will not discuss pricing with the owner" (decision 28, approved state
// M4-ready-check-day) — that tick IS the pricing confirmation the server records on Start.
import { useEffect, useState } from "react";
import { prestartReady, type DayKind } from "@/lib/trade-view.core";
import { dayChecks } from "@/lib/installer-screens.core";
import { CheckLine, PrimaryButton } from "@/components/trade/installer-kit";
import { HIVIC_READY_CHECK_PRICING_TICK } from "@/lib/owner-confirm.core";

export function TradePrestart({ jobId, kind, channel, label, onStart, disabledReason }: { jobId: string; kind: DayKind; channel?: string | null; label: string; onStart: () => void | Promise<void>; disabledReason?: string | null }) {
  const key = `hiv-prestart-${jobId}`;
  const [ticks, setTicks] = useState<boolean[]>([false, false, false]);
  const checks = dayChecks({ kind, channel: channel ?? null });
  // The pricing tick (our-lead Ready Check) is never remembered across visits: it is re-ticked each day, and the server
  // records the exact HIVIC_READY_CHECK_PRICING_TICK sentence (shown in full under the short line) on Start.
  const pricingTick = kind === "ready_check" && channel === "hivic_sourced";
  useEffect(() => { try { const v = JSON.parse(localStorage.getItem(key) ?? "null"); if (Array.isArray(v)) setTicks(pricingTick ? [!!v[0], !!v[1], false] : v); } catch { /* ignore */ } }, [key, pricingTick]);
  const flip = (i: number) => { const n = ticks.map((t, j) => (j === i ? !t : t)); setTicks(n); try { localStorage.setItem(key, JSON.stringify(pricingTick ? [n[0], n[1], false] : n)); } catch { /* ignore */ } };
  const ready = prestartReady(ticks);
  return (
    <>
      <div className="mt-3" data-prestart-checks>
        {checks.map((c, i) => <CheckLine key={c} on={!!ticks[i]} onClick={() => flip(i)}>{c}</CheckLine>)}
        {pricingTick && <p className="pl-8 text-[13px] leading-[1.45] text-sub" data-hivic-pricing-confirmation>{HIVIC_READY_CHECK_PRICING_TICK}</p>}
      </div>
      <PrimaryButton className="mt-2.5" disabled={!ready || !!disabledReason} onClick={onStart}>{!ready ? "Tick all 3 to start" : label}</PrimaryButton>
      {ready && disabledReason && <p className="mt-2 text-center text-[13px] text-sub">{disabledReason}</p>}
    </>
  );
}
