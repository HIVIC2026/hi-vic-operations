// One-off (Jo 27 Oct 2026): close HV-2624 and HV-2614 through the office Cancel path (decision 227). No notices.
import { cancelJobFully } from "../src/lib/office-actions.server";
const REASON = "Owner said by email they're not going ahead (Jo, 27 Oct)";
for (const id of ["e582ddb6-afc3-4ae8-8bbd-c7e33e264010", "4882b8e5-e43e-4473-8093-126cad5d949c"]) {
  const r = await cancelJobFully(id, REASON, null, { tell: { owner: false, installer: false } });
  console.log(id.slice(0, 8), JSON.stringify(r));
}
