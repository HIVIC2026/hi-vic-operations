// Pure Outlook connection and continuation rules. Credentials belong only on the connector gateway.
export const OUTLOOK_GATEWAY = "https://connector-gateway.lovable.dev/microsoft_outlook";

export type OutlookIdentity = { id: string; email: string; displayName: string | null };
export type OutlookHealth = {
  status: "not_configured" | "configured_not_checked" | "account_connected" | "connected" | "failed";
  configured: boolean;
  expectedMailbox: string | null;
  authenticatedAccount: OutlookIdentity | null;
  targetMailbox: string | null;
  mailboxReadable: boolean;
  checkedAt: string | null;
  readyForSync: boolean;
  problem: string | null;
};

export function normaliseMailbox(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
}

export function outlookMailboxPath(mailbox: string): string {
  const target = normaliseMailbox(mailbox);
  if (!target) throw new Error("A valid shared mailbox address is required.");
  return `/users/${encodeURIComponent(target)}`;
}

/** Accept provider continuations only at the known gateway or Microsoft Graph v1.0. */
export function outlookGatewayUrl(input: string): string {
  if (!input || input !== input.trim() || /[\\\r\n\t]/.test(input) || input.startsWith("//"))
    throw new Error("Outlook returned an invalid continuation link.");
  let u: URL;
  try { u = new URL(input.startsWith("/") ? `${OUTLOOK_GATEWAY}${input}` : input); }
  catch { throw new Error("Outlook returned an invalid continuation link."); }
  if (u.protocol !== "https:" || u.username || u.password || u.hash || (u.port && u.port !== "443"))
    throw new Error("Outlook returned an unsafe continuation link.");
  let path: string;
  if (u.origin === "https://graph.microsoft.com" && u.pathname.startsWith("/v1.0/")) {
    path = u.pathname.slice("/v1.0".length);
  } else if (u.origin === "https://connector-gateway.lovable.dev" && u.pathname.startsWith("/microsoft_outlook/")) {
    path = u.pathname.slice("/microsoft_outlook".length);
  } else throw new Error("Outlook returned a continuation outside the approved connector.");
  if (!/^\/(me|users)(\/|\(|$)/.test(path)) throw new Error("Outlook returned an unsupported continuation path.");
  return `${OUTLOOK_GATEWAY}${path}${u.search}`;
}

export function uncheckedOutlookHealth(configured: boolean, expectedMailbox: string | null): OutlookHealth {
  return {
    status: configured ? "configured_not_checked" : "not_configured", configured,
    expectedMailbox, authenticatedAccount: null, targetMailbox: expectedMailbox,
    mailboxReadable: false, checkedAt: null, readyForSync: false,
    problem: configured ? null : "Outlook credentials are not configured for this project.",
  };
}

export function checkedOutlookHealth(configured: boolean, expectedMailbox: string | null, raw: {
  id?: string; mail?: string | null; userPrincipalName?: string | null; displayName?: string | null;
}, checkedAt: string, readableMailbox: string | null = null): OutlookHealth {
  const email = normaliseMailbox(raw.mail) ?? normaliseMailbox(raw.userPrincipalName);
  if (typeof raw.id !== "string" || !raw.id || !email) throw new Error("Outlook did not return a usable authenticated account identity.");
  const target = normaliseMailbox(readableMailbox);
  const matches = !!target && target === normaliseMailbox(expectedMailbox);
  return {
    status: target ? "connected" : "account_connected", configured, expectedMailbox,
    authenticatedAccount: { id: raw.id, email, displayName: raw.displayName ?? null },
    targetMailbox: target ?? expectedMailbox, mailboxReadable: !!target, checkedAt,
    readyForSync: configured && matches,
    problem: !target ? "Enter and check the intended shared business mailbox address before importing correspondence."
      : !matches ? "Shared mailbox access was verified. Confirm this address to enable scheduled correspondence imports." : null,
  };
}
