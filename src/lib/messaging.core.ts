// Pure rules for the in-portal job message thread (owner <-> trade, office can view).
// All contact happens through the portal: phone numbers and email addresses typed by
// owners or trades are masked before storage so conversations stay on-platform.

export type ThreadRole = "owner" | "electrician" | "installer" | "admin";

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// Australian-style phone numbers: 8+ digits allowing spaces, dashes, dots, brackets, +61.
const PHONE_RE = /(?:\+?61[\s.-]?|\(?0)\d(?:[\s.\-()]*\d){7,9}/g;

export const MASK = "[contact details removed – please keep messages in the portal]";

export function maskContactDetails(body: string): { body: string; masked: boolean } {
  const out = body.replace(EMAIL_RE, MASK).replace(PHONE_RE, MASK);
  return { body: out, masked: out !== body };
}

export const QUICK_ACTIONS: Record<Exclude<ThreadRole, "admin">, string[]> = {
  owner: [
    "Hi, I'm happy to book a time — please propose a few options in the portal.",
    "Weekday mornings suit me best.",
    "Afternoons suit me best.",
    "I need to reschedule — can we find another time?",
  ],
  electrician: [
    "Hi, I'm the licensed electrician for your Pre Insulation Electrical Safety Assessment (PIESA). I've proposed some times in the portal — please pick one that suits.",
    "I'm on my way.",
    "Running about 15 minutes late — sorry.",
    "I'm outside now.",
  ],
  // Jo 24 Oct 2026 (mock-up M2): three short chips.
  installer: [
    "I've sent you 3 days",
    "I'm on my way",
    "Running 15 min late",
  ],
};
