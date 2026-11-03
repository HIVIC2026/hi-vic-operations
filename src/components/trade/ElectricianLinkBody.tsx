// The electrician's job link, one step at a time (new job flow Part 6). Presentation only: the server decides the step.
// No menu, no prices, no messages, no rate items, and ONE green button at most.
import { card, greenBtn } from "@/components/trade/TradeShell";
import type { ElectricianLinkView } from "@/lib/electrician-link.server";

type Shown = Pick<ElectricianLinkView, "business" | "firstName" | "jobNumber" | "owner" | "address" | "view" | "buttonUrl">;

const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;

export function ElectricianLinkBody({ d }: { d: Shown }) {
  return (
    <>
      <div>
        <p className="text-sm text-sub" data-electrician-who>{d.business}{d.firstName ? ` · ${d.firstName}` : ""}</p>
        <h1 className="font-display text-[26px] font-bold leading-tight" data-electrician-title>{d.view.title}</h1>
        <p className="text-xs font-bold text-sub">{d.jobNumber}</p>
      </div>
      {d.view.sub && <p className="text-base" data-electrician-sub>{d.view.sub}</p>}
      {(d.owner || d.address) && (
        <section className={`${card} space-y-1 text-sm`} data-electrician-job>
          {d.owner && <p><span className="font-medium">Owner:</span> {d.owner.name}{d.owner.phone ? <> · <a className="font-semibold underline" href={telHref(d.owner.phone)}>{d.owner.phone}</a></> : null}</p>}
          {d.address && <p><span className="font-medium">Address:</span> {d.address}</p>}
        </section>
      )}
      {d.view.button && d.buttonUrl && <a className={greenBtn} href={d.buttonUrl} data-electrician-button>{d.view.button}</a>}
    </>
  );
}
