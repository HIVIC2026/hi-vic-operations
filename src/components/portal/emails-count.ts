// The count on the office Emails heading (decision 414). Same query as the Emails tab, so both stay in step.
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getEmailsTab } from "@/lib/emails-tab.functions";

export const EMAILS_TAB_KEY = ["emails-tab"] as const;

export function useEmailsCount(): number | null {
  const load = useServerFn(getEmailsTab);
  const q = useQuery({ queryKey: EMAILS_TAB_KEY, queryFn: () => load(), staleTime: 60_000 });
  return q.data?.count ?? null;
}
