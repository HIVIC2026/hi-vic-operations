import { createFileRoute, redirect } from "@tanstack/react-router";
import { legacyBulkImportRedirect, loadAccess, userIdOf } from "@/lib/route-guards";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { addBulkRowFiles, removeBulkRowFile, addBulkElectrician, bulkBatchReview, bulkElectricianChoices, bulkImportBusinesses, confirmBulkBatch, createBulkBatch, geocodeBulkPhotos, listBulkBatches, readBulkFile, readBulkRows, setBulkReviewPlan, setBulkRowAddress } from "@/lib/bulk-import.functions";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { quotedGap, CONTACT_PERMISSION_WORDING, gridToRecords, QUOTE_NEEDED_LABEL, fieldProblems, rowStatusLine, jobsFound, attachedFilesNote, outsideVictoria, OUTSIDE_VIC_MESSAGE, chunkRows, readInChunks, readingProgress, rowRangeLabel, READ_CHUNK_ROWS, safeMemberPath, uniqueManifestPath, MAX_MEMBER_BYTES, type RowChunk, type FileResult, type LeadStage, type SecondContact } from "@/lib/bulk-import.core";
import { TradeShell } from "@/components/trade/TradeShell";
import { Check, ChevronDown, UploadCloud } from "lucide-react";
import { cn } from "@/lib/utils";

import { AttachFiles, ElectricianPicker, inviteResultMessage, useUploadFiles } from "@/components/trade/job-intake";
import { electricianPlanBlocker, usualElectrician } from "@/lib/job-electrician.core";

export const Route = createFileRoute("/_authenticated/partner/bulk-import")({
  beforeLoad: async ({ context }) => {
    // Office and installer business owners/admins may batch upload; others go to single Add job.
    const to = legacyBulkImportRedirect(await loadAccess(userIdOf(context)));
    if (to) throw redirect({ to, replace: true });
  },
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

type ManifestFile = { path: string; name: string; folder: string | null; type: string; gps_lat: number | null; gps_lng: number | null; taken_at: string | null; geo_address?: string | null; stored_path?: string };
type ReviewRow = {
  id: string; row_index: number; status: string; duplicate_note: string | null;
  extracted: { full_name?: string | null; address_line?: string | null; suburb?: string | null; postcode?: string | null; area_m2?: number | null; price_inc_gst?: number | null; quoted_answer?: "yes" | "no" | null; lead_stage?: LeadStage; phone?: string | null; email?: string | null; price_includes?: string | null; site_check?: "yes" | "no" | null; site_check_date?: string | null; site_check_source?: "file" | "asked" | null; second_contact?: SecondContact | null; notes?: string | null; owner_consent?: unknown };
  matched_files: { path: string; name: string; how: string }[]; sort_result: "covers_ready_check" | "needs_visit" | "office_review" | null;
  sort_reasons: string[]; missing_evidence: string[];
  import_stage: LeadStage; electrician_plan: ElectricianPlan | null;
};
type ElectricianPlan = { mode: "mine" | "hivic" | "job_by_job"; nomination_id?: string | null; business_id?: string | null };


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
    // Header row may be lower down; blank rows and extra columns are tolerated (see gridToRecords).
    const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false, blankrows: false });
    out.push(...gridToRecords(grid).map((r) => ({ _source_file: wb.SheetNames.length > 1 ? `${name} (${sn})` : name, ...r })));
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

type Collected = { manifest: ManifestFile[]; rows: Record<string, string>[]; documents: { name: string; text: string }[]; reads: FileResult[]; bytes: Map<string, { buf: ArrayBuffer; name: string; type: string }> };
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
  // Every job file (loose, in a folder or inside a ZIP) keeps its bytes so it can be stored privately and attached.
  const bytes: Collected["bytes"] = new Map();
  const taken = new Set<string>();
  const push = async (rawPath: string, name: string, type: string, buf: ArrayBuffer) => {
    const safe = safeMemberPath(rawPath);
    if (!safe) { reads.push({ name: rawPath, status: "error", message: "skipped — unsafe file path inside the upload" }); return; }
    if (buf.byteLength > MAX_MEMBER_BYTES) { reads.push({ name: safe, status: "error", message: "not attached — file is over 50 MB" }); return; }
    const path = LIST_RE.test(name) ? safe : uniqueManifestPath(safe, taken);
    if (!LIST_RE.test(name)) bytes.set(path, { buf, name, type });
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
  return { manifest: out, rows, documents, reads, bytes };
}

function guessType(name: string): string {
  if (/\.jpe?g$/i.test(name)) return "image/jpeg";
  if (/\.png$/i.test(name)) return "image/png";
  if (/\.webp$/i.test(name)) return "image/webp";
  if (/\.(heic|heif)$/i.test(name)) return "image/heic";
  if (/\.pdf$/i.test(name)) return "application/pdf";
  return "application/octet-stream";
}

