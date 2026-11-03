// The electrician's job link, one step at a time (new job flow Part 6). Presentation only: the server decides the step.
// No menu, no prices, no messages, no rate items, and ONE green button at most.
import { useState } from "react";
import { card, greenBtn, inputCls } from "@/components/trade/TradeShell";
import type { ElectricianLinkView } from "@/lib/electrician-link.server";

type Shown = Pick<ElectricianLinkView, "business" | "firstName" | "jobNumber" | "owner" | "address" | "view" | "buttonUrl">;

const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;

/** Pick a day and time, then press the step's button. The server decides whether booking is allowed. */
function BookForm({ label, onBook }: { label: string; onBook: (startIso: string) => Promise<{ ok: true } | { ok: false; message: string }> }) {
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const press = async () => {
    const t = new Date(when);
    if (!when || Number.isNaN(t.getTime())) { setError("Choose a day and time first."); return; }
    setBusy(true); setError(null);
    try { const r = await onBook(t.toISOString()); if (!r.ok) setError(r.message); }
    catch { setError("We couldn't save that. Try again."); }
    finally { setBusy(false); }
  };
  return (
    <section className={`${card} space-y-3`} data-electrician-book>
      <input type="datetime-local" aria-label="Day and time" className={inputCls} value={when} onChange={(e) => setWhen(e.target.value)} />
      <button type="button" className={greenBtn} disabled={busy} onClick={press} data-electrician-book-button>{label}</button>
      {error && <p className="text-sm text-danger" role="alert" data-electrician-book-error>{error}</p>}
    </section>
  );
}

type Result = { ok: true } | { ok: false; message: string };
const MAX_BYTES = 15 * 1024 * 1024;

/** Pick the certificate (a PDF or a photo) and press the step's button. The server checks the file and the link again. */
function UploadForm({ label, onUpload }: { label: string; onUpload: (file: File) => Promise<Result> }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const press = async () => {
    if (!file) { setError("Choose the certificate first."); return; } // DRAFT
    if (file.size > MAX_BYTES) { setError("That file is too big. Upload one under 15 MB."); return; } // DRAFT
    setBusy(true); setError(null);
    try { const r = await onUpload(file); if (!r.ok) setError(r.message); }
    catch { setError("We couldn't save that file. Try again."); } // DRAFT
    finally { setBusy(false); }
  };
  return (
    <section className={`${card} space-y-3`} data-electrician-upload>
      <input type="file" aria-label="Certificate of Electrical Safety" accept="application/pdf,image/*,.pdf,.heic,.heif" className={inputCls} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <button type="button" className={greenBtn} disabled={busy} onClick={press} data-electrician-upload-button>{label}</button>
      {error && <p className="text-sm text-danger" role="alert" data-electrician-upload-error>{error}</p>}
    </section>
  );
}

export function ElectricianLinkBody({ d, onBook, onUpload }: { d: Shown; onBook?: (startIso: string) => Promise<Result>; onUpload?: (file: File) => Promise<Result> }) {
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
      {d.view.canBook && d.view.button && onBook && <BookForm label={d.view.button} onBook={onBook} />}
      {d.view.step === "upload_certificate" && d.view.button && onUpload && <UploadForm label={d.view.button} onUpload={onUpload} />}
      {d.view.button && d.buttonUrl && <a className={greenBtn} href={d.buttonUrl} data-electrician-button>{d.view.button}</a>}
    </>
  );
}
