export const SPOT_HELD_MESSAGE = "Spot saved — we'll be in touch when your spot is released";
export const READY_CHECK_BOOKING_CLOSED = "Your spot hasn't been released yet, so booking is not open. We'll be in touch when your spot is released.";
export function ownerBookingAllowed(enabled: unknown, offeredAt: unknown, offeredBy: unknown, stage: string | null, deletedAt: unknown) {
  return enabled === true && typeof offeredAt === 'string' && !!offeredAt && typeof offeredBy === 'string' && !!offeredBy
    && !deletedAt && !!stage && !['cancelled', 'complete'].includes(stage);
}