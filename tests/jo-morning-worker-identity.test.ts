import {expect,test} from 'bun:test';
import {dateOfBirthProblem,escRegistrationTasks} from '../src/lib/worker-identity.core';
test('ESC date of birth is required, real, and in the past',()=>{
 expect(dateOfBirthProblem(null,'2026-11-02')).not.toBeNull();
 expect(dateOfBirthProblem('2026-11-02','2026-11-02')).not.toBeNull();
 expect(dateOfBirthProblem('2000-02-30','2026-11-02')).not.toBeNull();
 expect(dateOfBirthProblem('1990-05-12','2026-11-02')).toBeNull();
});
test('ESC registration task clears only when registered and ignores crew and removed people',()=>{
 const w={id:'w',business_id:'b',full_legal_name:'Pat Smith',trade_role:'installer',worker_role:'lead',esc_registered:false};
 expect(escRegistrationTasks([w])[0]?.line).toBe('Register Pat Smith with ESC');
 expect(escRegistrationTasks([{...w,esc_registered:true},{...w,worker_role:'crew'},{...w,removed_at:'2026-11-01'}])).toEqual([]);
});