import { expect, test } from "bun:test";
import { originalEnquiryMedia, groupBInvitationBlocker } from "../src/lib/group-b-media.core";
import { buildBase44Raw, retainOriginalMedia } from "../src/lib/enquiry.core";

test("explicit empty current media array clears the invitation blocker without extra verification", () => {
  const state = originalEnquiryMedia({media:[]},[]);
  expect(state).toEqual({excluded:false,received:false,uncertain:false,pendingSync:false,count:0});
  expect(groupBInvitationBlocker(state)).toBeNull();
});
test("entirely absent media keys remain uncertain even with complete verification", () => {
  for (const raw of [{},{original_media_verification:{complete:true}}]) {
    const state = originalEnquiryMedia(raw,[]);
    expect(state).toMatchObject({excluded:true,received:false,uncertain:true,pendingSync:false});
    expect(groupBInvitationBlocker(state)).not.toBeNull();
  }
});
test("null media alone is not a known manifest", () => {
  expect(originalEnquiryMedia({media:null},[])).toMatchObject({excluded:true,received:false,uncertain:true});
});
test("persisted intake image takes precedence over explicit empty raw media", () => {
  const state = originalEnquiryMedia({media:[]},[{kind:"intake_media",mime_type:"image/jpeg",storage_path:"J/intake/roof.jpg"}]);
  expect(state).toEqual({excluded:true,received:true,uncertain:false,pendingSync:false,count:1});
  expect(groupBInvitationBlocker(state)).not.toBeNull();
});
test("pending image reference still blocks when another recognised array is empty", () => {
  const state = originalEnquiryMedia({media:[],answers:{photos:[{source_id:"pending",name:"roof.jpg",mime_type:"image/jpeg"}]}},[]);
  expect(state).toEqual({excluded:true,received:true,uncertain:false,pendingSync:true,count:1});
  expect(groupBInvitationBlocker(state)).not.toBeNull();
});
test("read failure always holds explicit empty arrays, including verified manifests", () => {
  for (const raw of [{media:[]},{media:[],original_media_verification:{complete:true}}]) {
    const state = originalEnquiryMedia(raw,[],true);
    expect(state).toMatchObject({excluded:true,received:false,uncertain:true,pendingSync:false});
    expect(groupBInvitationBlocker(state)).not.toBeNull();
  }
});
test("every recognised empty array contributes a known manifest at either raw level", () => {
  for (const key of ["media","photos","videos","attachments","uploaded_files","uploaded_photos","uploaded_videos"]) {
    for (const raw of [{[key]:[]},{answers:{[key]:[]}}]) expect(originalEnquiryMedia(raw,[]).uncertain).toBe(false);
  }
  expect(originalEnquiryMedia({media:[],photos:[],answers:{videos:[]}},[]).excluded).toBe(false);
});
test("non-null non-array media values remain ambiguous despite an empty array", () => {
  for (const photos of ["roof.jpg",{},false,42]) expect(originalEnquiryMedia({media:[],photos},[])).toMatchObject({excluded:true,uncertain:true});
});
test("historically uncertain manifests are not cleared by new empty arrays or verification", () => {
  expect(originalEnquiryMedia({media:[],original_media_manifest_uncertain:true,original_media_verification:{complete:true}},[])).toMatchObject({excluded:true,uncertain:true});
});
test("non-empty ambiguous array entries still fail closed", () => {
  for (const media of [[{id:"opaque"}],[null],[""]]) expect(originalEnquiryMedia({media},[]).uncertain).toBe(true);
});

test("media-choice intent alone is not an attachment when the manifest confirms zero", () => {
  for (const media_choice of ["yes", "no", "unsure"]) expect(originalEnquiryMedia({answers:{media_choice},media:[],original_media_verification:{complete:true}},[])).toEqual({excluded:false,received:false,uncertain:false,pendingSync:false,count:0});
});
for (const [name,mime] of [["roof.jpg","image/jpeg"],["roof.mov","video/quicktime"]]) test(`${mime}: pending reference and imported document both exclude`, () => {
  const raw = {media:[{source_id:"1",name,mime_type:mime}]};
  expect(originalEnquiryMedia(raw,[])).toMatchObject({excluded:true,received:true,pendingSync:true,count:1});
  const doc = {kind:"intake_media",mime_type:mime,storage_path:`J/intake/base44/${name}`,external_id:"1",source_system:"base44"};
  expect(originalEnquiryMedia(raw,[doc,doc])).toMatchObject({excluded:true,pendingSync:false,count:1});
});
test("unrelated compliance photos and PDFs do not exclude", () => {
  expect(originalEnquiryMedia({media:[{source_id:"pdf",name:"agreement.pdf",mime_type:"application/pdf"}],original_media_verification:{complete:true}},[{kind:"customer_agreement",mime_type:"image/jpeg",storage_path:"J/compliance/signature.jpg"}]).excluded).toBe(false);
});
test("missing legacy manifest, opaque refs and read failures hold without claiming evidence received", () => {
  for (const raw of [{answers:{media_choice:"no"}},{media:[{id:"opaque"}]},null]) expect(originalEnquiryMedia(raw,[])).toMatchObject({excluded:true,received:false,uncertain:true});
  expect(originalEnquiryMedia({media:[],original_media_verification:{complete:true}},[],true).excluded).toBe(true);
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
  const retained = retainOriginalMedia(previous,buildBase44Raw({media:[],media_manifest_complete:true}));
  expect(retained.media).toEqual(previous.media);
  expect(originalEnquiryMedia(retained,[]).excluded).toBe(true);
  const legacy = retainOriginalMedia({answers:{media_choice:"no"}},buildBase44Raw({media:[],media_manifest_complete:true}));
  expect(originalEnquiryMedia(legacy,[])).toMatchObject({excluded:true,uncertain:true});
  expect(originalEnquiryMedia(retainOriginalMedia(legacy,buildBase44Raw({media:[],media_manifest_complete:true})),[]).excluded).toBe(true);
  const rawRef = retainOriginalMedia({answers:{photos:["https://example.test/original.jpg"]}},buildBase44Raw({media:[],media_manifest_complete:true,base44_answers:{media_choice:"no"}}));
  expect(originalEnquiryMedia(rawRef,[])).toMatchObject({received:true,pendingSync:true,excluded:true});
});