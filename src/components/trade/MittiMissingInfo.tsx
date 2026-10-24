import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { mittiAuditUrl } from "@/lib/mitti-link.core";
import { MittiFormLink } from "@/components/portal/MittiFormLink";
import { LinkRow } from "@/components/trade/installer-kit";

/** Ready Check group rows (mock-up M2): "What's missing" (only while something is) and "Open Mitti form ›". */
export function MittiMissingInfo({ missing, stops, auditId }: { missing: string[]; stops: string[]; auditId: string }) {
  const [open, setOpen] = useState(false);
  const url = mittiAuditUrl(auditId);
  return <>
    {(missing.length > 0 || stops.length > 0) && <div className="border-b border-line"><LinkRow onClick={() => setOpen(true)}>What's missing</LinkRow></div>}
    {url && <MittiFormLink auditId={auditId} className="flex min-h-12 w-full items-center justify-between gap-3 text-[15px] font-semibold text-hiv-blue"><span>Open Mitti form</span><span className="text-xl text-sub">›</span></MittiFormLink>}
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-w-sm rounded-lg"><DialogHeader><DialogTitle>What's missing</DialogTitle><DialogDescription className="sr-only">Ready Check answers</DialogDescription></DialogHeader>
      <ul className="list-disc space-y-2 pl-5 text-sm">{missing.map(m => <li key={m}>{m}</li>)}{stops.map(s => <li key={s} className="text-rose">{s}</li>)}</ul>
      {url && <MittiFormLink auditId={auditId} className="flex min-h-12 w-full items-center justify-center rounded-xl bg-hiv-blue text-base font-semibold text-white">Open Mitti form</MittiFormLink>}
    </DialogContent></Dialog>
  </>;
}
