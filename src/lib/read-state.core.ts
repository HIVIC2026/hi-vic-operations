// What a screen may say about a read. A failed read says it couldn't load; it is never shown as 0, "…" or "Nothing".
export const COULDNT_LOAD = "Couldn't load";
export const COULDNT_READ = "Couldn't read";

/** Big-number text: the value when we have it, "Couldn't load" when the read failed, "…" only while it is still loading. */
export function tileText(read: { hasData: boolean; failed: boolean }, value: () => string): string {
  if (read.hasData) return value();
  return read.failed ? COULDNT_LOAD : "…";
}

/** Count shown next to a pile: the number, "couldn't load" when the read failed, "…" while loading. */
export function pileCount(read: { count: number | undefined; failed: boolean }): string {
  if (read.count != null) return String(read.count);
  return read.failed ? "couldn't load" : "…";
}

/** A switch whose state couldn't be read is not Off. */
export function switchLabel(on: boolean | null | undefined): "On" | "Off" | typeof COULDNT_READ {
  return on == null ? COULDNT_READ : on ? "On" : "Off";
}
