// Pure owner ↔ trade communication status for the Pipeline card. Internal notes never count.
export type CommsTone = "good" | "warn" | "bad" | "neutral";
export type CommsStatus = { label: string; tone: CommsTone };
type Msg = { sender_id: string | null; created_at: string; internal: boolean | null };
type Assign = { user_id: string; assigned_at: string; active: boolean | null };

const H = 3_600_000;

export function commsStatus(assignments: Assign[], messages: Msg[], now: Date): CommsStatus | null {
  const trades = assignments.filter((a) => a.active !== false);
  if (trades.length === 0) return null;
  const tradeIds = new Set(trades.map((a) => a.user_id));
  const msgs = messages.filter((m) => !m.internal).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const age = (iso: string) => (now.getTime() - new Date(iso).getTime()) / H;
  const tradeMsgs = msgs.filter((m) => m.sender_id && tradeIds.has(m.sender_id));
  if (tradeMsgs.length === 0) {
    const since = age(trades.map((t) => t.assigned_at).sort()[0]!);
    if (since >= 48) return { label: "NO TRADE RESPONSE · 48H ALARM", tone: "bad" };
    if (since >= 24) return { label: "No trade response · 24h", tone: "warn" };
    return { label: "Awaiting trade reply", tone: "neutral" };
  }
  const last = msgs[msgs.length - 1]!;
  const lastAge = age(last.created_at);
  const lastFromTrade = !!last.sender_id && tradeIds.has(last.sender_id);
  if (lastAge >= 24 * 7) return { label: "COMMUNICATION STALE · 7+ DAYS", tone: "bad" };
  if (!lastFromTrade) {
    if (lastAge >= 48) return { label: "OWNER WAITING ON TRADE · 48H", tone: "bad" };
    if (lastAge >= 24) return { label: "Owner waiting on trade · 24h", tone: "warn" };
  } else if (lastAge >= 72) return { label: "Owner not responding · 3 days", tone: "warn" };
  const ownerMsgs = msgs.filter((m) => !(m.sender_id && tradeIds.has(m.sender_id)));
  if (ownerMsgs.length > 0) return { label: "Owner & trade communicating", tone: "good" };
  return { label: "Trade messaged · awaiting owner", tone: "neutral" };
}
