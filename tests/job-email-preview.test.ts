import { describe, expect, it } from 'vitest';
import { renderJobEmailPreview } from '../src/lib/job-email-preview.core';
import type { JoOutcomeEmailInput } from '../src/lib/jo-outcome-email.core';

const input: JoOutcomeEmailInput = {
  outcome: 'likely_eligible', insulation: 'none', ceilingSizeKnown: true,
  recipient: { firstName: 'TEST', propertyAddress: 'Synthetic TEST property', enquiryReference: 'TEST' },
  figures: { veuRebate: 2000, customerTotal: 1498, totalBeforeRebate: 3498, installation: 2800, piesaFee: 349, apFee: 349, ceilingAreaM2: 150, areaEstimated: false },
  links: { saveMySpotUrl: 'https://example.com/campaign', uploadMediaUrl: 'https://example.com/video', reviewResultUrl: 'https://example.com/result', calculatorUrl: 'https://example.com/calculator' },
};
describe('stored job preview', () => {
  it('uses the approved known-size no-insulation template', () => {
    expect(renderJobEmailPreview(input)?.templateId).toBe('eligible_no_insulation_size_known');
  });
  it('uses the unknown-size insulation template when size is assumed', () => {
    expect(renderJobEmailPreview({ ...input, outcome: 'needs_onsite_confirmation', insulation: 'unknown', ceilingSizeKnown: false })?.templateId).toBe('potentially_eligible_unknown_size_unknown');
  });
  it('requires a recorded qualifying review for the reviewed template', () => {
    expect(renderJobEmailPreview({ ...input, insulation: 'present', deskCheckStatus: 'looks_eligible' })?.templateId).toBe('eligible_below_r2_reviewed_size_known');
  });
  it('can preview ineligible without an estimate', () => {
    expect(renderJobEmailPreview({ ...input, outcome: 'does_not_appear_eligible', figures: undefined })?.templateId).toBe('ineligible');
  });
  it('does not invent absent prices', () => {
    expect(renderJobEmailPreview({ ...input, figures: undefined })).toBeNull();
  });
  it('rejects invalid stored rebate', () => {
    expect(renderJobEmailPreview({ ...input, figures: { ...input.figures as NonNullable<JoOutcomeEmailInput['figures']>, veuRebate: NaN } })).toBeNull();
  });
});