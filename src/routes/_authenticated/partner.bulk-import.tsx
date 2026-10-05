import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BatchOwnerLinksButton } from "@/components/portal/owner-eligibility";
import { bulkBatchReview, bulkImportBusinesses, confirmBulkBatch, createBulkBatch, geocodeBulkPhotos, readBulkFile, setBulkRowAddress } from "@/lib/bulk-import.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { CONTACT_PERMISSION_WORDING, LEAD_STAGE_LABEL, type FileResult, type LeadStage } from "@/lib/bulk-import.core";

export const Route = createFileRoute("/_authenticated/partner/bulk-import")({
  head: () => ({
    meta: [
      { title: "Bulk job upload — Home Insulation Victoria" },
      { name: "description", content: "Upload a customer list and files to import many installer-supplied jobs at once." },
      { property: "og:title", content: "Bulk job upload — Home Insulation Victoria" },
      { property: "og:description", content: "Import many installer-supplied jobs at once." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BulkImportPage,
});

type ManifestFile = { path: string; name: string; folder: string | null; type: string; gps_lat: number | null; gps_lng: number | null; taken_at: string | null; geo_address?: string | null };
type ReviewRow = {
  id: string; row_index: number; status: string; duplicate_note: string | null;
  extracted: { full_name?: string | null; address_line?: string | null; suburb?: string | null; postcode?: string | null; area_m2?: number | null; price_inc_gst?: number | null; lead_stage?: LeadStage; phone?: string | null; email?: string | null };
  matched_files: { name: string; how: string }[]; sort_result: "covers_ready_check" | "needs_visit" | "office_review" | null;
  sort_reasons: string[]; missing_evidence: string[];
};

const SORT_LABEL: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  covers_ready_check: { label: "Covers the Ready Check — no visit needed", variant: "default" },
  needs_visit: { label: "Needs a visit", variant: "secondary" },
  office_review: { label: "Office review", variant: "destructive" },
};

const LIST_RE = /\.(csv|xlsx|xls|ods)$/i;
const TEXT_RE = /\.(txt|eml|md|html?|json|msg|rtf)$/i;
const IMAGE_RE = /\.(jpe?g|png|webp|heic|heif)$/i;
const MAX_VISION = 60; // photos/PDF pages read with AI per upload

async function parseList(buf: ArrayBuffer, name: string): Promise<Record<string, string>[]> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buf, { type: "array" });
  const out: Record<string, string>[] = [];
  for (const sn of wb.SheetNames) {
    const sheet = wb.Sheets[sn];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false });
    out.push(...rows.map((r) => ({ _source_file: name, ...Object.fromEntries(Object.entries(r).map(([k, v]) => [String(k).trim(), String(v ?? "").trim()])) })));
  }
  return out.filter((r) => Object.entries(r).some(([k, v]) => k !== "_source_file" && v));
}

async function docxText(buf: ArrayBuffer): Promise<string> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) throw new Error("it isn't a readable Word file");
  return xml.replace(/<\/w:p>/g, "\n").replace(/<w:tab\/>/g, "\t").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Photo → JPEG no wider than 1600 px for AI reading (HEIC converted first). */
async function photoJpegBase64(buf: ArrayBuffer, name: string, type: string): Promise<string> {
  let blob: Blob = new Blob([buf], { type: type || "image/jpeg" });
  if (/\.(heic|heif)$/i.test(name) || /heic|heif/i.test(type)) {
    const heic2any = (await import("heic2any")).default;
    const res = await heic2any({ blob, toType: "image/jpeg", quality: 0.85 });
    blob = Array.isArray(res) ? res[0]! : res;
  }
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const out = await new Promise<Blob>((ok, bad) => canvas.toBlob((b) => (b ? ok(b) : bad(new Error("photo could not be converted"))), "image/jpeg", 0.82));
  return toBase64(await out.arrayBuffer());
}

type Collected = { manifest: ManifestFile[]; rows: Record<string, string>[]; documents: { name: string; text: string }[]; reads: FileResult[] };
type Readers = {
  readMedia: (name: string, mime: "application/pdf" | "image/jpeg", base64: string) => Promise<{ text: string; description: string }>;
  geocode: (points: { lat: number; lng: number }[]) => Promise<(string | null)[]>;
  progress: (msg: string) => void;
};
const why = (e: unknown) => (e instanceof Error && e.message ? e.message : "it could not be opened");

