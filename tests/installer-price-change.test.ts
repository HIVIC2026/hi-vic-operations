import {expect,test} from 'bun:test';
import {pendingPriceChange,priceChangeFromEvent,validatePriceChangeReason} from '../src/lib/installer-price-change.core';
import {quoteExpiresAt,quoteValidDaysFor} from '../src/lib/quote-expiry.core';
test('post-send requests require a reason but pre-send edits do not',()=>{
 expect(validatePriceChangeReason(true,'')).not.toBeNull();
 expect(validatePriceChangeReason(true,'More access work')).toBeNull();
 expect(validatePriceChangeReason(false,'')).toBeNull();
});
test('replacement waiting clears only after the newer send',()=>{
 const change=priceChangeFromEvent({price_changed_by_installer:true,previous_price_inc_gst:2500,price_inc_gst:2700,replaces_quote_id:'old'},'2026-11-05T10:00:00Z');
 expect(pendingPriceChange(change,'2026-11-05T09:00:00Z')).toBe(true);
 expect(pendingPriceChange(change,'2026-11-06T09:00:00Z')).toBe(false);
});
test('replacement gets 30 fresh Melbourne days from new send',()=>{
 expect(quoteValidDaysFor('2026-11-06T09:00:00Z')).toBe(30);
 expect(quoteExpiresAt('2026-11-06T09:00:00Z').toISOString()).toBe('2026-12-06T13:00:00.000Z');
});