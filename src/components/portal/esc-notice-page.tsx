// Approved P5 "Privacy notice for your installers" pieces (Jo 24 Oct 2026, decision 130). PURE PRESENTATION: the
// notice body (verbatim paragraphs passed in) and one tick row per installer person. Who may tick is decided by the page.
import type { ReactNode } from "react";
import type { NoticeParagraph } from "@/lib/esc-collection-notice.core";
import { P5 } from "@/lib/owner-pages.core";

/** The notice in the approved grey box: heading, version line, paragraphs and bullets (nested bullets indented). */
export function NoticeBody({ paragraphs }: { paragraphs: readonly NoticeParagraph[] }) {
  return (
    <section className="rounded-[12px] bg-mist p-4 text-sm leading-[1.55]" data-esc-notice>
      {paragraphs.map((p, i) => p.kind === "heading" ? <h2 key={i} className="font-display text-base font-semibold">{p.text}</h2>
        : p.kind === "version" ? <p key={i} className="mb-2.5 text-[13px] text-sub">{p.text}</p>
        : p.kind === "li" || p.kind === "li2" ? <div key={i} className={`flex gap-2 py-0.5 ${p.kind === "li2" ? "pl-6" : "pl-2"}`}><span>•</span><span>{p.text}</span></div>
        : <p key={i} className="my-2">{p.text}</p>)}
    </section>
  );
}

/** One installer person: square tick, name, the acknowledgement sentence and (when done) "Acknowledged 24 Oct 2026, 2:15pm". */
export function NoticeTickRow({ name, text, on, canTick, disabled, onChange, acknowledgedAt, action }: {
  name: string; text: string; on: boolean; canTick: boolean; disabled?: boolean; onChange?: (b: boolean) => void; acknowledgedAt?: string | null; action?: ReactNode;
}) {
  const box = <span aria-hidden className={`mt-px grid h-6 w-6 shrink-0 place-items-center rounded-[6px] border-2 border-hiv-blue text-sm font-semibold text-hiv-green ${on ? "bg-success-soft" : "bg-paper"}`}>{on ? "✓" : ""}</span>;
  const body = <span className="min-w-0 flex-1">
    <span className="block text-[15px] font-semibold">{name}</span>
    <span className="mt-0.5 block text-[13px] leading-[1.45] text-sub">{text}</span>
    {acknowledgedAt && <span className="mt-1 block text-xs text-hiv-green">{P5.acknowledged(acknowledgedAt)}</span>}
  </span>;
  return (
    <li className="mt-2 rounded-[10px] border border-line bg-paper px-3.5 py-3">
      {canTick ? <label className="flex cursor-pointer items-start gap-3"><input type="checkbox" className="sr-only" checked={on} disabled={disabled} onChange={(e) => onChange?.(e.target.checked)} />{box}{body}</label>
        : <div className="flex items-start gap-3">{box}{body}</div>}
      {action && <div className="mt-2 pl-9">{action}</div>}
    </li>
  );
}
