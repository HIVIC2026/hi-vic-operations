// Owner review (decision 335): which screen a star tap opens. PURE, no imports — the My job route's `validateSearch` runs
// on every page's first download (portal speed step 2B). owner-review.core re-exports these unchanged.

/** "?stars=N" → 1..5, anything else → null. */
export function parseStars(raw: unknown): 1 | 2 | 3 | 4 | 5 | null {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && /^\s*[1-5]\s*$/.test(raw) ? Number(raw) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 5 ? (n as 1 | 2 | 3 | 4 | 5) : null;
}

/** 4–5 → Google (when a link is set); 1–3 → the private feedback box. Never Google for 1–3. */
export function reviewOutcome(stars: number): "google" | "private" {
  return stars >= 4 ? "google" : "private";
}

/** What the screen shows for a given star tap: the Google link only for 4–5 and only when one is set. */
export function reviewScreen(stars: number | null, googleUrl: string | null): { kind: "ask" } | { kind: "thanks"; googleUrl: string | null } | { kind: "feedback" } {
  if (stars == null) return { kind: "ask" };
  return reviewOutcome(stars) === "google" ? { kind: "thanks", googleUrl } : { kind: "feedback" };
}
