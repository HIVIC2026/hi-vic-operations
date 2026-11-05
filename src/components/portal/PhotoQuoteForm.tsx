// Photo-quote installers (Jo 5 Nov 2026, spec decisions 4/5): the "Quote from photos" box on the installer job page.
// The owner's photos (tap to open full size) and videos (play inline), what the owner said, the four fields and
// "Send for quote" (greyed out with the first problem under it until the form is right). "Can't do this one" hands the job
// back with a reason. No prices anywhere: the quote is Home Insulation Victoria's.
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getPhotoQuoteMedia, tradeHandBack, tradeSubmitPhotoQuote } from "@/lib/trade-view.functions";
import { APPROVED_PRODUCTS } from "@/lib/insulation-product.core";
import { PHOTO_QUOTE_WORDS, photoQuoteProblems, type PhotoQuoteInput } from "@/lib/photo-quote.core";
import { markOfficeChanged } from "@/lib/office-list-refresh";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const W = PHOTO_QUOTE_WORDS;
const num = (v: string): number | null => (v.trim() === "" || !Number.isFinite(Number(v)) ? null : Number(v));

export function PhotoQuoteForm({ jobId }: { jobId: string }) {
  const load = useServerFn(getPhotoQuoteMedia);
  const submit = useServerFn(tradeSubmitPhotoQuote);
  const back = useServerFn(tradeHandBack);
  const qc = useQueryClient();
  const media = useQuery({ queryKey: ["photo-quote-media", jobId], queryFn: () => load({ data: { jobId } }), retry: false, staleTime: 30 * 60_000 });
  const [underR2, setUnderR2] = useState<boolean | null>(null);
  const [removeM2, setRemove] = useState("");
  const [installM2, setInstall] = useState("");
  const [product, setProduct] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [giveBack, setGiveBack] = useState(false);
  const [reason, setReason] = useState<string>("");
  const [other, setOther] = useState("");

  const input: PhotoQuoteInput = { underR2, removeM2: num(removeM2), installM2: num(installM2), product: product || null };
  const problems = useMemo(() => photoQuoteProblems(input), [underR2, removeM2, installM2, product]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async () => {
    setBusy(true); setError("");
    try {
      const r = await submit({ data: { jobId, ...input } });
      if (!r.ok) setError(r.message);
      else { markOfficeChanged(); await qc.invalidateQueries(); }
    } catch (e) { setError(e instanceof Error ? e.message : "Could not send. Try again."); }
    finally { setBusy(false); }
  };
  const handBack = async () => {
    const why = reason === "Other" ? other.trim() : reason;
    if (why.length < 3) return;
    setBusy(true); setError("");
    try { await back({ data: { jobId, reason: why } }); markOfficeChanged(); await qc.invalidateQueries(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not save."); }
    finally { setBusy(false); }
  };

  return (
    <div className="mt-4 space-y-4" data-photo-quote-form>
      {media.isLoading && <p className="text-sm text-sub">Loading the owner's photos…</p>}
      {media.error && <p role="alert" className="text-sm text-rose">{media.error instanceof Error ? media.error.message : "Couldn't load the photos."}</p>}
      {media.data && (
        <>
          {media.data.media.length === 0 ? <p className="text-sm text-sub">No photos or videos on file.</p> : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-photo-grid>
              {media.data.media.map((m) => m.kind === "video"
                ? <video key={m.id} src={m.url} controls playsInline preload="metadata" className="aspect-square w-full rounded-md bg-black object-cover" />
                : <a key={m.id} href={m.url} target="_blank" rel="noreferrer"><img src={m.url} alt={m.name} loading="lazy" className="aspect-square w-full rounded-md object-cover" /></a>)}
            </div>
          )}
          {media.data.ownerSaid.length > 0 && (
            <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-sm" data-owner-said>
              {media.data.ownerSaid.map(([label, value]) => (
                <div key={label} className="contents"><dt className="text-sub">{label}</dt><dd className="text-ink">{value ?? "—"}</dd></div>
              ))}
            </dl>
          )}
        </>
      )}

      <fieldset className="space-y-1">
        <legend className="text-sm font-medium text-ink">{W.fields.underR2}</legend>
        <div className="flex gap-2">
          <Button type="button" variant={underR2 === true ? "default" : "outline"} onClick={() => setUnderR2(true)}>Yes</Button>
          <Button type="button" variant={underR2 === false ? "default" : "outline"} onClick={() => setUnderR2(false)}>No</Button>
        </div>
      </fieldset>
      <label className="block text-sm font-medium text-ink">{W.fields.removeM2}
        <Input inputMode="decimal" value={removeM2} onChange={(e) => setRemove(e.target.value)} />
      </label>
      <label className="block text-sm font-medium text-ink">{W.fields.installM2}
        <Input inputMode="decimal" value={installM2} onChange={(e) => setInstall(e.target.value)} />
      </label>
      <label className="block text-sm font-medium text-ink">{W.fields.product}
        <select className="mt-1 block w-full rounded-md border border-line bg-white px-3 py-2 text-base" value={product} onChange={(e) => setProduct(e.target.value)}>
          <option value="">Pick one</option>
          {APPROVED_PRODUCTS.map((p) => <option key={p.option} value={p.option}>{p.option}</option>)}
        </select>
      </label>

      <div className="space-y-1">
        <Button disabled={busy || problems.length > 0} onClick={send} data-send-for-quote>{busy ? "Sending…" : W.send}</Button>
        {problems[0] && <p className="text-sm text-sub" data-first-problem>{problems[0]}</p>}
        {error && <p role="alert" className="text-sm text-rose">{error}</p>}
      </div>

      <div className="space-y-2 border-t border-line pt-3">
        <Button variant="outline" onClick={() => setGiveBack((v) => !v)}>Can't do this one</Button>
        {giveBack && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              {W.cantDoReasons.map((r) => <Button key={r} type="button" variant={reason === r ? "default" : "outline"} onClick={() => setReason(r)}>{r}</Button>)}
            </div>
            {reason === "Other" && <Input placeholder="Reason" value={other} onChange={(e) => setOther(e.target.value)} />}
            <Button disabled={busy || (reason === "Other" ? other.trim().length < 3 : !reason)} onClick={handBack}>Give back to Home Insulation Victoria</Button>
            {!reason && <p className="text-sm text-sub">Pick a reason so Home Insulation Victoria knows why.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
