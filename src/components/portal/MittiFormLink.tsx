import type { ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getMittiFormLink } from "@/lib/mitti-link.functions";
import { mittiFormUrl } from "@/lib/mitti-link.core";

/** Jo 24 Oct: opens THIS form. On tap the portal asks Mitti for the form's deep link (opens the Mitti app on a phone);
 *  on a phone it opens in the same tab so the app can take over, on a computer in a new tab. */
export function MittiFormLink({ auditId, className, children }: { auditId: string; className?: string; children: ReactNode }) {
  const getLink = useServerFn(getMittiFormLink);
  const fallback = mittiFormUrl(auditId);
  return (
    <a href={fallback} target="_blank" rel="noreferrer" className={className} data-mitti-form
      onClick={(e) => {
        e.preventDefault();
        const phone = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
        const tab = phone ? null : window.open("about:blank", "_blank");
        const go = (url: string) => { if (tab && !tab.closed) tab.location.href = url; else window.location.assign(url); };
        getLink({ data: { auditId } }).then((r) => go(r.url), () => go(fallback));
      }}>{children}</a>
  );
}
