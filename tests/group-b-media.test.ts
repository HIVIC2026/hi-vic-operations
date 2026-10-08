import { expect, test } from "bun:test";
import { originalEnquiryMedia, groupBInvitationBlocker } from "../src/lib/group-b-media.core";
import { buildBase44Raw, retainOriginalMedia } from "../src/lib/enquiry.core";

test("media-choice intent alone is not an attachment when the manifest confirms zero", () => {
  for (const media_choice of ["yes", "no", "unsure"]) expect(originalEnquiryMedia({answers:{media_choice},media:[]},[])).toEqual({excluded:false,received:false,uncertain:false,pendingSync:false,count:0});
});
for (const [name,mime] of [["roof.jpg","image/jpeg"],["roof.mov","video/quicktime"]]) test(`${mime}: pending reference and imported document both exclude`, () => {
  const raw = {media:[{source_id:"1",name,mime_type:mime}]};
  expect(originalEnquiryMedia(raw,[])).toMatchObject({excluded:true,received:true,pendingSync:true,count:1});
  const doc = {kind:"intake_media",mime_type:mime,storage_path:`J/intake/base44/${name}`,external_id:"1",source_system:"base44"};
  expect(originalEnquiryMedia(raw,[doc,doc])).toMatchObject({excluded:true,pendingSync:false,count:1});
});
test("unrelated compliance photos and PDFs do not exclude", () => {
  expect(originalEnquiryMedia({media:[{source_id:"pdf",name:"agreement.pdf",mime_type:"application/pdf"}]},[{kind:"customer_agreement",mime_type:"image/jpeg",storage_path:"J/compliance/signature.jpg"}]).excluded).toBe(false);
});
test("missing legacy manifest, opaque refs and read failures hold without claiming evidence received", () => {
  for (const raw of [{answers:{media_choice:"no"}},{media:[{id:"opaque"}]},null]) expect(originalEnquiryMedia(raw,[])).toMatchObject({excluded:true,received:false,uncertain:true});
  expect(originalEnquiryMedia({media:[]},[],true).excluded).toBe(true);
});
test("raw photo URLs exclude, and every repeated route/reminder has the same blocker", () => {
  const state = originalEnquiryMedia({answers:{photos:["https://example.test/photo.jpg"]}},[]);
  expect(state).toMatchObject({received:true,excluded:true,pendingSync:true});
  for(let i=0;i<3;i++) expect(groupBInvitationBlocker(state)).toBe("Existing enquiry photos/video received — office review, no repeat invitation");
});
test("snapshot retains actual attachment identity before copy, without signed URLs", () => {
  const raw = buildBase44Raw({media:[{source_id:"pending",name:"roof.mov",mime_type:"video/quicktime",signed_url:"https://example.test/temporary"}]});
  expect(raw.media).toEqual([{source_id:"pending",name:"roof.mov",mime_type:"video/quicktime"}]);
  expect(originalEnquiryMedia(raw,[]).pendingSync).toBe(true);
});
test("repeat empty sync retains pending attachments; legacy uncertainty survives later empty manifest", () => {
  const previous = {media:[{source_id:"first",name:"roof.jpg",mime_type:"image/jpeg"}]};
  const retained = retainOriginalMedia(previous,buildBase44Raw({media:[]}));
  expect(retained.media).toEqual(previous.media);
  expect(originalEnquiryMedia(retained,[]).excluded).toBe(true);
  const legacy = retainOriginalMedia({answers:{media_choice:"no"}},buildBase44Raw({media:[]}));
  expect(originalEnquiryMedia(legacy,[])).toMatchObject({excluded:true,uncertain:true});
  expect(originalEnquiryMedia(retainOriginalMedia(legacy,buildBase44Raw({media:[]})),[]).excluded).toBe(true);
});