async function collect(files: File[], r: Readers): Promise<Collected> {
  const out: ManifestFile[] = [];
  const rows: Record<string, string>[] = [];
  const documents: { name: string; text: string }[] = [];
  const reads: FileResult[] = [];
  const media: { path: string; run: () => Promise<void> }[] = [];
  let vision = 0;
  const push = async (path: string, name: string, type: string, buf: ArrayBuffer) => {
    const f: ManifestFile = { path, name, folder: path.includes("/") ? path.split("/").slice(0, -1).join("/") : null, type, gps_lat: null, gps_lng: null, taken_at: null };
    try {
      if (LIST_RE.test(name)) {
        const got = await parseList(buf, path);
        rows.push(...got);
        reads.push({ name: path, status: got.length ? "ok" : "warn", message: got.length ? `read ${got.length} row${got.length > 1 ? "s" : ""}` : "spreadsheet is empty" });
        return;
      }
      if (/\.docx$/i.test(name)) {
        const text = (await docxText(buf)).trim();
        if (text) documents.push({ name: path, text: text.slice(0, 200_000) });
        reads.push({ name: path, status: text ? "ok" : "warn", message: text ? "read Word document" : "Word document has no text" });
        out.push(f); return;
      }
      if (TEXT_RE.test(name) || type.startsWith("text/")) {
        const text = new TextDecoder().decode(buf).slice(0, 200_000);
        documents.push({ name: path, text });
        reads.push({ name: path, status: "ok", message: /\.eml$/i.test(name) ? "read email" : "read text" });
        out.push(f); return;
      }
      if (/\.pdf$/i.test(name) || type === "application/pdf") {
        out.push(f);
        if (buf.byteLength > 10_000_000) { reads.push({ name: path, status: "error", message: "couldn't read — PDF is over 10 MB; split it or send the pages as photos" }); return; }
        media.push({ path, run: async () => {
          const res = await r.readMedia(path, "application/pdf", toBase64(buf));
          if (res.text) documents.push({ name: path, text: res.text });
          reads.push({ name: path, status: res.text ? "ok" : "warn", message: res.text ? "read PDF" : "PDF has no customer details" });
        } });
        return;
      }
      if (IMAGE_RE.test(name) || type.startsWith("image/")) {
        try {
          const exifr = (await import("exifr")).default;
          const gps = await exifr.gps(buf).catch(() => null);
          const exif = await exifr.parse(buf, { pick: ["DateTimeOriginal", "CreateDate"] }).catch(() => null);
          if (gps && Number.isFinite(gps.latitude)) { f.gps_lat = gps.latitude; f.gps_lng = gps.longitude; }
          const taken = exif?.DateTimeOriginal ?? exif?.CreateDate;
          if (taken) f.taken_at = new Date(taken).toISOString();
        } catch { /* no readable EXIF */ }
        out.push(f);
        const gpsNote = f.gps_lat != null ? "photo with GPS" : "photo (no GPS)";
        if (vision >= MAX_VISION) { reads.push({ name: path, status: "ok", message: `${gpsNote} — writing in the picture not read (over ${MAX_VISION} photos)` }); return; }
        vision++;
        media.push({ path, run: async () => {
          let b64: string;
          try { b64 = await photoJpegBase64(buf, name, type); } catch (e) { reads.push({ name: path, status: f.gps_lat != null ? "ok" : "warn", message: `${gpsNote} — couldn't read writing in the picture because ${why(e)}` }); return; }
          const res = await r.readMedia(path, "image/jpeg", b64);
          if (res.text) documents.push({ name: path, text: res.text });
          reads.push({ name: path, status: "ok", message: res.text ? `${gpsNote} — read writing in the picture` : `${gpsNote}${res.description ? ` (${res.description})` : ""}` });
        } });
        return;
      }
      out.push(f);
      reads.push({ name: path, status: "warn", message: "this file type can't be read — only its name is used. Send PDF, Word, Excel/CSV, text, email or photos" });
    } catch (e) {
      out.push(f);
      reads.push({ name: path, status: "error", message: `couldn't read because ${why(e)}` });
    }
  };
  for (const file of files) {
    if (/\.zip$/i.test(file.name)) {
      try {
        const JSZip = (await import("jszip")).default;
        const zip = await JSZip.loadAsync(await file.arrayBuffer());
        for (const [path, entry] of Object.entries(zip.files)) {
          if (entry.dir || path.split("/").some((p) => p.startsWith("__MACOSX") || p.startsWith("."))) continue;
          await push(path, path.split("/").pop()!, guessType(path), await entry.async("arraybuffer"));
        }
      } catch (e) { reads.push({ name: file.name, status: "error", message: `couldn't open zip because ${why(e)}` }); }
    } else {
      const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
      await push(rel || file.name, file.name, file.type || guessType(file.name), await file.arrayBuffer());
    }
  }
  // AI reading of PDFs/photos, three at a time; one failure never stops the rest.
  let done = 0;
  const queue = [...media];
  await Promise.all([0, 1, 2].map(async () => {
    for (let m = queue.shift(); m; m = queue.shift()) {
      r.progress(`Reading files… ${++done} of ${media.length}`);
      try { await m.run(); } catch (e) { reads.push({ name: m.path, status: "error", message: `couldn't read because ${why(e)}` }); }
    }
  }));
  // Photo GPS → approximate street address (matching/sorting only).
  const withGps = out.filter((f) => f.gps_lat != null && f.gps_lng != null);
  if (withGps.length) {
    r.progress("Looking up photo locations…");
    const uniq = [...new Map(withGps.map((f) => [`${f.gps_lat!.toFixed(4)},${f.gps_lng!.toFixed(4)}`, { lat: f.gps_lat!, lng: f.gps_lng! }])).entries()].slice(0, 40);
    try {
      const addrs = await r.geocode(uniq.map(([, p]) => p));
      const byKey = new Map(uniq.map(([k], i) => [k, addrs[i] ?? null]));
      for (const f of withGps) f.geo_address = byKey.get(`${f.gps_lat!.toFixed(4)},${f.gps_lng!.toFixed(4)}`) ?? null;
    } catch { /* lookup unavailable — photos still match by name */ }
  }
  return { manifest: out, rows, documents, reads };
}

