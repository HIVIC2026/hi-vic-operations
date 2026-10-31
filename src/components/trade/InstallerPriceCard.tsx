// Decision 278 (Jo 25 Oct 2026): "Your price" — the business owner's card on their own customer's job page. The price and
// what it includes are entered HERE, never in Mitti. The server returns null for team members, so the card (and every word
// about price) never renders for staff. Decision 289: the electrician was chosen once at Add a job and is shown read-only
// here — never asked again. Decision 290 (corrected): the Ready Check's access rating and issue notes show as the flag;
// the boss prices any difficult access themselves. The boss's text (decision 288) deep-links to `#price`.
import { Fragment, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-me";
import {
  getInstallerPriceFn,
  setInstallerPriceFn,
  switchToHivElectricianFn,
} from "@/lib/installer-price.functions";
import {
  HIV_SWITCH,
  PRICE_INCLUDED_OPTIONS,
  PRICE_ISSUES,
  PRICE_LOCKED,
  accessFlagLine,
  priceCardLines,
  validateInstallerPrice,
} from "@/lib/installer-price.core";
const REMOVAL_OPTION = PRICE_INCLUDED_OPTIONS[1]; // "Removal of existing insulation"
import { PRICE_CARD_ANCHOR } from "@/lib/boss-price-link.core";
import { LinkRow, Note, PrimaryButton, Row } from "@/components/trade/installer-kit";
import { PIESA_FULL } from "@/lib/job-wording";
import { OneTapAction } from "@/components/trade/one-tap-action";

export function InstallerPriceCard({ jobId }: { jobId: string }) {
  const load = useServerFn(getInstallerPriceFn);
  const q = useQuery({
    queryKey: ["installer-price", jobId],
    queryFn: () => load({ data: { jobId } }),
    staleTime: 20_000,
  });
  const save = useAction(setInstallerPriceFn);
  const sw = useAction(switchToHivElectricianFn);
  const view = q.data;
  const [editing, setEditing] = useState(false);
  const [price, setPrice] = useState("");
  const [included, setIncluded] = useState<string[]>([PRICE_INCLUDED_OPTIONS[0]]);
  const [other, setOther] = useState("");
  const [productOption, setProductOption] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  // Jo 27 Oct 2026: when the Ready Check positively says there is no removal, the removal tick stays unticked and can't
  // be ticked; tapping it shows the reason under it.
  const removalBlocked = view?.removalRequired === false;
  const [removalNote, setRemovalNote] = useState(false);
  useEffect(() => {
    const cur = view?.current?.record;
    if (!cur) return;
    setPrice(String(cur.price_inc_gst));
    setIncluded(removalBlocked ? cur.included.filter((x) => x !== REMOVAL_OPTION) : cur.included);
    setOther(cur.included_other ?? "");
    setProductOption(cur.product_option ?? "");
    setNotes(cur.notes ?? "");
  }, [view?.current?.setAt, removalBlocked]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!view?.canSet) return null;
  const current = view.current?.record ?? null;
  const lines = current ? priceCardLines(current) : null;
  const access = accessFlagLine(view.access);
  const check = validateInstallerPrice({
    priceIncGst: price,
    included,
    includedOther: other,
    productOption: productOption || null,
    notes,
    removalRequired: view.removalRequired,
  });
  const showForm = !view.locked && (editing || !current);
  const toggle = (o: string) => {
    // Tom 31 Oct 2026: tapping Removal again hides the note; any other change hides it too.
    if (o === REMOVAL_OPTION && removalBlocked) {
      setRemovalNote((n) => !n);
      return;
    }
    setRemovalNote(false);
    setIncluded((xs) => (xs.includes(o) ? xs.filter((x) => x !== o) : [...xs, o]));
  };
  return (
    <div
      id={PRICE_CARD_ANCHOR}
      data-installer-price
      className="mt-1.5 scroll-mt-4 border-t border-line pt-1.5"
    >
      <p className="text-[13px] font-bold uppercase tracking-[1.1px] text-hiv-blue">Your price</p>
      {/* Jo 27 Oct 2026: the Ready Check details above the price box — same source the quote uses; missing = "Not on the Ready Check yet". */}
      <Row label="Address" value={view.readyCheck.address} />
      <Row label="Install m²" value={view.readyCheck.install} />
      <Row label="Removal m²" value={view.readyCheck.removal} />
      <Row label="Access" value={view.readyCheck.access} />
      <Row label="Insulation product" value={view.readyCheck.product} />
      <Row
        label="Electrician"
        value={view.electrician}
        last={!lines || (showForm && !view.hivSwitch)}
      />
      {view.hivSwitch && (
        <OneTapAction
          label={HIV_SWITCH.button(view.hivSwitch.priceIncGst)}
          busyLabel="Switching…"
          confirm={HIV_SWITCH.confirm}
          confirmLabel={HIV_SWITCH.yes}
          run={async () => {
            const r = await sw({ jobId }, "Switched to Home Insulation Victoria's electrician");
            if (r) await q.refetch();
          }}
        />
      )}
      {lines && !showForm && (
        <>
          <div className="border-b border-line py-3">
            <p className="text-[15px] text-sub">Your price to the owner (inc GST)</p>
            <p className="text-lg font-semibold">{lines.price}</p>
          </div>
          {lines.product && <Row label="Product" value={lines.product} />}
          <Row label="Includes" value={lines.included} last={!lines.notes} />
          {lines.notes && <Row label="Notes" value={lines.notes} last />}
          {!view.locked && <LinkRow onClick={() => setEditing(true)}>Edit</LinkRow>}
        </>
      )}
      {view.locked && <Note>{PRICE_LOCKED}</Note>}
      {showForm && (
        <form
          className="space-y-3 py-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!check.ok) return;
            setBusy(true);
            try {
              const r = await save(
                {
                  jobId,
                  priceIncGst: price,
                  included,
                  includedOther: other || null,
                  productOption: productOption || null,
                  notes: notes.trim() || null,
                },
                "Price saved",
              );
              if (r) {
                setEditing(false);
                await q.refetch();
              }
            } finally {
              setBusy(false);
            }
          }}
        >
          <Note className="mt-0">
            Only you see and set this. We add the $349 Accredited Person fee and the {PIESA_FULL},
            take off the rebate and prepare the owner's quote.
            {access ? " Any difficult access is yours to price in." : ""}
          </Note>
          <div>
            <Label htmlFor="ip-product">Insulation product</Label>
            <select
              id="ip-product"
              className="flex min-h-12 w-full rounded-md border border-input bg-transparent px-3 py-2 text-base"
              value={productOption}
              onChange={(e) => {
                setRemovalNote(false);
                setProductOption(e.target.value);
              }}
            >
              <option value="">Same as the Ready Check</option>
              {view.productOptions.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="ip-price">Your price to the owner (inc GST)</Label>
            <Input
              id="ip-price"
              inputMode="decimal"
              placeholder="e.g. 2400"
              value={price}
              onChange={(e) => {
                setRemovalNote(false);
                setPrice(e.target.value);
              }}
            />
          </div>
          <fieldset>
            <legend className="text-sm font-medium">What's included</legend>
            {PRICE_INCLUDED_OPTIONS.map((o) => (
              <Fragment key={o}>
                <label className="flex min-h-12 items-center gap-2.5 text-[15px]">
                  <input
                    type="checkbox"
                    checked={o === REMOVAL_OPTION && removalBlocked ? false : included.includes(o)}
                    aria-disabled={o === REMOVAL_OPTION && removalBlocked}
                    onChange={() => toggle(o)}
                  />
                  {o}
                </label>
                {o === REMOVAL_OPTION && removalBlocked && removalNote && (
                  <p data-removal-note className="pb-1 pl-7 text-sm text-rose">
                    {PRICE_ISSUES.noRemoval}
                  </p>
                )}
              </Fragment>
            ))}
            {included.includes("Other") && (
              <Input
                aria-label="What else is included?"
                placeholder="What else is included?"
                value={other}
                onChange={(e) => {
                  setRemovalNote(false);
                  setOther(e.target.value);
                }}
              />
            )}
          </fieldset>
          <div>
            <Label htmlFor="ip-notes">Notes (only you and the office see these)</Label>
            <Textarea
              id="ip-notes"
              maxLength={1000}
              value={notes}
              onChange={(e) => {
                setRemovalNote(false);
                setNotes(e.target.value);
              }}
            />
          </div>
          {!check.ok && price && (
            <ul data-price-issues className="space-y-1 text-sm text-rose">
              {check.issues.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <PrimaryButton type="submit" disabled={busy || !check.ok}>
              {busy ? "Saving…" : current ? "Save new price" : "Save price"}
            </PrimaryButton>
            {current && (
              <button
                type="button"
                className="min-h-11 px-4 text-[15px] font-semibold text-sub"
                onClick={() => setEditing(false)}
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
