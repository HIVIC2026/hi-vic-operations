// Pure sign-in helpers shared by the sign-in card, set-password page and tests (Jo, 7 Oct 22:55).

export type EmailCheck = { ok: true; email: string } | { ok: false; message: string };

/** Trim spaces, drop trailing full stops/commas, lowercase. Plus-addresses are kept. Says exactly what's wrong otherwise. */
export function normaliseLoginEmail(raw: string): EmailCheck {
  const email = raw.trim().replace(/[.,;\s]+$/, "").replace(/^[<"'\s]+|[>"'\s]+$/g, "").toLowerCase();
  if (!email) return { ok: false, message: "Type your email address." };
  if (/\s/.test(email)) return { ok: false, message: "Your email can't have spaces in it." };
  const at = email.split("@").length - 1;
  if (at === 0) return { ok: false, message: "Your email is missing the @ sign." };
  if (at > 1) return { ok: false, message: "Your email has more than one @ sign." };
  const [local, domain] = email.split("@") as [string, string];
  if (!local) return { ok: false, message: "Your email is missing the part before the @." };
  if (!domain) return { ok: false, message: "Your email is missing the part after the @ (for example hotmail.com)." };
  if (!domain.includes(".") || /\.\./.test(domain) || domain.startsWith(".") || !/\.[a-z]{2,}$/.test(domain)) return { ok: false, message: `"${domain}" doesn't look like a full email domain (for example hotmail.com).` };
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local) || local.startsWith(".") || local.endsWith(".") || local.includes("..")) return { ok: false, message: "The part before the @ has a character emails can't use." };
  return { ok: true, email };
}

type AuthErr = { message?: string | undefined; code?: string | undefined; status?: number | undefined } | null | undefined;

/** Plain-English message for a password sign-in failure. Never reveals whether an account exists. */
export function signInErrorMessage(e: AuthErr): string {
  const m = `${e?.code ?? ""} ${e?.message ?? ""}`.toLowerCase();
  if (e?.status === 429 || /rate|too many|over_request/.test(m)) return "Too many tries. Please wait a few minutes, then try again.";
  if (/not.?confirmed/.test(m)) return "Your email isn't confirmed yet. Use \"Email me a sign-in link\" instead.";
  return "That email and password don't match. Check them and try again, or use \"Email me a sign-in link\".";
}

/** Same wording whether or not the email has an account (safe wording). */
export const LINK_SENT_SAFE = "If that email has a Home Insulation Victoria account, we've sent it a link. Check your inbox (and junk folder).";
export function linkErrorMessage(e: AuthErr): string | null {
  const m = `${e?.code ?? ""} ${e?.message ?? ""}`.toLowerCase();
  if (e?.status === 429 || /rate|too many|over_email_send|seconds/.test(m)) return "We've just sent a link. Please wait a minute before asking for another.";
  return null; // anything else (incl. unknown email) → show the safe "if that email has an account" wording
}

/** Why a set-password / sign-in link didn't open. */
export function badLinkMessage(e: AuthErr): string {
  const m = `${e?.code ?? ""} ${e?.message ?? ""}`.toLowerCase();
  if (/expired/.test(m)) return "This link has expired.";
  if (/used|invalid|not found/.test(m)) return "This link has already been used.";
  return "This link has expired or was already used.";
}

/** Only same-site portal paths may be returned to after sign-in. Never the calculator, sign-in pages or other sites. */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next) return null;
  let p = next;
  try { if (/^https?:/i.test(p)) { const u = new URL(p); p = u.pathname + u.search; } } catch { return null; }
  if (!p.startsWith("/") || p.startsWith("//") || p.includes("\\")) return null;
  const path = p.split("?")[0]!;
  if (path === "/" || path === "/calculator" || path.startsWith("/auth") || path.startsWith("/portal") || path.startsWith("/reset-password")) return null;
  return /^\/(field|admin|owner|partner)(\/|$)/.test(path) ? p : null;
}
