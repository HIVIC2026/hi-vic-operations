import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { addBulkElectrician, bulkBatchReview, bulkElectricianChoices, bulkImportBusinesses, confirmBulkBatch, createBulkBatch, geocodeBulkPhotos, listBulkBatches, readBulkFile, setBulkReviewPlan, setBulkRowAddress } from "@/lib/bulk-import.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { CONTACT_PERMISSION_WORDING, LEAD_STAGE_LABEL, type FileResult, type LeadStage } from "@/lib/bulk-import.core";
import { AppShell } from "@/components/portal/AppShell";
import { TradeTabs } from "@/components/portal/trade-work";
import { AlertCircle, CheckCircle2, ChevronDown, FileArchive, UploadCloud, Zap } from "lucide-react";

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
  import_stage: LeadStage; electrician_plan: ElectricianPlan | null;
};
type ElectricianPlan = { mode: "mine" | "hivic" | "job_by_job"; nomination_id?: string | null; business_id?: string | null };

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
  const savePlan = useServerFn(setBulkReviewPlan);
  const getBatches = useServerFn(listBulkBatches);
  const getElectricians = useServerFn(bulkElectricianChoices);
  const addElectrician = useServerFn(addBulkElectrician);
  const [progress, setProgress] = useState("");
  const [localReads, setLocalReads] = useState<FileResult[]>([]);

  const [businessId, setBusinessId] = useState("");
  const [extraFiles, setExtraFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [permission, setPermission] = useState(false);
  const confirming = useRef(false);
  const [done, setDone] = useState<{ created: number; skipped: number; failed: number; alreadyTaken?: number; remaining?: number; ownerLinks: { jobNumber: string; owner: string; path: string }[] } | null>(null);
  const [batchPlan, setBatchPlan] = useState<ElectricianPlan>({ mode: "hivic" });
  const [rowStages, setRowStages] = useState<Record<string, LeadStage>>({});
  const [rowPlans, setRowPlans] = useState<Record<string, ElectricianPlan>>({});
  const [newElectrician, setNewElectrician] = useState({ name: "", mobile: "", email: "", business: "" });

  const { data: bizData } = useQuery({ queryKey: ["bulk-biz"], queryFn: () => getBusinesses() });
  const businesses = bizData?.businesses ?? [];
  const isAdmin = bizData?.isAdmin ?? false;
  const effectiveBiz = isAdmin ? businessId : (businessId || businesses[0]?.id || "");
  const { data: past, refetch: refreshPast } = useQuery({ queryKey: ["bulk-past", effectiveBiz], queryFn: () => getBatches({ data: effectiveBiz ? { businessId: effectiveBiz } : {} }), enabled: isAdmin || !!effectiveBiz });
  const { data: electricianData, refetch: refreshElectricians } = useQuery({ queryKey: ["bulk-electricians", effectiveBiz], queryFn: () => getElectricians({ data: { businessId: effectiveBiz } }), enabled: !!effectiveBiz });

  const { data: review } = useQuery({
    queryKey: ["bulk-review", batchId],
    queryFn: () => getReview({ data: { batchId: batchId! } }),
    enabled: !!batchId,
  });
  const rows = (review?.rows ?? []) as unknown as ReviewRow[];
  const missingAddr = rows.filter((r) => !r.duplicate_note && !skip.has(r.id) && !(r.extracted.address_line && r.extracted.postcode)).length;
  const summary = review?.batch?.summary as { file_results?: FileResult[]; rows?: number; covers_ready_check?: number; needs_visit?: number; office_review?: number; duplicates?: number; not_visited?: number; visited?: number; visited_quoted?: number } | null;
  useEffect(() => {
    if (!rows.length) return;
    setRowStages((old) => Object.fromEntries(rows.map((r) => [r.id, old[r.id] ?? r.import_stage ?? r.extracted.lead_stage ?? "not_visited"])));
    setRowPlans((old) => Object.fromEntries(rows.map((r) => [r.id, old[r.id] ?? r.electrician_plan ?? { mode: "hivic" }])));
  }, [review?.rows]);

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
    if (!batchId || confirming.current) return;
    confirming.current = true;
    setBusy(true);
    try {
      await savePlan({ data: { batchId, batchPlan, rows: rows.map((r) => ({ rowId: r.id, stage: rowStages[r.id] ?? "not_visited", plan: batchPlan.mode === "job_by_job" ? (rowPlans[r.id] ?? { mode: "hivic" }) : null })) } });
      const res = await confirm({ data: { batchId, skipRowIds: [...skip] } });
      setDone(res);
      qc.invalidateQueries({ queryKey: ["bulk-review", batchId] });
      toast.success(`${res.created} jobs created.`);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); confirming.current = false; }
  }

  return (
    <AppShell wide>
    <div className="mx-auto max-w-5xl space-y-6 pb-24">
      <div className="rounded-[22px] bg-workspace-mist p-5 sm:p-7">
        <p className="mb-2 text-sm font-bold text-primary">Add job</p>
        <h1 className="font-display text-3xl font-extrabold text-foreground sm:text-4xl">Bulk job upload</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">Add a spreadsheet, quotes, emails, notes or photos. We read everything together, then you check each customer before anything is added.</p>
      </div>

      {!batchId && (
        <Card className="rounded-[22px] border-border shadow-sm">
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
            <label className="block space-y-3 rounded-[18px] border-2 border-dashed border-primary/35 bg-workspace-mist p-8 text-center">
              <UploadCloud className="mx-auto h-9 w-9 text-primary" />
              <span className="block font-display text-lg font-bold">Choose files or a ZIP</span>
              <span className="block text-sm text-muted-foreground">Excel, CSV, PDF, Word, email, text and large photo batches</span>
              <input type="file" multiple className="mx-auto block" onChange={(e) => setExtraFiles([...(e.target.files ?? [])])} />
              {extraFiles.length > 0 && <span className="block text-xs text-muted-foreground">{extraFiles.length} file{extraFiles.length > 1 ? "s" : ""} ready</span>}
            </label>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={permission} onCheckedChange={(c) => setPermission(!!c)} />
              <span>{CONTACT_PERMISSION_WORDING}</span>
            </label>
            <p className="text-sm text-muted-foreground">Photos are used for matching and sorting only — they never count as official evidence. Any official evidence still missing is recorded and collected on install day.</p>
            <Button size="field" className="w-full" disabled={extraFiles.length === 0 || !effectiveBiz || !permission || busy} onClick={analyse}>{busy ? (progress || "Reading…") : "Read my files"}</Button>
            <FileResultList items={localReads} />
          </CardContent>
        </Card>
      )}

      {batchId && summary && !done && (
        <Card className="rounded-[22px] border-border shadow-sm">
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
            <ElectricianChoice value={batchPlan} onChange={setBatchPlan} approved={electricianData?.approved ?? []} pending={electricianData?.pending ?? []} add={async () => { const made = await addElectrician({ data: { businessId: effectiveBiz, name: newElectrician.name, mobile: newElectrician.mobile, email: newElectrician.email || null, business: newElectrician.business || null } }); await refreshElectricians(); setBatchPlan({ mode: "mine", ...(made.businessId ? { business_id: made.businessId } : { nomination_id: made.nominationId }) }); setNewElectrician({ name: "", mobile: "", email: "", business: "" }); }} draft={newElectrician} setDraft={setNewElectrician} />
            <p className="rounded-lg bg-workspace-mint p-3 text-sm">The owner gets a queued text/email link to choose times. Their electrician gets first choice and taps a time to take it. Nothing is sent while sending is off.</p>
            <div className="grid gap-3">
              {rows.map((r) => (
                <Card key={r.id} className={`rounded-[18px] ${r.sort_result === "office_review" ? "border-workspace-blush-strong" : ""}`}>
                  <CardContent className="space-y-3 p-4">
                    <div className="flex items-start justify-between gap-3"><div><div className="font-display text-lg font-bold">{r.extracted.full_name ?? "Unnamed customer"}</div><div className="text-sm text-muted-foreground">{r.extracted.phone ?? r.extracted.email ?? "Contact missing"}</div></div><Checkbox aria-label={`Skip ${r.extracted.full_name ?? "customer"}`} checked={skip.has(r.id) || !!r.duplicate_note} onCheckedChange={(c) => { const s = new Set(skip); if (c) s.add(r.id); else s.delete(r.id); setSkip(s); }} /></div>
                    <div className="text-sm">{r.extracted.address_line && r.extracted.postcode ? <>{r.extracted.address_line}, {[r.extracted.suburb, r.extracted.postcode].filter(Boolean).join(" ")}</> : <AddAddress row={r} onSaved={() => qc.invalidateQueries({ queryKey: ["bulk-review", batchId] })} />}</div>
                    <div className="grid grid-cols-3 gap-2 text-center text-sm"><div className="rounded-lg bg-muted p-2"><b>{r.extracted.area_m2 ? `${r.extracted.area_m2} m²` : "—"}</b><span className="block text-xs text-muted-foreground">Area</span></div><div className="rounded-lg bg-muted p-2"><b>{r.extracted.price_inc_gst ? `$${r.extracted.price_inc_gst}` : "—"}</b><span className="block text-xs text-muted-foreground">Price</span></div><div className="rounded-lg bg-muted p-2"><b>{r.matched_files.length}</b><span className="block text-xs text-muted-foreground">Files</span></div></div>
                    <label className="block text-sm font-semibold">Where is this job up to?<select className="mt-1 h-12 w-full rounded-md border bg-background px-3" value={rowStages[r.id] ?? "not_visited"} onChange={(e) => setRowStages({ ...rowStages, [r.id]: e.target.value as LeadStage })}>{Object.entries(LEAD_STAGE_LABEL).map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></label>
                    {batchPlan.mode === "job_by_job" && <ElectricianChoice compact value={rowPlans[r.id] ?? { mode: "hivic" }} onChange={(plan) => setRowPlans({ ...rowPlans, [r.id]: plan })} approved={electricianData?.approved ?? []} pending={electricianData?.pending ?? []} />}
                    <div>{r.sort_result && SORT_LABEL[r.sort_result] && <Badge variant={SORT_LABEL[r.sort_result]!.variant}>{SORT_LABEL[r.sort_result]!.label}</Badge>}<ul className="mt-2 space-y-1 text-xs text-muted-foreground">{(r.sort_reasons ?? []).map((x, i) => <li key={i}>• {x}</li>)}{r.duplicate_note && <li className="font-semibold text-destructive">• {r.duplicate_note}</li>}</ul></div>
                  </CardContent>
                </Card>
              ))}
            </div>
            <p className="text-sm text-muted-foreground">Confirming creates the jobs only — nothing is sent to any customer. If a price was included, a draft quote is prepared for office review (installer's price + PIESA + AP fee − government discount, no markup).</p>
            {missingAddr > 0 && <p className="text-sm text-destructive">{missingAddr} customer{missingAddr > 1 ? "s need" : " needs"} an address — add it in the table above, or tick Skip.</p>}
            <Button size="field" className="w-full" disabled={busy || summary.rows === 0 || missingAddr > 0 || rows.some((r) => r.sort_result === "office_review" && !skip.has(r.id))} onClick={confirmAll}>{busy ? "Adding…" : `Add ${rows.filter((r) => !skip.has(r.id) && !r.duplicate_note).length} jobs`}</Button>
          </CardContent>
        </Card>
      )}

      {done && (
        <Card>
          <CardHeader><CardTitle>Done</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <p>{done.created} jobs created{done.skipped ? `, ${done.skipped} skipped` : ""}{done.failed ? `, ${done.failed} could not be imported yet` : ""}.</p>{done.remaining ? <p className="text-sm font-semibold">{done.remaining} still to fix — this upload stays open. Fix them in Past uploads, then confirm again; jobs already added are never added twice.</p> : null}
            <p className="text-sm text-muted-foreground">Nothing has been sent to any customer. The office can see each job in the pipeline.</p>
            {!!done.ownerLinks.length && <details className="rounded-lg border p-3"><summary className="cursor-pointer font-semibold">Queued owner confirmation links</summary><div className="mt-2 space-y-2">{done.ownerLinks.map((l) => <div key={l.path} className="rounded bg-muted p-2 text-sm"><b>{l.jobNumber} · {l.owner}</b><div className="break-all text-muted-foreground">{l.path}</div></div>)}</div></details>}
            <Button variant="outline" onClick={() => { setBatchId(null); setDone(null); setExtraFiles([]); setPermission(false); setSkip(new Set()); setLocalReads([]); }}>Upload another batch</Button>
          </CardContent>
        </Card>
      )}

      <section className="space-y-3"><div className="flex items-center gap-2"><FileArchive className="h-5 w-5 text-primary"/><h2 className="font-display text-xl font-bold">Past uploads</h2></div>{(past?.batches ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No previous uploads yet.</p> : <div className="grid gap-2">{(past?.batches ?? []).map((b) => { const s = b.summary as { rows?: number } | null; return <button key={b.id} type="button" className="flex w-full items-center justify-between rounded-lg border bg-card p-3 text-left" onClick={() => setBatchId(b.id)}><span><b>{b.list_filename ?? "Bulk upload"}</b><span className="block text-xs text-muted-foreground">{new Date(b.created_at).toLocaleDateString("en-AU")} · {s?.rows ?? 0} jobs</span></span><span className="flex items-center gap-1 text-sm font-semibold capitalize">{b.status}<ChevronDown className="h-4 w-4"/></span></button>; })}</div>}</section>
      <TradeTabs installer />
    </div>
    </AppShell>
  );
}

type Choice = { businessId?: string; nominationId?: string; name: string; status: string; primary?: boolean; business?: string | null };
function ElectricianChoice({ value, onChange, approved, pending, compact = false, add, draft, setDraft }: { value: ElectricianPlan; onChange: (v: ElectricianPlan) => void; approved: Choice[]; pending: Choice[]; compact?: boolean; add?: () => Promise<void>; draft?: { name: string; mobile: string; email: string; business: string }; setDraft?: (v: { name: string; mobile: string; email: string; business: string }) => void }) {
  const [adding, setAdding] = useState(false);
  const options = [...approved.map((x) => ({ ...x, key: `b:${x.businessId}` })), ...pending.map((x) => ({ ...x, key: `n:${x.nominationId}` }))];
  const selected = value.business_id ? `b:${value.business_id}` : value.nomination_id ? `n:${value.nomination_id}` : "";
  const pickFirst = () => {
    const first = options[0];
    if (first?.businessId) onChange({ mode: "mine", business_id: first.businessId });
    else if (first?.nominationId) onChange({ mode: "mine", nomination_id: first.nominationId });
    else onChange({ mode: "mine" });
  };
  return <div className={compact ? "rounded-lg bg-muted p-3" : "rounded-[18px] border bg-card p-4"}><div className="mb-2 flex items-center gap-2"><Zap className="h-4 w-4 text-primary"/><b>{compact ? "Safety check" : "Who does the electrical safety check?"}</b></div><div className="grid gap-2 sm:grid-cols-3"><Button type="button" variant={value.mode === "mine" ? "default" : "outline"} onClick={pickFirst}>Use my electrician{compact ? "" : " for all"}</Button><Button type="button" variant={value.mode === "hivic" ? "default" : "outline"} onClick={() => onChange({ mode: "hivic" })}>Use Home Insulation Victoria{compact ? "" : " electricians for all"}</Button>{!compact && <Button type="button" variant={value.mode === "job_by_job" ? "default" : "outline"} onClick={() => onChange({ mode: "job_by_job" })}>Choose job by job</Button>}</div>{value.mode === "mine" && <div className="mt-3"><select aria-label="My electrician" className="h-12 w-full rounded-md border bg-background px-3" value={selected} onChange={(e) => { const [k,id] = e.target.value.split(":"); if (!id) return; onChange(k === "b" ? { mode: "mine", business_id: id } : { mode: "mine", nomination_id: id }); }}><option value="">Choose your electrician</option>{options.map((x) => <option key={x.key} value={x.key}>{x.name} · {x.status}</option>)}</select>{!compact && <Button type="button" variant="ghost" className="mt-1" onClick={() => setAdding(!adding)}>+ Add electrician</Button>}</div>}{adding && draft && setDraft && add && <div className="mt-3 grid gap-2 rounded-lg bg-muted p-3 sm:grid-cols-2"><Input placeholder="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })}/><Input placeholder="Mobile" value={draft.mobile} onChange={(e) => setDraft({ ...draft, mobile: e.target.value })}/><Input placeholder="Business (optional)" value={draft.business} onChange={(e) => setDraft({ ...draft, business: e.target.value })}/><Input placeholder="Email (optional)" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })}/><Button className="sm:col-span-2" disabled={draft.name.trim().length < 2 || draft.mobile.replace(/\D/g, "").length < 8} onClick={add}>Save electrician</Button></div>}{value.mode === "mine" && selected && <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground"><CheckCircle2 className="h-3.5 w-3.5"/>They get first choice. There is no automatic fallback or reassignment.</p>}{value.mode === "mine" && !selected && <p className="mt-2 flex items-center gap-1 text-xs text-destructive"><AlertCircle className="h-3.5 w-3.5"/>Choose or add an electrician before adding jobs.</p>}</div>;
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
