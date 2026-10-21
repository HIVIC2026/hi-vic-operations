export const SPOT_HELD_MESSAGE = "Spot held — we'll be in touch to book your Ready Check";
export const READY_CHECK_BOOKING_CLOSED = "Ready Check booking is not open. We'll be in touch when the office offers your booking.";
export function ownerBookingAllowed(enabled: unknown, offeredAt: unknown, offeredBy: unknown, stage: string | null, deletedAt: unknown) {
  return enabled === true && typeof offeredAt === 'string' && !!offeredAt && typeof offeredBy === 'string' && !!offeredBy
    && !deletedAt && !!stage && !['cancelled', 'complete'].includes(stage);
}