import { useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/trade/trade-ui";

/** One server action per tap: optional confirm step, busy label, and a same-tick double-tap guard.
 *  The server still enforces every workflow gate (booking, evidence); errors appear via the existing toast. */
export function OneTapAction({ label, busyLabel, run, confirm, confirmLabel = "Yes" }: { label: ReactNode; busyLabel: string; run: () => Promise<unknown>; confirm?: string; confirmLabel?: string }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const flight = useRef(false);
  const go = async () => {
    if (flight.current) return;
    flight.current = true; setBusy(true); setAsking(false);
    try { await run(); } finally { flight.current = false; setBusy(false); }
  };
  if (asking) return (
    <div className="space-y-2 rounded-[12px] border border-line bg-paper p-3" data-confirm-action>
      <p className="text-sm font-bold">{confirm}</p>
      <div className="grid grid-cols-2 gap-2"><Button size="field" variant="outline" onClick={() => setAsking(false)}>Not yet</Button><Button size="field" onClick={go}>{confirmLabel}</Button></div>
    </div>
  );
  return <Button size="field" className="w-full" disabled={busy} aria-busy={busy} onClick={() => (confirm ? setAsking(true) : void go())}>{busy ? busyLabel : label}</Button>;
}