function guessType(name: string): string {
  if (/\.jpe?g$/i.test(name)) return "image/jpeg";
  if (/\.png$/i.test(name)) return "image/png";
  if (/\.webp$/i.test(name)) return "image/webp";
  if (/\.(heic|heif)$/i.test(name)) return "image/heic";
  if (/\.pdf$/i.test(name)) return "application/pdf";
  return "application/octet-stream";
}

const STATUS_STYLE: Record<FileResult["status"], string> = { ok: "text-foreground", warn: "text-muted-foreground", error: "text-destructive" };
function FileResultList({ items }: { items: FileResult[] }) {
  if (!items.length) return null;
  return (
    <div className="space-y-1">
      <div className="text-sm font-medium">What we read from each file</div>
      <ul className="max-h-80 space-y-1 overflow-y-auto rounded-md border p-2 text-sm">
        {items.map((f, i) => (
          <li key={i} className={STATUS_STYLE[f.status]}><span className="font-medium break-all">{f.name.split("/").pop()}</span> — {f.message}</li>
        ))}
      </ul>
    </div>
  );
}

function BulkImportPage() {
  const qc = useQueryClient();
  const getBusinesses = useServerFn(bulkImportBusinesses);
  const createBatch = useServerFn(createBulkBatch);
  const getReview = useServerFn(bulkBatchReview);
  const confirm = useServerFn(confirmBulkBatch);
  const readFile = useServerFn(readBulkFile);
  const geocode = useServerFn(geocodeBulkPhotos);
  const [progress, setProgress] = useState("");
  const [localReads, setLocalReads] = useState<FileResult[]>([]);

  const [businessId, setBusinessId] = useState("");
  const [extraFiles, setExtraFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [permission, setPermission] = useState(false);
  const [done, setDone] = useState<{ created: number; skipped: number; failed: number } | null>(null);

  const { data: bizData } = useQuery({ queryKey: ["bulk-biz"], queryFn: () => getBusinesses() });
  const businesses = bizData?.businesses ?? [];
  const isAdmin = bizData?.isAdmin ?? false;
  const effectiveBiz = isAdmin ? businessId : (businessId || businesses[0]?.id || "");

  const { data: review } = useQuery({
    queryKey: ["bulk-review", batchId],
    queryFn: () => getReview({ data: { batchId: batchId! } }),
    enabled: !!batchId,
  });
  const rows = (review?.rows ?? []) as unknown as ReviewRow[];
  const missingAddr = rows.filter((r) => !r.duplicate_note && !skip.has(r.id) && !(r.extracted.address_line && r.extracted.postcode)).length;
  const summary = review?.batch?.summary as { file_results?: FileResult[]; rows?: number; covers_ready_check?: number; needs_visit?: number; office_review?: number; duplicates?: number; not_visited?: number; visited?: number; visited_quoted?: number } | null;

  async function analyse() {
    if (extraFiles.length === 0 || !effectiveBiz || !permission) return;
    setBusy(true); setLocalReads([]);
    try {
      const base = { businessId: effectiveBiz, onBehalf: isAdmin };
      const { manifest, rows: rawRows, documents, reads } = await collect(extraFiles, {
        readMedia: (name, mime, base64) => readFile({ data: { ...base, name, mime, base64 } }),
        geocode: async (points) => (await geocode({ data: { ...base, points } })).addresses,
        progress: setProgress,
      });
      setLocalReads(reads);
      if (rawRows.length === 0 && documents.length === 0 && manifest.length === 0) { toast.error("None of these files could be read — see the list below."); return; }
      setProgress("Finding customers…");
      const res = await createBatch({ data: { ...base, listFilename: `${extraFiles.length} files`, rawRows, documents, manifest, fileReads: reads, permissionConfirmed: true } });
      setBatchId(res.batchId);
      if (res.summary.rows > 0) toast.success(`${res.summary.rows} jobs found — please review below.`);
      else toast.warning("No customers found yet — see what we read from each file below.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(false); setProgress(""); }
  }

  async function confirmAll() {
    if (!batchId) return;
    setBusy(true);
    try {
      const res = await confirm({ data: { batchId, skipRowIds: [...skip] } });
      setDone(res);
      qc.invalidateQueries({ queryKey: ["bulk-review", batchId] });
      toast.success(`${res.created} jobs created.`);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4">
      <div>
        <h1 className="text-2xl font-semibold">Bulk job upload</h1>
        <p className="text-muted-foreground">Drop in anything you have — emails, exports, photos, PDFs, notes. No forms or spreadsheets to fill in. We work out each customer and how far along they are, then show you one review table. Nothing is created or sent until you confirm.</p>
      </div>

      {!batchId && (
        <Card>
          <CardHeader><CardTitle>1. Upload</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {isAdmin && (
              <label className="block space-y-1">
                <span className="text-sm font-medium">Installer business (office upload on their behalf)</span>
                <select className="w-full rounded-md border bg-background p-2" value={businessId} onChange={(e) => setBusinessId(e.target.value)}>
                  <option value="">Choose…</option>
                  {businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </label>
            )}
            <label className="block space-y-2 rounded-lg border-2 border-dashed p-6 text-center">
              <span className="block text-sm font-medium">Drop your files here, or tap to choose (zips welcome)</span>
              <input type="file" multiple className="mx-auto block" onChange={(e) => setExtraFiles([...(e.target.files ?? [])])} />
              {extraFiles.length > 0 && <span className="block text-xs text-muted-foreground">{extraFiles.length} file{extraFiles.length > 1 ? "s" : ""} ready</span>}
            </label>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={permission} onCheckedChange={(c) => setPermission(!!c)} />
              <span>{CONTACT_PERMISSION_WORDING}</span>
            </label>
            <p className="text-sm text-muted-foreground">Photos are used for matching and sorting only — they never count as official evidence. Any official evidence still missing is recorded and collected on install day.</p>
            <Button disabled={extraFiles.length === 0 || !effectiveBiz || !permission || busy} onClick={analyse}>{busy ? (progress || "Reading…") : "Read and match"}</Button>
            <FileResultList items={localReads} />
          </CardContent>
        </Card>
      )}

      {batchId && summary && !done && (
        <Card>
          <CardHeader>
            <CardTitle>2. Review — {summary.rows} jobs found</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {summary.rows === 0 && <p className="text-sm">No customers were found in these files. Check the list below, then add a customer list, or name folders/files by address (e.g. "14 Example St"), and upload again.</p>}
            {summary.rows === 0 && <Button variant="outline" onClick={() => { setBatchId(null); setExtraFiles([]); setPermission(false); setLocalReads([]); }}>Upload again</Button>}
            <FileResultList items={summary.file_results ?? localReads} />
            <div className="flex flex-wrap gap-2">
              <Badge variant="default">{summary.covers_ready_check ?? 0} cover the Ready Check</Badge>
              <Badge variant="secondary">{summary.needs_visit ?? 0} need a visit</Badge>
              <Badge variant="destructive">{summary.office_review ?? 0} office review</Badge>
              <Badge variant="outline">{summary.not_visited ?? 0} not visited · {summary.visited ?? 0} visited · {summary.visited_quoted ?? 0} quoted</Badge>
              {(summary.duplicates ?? 0) > 0 && <Badge variant="outline">{summary.duplicates} possible duplicates (skipped)</Badge>}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="p-2">Skip</th><th className="p-2">Customer</th><th className="p-2">Address</th>
                    <th className="p-2">Stage</th><th className="p-2">Area</th><th className="p-2">Price</th><th className="p-2">Files</th><th className="p-2">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b align-top">
                      <td className="p-2">
                        <Checkbox checked={skip.has(r.id) || !!r.duplicate_note} disabled={!!r.duplicate_note}
                          onCheckedChange={(c) => { const s = new Set(skip); if (c) s.add(r.id); else s.delete(r.id); setSkip(s); }} />
                      </td>
                      <td className="p-2">{r.extracted.full_name ?? "—"}<div className="text-xs text-muted-foreground">{r.extracted.phone ?? r.extracted.email ?? ""}</div></td>
                      <td className="p-2">{r.extracted.address_line && r.extracted.postcode
                        ? <>{r.extracted.address_line}<div className="text-xs text-muted-foreground">{[r.extracted.suburb, r.extracted.postcode].filter(Boolean).join(" ")}</div></>
                        : <AddAddress row={r} onSaved={() => qc.invalidateQueries({ queryKey: ["bulk-review", batchId] })} />}</td>
                      <td className="p-2">{r.extracted.lead_stage ? LEAD_STAGE_LABEL[r.extracted.lead_stage] : "—"}</td>
                      <td className="p-2">{r.extracted.area_m2 ? `${r.extracted.area_m2} m²` : "—"}</td>
                      <td className="p-2">{r.extracted.price_inc_gst ? `$${r.extracted.price_inc_gst}` : "—"}</td>
                      <td className="p-2">{r.matched_files.length > 0 ? `${r.matched_files.length} file${r.matched_files.length > 1 ? "s" : ""}` : "—"}</td>
                      <td className="p-2">
                        {r.sort_result && SORT_LABEL[r.sort_result] && <Badge variant={SORT_LABEL[r.sort_result]!.variant}>{SORT_LABEL[r.sort_result]!.label}</Badge>}
                        <ul className="mt-1 list-inside list-disc text-xs text-muted-foreground">
                          {(r.sort_reasons ?? []).map((x, i) => <li key={i}>{x}</li>)}
                          {r.duplicate_note && <li className="text-destructive">{r.duplicate_note}</li>}
                        </ul>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-sm text-muted-foreground">Confirming creates the jobs only — nothing is sent to any customer. If a price was included, a draft quote is prepared for office review (installer's price + PIESA + AP fee − government discount, no markup).</p>
            {missingAddr > 0 && <p className="text-sm text-destructive">{missingAddr} customer{missingAddr > 1 ? "s need" : " needs"} an address — add it in the table above, or tick Skip.</p>}
            <Button disabled={busy || summary.rows === 0 || missingAddr > 0} onClick={confirmAll}>{busy ? "Creating…" : "Confirm — create these jobs"}</Button>
          </CardContent>
        </Card>
      )}

      {done && (
        <Card>
          <CardHeader><CardTitle>Done</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <p>{done.created} jobs created{done.skipped ? `, ${done.skipped} skipped` : ""}{done.failed ? `, ${done.failed} could not be imported (office notified)` : ""}.</p>
            <p className="text-sm text-muted-foreground">Nothing has been sent to any customer. The office can see each job in the pipeline.</p>
            {batchId && <BatchOwnerLinksButton batchId={batchId} />}
            <Button variant="outline" onClick={() => { setBatchId(null); setDone(null); setExtraFiles([]); setPermission(false); setSkip(new Set()); setLocalReads([]); }}>Upload another batch</Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function AddAddress({ row, onSaved }: { row: ReviewRow; onSaved: () => void }) {
  const save = useServerFn(setBulkRowAddress);
  const [line, setLine] = useState(row.extracted.address_line ?? "");
  const [suburb, setSuburb] = useState(row.extracted.suburb ?? "");
  const [pc, setPc] = useState(row.extracted.postcode ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-destructive">No address found — please add it</p>
      <Input aria-label="Street address" placeholder="Street address" value={line} onChange={(e) => setLine(e.target.value)} />
      <div className="flex gap-1">
        <Input aria-label="Suburb" placeholder="Suburb" value={suburb} onChange={(e) => setSuburb(e.target.value)} />
        <Input aria-label="Postcode" placeholder="Postcode" className="w-24" inputMode="numeric" value={pc} onChange={(e) => setPc(e.target.value)} />
      </div>
      <Button size="sm" variant="outline" disabled={busy || line.trim().length < 3 || !/^3\d{3}$/.test(pc.trim())}
        onClick={async () => {
          setBusy(true);
          try { await save({ data: { rowId: row.id, address_line: line, suburb: suburb || null, postcode: pc } }); toast.success("Address added"); onSaved(); }
          catch (e) { toast.error((e as Error).message); }
          finally { setBusy(false); }
        }}>Save address</Button>
    </div>
  );
}
