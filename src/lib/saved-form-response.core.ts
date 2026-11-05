// Only for already-durable jobs/bookings covered by the existing missing-form sweep.
export function scheduleSavedForm(task: () => Promise<unknown>, schedule: (task: () => Promise<unknown>) => string): "scheduled" {
  schedule(task);
  return "scheduled";
}