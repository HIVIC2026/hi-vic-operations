export function acceptedTestEmail(row: { delivery_status: string; provider_message_id: string | null; source_reference?: string | null }) {
  if (row.delivery_status !== "sent") return null;
  return row.provider_message_id ?? /Resend accepted \(id ([^)]+)\)/.exec(row.source_reference ?? "")?.[1] ?? null;
}