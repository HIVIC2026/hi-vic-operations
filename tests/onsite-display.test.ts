import {expect,test} from 'bun:test';
import {houseAgeLabel} from '../src/lib/onsite-assessment.core';
test('house age label uses the five website options',()=>{expect(houseAgeLabel({house_built_period:'1990_or_earlier'})).toBe('1990 or earlier');expect(houseAgeLabel(null)).toBe('Age not given');});
