// The electrician an installer names at sign-up becomes their saved usual electrician on approval.
import { usualElectrician, type UsualElectrician } from "./usual-electrician.core";

type Named = { name?: unknown; email?: unknown; mobile?: unknown; is_primary?: unknown; rec_number?: unknown; business_name?: unknown; licence_number?: unknown };
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export function signupMainElectrician(data: unknown): UsualElectrician | null {
  const d = (data ?? {}) as { electrician_choice?: unknown; preferred_electricians?: unknown };
  if (d.electrician_choice !== "have" || !Array.isArray(d.preferred_electricians) || !d.preferred_electricians.length) return null;
  const list = d.preferred_electricians as Named[];
  const main = list.find((e) => e?.is_primary === true) ?? list[0];
  if (!main) return null;
  const phone = str(main.mobile).replace(/\s+/g, "");
  return usualElectrician({
    name: str(main.business_name) || str(main.name),
    licence: str(main.rec_number) || str(main.licence_number),
    email: str(main.email) || null,
    ...(phone ? { phone } : {}),
  });
}

/** Should the stuck sign-up electrician invite go out now? "wait" = comms are off (try again later); "skip" = never from here. */
export function signupInviteDue(n: { status: string; invite_sent_at: string | null; business_id: string | null; email: string | null; installerApproved: boolean; commsEnabled: boolean; electricianAlreadyApproved: boolean }): "send" | "wait" | "skip" {
  if (n.status !== "invite_pending_comms" || n.invite_sent_at || n.business_id || !n.email?.trim() || !n.installerApproved || n.electricianAlreadyApproved) return "skip";
  return n.commsEnabled ? "send" : "wait";
}
