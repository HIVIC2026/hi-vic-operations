// Browser-only: turns a picked certificate into an upload the server accepts.
// Fills a blank file type from the extension, and converts iPhone HEIC photos (and other
// phone image formats the browser can display) to JPEG. The server still checks the real bytes.
import { certificateMime } from "./onboarding-security.core";

const OK = ["application/pdf", "image/jpeg", "image/png"];

async function toJpeg(f: File): Promise<File> {
  const url = URL.createObjectURL(f);
  try {
    const img = new Image();
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error("x")); img.src = url; });
    const scale = Math.min(1, 3000 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.9));
    if (!blob) throw new Error("x");
    const base = (f.name.replace(/\.[^.]*$/, "") || "certificate").replace(/[^\w\- ]+/g, " ").trim() || "certificate";
    return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
  } finally { URL.revokeObjectURL(url); }
}

export async function prepareCertificate(f: File): Promise<{ file: File; mime: "application/pdf" | "image/jpeg" | "image/png" }> {
  let mime = certificateMime(f.type, f.name);
  let file = f;
  if (!OK.includes(mime)) {
    if (mime.startsWith("image/") || /\.(heic|heif|webp)$/i.test(f.name)) {
      try { file = await toJpeg(f); mime = "image/jpeg"; }
      catch { throw new Error("We couldn't open that photo. Please take a screenshot of the certificate, or upload it as a PDF, JPG or PNG."); }
    } else throw new Error("Upload a PDF, JPG or PNG.");
  }
  if (file.size > 10 * 1024 * 1024) throw new Error("File must be 10 MB or smaller.");
  return { file, mime: mime as "application/pdf" };
}
