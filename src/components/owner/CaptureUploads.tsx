import { useRef, useState } from "react";
import { FileImage, Film, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { validateCaptureFile } from "@/lib/owner-capture.core";

type Selected = { id: number; file: File; status: "selected" | "saved" | "failed"; error?: string | undefined };

/** Serializes signed uploads; successful files stay saved when a later file fails. */
export function CaptureUploads({ kind, remaining, received, uploadFile, onSaved, onBusyChange }: {
  kind: "photos" | "video";
  remaining: number;
  received: number;
  uploadFile: (file: File) => Promise<void>;
  onSaved: () => Promise<unknown>;
  onBusyChange: (busy: boolean) => void;
}) {
  const [files, setFiles] = useState<Selected[]>([]);
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedHere, setSavedHere] = useState(0);
  const initialReceived = useRef(received);
  const lock = useRef(false);
  const nextId = useRef(0);
  const pick = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const pending = files.filter((entry) => entry.status !== "saved");
  const slots = Math.max(0, remaining - Math.max(0, initialReceived.current + savedHere - received));

  const choose = (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (lock.current) return;
    const accepted: Selected[] = [];
    const errors: string[] = [];
    for (const file of picked) {
      const validation = validateCaptureFile({ mime: file.type, fileName: file.name, size: file.size });
      if (!validation.ok) { errors.push(`${file.name}: ${validation.error}`); continue; }
      if (pending.length + accepted.length >= slots) { errors.push("There aren't enough remaining file spaces for that selection."); break; }
      accepted.push({ id: nextId.current++, file, status: "selected" });
    }
    setFiles((previous) => [...previous, ...accepted]);
    setError(errors.length ? errors.join(" ") : null);
  };

  const submit = async () => {
    if (lock.current || !pending.length) return;
    lock.current = true; setBusy(true); onBusyChange(true); setError(null);
    try {
      for (const entry of pending) {
        setCurrent(entry.file.name);
        try {
          await uploadFile(entry.file);
          setFiles((previous) => previous.map((file) => file.id === entry.id ? { ...file, status: "saved", error: undefined } : file));
          setSavedHere((count) => count + 1);
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : "Upload failed. Please try again.";
          setFiles((previous) => previous.map((file) => file.id === entry.id ? { ...file, status: "failed", error: message } : file));
          // Stop on an uncertain confirmation. Retrying reuses its existing signed path.
          break;
        }
      }
      await onSaved();
    } finally { lock.current = false; setBusy(false); setCurrent(null); onBusyChange(false); }
  };

  return <div className="space-y-3">
    <input ref={camera} type="file" accept="video/*" capture="environment" className="hidden" onChange={choose} data-testid="camera-input" />
    <input ref={pick} type="file" multiple accept="image/*,video/*,.heic,.heif,.mov,.mp4,.m4v" className="hidden" onChange={choose} data-testid="upload-input" />
    <p className="text-sm">{kind === "video" ? "Record from the manhole opening. Show the existing insulation clearly." : "Upload clear photos showing your existing insulation."} Please do not climb into the roof space.</p>
    {Math.max(received, initialReceived.current + savedHere) > 0 && <p role="status" className="text-sm font-semibold">{Math.max(received, initialReceived.current + savedHere)} files received — awaiting office review.</p>}
    {slots > pending.length && <>
      {kind === "video" && <Button disabled={busy} onClick={() => camera.current?.click()} className="h-12 w-full">Record a video</Button>}
      <Button variant="outline" disabled={busy} onClick={() => pick.current?.click()} className="h-12 w-full">Choose photos and videos</Button>
    </>}
    {files.length > 0 && <ul className="space-y-2" aria-label="Selected files">
      {files.map((entry) => <li key={entry.id} className="flex min-w-0 items-start gap-2 border-b py-2">
        {entry.file.type.startsWith("video/") ? <Film className="mt-2 size-5 shrink-0 text-muted-foreground" /> : <FileImage className="mt-2 size-5 shrink-0 text-muted-foreground" />}
        <div className="min-w-0 flex-1"><p className="break-all text-sm font-medium">{entry.file.name}</p><p className="text-xs text-muted-foreground">{(entry.file.size / (1024 * 1024)).toFixed(1)} MB · {entry.status === "saved" ? "Received" : entry.status === "failed" ? "Not confirmed" : "Ready to upload"}</p>{entry.error && <p role="alert" className="mt-1 break-words text-sm text-destructive">{entry.error}</p>}</div>
        {entry.status === "selected" && <Button variant="ghost" size="icon" className="size-12 shrink-0" disabled={busy} aria-label={`Remove ${entry.file.name}`} title={`Remove ${entry.file.name}`} onClick={() => setFiles((previous) => previous.filter((file) => file.id !== entry.id))}><X className="size-4" /></Button>}
      </li>)}
    </ul>}
    {pending.length > 0 && <Button className="h-12 w-full" disabled={busy} onClick={() => void submit()}>{busy ? "Uploading…" : pending.some((entry) => entry.status === "failed") ? "Retry remaining files" : `Upload ${pending.length} ${pending.length === 1 ? "file" : "files"}`}</Button>}
    {current && <p role="status" className="break-all text-sm">Uploading {current}… please keep this page open.</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {slots === 0 && !pending.length && <p className="text-sm">We've received the maximum number of files for this property. Thank you!</p>}
    <p className="text-xs text-muted-foreground">Your files are awaiting office review. Your spot is not saved yet.</p>
  </div>;
}