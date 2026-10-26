// Office Inbox rows (Jo 26 Oct 2026): an unmatched email's Needs me row plus what the Outlook sync stored about it.
// PURE: types only.
import type { NeedsRow } from "./office-needs.core";

export type InboxMail = { from: string | null; fromName: string | null; subject: string | null; snippet: string | null; hasAttachments: boolean; ownerName: string | null; address: string | null };
export type InboxRow = NeedsRow & { mail: InboxMail };
