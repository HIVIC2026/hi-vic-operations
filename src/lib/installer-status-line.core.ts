// The installer's one status line (decisions 278/279). PURE, no imports: the My work page loads this small module instead
// of all of installer-screens.core (portal speed step 2B), which re-exports it unchanged.

// ---------- Decision 279 (Jo 25 Oct 2026): ONE status line per job, on the job page and My work ----------
/** The order Jo fixed: no answers on the Mitti form → only "do the Ready Check" (no quote wording at all); answers but no
 *  boss price (A1) → "enter your price" (staff: waiting on the business owner, nothing about price); both in → the quote
 *  status. `formHasAnswers`/`priceEntered` null = not known, so older callers fall through to the quote line as before. */
export type StatusLineFacts = {
  channel: string | null;
  formLinked: boolean;
  formCompleted: boolean;
  formHasAnswers: boolean | null | undefined;
  priceEntered: boolean | null | undefined;
  boss: boolean;
  quoteLine: string | null;
};
export type StatusLine = {
  kind: "ready_check" | "price" | "waiting_boss" | "quote" | "none";
  title: string;
  home: string;
  yours: boolean;
};
export const DO_READY_CHECK_TITLE = "Do the Ready Check";
export const ENTER_PRICE_TITLE = "Enter your price";
export const WAITING_BOSS_TITLE = "Nothing for you — waiting on your business owner";
export function installerStatusLine(f: StatusLineFacts): StatusLine {
  if (f.formLinked && !f.formCompleted && f.formHasAnswers === false)
    return {
      kind: "ready_check",
      title: DO_READY_CHECK_TITLE,
      home: "Next: do the Ready Check",
      yours: true,
    };
  if (
    f.channel === "installer_sourced" &&
    f.priceEntered === false &&
    (f.formHasAnswers === true || f.formCompleted)
  ) {
    if (f.boss)
      return {
        kind: "price",
        title: ENTER_PRICE_TITLE,
        home: "Next: enter your price",
        yours: true,
      };
    return {
      kind: "waiting_boss",
      title: WAITING_BOSS_TITLE,
      home: "Next: nothing yet — waiting on your business owner",
      yours: false,
    };
  }
  if (f.quoteLine)
    return {
      kind: "quote",
      title: f.quoteLine.replace(/^You:\s*/, ""),
      home: f.quoteLine,
      yours: f.quoteLine.startsWith("You:"),
    };
  return { kind: "none", title: "", home: "", yours: false };
}

