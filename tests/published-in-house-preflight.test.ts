import {expect,test} from 'bun:test';
import {publishedHarnessCapabilities} from '../src/lib/published-in-house-preflight.core';
import {publishedPreflightBlockers} from '../scripts/published-in-house.core';
test('incomplete deployed capture/setup capabilities never authorize the browser runner',()=>{
 const origin='https://portal.homeinsulationvictoria.com.au';
 const proof=publishedHarnessCapabilities(origin,'run-123456789');
 expect(publishedPreflightBlockers(proof,origin,'run-123456789').length).toBe(9);
 expect(proof.messagesCaptured).toBe(false);
 expect(proof.mittiIncludingMediaSimulated).toBe(false);
 expect(proof.setupScoped).toBe(false);
});