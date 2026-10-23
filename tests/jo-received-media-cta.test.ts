import { expect, test } from 'bun:test';
import { renderJoOutcomeEmail, type JoOutcomeEmailInput } from '../src/lib/jo-outcome-email.core';

const input: JoOutcomeEmailInput = {
  outcome: 'needs_onsite_confirmation', insulation: 'present', ceilingSizeKnown: true,
  mediaAlreadyReceived: true,
  recipient: { firstName: 'Fictional', propertyAddress: '1 TEST Street VIC 3000', enquiryReference: 'TEST' },
  figures: { veuRebate: 1481.76, customerTotal: 3697.24, totalBeforeRebate: 5179, installation: 4481, piesaFee: 349, apFee: 349, ceilingAreaM2: 150, areaEstimated: false },
  links: { saveMySpotUrl: 'https://estimate.homeinsulationvictoria.com.au/estimate/TEST/campaign', uploadMediaUrl: 'https://estimate.homeinsulationvictoria.com.au/estimate/TEST/video', reviewResultUrl: 'https://estimate.homeinsulationvictoria.com.au/estimate/TEST', calculatorUrl: 'https://estimate.homeinsulationvictoria.com.au/estimate/TEST' },
};

for (const ceilingSizeKnown of [true, false]) {
  test(`received media keeps optional secure upload action, known size ${ceilingSizeKnown}`, () => {
    const mail = renderJoOutcomeEmail({ ...input, ceilingSizeKnown });
    expect(mail?.ctas).toEqual(['upload_media']);
    expect(mail?.html).toContain(`href="${input.links.uploadMediaUrl}"`);
    expect(mail?.plainText).toContain(input.links.uploadMediaUrl);
    expect(mail?.plainText).toContain('Add more photos or video');
    expect(mail?.plainText).toContain('you do not need to upload it again');
    expect(mail?.plainText).toContain('optionally add multiple photos and/or videos');
    expect(mail?.plainText).toContain('don’t enter the roof space');
    expect(mail?.plainText).not.toContain('Please upload clear photos');
  });
}
test('received media with missing secure upload link fails closed', () => {
  expect(() => renderJoOutcomeEmail({ ...input, links: { ...input.links, uploadMediaUrl: '' } })).toThrow('upload_media link is missing');
});
test('ordinary media request retains its existing mandatory upload action', () => {
  const mail = renderJoOutcomeEmail({ ...input, mediaAlreadyReceived: false });
  expect(mail?.ctas).toEqual(['upload_media']);
  expect(mail?.plainText).toContain('Tell us about your insulation');
  expect(mail?.plainText).not.toContain('Add more photos or video');
});