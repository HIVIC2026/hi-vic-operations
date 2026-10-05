import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BatchOwnerLinksButton } from "@/components/portal/owner-eligibility";
import { bulkBatchReview, bulkImportBusinesses, confirmBulkBatch, createBulkBatch } from "@/lib/bulk-import.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { CONTACT_PERMISSION_WORDING, LEAD_STAGE_LABEL, type LeadStage } from "@/lib/bulk-import.core";

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

type ManifestFile = { path: string; name: string; folder: string | null; type: string; gps_lat: number | null; gps_lng: number | null; taken_at: string | null };
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

const LIST_RE = /\.(csv|xlsx|xls)$/i;
const TEXT_RE = /\.(txt|eml|md|html?|json|msg)$/i;

async function parseList(buf: ArrayBuffer, name: string): Promise<Record<string, string>[]> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buf, { type: "array" });
  const firstSheet = wb.SheetNames[0];
  if (!firstSheet) return [];
  const sheet = wb.Sheets[firstSheet];
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false });
  return rows.map((r) => ({ _source_file: name, ...Object.fromEntries(Object.entries(r).map(([k, v]) => [String(k).trim(), String(v ?? "").trim()])) }));
}

type Collected = { manifest: ManifestFile[]; rows: Record<string, string>[]; documents: { name: string; text: string }[] };

async function collect(files: File[]): Promise<Collected> {
  const out: ManifestFile[] = [];
  const rows: Record<string, string>[] = [];
  const documents: { name: string; text: string }[] = [];
  const push = async (path: string, name: string, type: string, buf: ArrayBuffer) => {
    if (LIST_RE.test(name)) { rows.push(...(await parseList(buf, path))); return; }
    if (TEXT_RE.test(name) || type.startsWith("text/")) { documents.push({ name: path, text: new TextDecoder().decode(buf).slice(0, 200_000) }); return; }
    const f: ManifestFile = { path, name, folder: path.includes("/") ? path.split("/").slice(0, -1).join("/") : null, type, gps_lat: null, gps_lng: null, taken_at: null };
    if (/^image\//.test(type) || /\.jpe?g$/i.test(name)) {
      try {
        const exifr = (await import("exifr")).default;
        const gps = await exifr.gps(buf).catch(() => null);
        const exif = await exifr.parse(buf, { pick: ["DateTimeOriginal", "CreateDate"] }).catch(() => null);
        if (gps && Number.isFinite(gps.latitude)) { f.gps_lat = gps.latitude; f.gps_lng = gps.longitude; }
        const taken = exif?.DateTimeOriginal ?? exif?.CreateDate;
        if (taken) f.taken_at = new Date(taken).toISOString();
      } catch { /* no readable EXIF */ }
    }
    out.push(f);
  };
  for (const file of files) {
    if (/\.zip$/i.test(file.name)) {
      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(await file.arrayBuffer());
      for (const [path, entry] of Object.entries(zip.files)) {
        if (entry.dir || path.split("/").some((p) => p.startsWith("__MACOSX") || p.startsWith("."))) continue;
        await push(path, path.split("/").pop()!, guessType(path), await entry.async("arraybuffer"));
      }
    } else {
      const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
      await push(rel || file.name, file.name, file.type || guessType(file.name), await file.arrayBuffer());
    }
  }
  return { manifest: out, rows, documents };
}

function guessType(name: string): string {
  if (/\.jpe?g$/i.test(name)) return "image/jpeg";
  if (/\.png$/i.test(name)) return "image/png";
  if (/\.pdf$/i.test(name)) return "application/pdf";
  return "application/octet-stream";
}

function BulkImportPage() {
  const qc = useQueryClient();
  const getBusinesses = useServerFn(bulkImportBusinesses);
  const createBatch = useServerFn(createBulkBatch);
  const getReview = useServerFn(bulkBatchReview);
  const confirm = useServerFn(confirmBulkBatch);

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
  const summary = review?.batch?.summary as { rows?: number; covers_ready_check?: number; needs_visit?: number; office_review?: number; duplicates?: number; not_visited?: number; visited?: number; visited_quoted?: number } | null;

  async function analyse() {
    if (extraFiles.length === 0 || !effectiveBiz || !permission) return;
    setBusy(true);
    try {
      const { manifest, rows: rawRows, documents } = await collect(extraFiles);
      if (rawRows.length === 0 && documents.length === 0) { toast.error("We couldn't find customer details — add an export, email or notes with names and addresses."); return; }
      const res = await createBatch({ data: { businessId: effectiveBiz, onBehalf: isAdmin, listFilename: `${extraFiles.length} files`, rawRows, documents, manifest, permissionConfirmed: true } });
      setBatchId(res.batchId);
      toast.success(`${res.summary.rows} jobs found — please review below.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(false); }
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
            <Button disabled={extraFiles.length === 0 || !effectiveBiz || !permission || busy} onClick={analyse}>{busy ? "Reading…" : "Read and match"}</Button>
          </CardContent>
        </Card>
      )}

      {batchId && summary && !done && (
        <Card>
          <CardHeader>
            <CardTitle>2. Review — {summary.rows} jobs found</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
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
                      <td className="p-2">{r.extracted.address_line ?? "—"}<div className="text-xs text-muted-foreground">{[r.extracted.suburb, r.extracted.postcode].filter(Boolean).join(" ")}</div></td>
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
            <Button disabled={busy} onClick={confirmAll}>{busy ? "Creating…" : "Confirm — create these jobs"}</Button>
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
            <Button variant="outline" onClick={() => { setBatchId(null); setDone(null); setExtraFiles([]); setPermission(false); setSkip(new Set()); }}>Upload another batch</Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
