// Brief N — browser-run preparation. Resets the synthetic fixtures and performs ONLY the homeowner
// availability step (Test A) at service level, so the browser run can start at the Office handoff.
// Writes nothing outside the disposable local stack.
import { ID, preflight, seedFixtures, serviceAdmin, windowsFor } from "./harness";

await preflight();
const admin = await serviceAdmin();
await seedFixtures(admin);

const { allowedPiesaDays } = await import("@/lib/piesa-windows.core");
const days = allowedPiesaDays(new Date());
const slots = ["10-12", "12-14", "8-10"] as const;
const picks = days.slice(0, 3).map((date, i) => ({ date, slot: slots[i]! }));

const { submitReadyCheckWindows } = await import("@/lib/readycheck-booking.server");
const res = await submitReadyCheckWindows(ID.jobFlow, picks as never);
const windows = await windowsFor(admin, ID.jobFlow);
const { data: job } = await admin.from("jobs").select("id, job_number, stage, suburb, postcode").eq("id", ID.jobFlow).single();

console.log(JSON.stringify({
  submit: res,
  windows: windows.map((w) => ({ id: w.id, starts_at: w.starts_at, status: w.status })),
  job,
}, null, 2));
