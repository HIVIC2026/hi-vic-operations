// Jo-approved one-off (22 Oct 2026): retry the 40 Save-my-spot reminder texts that failed on 21 Oct
// with the Twilio "realm au1" error, through the now-working scheduled SMS path.
// Every existing guard still applies: spot still open, not saved, not opted out, not cancelled/
// closed/deleted, not test, valid consent, current price/link, one delivered reminder per person.
// Usage: bun scripts/retry-failed-reminders-22oct.ts --dry      (plan only, no writes, no sends)
//        bun scripts/retry-failed-reminders-22oct.ts            (real sends, in batches of 10)
import { runSaveSpotReminderBlast } from "../src/lib/save-spot-reminder-blast.server";

// The 40 job ids from the 21 Oct job_communications failures (channel=sms, save_spot_reminder, failed).
const JOB_IDS = [
  "0651363d-1c72-4b4a-b9a9-6648f672da6e", "0968466d-ffaf-486f-a756-6f9885c1af0f",
  "0d0daba6-32bc-407f-82f9-aac9fb3bc84c", "14177f5a-1944-4a9f-ac63-62d3c711008e",
  "14b0de74-7618-4677-9f89-c286a0040dab", "19678935-ed04-4842-9483-cd0e6678386b",
  "20e5a699-3cd1-483e-b25b-319a47e363a6", "216805bc-5ab1-4151-84cf-286061d5e2bf",
  "2499ed71-2d32-4d79-ad61-93df2852ce19", "267a675f-89d8-4d92-bcd0-807ee8a7624c",
  "2e91ae9a-2e62-446c-a721-d768f9d477ad", "37d4afa6-e5a1-4f3b-9fa7-963687d337ff",
  "3c8fd69c-4920-4670-bdd8-5b66214670c4", "41782f84-edbc-4fce-b70d-9282b8278cf6",
  "46b80a62-4c09-4683-9302-a06b1c461b51", "4e33d3a5-062a-4f1b-bb15-0b2bd0c72fc6",
  "5b696036-16a0-4158-bfdb-24c46aa18fdb", "5d707e5a-dbb4-4d90-9990-a2b5a9a93257",
  "5f843e85-2991-4812-93f6-624f29f722b1", "7bf1d0b1-c1f7-4216-b8c1-37d456ed5052",
  "82b7b88a-b4fe-4255-aea9-fba2b959e18c", "917c0b4e-8209-4318-a5dd-47fd1ba8c55d",
  "95d88ee2-e8e1-44de-b5d1-659c2bcbadb5", "9dc8cf3c-9856-437d-9b6b-10e76477a6bc",
  "a486b8a3-e705-4879-a07a-ce10b1349a71", "ab7d1ba7-fe85-4534-87a8-f8b440e9ca17",
  "b47d66da-b07d-424c-81a6-3de61faff35d", "b6d576b5-e99b-40e7-8516-d475b775a424",
  "c27cb604-c876-4116-a989-4bdece921f6e", "c8ec37ea-18cb-4167-94e7-34605f9a3f34",
  "c97cba2f-dbcb-4f7f-a33c-e434a9cc2ba9", "c9aaeed0-3b32-42d7-bbe6-8b9b55af9ee4",
  "cc34c13d-edfc-40ef-b043-cf369329e1c3", "da7e9da1-7873-4e7d-9d7c-ac08cb6a387e",
  "eac9fffa-bd46-4a67-9874-5721441a3145", "f55688c4-b407-4470-a90e-137845caa1c6",
  "fadb99ab-d03e-4340-ab64-596b0eafa72b", "fb2e1210-6150-4d30-87d4-d54ea779e03f",
  "fb8f2cd8-ef8e-4e3b-bbc7-35a4dfc26659", "fcfd3e61-0044-49d7-88fa-1ee38990a700",
];

const dry = process.argv.includes("--dry");

if (dry) {
  const r = await runSaveSpotReminderBlast(true, false, JOB_IDS);
  console.log("DRY RUN — nothing written, nothing sent");
  console.log("eligible recipients:", r.recipientCount);
  for (const s of r.samples) console.log("  sample:", s.jobNumber ?? s.jobId, "->", s.phone);
  console.log("skipped:", r.skipped.length);
  for (const s of r.skipped) console.log("  skip:", s.jobNumber ?? s.jobId, "->", s.reason);
  console.log("send blockers:", r.sendBlockers);
  process.exit(0);
}

// Real run: batches of 10 (the blast's own cap). Each batch re-checks every recipient with the
// existing guards; the unique per-job claim and the per-phone claim make a duplicate impossible.
let total = { sent: 0, already: 0, blocked: 0, failed: 0, other: 0 };
for (let batch = 0; batch < 6; batch++) {
  const r = await runSaveSpotReminderBlast(false, false, JOB_IDS);
  console.log(`batch ${batch + 1}: recipients=${r.recipientCount} blockers=${JSON.stringify(r.sendBlockers)}`);
  for (const x of r.results) {
    console.log("  result:", x.jobNumber ?? x.jobId, "->", x.status, x.detail ? `(${x.detail})` : "");
    if (x.status === "sent" || x.status === "delivered") total.sent++;
    else if (x.status === "already") total.already++;
    else if (x.status === "blocked") total.blocked++;
    else if (x.status === "failed" || x.status === "undelivered") total.failed++;
    else total.other++;
  }
  for (const s of r.skipped) console.log("  skip:", s.jobNumber ?? s.jobId, "->", s.reason);
  if (r.recipientCount === 0 || r.results.length === 0) break;
}
console.log("TOTALS:", JSON.stringify(total));
process.exit(0);
