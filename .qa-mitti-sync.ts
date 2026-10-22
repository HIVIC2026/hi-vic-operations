import { syncMittiAssessment } from "./src/lib/mitti.server";
const J="45383d16-2bc2-4aef-9393-62067a73498f";
const r=await syncMittiAssessment(J, null as never); console.log(JSON.stringify(r));
process.exit(0);
