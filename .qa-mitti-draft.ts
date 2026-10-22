import { draftInstallerQuoteFromReadyCheck } from "./src/lib/installer-quote.server";
const J="45383d16-2bc2-4aef-9393-62067a73498f";
const d:any=await draftInstallerQuoteFromReadyCheck(J,null,[{label:"Total quoted price (inc GST)",value:"3600"},{label:"What’s included in your quote?",value:"R5.0 ceiling insulation supply and install"}],"audit_233340c28858470b9873cda295309428");
console.log("ready",d?.ready,"blockers",JSON.stringify(d?.blockers));
process.exit(0);
