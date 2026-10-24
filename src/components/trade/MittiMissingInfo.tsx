import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ExternalLink } from "lucide-react";
import { mittiAuditUrl } from "@/lib/mitti-link.core";
import { MittiFormLink } from "@/components/portal/MittiFormLink";

export function MittiMissingInfo({ missing, stops, auditId }: { missing: string[]; stops: string[]; auditId: string }) {
  const [open, setOpen] = useState(false);
  const url = mittiAuditUrl(auditId);
  return <>
    <div className="flex flex-wrap gap-2">
      {(missing.length > 0 || stops.length > 0) && <Button variant="outline" className="h-12" onClick={() => setOpen(true)}>What's missing</Button>}
      {url && <Button asChild className="h-12"><MittiFormLink auditId={auditId}>Mitti form<ExternalLink className="h-4 w-4" /></MittiFormLink></Button>}
    </div>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-w-sm rounded-lg"><DialogHeader><DialogTitle>What's missing</DialogTitle><DialogDescription className="sr-only">Ready Check answers</DialogDescription></DialogHeader>
      <ul className="list-disc space-y-2 pl-5 text-sm">{missing.map(m => <li key={m}>{m}</li>)}{stops.map(s => <li key={s} className="text-destructive">{s}</li>)}</ul>
      {url && <Button asChild className="h-12"><MittiFormLink auditId={auditId}>Mitti form<ExternalLink className="h-4 w-4" /></MittiFormLink></Button>}
    </DialogContent></Dialog>
  </>;
}