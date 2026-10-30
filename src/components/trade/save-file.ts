/** Save a file from a tap. iPhone ignores <a download> for data links, so phones get the Share sheet.
 * Call it straight from the tap handler (no await before it) so the browser keeps the user gesture. */
export async function saveFile(file: File, opts?: { title?: string }): Promise<void> {
  const phone = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
  if (phone && typeof navigator !== "undefined" && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], ...(opts?.title ? { title: opts.title } : {}) });
      return;
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") return; // closing the sheet is fine
      // any other share problem: fall through to the normal download
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.hidden = true;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
