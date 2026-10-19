export function automaticFirstResponseStatus(enabled: boolean, activatedAt: string | null) {
  if (!enabled) return { on: false, reason: 'Automatic selection is disabled.' };
  if (!activatedAt) return { on: false, reason: 'Not activated. No automatic first responses will be sent.' };
  return { on: true, reason: 'Activated; all delivery safeguards still apply.' };
}