const STATUS_STYLE: Record<FileResult["status"], string> = { ok: "text-ink", warn: "text-sub", error: "text-danger" };
function FileResultList({ items }: { items: FileResult[] }) {
  if (!items.length) return null;
  // Files not linked to any customer are always shown open, so they can't be missed before confirming.
  const unlinked = items.filter((f) => f.status === "warn" && /not linked to any customer/.test(f.message));
  return (
    <div className="space-y-2">
      {unlinked.length > 0 && (
        <div role="alert" data-unlinked-files className="rounded-[12px] border border-warning bg-warning-soft p-2 text-xs">
          <p className="font-semibold">{unlinked.length === 1 ? "1 file is" : `${unlinked.length} files are`} not linked to any customer — check before continuing</p>
          <ul className="mt-1 space-y-1">{unlinked.map((f, i) => <li key={i}><span className="font-medium break-all">{f.name.split("/").pop()}</span> — {f.message}</li>)}</ul>
        </div>
      )}
      <details className="text-sm">
        <summary className="cursor-pointer text-xs font-semibold text-sub">What we read from each file ({items.length})</summary>
        <ul className="mt-1 max-h-80 space-y-1 overflow-y-auto rounded-[12px] border border-line bg-paper p-2 text-xs">
          {items.map((f, i) => (
            <li key={i} className={STATUS_STYLE[f.status]}><span className="font-medium break-all">{f.name.split("/").pop()}</span> — {f.message}</li>
          ))}
        </ul>
      </details>
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
  const readRows = useServerFn(readBulkRows);
  const [failedChunks, setFailedChunks] = useState<{ from: number; to: number }[]>([]);
  const pending = useRef<{ base: { businessId: string; onBehalf: boolean }; rawRows: Record<string, string>[]; documents: { name: string; text: string }[]; manifest: unknown[]; reads: unknown[]; leads: unknown[]; failed: RowChunk<Record<string, string>>[] } | null>(null);
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
  const resumed = useRef<string | null>(null);
  // Refresh-safe review: the open upload stays in the address bar so a reload resumes it (never a second upload).
  useEffect(() => { const b = new URLSearchParams(window.location.search).get("batch"); if (b && /^[0-9a-f-]{36}$/i.test(b)) { resumed.current = b; setBatchId(b); } }, []);
  useEffect(() => { const u = new URL(window.location.href); if (batchId) u.searchParams.set("batch", batchId); else u.searchParams.delete("batch"); window.history.replaceState(window.history.state, "", u.toString()); }, [batchId]);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [consent, setConsent] = useState<Record<string, boolean>>({});
  const [leads, setLeads] = useState<Record<string, ReviewRow["extracted"]>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [showAllPast, setShowAllPast] = useState(false);
  const confirming = useRef(false);
  const [done, setDone] = useState<{ created: number; skipped: number; failed: number; alreadyTaken?: number; remaining?: number | null; remainingUnknown?: boolean; ownerLinks: { jobNumber: string; owner: string; path: string }[]; incomplete?: { row: number; jobNumber?: string | null; reason: string }[]; results?: { row: number; jobNumber: string; quote: string; attached: string[]; notAttached: string[] }[] } | null>(null);
  const [batchPlan, setBatchPlan] = useState<ElectricianPlan>({ mode: "hivic" });
  const [rowStages, setRowStages] = useState<Record<string, LeadStage>>({});
  const [rowPlans, setRowPlans] = useState<Record<string, ElectricianPlan>>({});
  // Site check (Jo, 7 Oct): read from the file when it says so; otherwise the installer answers Yes/No per row.
  // "Quoted? Yes / No" per customer (Jo, 7 Oct): never preset; a file price prefills Yes but the installer still confirms.
  const [rowQuoted, setRowQuoted] = useState<Record<string, { answer: "yes" | "no" | null; price: string; confirmed: boolean }>>({});
  const quotedSend = (id: string) => { const q = rowQuoted[id]; if (!q?.confirmed || !q.answer) return { quoted: null, quotedPrice: null }; const n = Number(q.price.replace(/[$,\s]/g, "")); return q.answer === "yes" ? { quoted: "yes" as const, quotedPrice: Number.isFinite(n) && n > 0 ? n : null } : { quoted: "no" as const, quotedPrice: null }; };
  const quotedOpen = (id: string) => { const x = quotedSend(id); return quotedGap(x.quoted, x.quotedPrice); };
  const [rowChecks, setRowChecks] = useState<Record<string, { check: "yes" | "no" | null; date: string | null }>>({});
  const [newElectrician, setNewElectrician] = useState({ name: "", mobile: "", email: "", business: "" });

  const { data: bizData } = useQuery({ queryKey: ["bulk-biz"], queryFn: () => getBusinesses() });
  const businesses = bizData?.businesses ?? [];
  const isAdmin = bizData?.isAdmin ?? false;
  const effectiveBiz = isAdmin ? businessId : (businessId || businesses[0]?.id || "");
  const storeFiles = useUploadFiles(effectiveBiz);
  const { data: past, refetch: refreshPast } = useQuery({ queryKey: ["bulk-past", effectiveBiz], queryFn: () => getBatches({ data: effectiveBiz ? { businessId: effectiveBiz } : {} }), enabled: isAdmin || !!effectiveBiz });
  const { data: electricianData, refetch: refreshElectricians } = useQuery({ queryKey: ["bulk-electricians", effectiveBiz], queryFn: () => getElectricians({ data: { businessId: effectiveBiz } }), enabled: !!effectiveBiz });
  // The installer's usual electrician is preselected (Jo, 7 Oct); each card can change it.
  const planSeeded = useRef(false);
  useEffect(() => { if (planSeeded.current || !electricianData) return; planSeeded.current = true; const u = usualElectrician(electricianData.approved); if (u?.businessId) setBatchPlan({ mode: "mine", business_id: u.businessId }); }, [electricianData]);
  const planFor = (id: string): ElectricianPlan => rowPlans[id] ?? batchPlan;
  const addNewElectrician = async (d: { name: string; business: string; mobile: string; email: string }) => { const made = await addElectrician({ data: { businessId: effectiveBiz, name: d.name, mobile: d.mobile, email: d.email, business: d.business } }); await refreshElectricians(); return { made, message: inviteResultMessage(made) }; };

  const { data: review } = useQuery({
    queryKey: ["bulk-review", batchId],
    queryFn: () => getReview({ data: { batchId: batchId! } }),
    enabled: !!batchId,
  });
  const rows = (review?.rows ?? []) as unknown as ReviewRow[];
  // A reloaded upload that is already confirmed is never shown as editable again (see Past uploads instead).
  const reviewStatus = (review?.batch as { status?: string } | undefined)?.status;
  useEffect(() => { if (batchId && batchId === resumed.current && !done && reviewStatus && reviewStatus !== "analysed") { resumed.current = null; setBatchId(null); toast.info("That upload is already finished — see Past uploads below."); } }, [batchId, done, reviewStatus]);
  const summary = review?.batch?.summary as { file_results?: FileResult[]; rows?: number; covers_ready_check?: number; needs_visit?: number; office_review?: number; duplicates?: number; not_visited?: number; visited?: number; visited_quoted?: number; quote_needed?: number; site_check_unclear?: number } | null;
  useEffect(() => {
    if (!rows.length) return;
    setRowStages((old) => Object.fromEntries(rows.map((r) => [r.id, old[r.id] ?? r.import_stage ?? r.extracted.lead_stage ?? "not_visited"])));
    setRowPlans((old) => Object.fromEntries(rows.filter((r) => old[r.id] || r.electrician_plan).map((r) => [r.id, old[r.id] ?? r.electrician_plan!])));
    setRowQuoted((old) => Object.fromEntries(rows.map((r) => [r.id, old[r.id] ?? (r.extracted.quoted_answer ? { answer: r.extracted.quoted_answer, price: r.extracted.price_inc_gst ? String(r.extracted.price_inc_gst) : "", confirmed: true } : r.extracted.price_inc_gst ? { answer: "yes", price: String(r.extracted.price_inc_gst), confirmed: false } : { answer: null, price: "", confirmed: false })])));
    setConsent((old) => Object.fromEntries(rows.map((r) => [r.id, old[r.id] ?? !!(r.extracted.owner_consent && typeof r.extracted.owner_consent === "object")])));
    setLeads((old) => Object.fromEntries(rows.map((r) => [r.id, old[r.id] ?? r.extracted])));
    setRowChecks((old) => Object.fromEntries(rows.map((r) => [r.id, old[r.id] ?? { check: r.extracted.site_check ?? null, date: r.extracted.site_check_date ?? null }])));
  }, [review?.rows]);

  const statusOf = (r: ReviewRow) => { const q = quotedSend(r.id); return rowStatusLine({ lead: leads[r.id] ?? r.extracted, consent: !!consent[r.id], quoted: rowQuoted[r.id]?.confirmed ? rowQuoted[r.id]!.answer : null, quotedPrice: q.quotedPrice ?? null, siteCheck: rowChecks[r.id]?.check ?? null, installed: r.import_stage === "installed", duplicate: r.duplicate_note }); };
  const toAdd = rows.filter((r) => !skip.has(r.id) && !statusOf(r).excluded);
  const notReady = toAdd.filter((r) => !statusOf(r).ready || r.sort_result === "office_review");
  const anySaving = Object.values(saving).some(Boolean);
  const reset = () => { setBatchId(null); setDone(null); setExtraFiles([]); setSkip(new Set()); setLocalReads([]); setConsent({}); setLeads({}); };
  const step = done ? 3 : batchId ? 2 : 1;

  async function finishBatch() {
    const p = pending.current; if (!p) return;
    setProgress("Finding customers…");
    const res = await createBatch({ data: { ...p.base, listFilename: `${extraFiles.length} file${extraFiles.length === 1 ? "" : "s"}`, rawRows: p.rawRows, documents: p.documents, manifest: p.manifest as never, fileReads: p.reads as never, preExtracted: p.leads as never } });
    pending.current = null; setFailedChunks([]);
    setBatchId(res.batchId);
    toast.success(res.summary.rows > 0 ? `${res.summary.rows} customer${res.summary.rows === 1 ? "" : "s"} found.` : "No customers found in this upload.");
  }
  async function retryFailed() {
    const p = pending.current; if (!p) return;
    setBusy(true);
    try {
      const total = p.failed.reduce((n, c) => n + c.rows.length, 0);
      const r = await readInChunks(p.failed, async (c) => (await readRows({ data: { ...p.base, rows: c.rows } })).leads, { onDone: (n) => setProgress(readingProgress(total, n)) });
      p.leads = [...p.leads, ...r.leads]; p.failed = r.failed;
      if (r.failed.length) { setFailedChunks(r.failed.map(({ from, to }) => ({ from, to }))); toast.error("Some rows still couldn't be read."); return; }
      await finishBatch();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); setProgress(""); }
  }
  async function continueWithout() {
    setBusy(true);
    try { await finishBatch(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); setProgress(""); }
  }

  async function analyse() {
    if (extraFiles.length === 0 || !effectiveBiz) return;
    setBusy(true); setLocalReads([]);
    try {
      const base = { businessId: effectiveBiz, onBehalf: isAdmin };
      const collected = await collect(extraFiles, {
        readMedia: (name, mime, base64) => readFile({ data: { ...base, name, mime, base64 } }),
        geocode: async (points) => (await geocode({ data: { ...base, points } })).addresses,
        progress: setProgress,
      });
      const { rows: rawRows, documents } = collected;
      // Keep a private copy of EVERY job file — loose, in a folder or inside a ZIP — keyed by its full relative path,
      // so it can be attached to its job on confirm. A file that fails to save is shown as not attached, never hidden.
      setProgress("Saving your files…");
      const stored = new Map<string, string>();
      const reads = [...collected.reads];
      let n = 0;
      for (const [path, b] of collected.bytes) {
        setProgress(`Saving your files… ${++n} of ${collected.bytes.size}`);
        try {
          const [saved] = await storeFiles([new File([b.buf], b.name, { type: b.type })]);
          if (saved) stored.set(path, saved.path);
        } catch (err) { reads.push({ name: path, status: "error", message: `couldn't be saved, so it can't be attached — ${why(err)}. Add it to the customer card by hand.` }); }
      }
      const manifest = collected.manifest.map((f) => (stored.get(f.path) ? { ...f, stored_path: stored.get(f.path)! } : f));
      setLocalReads(reads);
      if (rawRows.length === 0 && documents.length === 0 && manifest.length === 0) { toast.error("None of these files could be read — see the list below."); return; }
      if (rawRows.length > READ_CHUNK_ROWS) {
        // Big list: read in small chunks with retries and live progress, so nothing hangs or fails as a whole.
        setProgress(readingProgress(rawRows.length, 0));
        const r = await readInChunks(chunkRows(rawRows), async (c) => (await readRows({ data: { ...base, rows: c.rows } })).leads, { onDone: (n) => setProgress(readingProgress(rawRows.length, n)) });
        pending.current = { base, rawRows, documents, manifest, reads, leads: r.leads, failed: r.failed };
        if (r.failed.length) { setFailedChunks(r.failed.map(({ from, to }) => ({ from, to }))); return; }
        await finishBatch(); return;
      }
      setProgress("Finding customers…");
      const res = await createBatch({ data: { ...base, listFilename: `${extraFiles.length} file${extraFiles.length === 1 ? "" : "s"}`, rawRows, documents, manifest, fileReads: reads } });
      setBatchId(res.batchId);
      if (res.summary.rows > 0) toast.success(`${jobsFound(res.summary.rows)} — please check each customer.`);
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
      const saved = await savePlan({ data: { batchId, batchPlan, rows: rows.map((r) => ({ rowId: r.id, stage: rowStages[r.id] ?? "not_visited", siteCheck: rowChecks[r.id]?.check ?? null, ...quotedSend(r.id), siteCheckDate: rowChecks[r.id]?.check === "yes" ? rowChecks[r.id]?.date ?? null : null, consent: !!consent[r.id], plan: planFor(r.id) })) } });
      if (saved.lockedRows?.length) toast.info(`Row${saved.lockedRows.length > 1 ? "s" : ""} ${saved.lockedRows.join(", ")}: job already started — answers there are locked; confirm finishes that job, then correct details on the job page.`);
      const res = await confirm({ data: { batchId, skipRowIds: [...skip, ...rows.filter((r) => statusOf(r).excluded).map((r) => r.id)] } });
      setDone(res);
      qc.invalidateQueries({ queryKey: ["bulk-review", batchId] });
      if (res.incomplete?.length) toast.warning(`${res.created} job${res.created === 1 ? "" : "s"} added · ${res.incomplete.length} not finished — see below.`);
      else toast.success(`${res.created} job${res.created === 1 ? "" : "s"} added.`);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); confirming.current = false; }
  }

  return (
    <TradeShell installer>
    <div className="mx-auto max-w-3xl space-y-4 text-ink">
      <header>
        <h1 className="font-display text-[26px] font-extrabold leading-tight sm:text-[30px]">Upload multiple jobs</h1>
        <p className="mt-1 text-sm text-sub">Add many customer jobs at once from a spreadsheet (CSV or Excel customer list), plus any job sheets, quotes or photos. Adding just one customer? <a href="/partner/import" className="font-semibold text-hiv-blue underline">Add a single job</a>. <a href="/templates/customer-list-template.csv" download className="font-semibold text-hiv-blue underline">Download template</a></p>
        <details className="mt-1 text-sm text-sub" data-list-guide>
          <summary className="cursor-pointer text-xs font-semibold text-hiv-blue">Help setting out your list</summary>
          <p className="mt-1">One row per customer: name, phone, email and full address (with postcode). Add your quoted price inc GST if you've quoted.</p>
        </details>
      </header>

      <Steps step={step} />

      {step === 1 && (
        <section className="space-y-3 rounded-[18px] border border-line bg-paper p-4 shadow-card">
          {isAdmin && (
            <label className="block text-sm"><span className="font-semibold">Installer business</span>
              <select className="mt-1 h-10 w-full rounded-[10px] border border-line bg-paper px-2" value={businessId} onChange={(e) => setBusinessId(e.target.value)}>
                <option value="">Choose…</option>
                {businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
          )}
          <label className="block cursor-pointer rounded-[14px] border-2 border-dashed border-mist-line bg-mist p-6 text-center">
            <UploadCloud className="mx-auto h-7 w-7 text-hiv-blue" />
            <span className="mt-1 block font-display font-bold">Choose files</span>
            <span className="block text-xs text-sub">Excel, CSV, Word, PDF, email or photos</span>
            <input type="file" multiple className="sr-only" aria-label="Choose files" onChange={(e) => setExtraFiles([...(e.target.files ?? [])])} />
            {extraFiles.length > 0 && <span className="mt-2 block text-xs font-semibold">{extraFiles.length} file{extraFiles.length > 1 ? "s" : ""} chosen</span>}
          </label>
          {failedChunks.length > 0 && (
            <div role="alert" data-failed-rows className="rounded-[18px] border border-line bg-paper p-[19px] shadow-card text-sm">
              <p className="font-bold text-danger">Some rows couldn't be read</p>
              <p className="mt-1 text-sub">{failedChunks.map(rowRangeLabel).join(", ")}. Everything else was read and is kept.</p>
              <div className="mt-3 grid gap-2 sm:flex">
                <PrimaryButton disabled={busy} onClick={retryFailed}>{busy ? (progress || "Reading…") : "Try these rows again"}</PrimaryButton>
                <button type="button" disabled={busy} onClick={continueWithout} className="h-12 rounded-[10px] border border-line bg-paper px-[15px] text-[13px] font-bold text-hiv-blue md:h-[42px]">Continue without them</button>
              </div>
            </div>
          )}
          <PrimaryButton disabled={extraFiles.length === 0 || !effectiveBiz || busy || failedChunks.length > 0} onClick={analyse}>{busy ? (progress || "Reading…") : "Read my files"}</PrimaryButton>
          <FileResultList items={localReads} />
        </section>
      )}

      {step === 2 && summary && (
        <section className="space-y-3">
          <h2 className="font-display text-lg font-bold">{jobsFound(summary.rows ?? 0)}</h2>
          {(summary.rows ?? 0) === 0 && <div className="rounded-[14px] border border-line bg-paper p-4 text-sm">We couldn't find a customer in these files. Add a customer list, or name files by address (e.g. "14 Example St"), then upload again.<div className="mt-2"><SmallButton onClick={reset}>Upload again</SmallButton></div></div>}
          {(summary.rows ?? 0) > 1 && <ElectricianPicker title="Electrician for every customer" value={batchPlan} onChange={(v) => { setBatchPlan(v); setRowPlans({}); }} approved={electricianData?.approved ?? []} pending={electricianData?.pending ?? []} onAdd={async (d) => { const { made, message } = await addNewElectrician(d); setBatchPlan({ mode: "mine", ...(made.businessId ? { business_id: made.businessId } : { nomination_id: made.nominationId }) }); setRowPlans({}); return { message }; }} />}
          {rows.length > 1 && (() => { const open = rows.filter((r) => !skip.has(r.id) && !statusOf(r).excluded && r.import_stage !== "installed"); return (
            <div className="flex flex-wrap items-center gap-2 text-sm" data-site-check-all><span className="text-sub">Site check for all:</span>{(["yes", "no"] as const).map((v) => <SmallButton key={v} onClick={() => { const nc = { ...rowChecks }; const ns = { ...rowStages }; for (const r of open) { nc[r.id] = { check: v, date: v === "yes" ? rowChecks[r.id]?.date ?? null : null }; ns[r.id] = v === "yes" ? (r.extracted.price_inc_gst ? "quoted" : "visited") : "not_visited"; } setRowChecks(nc); setRowStages(ns); }}>{v === "yes" ? "Yes to all" : "No to all"}</SmallButton>)}</div>); })()}
          <div className="grid gap-3">
            {rows.map((r) => (
              <CustomerCard key={r.id} row={r} status={statusOf(r)} skipped={skip.has(r.id)} onSkip={(v) => { const n = new Set(skip); if (v) n.add(r.id); else n.delete(r.id); setSkip(n); }}
                consent={!!consent[r.id]} onConsent={(v) => setConsent({ ...consent, [r.id]: v })}
                quoted={rowQuoted[r.id] ?? { answer: null, price: "", confirmed: false }} onQuoted={(q) => setRowQuoted({ ...rowQuoted, [r.id]: q })}
                check={rowChecks[r.id] ?? { check: null, date: null }} onCheck={(v) => { setRowChecks({ ...rowChecks, [r.id]: v }); setRowStages({ ...rowStages, [r.id]: r.import_stage === "installed" ? "installed" : v.check === "yes" ? (r.extracted.price_inc_gst ? "quoted" : "visited") : "not_visited" }); }}
                onLead={(l) => setLeads((o) => ({ ...o, [r.id]: l }))} onSaving={(v) => setSaving((o) => ({ ...o, [r.id]: v }))}
                businessId={effectiveBiz}
                electrician={<ElectricianPicker compact note={(summary.rows ?? 0) <= 1} value={planFor(r.id)} onChange={(plan) => setRowPlans((o) => ({ ...o, [r.id]: plan }))} approved={electricianData?.approved ?? []} pending={electricianData?.pending ?? []} onAdd={async (d) => { const { made, message } = await addNewElectrician(d); setRowPlans((o) => ({ ...o, [r.id]: { mode: "mine", ...(made.businessId ? { business_id: made.businessId } : { nomination_id: made.nominationId }) } })); return { message }; }} />} />
            ))}
          </div>
          <FileResultList items={summary.file_results ?? localReads} />
          {(summary.rows ?? 0) > 0 && toAdd.length === 0 && rows.every((r) => statusOf(r).excluded || skip.has(r.id)) && <div className="rounded-[14px] border border-line bg-paper p-3 text-sm">Nothing from this upload can be added.<div className="mt-2"><SmallButton onClick={reset}>Upload something else</SmallButton></div></div>}
          {(summary.rows ?? 0) > 0 && toAdd.length > 0 && (
            <div className="sticky bottom-2 z-10 space-y-2 rounded-[18px] border border-line bg-paper p-3 shadow-card" data-confirm-bar>
              {notReady.length > 0 ? <p className="text-sm"><b>Still missing:</b> {notReady.slice(0, 3).map((r) => `${(leads[r.id] ?? r.extracted).full_name || "Unnamed customer"} — ${r.sort_result === "office_review" && statusOf(r).ready ? "held for the office to check" : statusOf(r).text.replace(/^Needs: /, "")}`).join("; ")}{notReady.length > 3 ? ` and ${notReady.length - 3} more` : ""}. Or tap "Don't add" on that card.</p>
                : <p className="text-sm text-sub">Nothing is sent to any customer when you confirm.</p>}
              {toAdd.some((r) => electricianPlanBlocker(planFor(r.id))) && <p className="text-sm text-danger">Choose the electrician on each customer marked "My electrician".</p>}
              <PrimaryButton disabled={busy || anySaving || toAdd.length === 0 || notReady.length > 0 || toAdd.some((r) => !!electricianPlanBlocker(planFor(r.id)))} onClick={confirmAll}>{busy ? "Adding…" : anySaving ? "Saving…" : `Confirm ${toAdd.length} job${toAdd.length === 1 ? "" : "s"}`}</PrimaryButton>
            </div>
          )}
        </section>
      )}

      {done && (
        <section className="space-y-2 rounded-[18px] border border-line bg-paper p-4 shadow-card">
          <h2 className="font-display text-lg font-bold">{done.created} job{done.created === 1 ? "" : "s"} added</h2>
          {(done.skipped > 0 || done.failed > 0) && <p className="text-sm">{done.skipped ? `${done.skipped} not added. ` : ""}{done.failed ? `${done.failed} still need fixing.` : ""}</p>}
          {!!done.incomplete?.length && <div role="alert" className="rounded-[10px] border border-rose/40 p-2 text-sm"><b>Not finished — nothing is lost:</b><ul className="mt-1 list-disc pl-5">{done.incomplete.map((x) => <li key={x.row}>Customer {x.row}{x.jobNumber ? ` (job ${x.jobNumber} started)` : ""}: {x.reason}</li>)}</ul></div>}
          {(done.results ?? []).some((r) => r.notAttached.length) && <div className="rounded-[10px] bg-mist p-2 text-sm"><b>Files not attached</b> (unsupported or not saved — add them on the job by hand):<ul className="mt-1 list-disc pl-5">{(done.results ?? []).filter((r) => r.notAttached.length).map((r) => <li key={r.row}>{r.jobNumber}: {r.notAttached.join(", ")}</li>)}</ul></div>}
          {done.remainingUnknown ? <p className="text-sm font-semibold" data-remaining-unknown>We couldn't check whether every customer is finished. This upload stays open — open it under Past uploads and confirm again. Jobs already added are never added twice.</p> : null}
          {done.remaining ? <p className="text-sm font-semibold">{done.remaining} still to fix — open this upload under Past uploads and confirm again. Jobs already added are never added twice.</p> : null}
          <p className="text-sm text-sub">Nothing has been sent to any customer.</p>
          {!!done.ownerLinks.length && <details className="text-sm"><summary className="cursor-pointer font-semibold">Owner links (queued, not sent)</summary><div className="mt-2 space-y-1">{done.ownerLinks.map((l) => <div key={l.path} className="rounded-[10px] bg-mist p-2"><b>{l.jobNumber} · {l.owner}</b><div className="break-all text-xs text-sub">{l.path}</div></div>)}</div></details>}
          <SmallButton onClick={reset}>Upload more</SmallButton>
        </section>
      )}

      <section className="space-y-2"><h2 className="font-display text-base font-bold">Past uploads</h2>{(past?.batches ?? []).length === 0 ? <p className="text-sm text-sub">No previous uploads yet.</p> : <div className="grid gap-2">{(past?.batches ?? []).slice(0, showAllPast ? undefined : 5).map((b) => { const s = b.summary as { rows?: number } | null; return <button key={b.id} type="button" className="grid min-h-12 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-[14px] border border-line bg-paper px-3 py-2 text-left" onClick={() => { setDone(null); setBatchId(b.id); }}><span className="min-w-0"><b className="block truncate text-sm">{b.list_filename ?? "Upload"}</b><span className="block text-xs text-sub">{new Date(b.created_at).toLocaleDateString("en-AU")} · {jobsFound(s?.rows ?? 0).replace(" found", "")}</span></span><span className="flex items-center gap-1 text-xs font-semibold capitalize text-sub">{b.status}<ChevronDown className="h-4 w-4"/></span></button>; })}{!showAllPast && (past?.batches ?? []).length > 5 && <SmallButton onClick={() => setShowAllPast(true)}>Show all {(past?.batches ?? []).length}</SmallButton>}</div>}</section>
    </div>
    </TradeShell>
  );
}

function Steps({ step }: { step: number }) {
  const items = ["Upload", "Check customers", "Confirm"];
  return <ol className="grid grid-cols-3 gap-1" aria-label="Steps">{items.map((t, i) => { const n = i + 1; return <li key={t} aria-current={n === step ? "step" : undefined} className={cn("flex min-w-0 items-center gap-1.5 rounded-[10px] px-2 py-1.5 text-xs font-semibold", n === step ? "bg-hiv-blue text-primary-foreground" : n < step ? "bg-success-soft text-success" : "bg-mist text-sub")}><span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-current text-[11px]">{n < step ? <Check className="h-3 w-3" /> : n}</span><span className="leading-tight">{t}</span></li>; })}</ol>;
}

function PrimaryButton({ className, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...p} className={cn("h-11 w-full rounded-[12px] bg-action px-4 font-semibold text-action-foreground disabled:opacity-45", className)} />;
}
function SmallButton({ className, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...p} className={cn("h-8 rounded-[9px] border border-line bg-paper px-3 text-xs font-semibold text-ink hover:bg-mist", className)} />;
}

/** Compact Yes/No toggle (phase 1 look). */
function YesNo({ label, value, onChange }: { label: string; value: "yes" | "no" | null; onChange: (v: "yes" | "no") => void }) {
  return <div role="group" aria-label={label} className="inline-flex rounded-[10px] bg-mist p-0.5">{(["yes", "no"] as const).map((v) => <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)} className={cn("h-8 min-w-14 rounded-[8px] px-3 text-xs font-semibold", value === v ? "bg-hiv-blue text-primary-foreground" : "text-sub hover:text-ink")}>{v === "yes" ? "Yes" : "No"}</button>)}</div>;
}

function Field({ label, value, onChange, problem, ...p }: { label: string; value: string; onChange: (v: string) => void; problem?: string | null } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value">) {
  return <label className="block min-w-0 text-xs"><span className="font-semibold text-sub">{label}</span><input {...p} aria-label={label} aria-invalid={!!problem} value={value} onChange={(e) => onChange(e.target.value)} className={cn("mt-0.5 h-10 w-full rounded-[10px] border bg-paper px-2.5 text-sm text-ink", problem ? "border-danger" : "border-line")} />{problem && <span className="mt-0.5 block text-danger">{problem}</span>}</label>;
}

type Quoted = { answer: "yes" | "no" | null; price: string; confirmed: boolean };
type CheckV = { check: "yes" | "no" | null; date: string | null };
function CustomerCard({ row, status, skipped, onSkip, consent, onConsent, quoted, onQuoted, check, onCheck, onLead, onSaving, electrician, businessId }: {
  row: ReviewRow; status: { ready: boolean; text: string; excluded: boolean }; skipped: boolean; onSkip: (v: boolean) => void; consent: boolean; onConsent: (v: boolean) => void;
  quoted: Quoted; onQuoted: (q: Quoted) => void; check: CheckV; onCheck: (v: CheckV) => void; onLead: (l: ReviewRow["extracted"]) => void; onSaving: (v: boolean) => void; electrician: React.ReactNode; businessId: string;
}) {
  const uploadFiles = useUploadFiles(businessId);
  const addFiles = useServerFn(addBulkRowFiles), dropFile = useServerFn(removeBulkRowFile);
  const [cardFiles, setCardFiles] = useState(row.matched_files);
  const qc = useQueryClient();
  const save = useServerFn(setBulkRowAddress);
  const x = row.extracted;
  const [f, setF] = useState({ full_name: x.full_name ?? "", phone: x.phone ?? "", email: x.email ?? "", address_line: x.address_line ?? "", suburb: x.suburb ?? "", postcode: x.postcode ?? "" });
  const [second, setSecond] = useState<SecondContact>(x.second_contact ?? { name: null, phone: null, email: null });
  const [showSecond, setShowSecond] = useState(!!x.second_contact);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const lead = { ...x, ...f, second_contact: second };
  const prob = fieldProblems(lead);
  const dirty = useRef(false);
  useEffect(() => { onLead(lead); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [f.full_name, f.phone, f.email, f.address_line, f.suburb, f.postcode]);
  // Edits save themselves once the details are complete (no separate Save button).
  useEffect(() => {
    if (!dirty.current) return;
    const complete = !prob.name && !prob.phone && !prob.email && !prob.address && /^3\d{3}$/.test(f.postcode.trim());
    if (!complete) { onSaving(false); return; }
    onSaving(true); setSaveState("saving");
    const t = setTimeout(async () => {
      try { await save({ data: { rowId: row.id, ...f, second_contact: second.name || second.phone || second.email ? second : null } }); setSaveState("saved"); setSaveErr(null); await qc.invalidateQueries({ queryKey: ["bulk-review"] }); }
      catch (e) { setSaveState("error"); setSaveErr((e as Error).message); }
      finally { onSaving(false); }
    }, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f, second]);
  const set = (k: keyof typeof f) => (v: string) => { dirty.current = true; setF((o) => ({ ...o, [k]: v })); };
  const setS = (k: keyof SecondContact) => (v: string) => { dirty.current = true; setSecond((o) => ({ ...o, [k]: v || null })); };
  const out = status.excluded;
  const grey = out || skipped;
  const fileNote = attachedFilesNote(row.matched_files);
  const installed = row.import_stage === "installed";
  return (
    <article className={cn("rounded-[18px] border border-line bg-paper p-4 shadow-card", grey && "bg-mist opacity-70")} data-customer-card>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
        <div className="min-w-0"><h3 className="break-words font-display text-base font-bold">{f.full_name || "Unnamed customer"}{second.name ? ` & ${second.name}` : ""}</h3>
          <p className={cn("mt-0.5 text-xs font-semibold", out ? "text-danger" : status.ready ? "text-success" : "text-sub")} data-row-status>{skipped ? "Not adding this one" : status.text}</p></div>
        {!out && <SmallButton onClick={() => onSkip(!skipped)}>{skipped ? "Add back" : "Don't add"}</SmallButton>}
      </div>
      {!grey && <div className="mt-3 space-y-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Name" value={f.full_name} onChange={set("full_name")} problem={prob.name} autoComplete="off" />
          <Field label="Phone" value={f.phone} onChange={set("phone")} problem={prob.phone} inputMode="tel" />
          <Field label="Email" value={f.email} onChange={set("email")} problem={prob.email} type="email" className="sm:col-span-2" />
          <Field label="Street address" value={f.address_line} onChange={set("address_line")} problem={null} />
          <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-2"><Field label="Suburb" value={f.suburb} onChange={set("suburb")} problem={null} /><Field label="Postcode" value={f.postcode} onChange={set("postcode")} problem={null} inputMode="numeric" /></div>
        </div>
        {prob.address && <p className="-mt-1 text-xs text-danger">{prob.address}</p>}
        {showSecond ? <div className="rounded-[12px] bg-mist p-2"><p className="mb-1 text-xs font-semibold text-sub">Second contact</p><div className="grid gap-2 sm:grid-cols-3"><Field label="Name" value={second.name ?? ""} onChange={setS("name")} /><Field label="Phone" value={second.phone ?? ""} onChange={setS("phone")} inputMode="tel" /><Field label="Email" value={second.email ?? ""} onChange={setS("email")} type="email" /></div></div>
          : <button type="button" className="text-xs font-semibold text-hiv-blue" onClick={() => setShowSecond(true)}>+ Add a second contact</button>}
        {saveState !== "idle" && <p className="text-xs text-sub">{saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : <span className="text-danger">Not saved: {saveErr}</span>}</p>}
        <label className="flex items-start gap-2 text-sm"><Checkbox checked={consent} onCheckedChange={(c) => onConsent(!!c)} aria-label="Owner consent" className="mt-0.5" /><span>{CONTACT_PERMISSION_WORDING}</span></label>
        <div className="grid gap-2 border-t border-line pt-3">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2" data-quoted-picker><span className="text-sm font-semibold">Quoted?</span><YesNo label="Quoted?" value={quoted.confirmed ? quoted.answer : null} onChange={(v) => onQuoted({ ...quoted, answer: v, confirmed: true })} /></div>
          {quoted.answer === "yes" && !quoted.confirmed && <p className="text-xs text-sub">We found ${quoted.price} in your file — tap Yes if that's your price.</p>}
          {quoted.answer === "yes" && <Field label="Your price inc GST ($)" value={quoted.price} onChange={(v) => onQuoted({ ...quoted, price: v })} inputMode="decimal" problem={quoted.confirmed && quotedGap("yes", Number(quoted.price.replace(/[$,\s]/g, "")) || null) ? "Enter your exact price inc GST" : null} />}
          {quoted.confirmed && quoted.answer === "no" && <p className="text-xs text-sub">{QUOTE_NEEDED_LABEL}</p>}
          {!quoted.confirmed && quoted.answer !== "yes" && <p className="text-xs text-sub">Not sure yet? Leave it — you can answer on the job page.</p>}
          {installed ? <p className="text-sm font-semibold">Already installed — history only</p> : <>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2" data-site-check><span className="text-sm font-semibold">Site check done?{x.site_check_source === "file" && check.check ? <span className="ml-1 text-xs font-normal text-sub">(from your file)</span> : null}</span><YesNo label="Site check done?" value={check.check} onChange={(v) => onCheck({ check: v, date: v === "yes" ? check.date : null })} /></div>
            {check.check === "yes" && <Field label="Site check date (if known)" type="date" value={check.date ?? ""} onChange={(v) => onCheck({ check: "yes", date: v || null })} />}
          </>}
        </div>
        <AttachFiles businessId={businessId} files={cardFiles} onAdd={async (f) => { const up = await uploadFiles(f); const r = await addFiles({ data: { rowId: row.id, files: up.map((x) => ({ path: x.path, name: x.name, type: x.type ?? "" })) } }); setCardFiles(r.files as typeof cardFiles); if (!check.check && r.files.some((m) => /\.(jpe?g|png|heic|heif|webp)$/i.test(m.name))) onCheck({ check: "yes", date: check.date }); await qc.invalidateQueries({ queryKey: ["bulk-review"] }); }} onRemove={async (path) => { const r = await dropFile({ data: { rowId: row.id, path } }); setCardFiles(r.files as typeof cardFiles); }} />
        {electrician}
        <ul className="space-y-0.5 text-xs text-sub">
          <li>Ceiling size: {x.area_m2 ? `${x.area_m2} m²` : "not given"}</li>
          {fileNote && <li>{fileNote}</li>}
          {/Listed \d+ times in the upload/i.test(x.notes ?? "") && <li className="font-semibold text-danger" data-repeat-note>This customer was listed more than once in your upload. We kept one job only — please check the details.</li>}
          {row.sort_result === "office_review" && <li className="font-semibold text-danger">Held for the office to check{(row.sort_reasons ?? []).filter((r) => !/^(Stage|Site check|Missing|Customer details|Phone|Email|Postcode|Measurements|Small items)/.test(r) && r !== QUOTE_NEEDED_LABEL && r !== OUTSIDE_VIC_MESSAGE).slice(0, 1).map((r) => `: ${r}`)}</li>}
        </ul>
      </div>}
      {out && <div className="mt-2 space-y-0.5 text-sm"><p>{f.address_line}{f.suburb ? `, ${f.suburb}` : ""} {f.postcode}</p><p className="text-xs text-sub">{[f.phone, f.email].filter(Boolean).join(" · ")}</p>{(second.name || second.phone || second.email) && <p className="text-xs text-sub">Second contact: {[second.name, second.phone, second.email].filter(Boolean).join(" · ")}</p>}</div>}
    </article>
  );
}

