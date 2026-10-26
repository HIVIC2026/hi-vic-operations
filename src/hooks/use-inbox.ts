// Office Inbox rows (Jo 26 Oct 2026). The Inbox page and the top bar's count read the same query.
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getUnmatchedEmailRows } from "@/lib/email-office.functions";
import type { InboxRow } from "@/lib/inbox.core";

export const INBOX_QUERY_KEY = ["inbox-emails"] as const;

export function useInboxEmails() {
  const load = useServerFn(getUnmatchedEmailRows);
  return useQuery({ queryKey: INBOX_QUERY_KEY, queryFn: () => load() as Promise<InboxRow[]>, staleTime: 60_000 });
}
