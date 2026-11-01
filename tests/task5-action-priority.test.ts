import {expect,test} from 'bun:test';
import {currentOwnerAction,resolveOwnerScreen} from '../src/lib/owner-myjob.core';
const none={taps:false,spot:false,quote:false,pay:false,piesa:false,veec:false,book:false,fixes:false,newquote:false,review:false,turn:false};
for(const action of ['taps','spot','quote','pay','piesa','veec','book','fixes','newquote','review','turn'] as const)test(`home dispatches recorded ${action} action`,()=>{
 const currentAction=currentOwnerAction({...none,[action]:true});expect(currentAction).toBe(action);expect(resolveOwnerScreen('home',{currentAction})).toBe(action);
});
test('pending safety fee outranks a later declaration; signed declarations disappear',()=>{expect(currentOwnerAction({...none,pay:true,piesa:true})).toBe('pay');expect(currentOwnerAction(none)).toBeNull();});
test('current Ready Check release confirmation is shown before quick taps',()=>{expect(currentOwnerAction({...none,turn:true,taps:true})).toBe('turn');});