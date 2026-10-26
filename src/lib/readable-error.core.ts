// Pure: what a page may show a person when a server call fails. Server functions reject bad input with the raw
// validation issues as the message (a JSON array), and the browser reports a dropped connection as "Failed to fetch";
// neither is wording for a person, so the page's own plain sentence is shown instead. Plain messages the server wrote
// for people ("This link has expired…") are kept as they are.

const NETWORK = /^(failed to fetch|load failed|networkerror when attempting to fetch resource\.?|network ?error)$/i;

export function readableError(err: unknown, fallback: string): string {
  const msg = err instanceof Error ? err.message.trim() : "";
  if (!msg) return fallback;
  if (msg.startsWith("[") || msg.startsWith("{")) return fallback;
  if (NETWORK.test(msg)) return fallback;
  return msg;
}
